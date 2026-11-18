/** `xg.*` tools for Worker and main Sessions; project scope is resolved from the Session's Ticket, never from model input. */
import type { Agent } from '@deepseek-ai/dsh-agent'
import { z } from 'zod'
import { TASK_STATUSES, TASK_TYPES, type Task, type TaskType } from './domain.ts'
import type { XgService } from './service.ts'
import type { XgStore } from './store.ts'
import type { Tool } from '../app/tools/tool.ts'

/** Local constructor so the xg tools do not import the upstream tool registry's runtime modules (and their cycles). */
const tool = <S extends z.ZodType>(definition: Tool<S>): Tool<S> => definition as unknown as Tool<S>

export interface XgToolsHost {
  readonly service: XgService
  readonly store: XgStore
  /** Outbound guard; omitted in unit tests that do not exercise filtering. */
  readonly policy?: { guardFields<T extends Record<string, unknown>>(value: T, sensitivity: '公开' | '内部' | '机密'): T }
}

export interface XgToolScope {
  /** The Executor Ticket whose Session is calling; absent in the main Session. */
  ticket?: { id: string }
  agent: Agent
}

const TaskSchema = z.string().min(1).describe('任务 ID，例如 BIL-42。Worker 可省略；主控必须提供。')

function safe<T>(host: XgToolsHost, value: T, sensitivity: '公开' | '内部' | '机密'): T {
  if (!host.policy) return value
  return host.policy.guardFields({ value }, sensitivity).value as T
}

function scopeOf(host: XgToolsHost, scope: XgToolScope, requested?: string): { task: Task; worker: boolean } {
  const byTicket = scope.ticket ? host.store.attempts.byTicket(scope.ticket.id) : undefined
  const workerTask = byTicket ? host.store.tasks.get(byTicket.taskId) : undefined
  if (scope.ticket && !workerTask) throw new Error('当前 Ticket 未绑定工作台任务；请通过 xg 任务派发')
  if (workerTask && requested && requested !== workerTask.id) throw new Error('Worker 只能访问自己的任务')
  const taskId = workerTask?.id ?? requested
  if (!taskId) throw new Error('主控调用需要 task_id')
  const task = host.store.tasks.get(taskId)
  if (!task) throw new Error(`任务不存在：${taskId}`)
  return { task, worker: !!workerTask }
}

function summaryOf(host: XgToolsHost, task: Task) {
  const detail = host.service.taskDetail(task.id)
  return safe(host, detail, detail.project.sensitivity)
}

/** Builds the xg tool set for one Session; Workers get reporting tools, the main Session gets reviewing and acceptance tools. */
export function xgTools(host: XgToolsHost, scope: XgToolScope): Tool[] {
  const worker = !!scope.ticket
  const main: Tool[] = [
    tool({
      name: 'xg.project.list',
      description: '列出雄大工作台的项目及其任务状态计数。主控开工前先用它确认当前实例有哪些项目。',
      schema: z.object({}).strict(),
      execute: async () => ({ items: host.store.projects.list().map(project => ({ ...project,
        tasks: host.store.tasks.counts(project.id) })) }),
    }),
    tool({
      name: 'xg.task.list',
      description: '列出雄大工作台的任务（不包含已删除任务），可按状态、类型和数量过滤。任务 ID 来自这里，不要自己编造。',
      schema: z.object({
        status: z.enum(TASK_STATUSES).optional(),
        type: z.enum(TASK_TYPES).optional(),
        limit: z.number().int().min(1).max(100).default(50),
      }).strict(),
      execute: async (args: { status?: Task['status']; type?: TaskType; limit: number }) => {
        const page = host.store.tasks.list({ status: args.status, type: args.type, limit: args.limit })
        return { total: page.total, items: page.items.map(task => ({ ...task,
          projectShortCode: host.store.projects.get(task.projectId)?.shortCode ?? null })) }
      },
    }),
    tool({
      name: 'xg.overview',
      description: '雄大工作台概览：项目数、任务状态计数、活动任务、未处理收件、待复核记忆和评审数量。',
      schema: z.object({}).strict(),
      execute: async () => host.service.overview(),
    }),
    tool({
      name: 'xg.requirement.list',
      description: '列出雄大工作台的需求，可按项目短码过滤；返回需求 ID、标题、状态、优先级和所属项目。',
      schema: z.object({ project_short_code: z.string().trim().min(1).optional(), limit: z.number().int().min(1).max(100).default(50) }).strict(),
      execute: async (args: { project_short_code?: string; limit: number }) => {
        const project = args.project_short_code ? host.store.projects.byShortCode(args.project_short_code.trim().toUpperCase()) : undefined
        const page = host.store.requirements.list({ projectId: project?.id, limit: args.limit })
        return { total: page.total, items: page.items.map(requirement => ({ ...requirement,
          projectShortCode: host.store.projects.get(requirement.projectId)?.shortCode ?? null })) }
      },
    }),
    tool({
      name: 'xg.memory.list',
      description: '列出雄大工作台的记忆条目，可按状态过滤；待复核条目需要人确认后才能进入检索。',
      schema: z.object({
        status: z.enum(['草稿', '待复核', '已确认', '已废弃']).optional(),
        limit: z.number().int().min(1).max(100).default(50),
      }).strict(),
      execute: async (args: { status?: '草稿' | '待复核' | '已确认' | '已废弃'; limit: number }) => {
        const page = host.store.memory.list({ status: args.status, limit: args.limit })
        return { total: page.total, items: page.items }
      },
    }),
    tool({
      name: 'xg.task.get',
      description: '读取雄大工作台任务、需求、规格、验收标准、执行尝试、证据、评审和事件。Worker 省略 task_id，主控必须提供。',
      schema: z.object({ task_id: TaskSchema.optional() }).strict(),
      execute: async (args: { task_id?: string }) => {
        const { task } = scopeOf(host, scope, args.task_id)
        return summaryOf(host, task)
      },
    }),
    tool({
      name: 'xg.memory.search',
      description: '搜索项目记忆（已确认的领域、决策、经验、故障、交接）。按当前任务的项目隔离，不能跨项目。',
      schema: z.object({
        task_id: TaskSchema.optional(),
        query: z.string().trim().min(1).describe('关键词，支持中文；多个词用空格分隔。'),
        type: z.enum(['领域', '决策', '经验', '故障', '交接']).optional(),
        limit: z.number().int().min(1).max(50).default(10),
      }).strict(),
      execute: async (args: { task_id?: string; query: string; type?: '领域' | '决策' | '经验' | '故障' | '交接'; limit: number }) => {
        const { task } = scopeOf(host, scope, args.task_id)
        const project = host.store.projects.get(task.projectId)!
        return { items: safe(host, host.service.searchMemory({ projectId: task.projectId, query: args.query, limit: args.limit,
          ...(args.type ? { types: [args.type] } : {}), statuses: ['已确认'] }), project.sensitivity) }
      },
    }),
    tool({
      name: 'xg.memory.propose',
      description: '提交一条记忆草稿。必须给出至少一条证据产物 ID；主控校验后由人确认，AI 不能直接确认。',
      schema: z.object({
        task_id: TaskSchema.optional(),
        type: z.enum(['领域', '决策', '经验', '故障', '交接']),
        title: z.string().trim().min(1).max(200),
        content: z.string().trim().min(1),
        tags: z.array(z.string().trim().min(1)).max(20).default([]),
        artifact_ids: z.array(z.string().min(1)).min(1).describe('至少一条证据产物 ID。'),
      }).strict(),
      execute: async (args: { task_id?: string; type: '领域' | '决策' | '经验' | '故障' | '交接'; title: string; content: string;
        tags: string[]; artifact_ids: string[] }) => {
        const { task } = scopeOf(host, scope, args.task_id)
        return host.service.proposeMemory({ projectId: task.projectId, type: args.type, title: args.title, content: args.content,
          sourceType: '任务', sourceRef: task.id, tags: args.tags, artifactIds: args.artifact_ids })
      },
    }),
    tool({
      name: 'xg.review.get',
      description: '读取评审所需的任务、验收标准、实现尝试、证据和此前的评审结论。',
      schema: z.object({ task_id: TaskSchema.optional() }).strict(),
      execute: async (args: { task_id?: string }) => {
        const { task } = scopeOf(host, scope, args.task_id)
        const detail = summaryOf(host, task)
        return { task: detail.task, requirement: detail.requirement, spec: detail.spec, attempts: detail.attempts,
          artifacts: detail.artifacts, reviews: detail.reviews }
      },
    }),
    tool({
      name: 'xg.review.submit',
      description: '提交评审结论：通过进入待验收，退回进入进行中。评审会话必须与实现会话不同。',
      schema: z.object({
        task_id: TaskSchema.optional(),
        decision: z.enum(['通过', '退回']),
        comments: z.string().max(5000).optional(),
        reviewer_session: z.string().min(1).optional().describe('评审使用的会话 ID；不得与实现会话相同。'),
      }).strict(),
      execute: async (args: { task_id?: string; decision: '通过' | '退回'; comments?: string; reviewer_session?: string }) => {
        const { task } = scopeOf(host, scope, args.task_id)
        const result = host.service.submitReview(task.id, { decision: args.decision, comments: args.comments,
          reviewerSession: args.reviewer_session })
        return { task: result.task, review: result.review }
      },
    }),
    tool({
      name: 'xg.task.accept',
      description: '人工最终验收：只有待验收任务可以改为完成，并记录验收人。Agent 只有在人明确要求时代为调用。',
      schema: z.object({ task_id: TaskSchema.optional(), accepted_by: z.string().trim().min(1).default('你') }).strict(),
      execute: async (args: { task_id?: string; accepted_by: string }) => {
        const { task } = scopeOf(host, scope, args.task_id)
        return host.service.acceptTask(task.id, args.accepted_by)
      },
    }),
    tool({
      name: 'xg.proposal.create',
      description: '提交一条需求拆解提案。不会直接创建任务：人看 diff 后点“应用”才会落库。用于把确认过的需求拆成可执行任务。',
      schema: z.object({
        requirement_id: z.string().min(1),
        title: z.string().trim().min(1).max(200),
        summary: z.string().trim().max(2000).optional(),
        tasks: z.array(z.object({
          title: z.string().trim().min(1).max(200),
          type: z.enum(TASK_TYPES),
          priority: z.enum(['P0', 'P1', 'P2', 'P3']),
          description: z.string().max(5000).optional(),
          acceptance: z.string().max(5000).optional(),
        })).min(1).max(20),
      }).strict(),
      execute: async (args: { requirement_id: string; title: string; summary?: string;
        tasks: { title: string; type: TaskType; priority: 'P0' | 'P1' | 'P2' | 'P3'; description?: string; acceptance?: string }[] }) =>
        host.service.createProposal({ kind: 'requirement.split', targetType: 'requirement', targetId: args.requirement_id,
          title: args.title, summary: args.summary, payload: { tasks: args.tasks }, createdBy: '智能体' }),
    }),
    tool({
      name: 'xg.proposal.list',
      description: '查看工作台的 Agent 提案，默认只看待确认；应用和拒绝由人操作。',
      schema: z.object({
        status: z.enum(['待确认', '已应用', '已拒绝', '已过期']).default('待确认'),
        limit: z.number().int().min(1).max(100).default(30),
      }).strict(),
      execute: async (args: { status: '待确认' | '已应用' | '已拒绝' | '已过期'; limit: number }) =>
        host.service.listProposals({ status: args.status, limit: args.limit }),
    }),
    tool({
      name: 'xg.inbox.list',
      description: '读取未处理收件（企微、邮箱、电话、同事、其他），只读；建需求和拆任务由人确认。',
      schema: z.object({ limit: z.number().int().min(1).max(100).default(30) }).strict(),
      execute: async (args: { limit: number }) => {
        const items = host.service.store.inbox.list({ status: '未处理', limit: args.limit }).items
        return { items }
      },
    }),
    tool({
      name: 'xg.requirement.get',
      description: '读取需求及其任务列表；Worker 省略 requirement_id，主控用 task_id 或 requirement_id 指定。',
      schema: z.object({ requirement_id: z.string().min(1).optional(), task_id: TaskSchema.optional() }).strict(),
      execute: async (args: { requirement_id?: string; task_id?: string }) => {
        let requirementId = args.requirement_id
        if (!requirementId) {
          const { task } = scopeOf(host, scope, args.task_id)
          requirementId = task.requirementId
        }
        const requirement = host.service.store.requirements.get(requirementId)
        if (!requirement) throw new Error(`需求不存在：${requirementId}`)
        const project = host.store.projects.get(requirement.projectId)!
        return safe(host, { requirement, tasks: host.service.store.tasks.list({ projectId: requirement.projectId,
          requirementId: requirement.id, limit: 200 }).items }, project.sensitivity)
      },
    }),
  ]
  if (!worker) return main
  return [
    tool({
      name: 'xg.task.get',
      description: '读取当前雄大工作台任务、需求、规格、验收标准、执行尝试、证据、评审和事件。',
      schema: z.object({}).strict(),
      execute: async () => {
        const { task } = scopeOf(host, scope)
        return summaryOf(host, task)
      },
    }),
    tool({
      name: 'xg.task.report',
      description: '向雄大工作台报告进度、就绪、阻塞、失败或放弃；ready 只会让任务进入评审，不会直接完成。',
      schema: z.object({
        state: z.enum(['progress', 'waiting', 'ready', 'blocked', 'failed', 'dropped']),
        summary: z.string().trim().min(1).max(5000),
        attention: z.string().trim().min(1).max(1000).nullish().describe('需要人回答的具体问题；没有就省略。'),
        stage: z.string().trim().max(100).optional(),
      }).strict(),
      execute: async (args: { state: 'progress' | 'waiting' | 'ready' | 'blocked' | 'failed' | 'dropped'; summary: string;
        attention?: string | null; stage?: string }) => {
        const { task } = scopeOf(host, scope)
        const result = host.service.report(task.id, { state: args.state, summary: args.summary,
          attention: args.attention ?? null, stage: args.stage ?? null })
        return { task: result.task, attempt: result.attempt }
      },
    }),
    tool({
      name: 'xg.artifact.add',
      description: '添加证据、代码、文档、复盘或其他产物；证据用于评审和记忆，不写进任务列表。',
      schema: z.object({
        type: z.enum(['证据', '代码', '文档', '复盘', '其他']),
        title: z.string().trim().max(200).optional(),
        content: z.string().max(200_000).optional(),
        uri: z.string().trim().max(2000).optional(),
      }).strict(),
      execute: async (args: { type: '证据' | '代码' | '文档' | '复盘' | '其他'; title?: string; content?: string; uri?: string }) => {
        const { task } = scopeOf(host, scope)
        return host.service.addArtifact(task.id, args)
      },
    }),
    tool({
      name: 'xg.triage.record',
      description: '排障任务专用：按取证 → 假设 → 根因记录。取证必须引用 type=证据 的产物；没有取证不能假设，没有假设和证据不能根因。',
      schema: z.object({
        stage: z.enum(['取证', '假设', '根因']),
        content: z.string().trim().min(1).max(20_000),
        artifact_id: z.string().min(1).optional().describe('取证阶段必须提供，指向 xg.artifact.add(type=证据) 的产物。'),
      }).strict(),
      execute: async (args: { stage: '取证' | '假设' | '根因'; content: string; artifact_id?: string }) => {
        const { task } = scopeOf(host, scope)
        return host.service.recordTriage(task.id, { stage: args.stage, content: args.content, artifactId: args.artifact_id })
      },
    }),
    tool({
      name: 'xg.memory.search',
      description: '搜索本项目的已确认记忆，用于排障前查找相似故障、开工前查领域和决策。',
      schema: z.object({
        query: z.string().trim().min(1),
        type: z.enum(['领域', '决策', '经验', '故障', '交接']).optional(),
        limit: z.number().int().min(1).max(50).default(10),
      }).strict(),
      execute: async (args: { query: string; type?: '领域' | '决策' | '经验' | '故障' | '交接'; limit: number }) => {
        const { task } = scopeOf(host, scope)
        const project = host.store.projects.get(task.projectId)!
        return { items: safe(host, host.service.searchMemory({ projectId: task.projectId, query: args.query, limit: args.limit,
          ...(args.type ? { types: [args.type] } : {}), statuses: ['已确认'] }), project.sensitivity) }
      },
    }),
    tool({
      name: 'xg.memory.propose',
      description: '提交记忆草稿，必须关联至少一条证据产物；由人确认后才进入检索。',
      schema: z.object({
        type: z.enum(['领域', '决策', '经验', '故障', '交接']),
        title: z.string().trim().min(1).max(200),
        content: z.string().trim().min(1),
        tags: z.array(z.string().trim().min(1)).max(20).default([]),
        artifact_ids: z.array(z.string().min(1)).min(1),
      }).strict(),
      execute: async (args: { type: '领域' | '决策' | '经验' | '故障' | '交接'; title: string; content: string; tags: string[];
        artifact_ids: string[] }) => {
        const { task } = scopeOf(host, scope)
        return host.service.proposeMemory({ projectId: task.projectId, type: args.type, title: args.title, content: args.content,
          sourceType: '任务', sourceRef: task.id, tags: args.tags, artifactIds: args.artifact_ids })
      },
    }),
    tool({
      name: 'xg.attention.raise',
      description: '向人提出一个具体问题并进入阻塞；一次只问一个问题。',
      schema: z.object({ question: z.string().trim().min(1).max(1000), summary: z.string().trim().max(5000).optional() }).strict(),
      execute: async (args: { question: string; summary?: string }) => {
        const { task } = scopeOf(host, scope)
        const result = host.service.report(task.id, { state: 'blocked', summary: args.summary ?? args.question, attention: args.question })
        return { task: result.task, attempt: result.attempt }
      },
    }),
    tool({
      name: 'xg.requirement.get',
      description: '读取当前任务所属的需求和同需求任务。',
      schema: z.object({}).strict(),
      execute: async () => {
        const { task } = scopeOf(host, scope)
        const requirement = host.service.store.requirements.get(task.requirementId)
        if (!requirement) throw new Error('需求不存在')
        const project = host.store.projects.get(task.projectId)!
        return safe(host, { requirement, tasks: host.service.store.tasks.list({ projectId: project.id, requirementId: requirement.id,
          limit: 200 }).items }, project.sensitivity)
      },
    }),
  ]
}

/** Tool names a worker or the main Session may see; the xg tools are registered per Session, not globally. */
export const XG_TOOL_NAMES = ['xg.project.list', 'xg.task.list', 'xg.overview', 'xg.requirement.list', 'xg.memory.list',
  'xg.task.get', 'xg.task.report', 'xg.artifact.add', 'xg.triage.record', 'xg.memory.search', 'xg.memory.propose',
  'xg.attention.raise', 'xg.review.get', 'xg.review.submit', 'xg.task.accept', 'xg.inbox.list', 'xg.requirement.get',
  'xg.proposal.create', 'xg.proposal.list'] as const

export type XgToolName = typeof XG_TOOL_NAMES[number]
export type { TaskType }
