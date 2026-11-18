import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { Engine, MemoryRepositories, type Assignment, type Executor, type OutboundMessage, type Policy, type Ticket } from '../src/core/index.ts'
import { XgPolicy } from '../src/xg/policy.ts'
import { EngineTicketGateway, XgService } from '../src/xg/service.ts'
import { XgStore } from '../src/xg/store.ts'
import { xgTools, type XgToolScope } from '../src/xg/tools.ts'
import { XgRuntime } from '../src/xg/runtime.ts'

function harness(policy = new XgPolicy()) {
  const repo = new MemoryRepositories()
  const starts: [Ticket, Assignment][] = []
  const executor: Executor = { start: (ticket, assignment) => { starts.push([ticket, assignment]) }, deliver: () => {}, stop: () => {} }
  const runtimePolicy: Policy = {
    version: 'v1', paused: false, evalTimeoutMs: 60_000,
    gate: () => ({ admissible: true, strength: 'explicit', basis: { via: 'followup' } }),
    revalidate: () => true, admitsInferred: () => true,
  }
  const outbox = { send: (message: OutboundMessage) => { void message }, status: () => 'sent' as const, withdraw: () => {} }
  const engine = new Engine({ repo, scope: { scope: () => ({ listened: true, observed: false }) }, policy: () => runtimePolicy,
    assessor: { request: () => {} }, executor, outbox })
  const db = new DatabaseSync(':memory:')
  const store = new XgStore(db)
  const service = new XgService({ store, gateway: new EngineTicketGateway(engine, repo.tickets), tickets: repo.tickets, policy })
  return { repo, engine, store, service, starts, db, policy }
}
const agent = {} as Agent
const signal = () => AbortSignal.timeout(5_000)
const call = async <T>(tools: ReturnType<typeof xgTools>, name: string, args: unknown): Promise<T> => {
  const tool = tools.find(item => item.name === name)
  if (!tool) throw new Error(`missing tool ${name}`)
  // Sessions parse the schema before executing; do the same so strict schemas reject out-of-scope arguments.
  return await tool.execute(tool.schema.parse(args) as never, signal()) as T
}
function seed(service: XgService, type: '开发' | '排障' = '开发') {
  const project = service.createProject({ shortCode: 'BIL', name: '账单' })
  const requirement = service.createRequirement({ projectId: project.id, title: '登录', sourceNote: '人工' })
  service.confirmRequirement(requirement.id)
  const task = service.createTask({ projectId: project.id, requirementId: requirement.id, title: '修复登录', type, priority: 'P1' })
  return { project, requirement, task }
}

describe('xg tools', () => {
  it('scopes a Worker to its Ticket task and exposes the report, evidence, triage, memory and review flow', async () => {
    const h = harness()
    const { task } = seed(h.service, '排障')
    h.service.saveSpec(task.id, { content: '连接池上限 20', approve: true })
    const run = h.service.dispatchTask(task.id)
    const ticket = h.repo.tickets.get(run.attempt.ticketId!)!
    const worker = xgTools(h, { agent, ticket: { id: ticket.id } })
    const detail = await call<{ task: { id: string }; spec: { content: string } | null }>(worker, 'xg.task.get', {})
    expect(detail.task.id).toBe(task.id)
    expect(detail.spec?.content).toBe('连接池上限 20')
    const evidence = await call<{ id: string }>(worker, 'xg.artifact.add', { type: '证据', title: '日志', content: 'timeout' })
    expect(evidence.id).toBeTruthy()
    await call(worker, 'xg.triage.record', { stage: '取证', content: '连接池耗尽', artifact_id: evidence.id })
    await call(worker, 'xg.triage.record', { stage: '假设', content: '上限过低' })
    await call(worker, 'xg.triage.record', { stage: '根因', content: '上限 5' })
    const ready = await call<{ task: { status: string } }>(worker, 'xg.task.report', { state: 'ready', summary: '已扩容' })
    expect(ready.task.status).toBe('评审')
    const memory = await call<{ id: string }>(worker, 'xg.memory.propose', { type: '故障', title: '连接池超时', content: '扩容到 20',
      tags: [], artifact_ids: [evidence.id] })
    expect(memory.id).toBeTruthy()
    // The main Session may submit a review from a different session and accept the task.
    const main = xgTools(h, { agent })
    const review = await call<{ task: { status: string } }>(main, 'xg.review.submit', { task_id: task.id, decision: '通过',
      reviewer_session: 'review-xg-1' })
    expect(review.task.status).toBe('待验收')
    const accepted = await call<{ status: string }>(main, 'xg.task.accept', { task_id: task.id, accepted_by: '你' })
    expect(accepted.status).toBe('完成')
  })

  it('refuses a Worker that names another task', async () => {
    const h = harness()
    const first = seed(h.service)
    const second = h.service.createTask({ projectId: first.project.id, requirementId: first.requirement.id, title: '另一个', type: '开发', priority: 'P2' })
    const run = h.service.dispatchTask(first.task.id)
    const ticket = h.repo.tickets.get(run.attempt.ticketId!)!
    const worker = xgTools(h, { agent, ticket: { id: ticket.id } })
    await expect(call(worker, 'xg.task.get', { task_id: second.id })).rejects.toThrow()
  })

  it('guards task detail output for a 机密 project', async () => {
    const h = harness(new XgPolicy())
    const project = h.service.createProject({ shortCode: 'SEC', name: '机密', sensitivity: '公开' })
    const requirement = h.service.createRequirement({ projectId: project.id, title: 'r', sourceNote: '人工' })
    const task = h.service.createTask({ projectId: project.id, requirementId: requirement.id, title: '安全', type: '开发', priority: 'P1',
      description: 'token sk-abcdefgh12345678' })
    expect(task.description).toContain('[已脱敏:api-key]')
    const main = xgTools(h, { agent })
    const detail = await call<{ task: { description: string } }>(main, 'xg.task.get', { task_id: task.id })
    expect(detail.task.description).toContain('[已脱敏:api-key]')
  })
})

describe('main Session awareness', () => {
  it('lists projects, tasks, requirements and the overview through the workbench tools', async () => {
    const h = harness()
    const { task, requirement, project } = seed(h.service)
    const main = xgTools(h, { agent })
    expect(main.map(tool => tool.name)).toEqual(expect.arrayContaining(['xg.project.list', 'xg.task.list', 'xg.overview',
      'xg.requirement.list', 'xg.memory.list']))
    const projects = await call<{ items: { id: string; shortCode: string }[] }>(main, 'xg.project.list', {})
    expect(projects.items).toContainEqual(expect.objectContaining({ id: project.id, shortCode: 'BIL' }))
    const tasks = await call<{ total: number; items: { id: string; projectShortCode: string }[] }>(main, 'xg.task.list', {})
    expect(tasks.items).toContainEqual(expect.objectContaining({ id: task.id, projectShortCode: 'BIL' }))
    const requirements = await call<{ items: { id: string }[] }>(main, 'xg.requirement.list', { project_short_code: 'bil' })
    expect(requirements.items.map(item => item.id)).toContain(requirement.id)
    const overview = await call<{ projects: number; tasks: { 就绪: number } }>(main, 'xg.overview', {})
    expect(overview.projects).toBe(1)
    expect(overview.tasks.就绪).toBe(1)
  })

  it('lets the main Session draft and list a split proposal without applying it', async () => {
    const h = harness()
    const { requirement } = seed(h.service)
    const main = xgTools(h, { agent })
    const proposal = await call<{ id: string; status: string }>(main, 'xg.proposal.create', {
      requirement_id: requirement.id, title: '拆成实现和评审', summary: '两个独立任务',
      tasks: [{ title: '实现登录', type: '开发', priority: 'P1' }, { title: '评审登录', type: '评审', priority: 'P2' }],
    })
    expect(proposal.status).toBe('待确认')
    expect(h.store.tasks.list().total).toBe(1)
    const items = await call<{ id: string; status: string }[]>(main, 'xg.proposal.list', {})
    expect(items).toContainEqual(expect.objectContaining({ id: proposal.id, status: '待确认' }))
  })

  it('gives the main Session a workbench prompt and a Worker its task prompt', () => {
    const h = harness()
    const { task } = seed(h.service)
    const runtime = new XgRuntime({ db: h.db, engine: h.engine, tickets: h.repo.tickets, policy: new XgPolicy() })
    expect(runtime.promptFor(undefined)).toContain('xg.task.list')
    const run = h.service.dispatchTask(task.id)
    const ticket = h.repo.tickets.get(run.attempt.ticketId!)!
    expect(runtime.promptFor(ticket)).toContain('xg.task.get')
    h.service.saveProjectSettings(task.projectId, { workerModel: { provider: 'opencode-go', model: 'deepseek-v4.1-flash',
      reasoningEffort: 'max' } })
    expect(runtime.workerModelFor(ticket)).toEqual({ provider: 'opencode-go', model: 'deepseek-v4.1-flash', reasoningEffort: 'max' })
    runtime.stop()
  })
})

describe('XgRuntime', () => {
  it('registers the /xg prefix on start and disposes it on stop', () => {
    const h = harness()
    const registered: string[] = []
    const ctx = { webServer: { host: '127.0.0.1', port: 3082, register: (route: { path: string }) => {
      registered.push(route.path)
      return () => { registered.push('disposed') }
    } } }
    const runtime = new XgRuntime({ db: h.db, engine: h.engine, tickets: h.repo.tickets, policy: new XgPolicy() })
    runtime.start(ctx as never)
    expect(registered).toEqual(['/xg'])
    runtime.stop()
    expect(registered).toEqual(['/xg', 'disposed'])
  })

  it('dispatches autoDispatch tasks on tick and exposes runtime tools', () => {
    const h = harness()
    const { task } = seed(h.service)
    h.store.tasks.save({ ...task, autoDispatch: true })
    const runtime = new XgRuntime({ db: h.db, engine: h.engine, tickets: h.repo.tickets, policy: new XgPolicy() })
    runtime.tick()
    const updated = h.store.tasks.get(task.id)!
    expect(updated.status).toBe('进行中')
    expect(h.store.attempts.list(task.id)).toHaveLength(1)
    expect(runtime.tools(agent).map(tool => tool.name)).toContain('xg.task.get')
    const ticket = h.repo.tickets.get(h.store.attempts.list(task.id)[0]!.ticketId!)!
    expect(runtime.promptFor(ticket)).toContain('xg.task.get')
    runtime.stop()
  })
})
