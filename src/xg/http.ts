/** Loopback-only `/xg/api` routes for the workbench panel. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import { sameOrigin } from '../app/http.ts'
import type { XgService } from './service.ts'
import type { XgStore } from './store.ts'

export interface XgHttpHost {
  readonly service: XgService
  readonly store: XgStore
}

const TaskTypeSchema = z.enum(['设计', '开发', '排障', '评审'])
const PrioritySchema = z.enum(['P0', 'P1', 'P2', 'P3'])
const ChannelSchema = z.enum(['企微', '邮箱', '电话', '同事', '其他'])
const MemoryTypeSchema = z.enum(['领域', '决策', '经验', '故障', '交接'])

/** A client-facing 400 or 404 raised while parsing an xg route, serialized with its status. */
class RouteError extends Error { constructor(readonly status: 400 | 404, message: string) { super(message) } }

async function readBody(req: IncomingMessage, maxBytes = 512 * 1024): Promise<unknown> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    const bytes = Buffer.from(chunk)
    size += bytes.length
    if (size > maxBytes) throw new RouteError(400, `请求超过 ${maxBytes} 字节`)
    chunks.push(bytes)
  }
  if (!size) return {}
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown }
  catch { throw new RouteError(400, '请求体不是 JSON') }
}
function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
  res.end(JSON.stringify(value))
}
function failure(error: unknown): [number, { error: string }] {
  if (error instanceof RouteError) return [error.status, { error: error.message }]
  if (error instanceof z.ZodError) return [400, { error: error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ') }]
  const message = error instanceof Error ? error.message : String(error)
  return [message.includes('不存在') ? 404 : 400, { error: message }]
}
const query = (url: URL) => Object.fromEntries(url.searchParams)

/**
 * Register the xg panel API. It shares the loopback web server and same-origin rule with `/orchestrator/api`,
 * but lives under its own prefix so the upstream routes stay untouched.
 */
export function registerXgHttp(ctx: Context, host: XgHttpHost): () => void {
  if (ctx.webServer.host !== '127.0.0.1') throw new Error('雄大工作台需要 loopback Web 服务')
  return ctx.webServer.register({ kind: 'prefix', path: '/xg', handler: async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (!url.pathname.startsWith('/xg/api/')) { res.writeHead(404); res.end(); return }
    if (!sameOrigin(req, ctx.webServer.port)) { json(res, 403, { error: '需要同源管理请求' }); return }
    const { service, store } = host
    const path = url.pathname.slice('/xg/api/'.length).replace(/\/+$/, '')
    const segments = path ? path.split('/').map(segment => decodeURIComponent(segment)) : []
    const id = (index = 1) => {
      const value = segments[index]
      if (!value) throw new RouteError(404, '缺少 ID')
      return value
    }
    const q = query(url)
    const method = req.method ?? 'GET'
    const body = (): Promise<unknown> => readBody(req)
    try {
      if (method === 'GET' && segments[0] === 'overview') return json(res, 200, service.overview())
      if (method === 'GET' && segments[0] === 'workbench' && segments.length === 1) {
        return json(res, 200, {
          overview: service.overview(),
          projects: store.projects.list(),
          requirements: store.requirements.list({ limit: 500 }).items,
          tasks: store.tasks.list({ limit: 500 }).items,
          inbox: store.inbox.list({ limit: 200 }).items,
          memory: store.memory.list({ limit: 500 }).items,
          proposals: store.proposals.list({ limit: 200 }).items,
          reviews: store.reviews.listAll(200),
          audit: store.audit.list({ limit: 120 }),
        })
      }
      if (method === 'GET' && segments[0] === 'projects' && segments.length === 1) {
        return json(res, 200, { items: store.projects.list(), total: store.projects.list().length })
      }
      if (method === 'POST' && segments[0] === 'projects' && segments.length === 1) {
        const input = z.object({ shortCode: z.string().min(1), name: z.string().min(1), rootPath: z.string().optional(),
          sensitivity: z.enum(['公开', '内部', '机密']).optional() }).parse(await body())
        return json(res, 200, service.createProject(input))
      }
      if (method === 'GET' && segments[0] === 'projects' && segments[2] === 'settings') {
        return json(res, 200, service.projectSettings(id(1)))
      }
      if (method === 'POST' && segments[0] === 'projects' && segments[2] === 'settings') {
        const input = z.object({
          rootPath: z.string().nullable().optional(),
          sensitivity: z.enum(['公开', '内部', '机密']).optional(),
          workerModel: z.object({ provider: z.string().min(1), model: z.string().min(1), reasoningEffort: z.string().optional() }).nullable().optional(),
          autoDispatch: z.boolean().optional(),
          defaultPriority: z.enum(['P0', 'P1', 'P2', 'P3']).nullable().optional(),
        }).parse(await body())
        return json(res, 200, service.saveProjectSettings(id(1), input))
      }
      if (method === 'GET' && segments[0] === 'requirements') {
        return json(res, 200, store.requirements.list({ projectId: q.projectId || undefined,
          status: z.enum(['待确认', '已确认', '已拆分', '已关闭']).optional().parse(q.status || undefined) }))
      }
      if (method === 'POST' && segments[0] === 'requirements' && segments.length === 1) {
        const input = z.object({ projectId: z.string().min(1), title: z.string().min(1), description: z.string().optional(),
          sourceNote: z.string().optional(), priority: PrioritySchema.optional() }).parse(await body())
        return json(res, 200, service.createRequirement(input))
      }
      if (method === 'POST' && segments[0] === 'requirements' && segments[2] === 'confirm') {
        return json(res, 200, service.confirmRequirement(id(1)))
      }
      if (method === 'POST' && segments[0] === 'requirements' && segments[2] === 'split') {
        const input = z.object({ tasks: z.array(z.object({ title: z.string().min(1), type: TaskTypeSchema, priority: PrioritySchema,
          description: z.string().optional(), acceptance: z.string().optional() })).min(1) }).parse(await body())
        return json(res, 200, service.splitRequirement(id(1), input.tasks))
      }
      if (method === 'POST' && segments[0] === 'requirements' && segments[2] === 'delete') {
        return json(res, 200, service.deleteRequirement(id(1)))
      }
      if (method === 'GET' && segments[0] === 'inbox') {
        return json(res, 200, store.inbox.list({ projectId: q.projectId || undefined,
          status: z.enum(['未处理', '已建需求', '已忽略']).optional().parse(q.status || undefined) }))
      }
      if (method === 'POST' && segments[0] === 'inbox' && segments.length === 1) {
        const input = z.object({ channel: ChannelSchema, contact: z.string().optional(), rawContext: z.string().optional(),
          projectId: z.string().optional(), externalRef: z.string().optional() }).parse(await body())
        return json(res, 200, service.createInboxItem(input))
      }
      if (method === 'POST' && segments[0] === 'inbox' && segments[2] === 'triage') {
        const input = z.object({ projectId: z.string().min(1), title: z.string().min(1), description: z.string().optional(),
          priority: PrioritySchema.optional() }).parse(await body())
        return json(res, 200, service.triageInbox(id(1), input))
      }
      if (method === 'POST' && segments[0] === 'inbox' && segments[2] === 'ignore') {
        return json(res, 200, service.ignoreInbox(id(1)))
      }
      if (method === 'POST' && segments[0] === 'inbox' && segments[2] === 'delete') {
        return json(res, 200, service.deleteInbox(id(1)))
      }
      if (method === 'GET' && segments[0] === 'proposals') {
        return json(res, 200, store.proposals.list({ projectId: q.projectId || undefined,
          status: z.enum(['待确认', '已应用', '已拒绝', '已过期']).optional().parse(q.status || undefined),
          targetType: q.targetType || undefined, targetId: q.targetId || undefined, limit: 200 }))
      }
      if (method === 'POST' && segments[0] === 'proposals' && segments.length === 1) {
        const input = z.object({ kind: z.literal('requirement.split'), targetType: z.literal('requirement'),
          targetId: z.string().min(1), title: z.string().min(1), summary: z.string().optional(),
          payload: z.object({ tasks: z.array(z.object({ title: z.string().min(1), type: TaskTypeSchema, priority: PrioritySchema,
            description: z.string().optional(), acceptance: z.string().optional() })).min(1) }),
          createdBy: z.string().trim().min(1).optional() }).parse(await body())
        return json(res, 200, service.createProposal(input))
      }
      if (method === 'POST' && segments[0] === 'proposals' && segments[2] === 'apply') {
        const input = z.object({ by: z.string().trim().min(1).optional() }).parse(await body())
        return json(res, 200, service.applyProposal(id(1), input.by ?? '你'))
      }
      if (method === 'POST' && segments[0] === 'proposals' && segments[2] === 'reject') {
        const input = z.object({ by: z.string().trim().min(1).optional(), reason: z.string().optional() }).parse(await body())
        return json(res, 200, service.rejectProposal(id(1), input.reason ?? '', input.by ?? '你'))
      }
      if (method === 'GET' && segments[0] === 'tasks' && segments.length === 1) {
        return json(res, 200, store.tasks.list({ projectId: q.projectId || undefined,
          status: z.enum(['就绪', '进行中', '评审', '待验收', '完成', '阻塞', '取消']).optional().parse(q.status || undefined),
          type: z.enum(['设计', '开发', '排障', '评审']).optional().parse(q.type || undefined) }))
      }
      if (method === 'GET' && segments[0] === 'tasks' && segments.length === 2) {
        return json(res, 200, service.taskDetail(id(1)))
      }
      if (method === 'POST' && segments[0] === 'tasks' && segments.length === 1) {
        const input = z.object({ projectId: z.string().min(1), requirementId: z.string().min(1), title: z.string().min(1),
          type: TaskTypeSchema, priority: PrioritySchema, description: z.string().optional(), acceptance: z.string().optional(),
          autoDispatch: z.boolean().optional() }).parse(await body())
        return json(res, 200, service.createTask(input))
      }
      if (method === 'POST' && segments[0] === 'tasks' && segments[2] === 'dispatch') {
        return json(res, 200, service.dispatchTask(id(1)))
      }
      if (method === 'POST' && segments[0] === 'tasks' && segments[2] === 'retry') {
        return json(res, 200, service.retryTask(id(1)))
      }
      if (method === 'POST' && segments[0] === 'tasks' && segments[2] === 'cancel') {
        return json(res, 200, service.cancelTask(id(1)))
      }
      if (method === 'POST' && segments[0] === 'tasks' && segments[2] === 'delete') {
        return json(res, 200, service.deleteTask(id(1)))
      }
      if (method === 'POST' && segments[0] === 'tasks' && segments[2] === 'accept') {
        const input = z.object({ acceptedBy: z.string().trim().min(1).optional() }).parse(await body())
        return json(res, 200, service.acceptTask(id(1), input.acceptedBy))
      }
      if (method === 'POST' && segments[0] === 'tasks' && segments[2] === 'spec') {
        const input = z.object({ content: z.string().trim().min(1), approve: z.boolean().optional(), approvedBy: z.string().trim().min(1).optional() })
          .parse(await body())
        return json(res, 200, service.saveSpec(id(1), input))
      }
      if (method === 'POST' && segments[0] === 'tasks' && segments[2] === 'review') {
        const input = z.object({ decision: z.enum(['通过', '退回']), comments: z.string().optional(), reviewer: z.string().optional(),
          reviewerSession: z.string().optional() }).parse(await body())
        return json(res, 200, service.submitReview(id(1), input))
      }
      if (method === 'GET' && segments[0] === 'memory') {
        if (q.q?.trim()) {
          if (!q.projectId) throw new RouteError(400, '搜索记忆需要 projectId')
          return json(res, 200, { items: service.searchMemory({ projectId: q.projectId, query: q.q, limit: 50,
            ...(q.type ? { types: [MemoryTypeSchema.parse(q.type)] } : {}), statuses: ['已确认'] }), total: 0 })
        }
        return json(res, 200, store.memory.list({ projectId: q.projectId || undefined,
          status: z.enum(['草稿', '待复核', '已确认', '已废弃']).optional().parse(q.status || undefined),
          type: MemoryTypeSchema.optional().parse(q.type || undefined) }))
      }
      if (method === 'POST' && segments[0] === 'memory' && segments.length === 1) {
        const input = z.object({ projectId: z.string().min(1), type: MemoryTypeSchema, title: z.string().min(1), content: z.string().min(1),
          sourceType: z.enum(['任务', '会话', '人工']), sourceRef: z.string().optional(), tags: z.array(z.string()).optional(),
          artifactIds: z.array(z.string()).optional() }).parse(await body())
        return json(res, 200, service.proposeMemory(input))
      }
      if (method === 'POST' && segments[0] === 'memory' && segments[1] === 'verify' && segments.length === 2) {
        const input = z.object({ projectId: z.string().min(1) }).parse(await body())
        return json(res, 200, service.verifyMemoryRefs(input.projectId))
      }
      if (method === 'POST' && segments[0] === 'memory' && segments[2] === 'confirm') {
        const input = z.object({ by: z.string().optional() }).parse(await body())
        return json(res, 200, service.confirmMemory(id(1), input.by))
      }
      if (method === 'POST' && segments[0] === 'memory' && segments[2] === 'reject') {
        const input = z.object({ by: z.string().optional(), reason: z.string().optional() }).parse(await body())
        return json(res, 200, service.rejectMemory(id(1), input.by, input.reason))
      }
      if (method === 'GET' && segments[0] === 'reviews') {
        const items = q.projectId ? store.reviews.listProject(q.projectId) : store.reviews.listAll()
        return json(res, 200, { items, total: items.length })
      }
      if (method === 'GET' && segments[0] === 'audit') {
        const items = store.audit.list({ projectId: q.projectId || undefined, limit: 200 })
        return json(res, 200, { items, total: items.length })
      }
      throw new RouteError(404, '未知的 xg 操作')
    } catch (error) {
      const [status, payload] = failure(error)
      json(res, status, payload)
    }
  } })
}
