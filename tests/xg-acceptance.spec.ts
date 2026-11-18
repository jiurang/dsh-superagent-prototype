/**
 * End-to-end acceptance for `SUPERAGENT-DESIGN.md` §17.
 * It uses the real Engine and SQLite, with a fake Executor, so it proves the domain and persistence without a model.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Engine, MemoryRepositories, type Assignment, type Executor, type OutboundMessage, type Policy, type Ticket } from '../src/core/index.ts'
import { EngineTicketGateway, XgService } from '../src/xg/service.ts'
import { XgPolicy } from '../src/xg/policy.ts'
import { XgStore } from '../src/xg/store.ts'

let directory: string
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'xg-acceptance-')) })
afterEach(() => { rmSync(directory, { recursive: true, force: true }) })

interface Harness {
  repo: MemoryRepositories
  engine: Engine
  store: XgStore
  service: XgService
  starts: [Ticket, Assignment][]
  close(): void
}

function harness(policy?: XgPolicy, dbName = 'orchestrator.sqlite'): Harness {
  const repo = new MemoryRepositories()
  const starts: [Ticket, Assignment][] = []
  const executor: Executor = { start: (ticket, assignment) => { starts.push([ticket, assignment]) }, deliver: () => {}, stop: () => {} }
  const runtimePolicy: Policy = {
    version: 'v1', paused: false, evalTimeoutMs: 60_000,
    gate: () => ({ admissible: true, strength: 'explicit', basis: { via: 'followup' } }),
    revalidate: () => true, admitsInferred: () => true,
  }
  const outbox = { messages: [] as OutboundMessage[], send: (message: OutboundMessage) => { outbox.messages.push(message) },
    status: () => 'sent' as const, withdraw: () => {} }
  const engine = new Engine({ repo, scope: { scope: () => ({ listened: true, observed: false }) }, policy: () => runtimePolicy,
    assessor: { request: () => {} }, executor, outbox })
  const path = join(directory, dbName)
  const db = new DatabaseSync(path)
  const store = new XgStore(db, { path })
  const service = new XgService({ store, gateway: new EngineTicketGateway(engine, repo.tickets), tickets: repo.tickets, policy })
  return { repo, engine, store, service, starts, close: () => { db.close() } }
}

function seed(service: XgService, options: { type?: '开发' | '排障'; sensitivity?: '公开' | '内部' | '机密'; shortCode?: string } = {}) {
  const project = service.createProject({ shortCode: options.shortCode ?? 'BIL', name: '账单系统', sensitivity: options.sensitivity ?? '内部' })
  const item = service.createInboxItem({ channel: '邮箱', contact: 'alice@example.com', rawContext: '登录页 500', projectId: project.id })
  const requirement = service.triageInbox(item.id, { projectId: project.id, title: '修复登录', priority: 'P1' }).requirement
  service.confirmRequirement(requirement.id)
  const task = service.createTask({ projectId: project.id, requirementId: requirement.id, title: '实现登录修复',
    type: options.type ?? '开发', priority: 'P1', acceptance: '登录成功' })
  return { project, requirement, task }
}

describe('A1 单体可启动、可重启、可备份', () => {
  it('reopens a copied database with its business rows intact', () => {
    const h = harness()
    const { project } = seed(h.service)
    const backup = join(directory, 'backup.sqlite')
    h.store.backupTo(backup)
    h.close()
    const db = new DatabaseSync(backup)
    const reopened = new XgStore(db)
    expect(reopened.projects.get(project.id)?.name).toBe('账单系统')
    expect(reopened.tasks.list().total).toBe(1)
    db.close()
  })
})

describe('A2 任务就绪 → Trigger → Ticket → Worker → 报告', () => {
  it('turns a ready task into a real Ticket and maps the worker report back', () => {
    const h = harness()
    const { task } = seed(h.service)
    const run = h.service.dispatchTask(task.id)
    expect(run.attempt.ticketId).toBeTruthy()
    const ticket = h.repo.tickets.get(run.attempt.ticketId!)!
    expect(ticket.title).toBe('实现登录修复')
    const assignment = ticket.assignments.at(-1)!
    h.engine.assignmentStarted(ticket.id, assignment.id)
    h.engine.report(ticket.id, { state: 'ready', summary: '测试通过，已提交' })
    expect(h.service.syncTask(task.id)).toBe(true)
    expect(h.store.tasks.get(task.id)?.status).toBe('评审')
    expect(h.store.attempts.get(run.attempt.id)?.lastReportAt).toBeTruthy()
    h.close()
  })
})

describe('A3 面板只显示一个任务列表，Attempt 在详情里', () => {
  it('exposes only tasks in the list and attempts in the detail', () => {
    const h = harness()
    const { task } = seed(h.service)
    h.service.dispatchTask(task.id)
    const overview = h.service.overview()
    expect(overview.active.map(item => item.id)).toEqual([task.id])
    expect(Object.keys(overview.active[0]!)).not.toContain('attempts')
    const detail = h.service.taskDetail(task.id)
    expect(detail.attempts).toHaveLength(1)
    expect(detail.task.id).toBe(task.id)
    h.close()
  })
})

describe('A4 Worker 能读需求/规格/记忆，能写报告/证据', () => {
  it('returns requirement, spec, evidence, and project memory through the task detail', () => {
    const h = harness()
    const { project, requirement, task } = seed(h.service)
    h.service.saveSpec(task.id, { content: '登录接口超时 5s 应重试', approve: true })
    const evidence = h.service.addArtifact(task.id, { type: '证据', title: '请求日志', content: 'POST /login 500' })
    const memory = h.service.proposeMemory({ projectId: project.id, type: '领域', title: '登录协议', content: '登录使用 OAuth2 设备码',
      sourceType: '任务', sourceRef: task.id, artifactIds: [evidence.id] })
    h.service.confirmMemory(memory.id)
    const detail = h.service.taskDetail(task.id)
    expect(detail.requirement.id).toBe(requirement.id)
    expect(detail.spec?.content).toContain('登录接口')
    expect(detail.artifacts.map(item => item.id)).toContain(evidence.id)
    expect(h.service.searchMemory({ projectId: project.id, query: 'OAuth2' }).map(item => item.id)).toEqual([memory.id])
    h.close()
  })
})

describe('A5 ready → 评审，不直接完成', () => {
  it('moves a ready ticket to 评审 and requires review plus human acceptance', () => {
    const h = harness()
    const { task } = seed(h.service)
    h.service.dispatchTask(task.id)
    expect(h.service.report(task.id, { state: 'ready', summary: '完成' }).task.status).toBe('评审')
    expect(() => h.service.acceptTask(task.id)).toThrow('待验收')
    h.service.submitReview(task.id, { decision: '通过', comments: '证据齐全' })
    expect(h.store.tasks.get(task.id)?.status).toBe('待验收')
    expect(h.service.acceptTask(task.id).status).toBe('完成')
    h.close()
  })
})

describe('A6 取消停 Ticket；重试产生新 Attempt', () => {
  it('stops the ticket on cancel and starts a new attempt on retry', () => {
    const h = harness()
    const { task } = seed(h.service)
    const first = h.service.dispatchTask(task.id)
    h.service.cancelTask(task.id)
    expect(h.store.tasks.get(task.id)?.status).toBe('取消')
    expect(h.store.attempts.get(first.attempt.id)?.status).toBe('取消')
    expect(h.repo.tickets.get(first.attempt.ticketId!)?.ended?.outcome).toBe('stopped')

    const other = h.service.createTask({ projectId: task.projectId, requirementId: task.requirementId, title: '重试示例', type: '开发', priority: 'P2' })
    const blocked = h.service.dispatchTask(other.id)
    h.service.report(other.id, { state: 'blocked', summary: '缺少权限' })
    const retry = h.service.retryTask(other.id)
    expect(retry.attempt.id).not.toBe(blocked.attempt.id)
    expect(h.store.attempts.list(other.id)).toHaveLength(2)
    expect(h.store.tasks.list().total).toBe(2)
    h.close()
  })
})

describe('A7 排障三段记录', () => {
  it('enforces 取证 → 假设 → 根因 and ready', () => {
    const h = harness()
    const { task } = seed(h.service, { type: '排障' })
    h.service.dispatchTask(task.id)
    expect(() => h.service.report(task.id, { state: 'ready', summary: '猜的' })).toThrow('没有取证')
    const evidence = h.service.addArtifact(task.id, { type: '证据', title: '超时日志', content: 'pool exhausted at 10s' })
    h.service.recordTriage(task.id, { stage: '取证', content: '连接池耗尽', artifactId: evidence.id })
    h.service.recordTriage(task.id, { stage: '假设', content: '连接池上限过低' })
    h.service.recordTriage(task.id, { stage: '根因', content: '上限 5，峰值 20' })
    expect(h.store.triage.list(task.id).map(item => item.stage)).toEqual(['取证', '假设', '根因'])
    expect(h.service.report(task.id, { state: 'ready', summary: '已扩容' }).task.status).toBe('评审')
    h.close()
  })
})

describe('A8 记忆可写、可确认、可搜索', () => {
  it('keeps unconfirmed memory out of search and finds it after confirmation', () => {
    const h = harness()
    const { task } = seed(h.service, { type: '排障' })
    const evidence = h.service.addArtifact(task.id, { type: '证据', title: '日志', content: 'timeout' })
    const memory = h.service.proposeMemory({ projectId: task.projectId, type: '故障', title: '登录超时', content: '把连接池从 5 调到 20',
      sourceType: '任务', sourceRef: task.id, artifactIds: [evidence.id] })
    expect(memory.status).toBe('待复核')
    expect(h.service.searchMemory({ projectId: task.projectId, query: '连接池' })).toHaveLength(0)
    h.service.confirmMemory(memory.id)
    expect(h.service.searchMemory({ projectId: task.projectId, query: '连接池' }).map(item => item.id)).toEqual([memory.id])
    h.close()
  })
})

describe('A9 收件箱能进需求，需求能拆任务', () => {
  it('turns an inbox item into a requirement and splits it into tasks', () => {
    const h = harness()
    const { project, requirement } = seed(h.service)
    expect(h.store.inbox.list().total).toBe(1)
    expect(h.store.inbox.list().items[0]?.status).toBe('已建需求')
    const split = h.service.splitRequirement(requirement.id, [
      { title: '改接口', type: '开发', priority: 'P1' },
      { title: '验登录', type: '评审', priority: 'P2' },
    ])
    expect(split.requirement.status).toBe('已拆分')
    expect(split.tasks.every(task => task.requirementId === requirement.id)).toBe(true)
    h.close()
  })
})

describe('A10 敏感数据在工具网关被过滤', () => {
  it('blocks an API key in a 机密 project and redacts it in a 内部 project', () => {
    const policy = new XgPolicy({ customers: ['客户甲'] })
    const secret = new XgPolicy()
    expect(secret.guard('token oc_sk_test_secret_value', '机密').blocked).toBe(true)
    const h = harness(policy)
    const { project } = seed(h.service, { sensitivity: '机密' })
    expect(() => h.service.createTask({ projectId: project.id, requirementId: h.store.requirements.list().items[0]!.id,
      title: '泄露', type: '开发', priority: 'P1', description: 'key sk-abcdefgh12345678' })).toThrow('阻断')
    expect(h.store.audit.list({ projectId: project.id }).some(entry => entry.action === '过滤阻断')).toBe(true)
    const internal = h.service.createProject({ shortCode: 'INT', name: '内部项目', sensitivity: '内部' })
    const requirement = h.service.createRequirement({ projectId: internal.id, title: '内部', sourceNote: '人工' })
    const task = h.service.createTask({ projectId: internal.id, requirementId: requirement.id, title: '脱敏', type: '开发', priority: 'P2',
      description: '手机号 13812345678' })
    expect(task.description).toContain('[已脱敏:phone]')
    h.close()
  })
})

describe('A12 一项目一实例，多项目不串数据', () => {
  it('keeps two workbench databases independent even with the same project short code', () => {
    const one = harness(undefined, 'one.sqlite')
    const two = harness(undefined, 'two.sqlite')
    const a = one.service.createProject({ shortCode: 'SAME', name: '项目一' })
    const b = two.service.createProject({ shortCode: 'SAME', name: '项目二' })
    expect(a.id).not.toBe(b.id)
    expect(one.store.projects.list()).toHaveLength(1)
    expect(two.store.projects.list()).toHaveLength(1)
    expect(one.service.overview().tasks.就绪).toBe(0)
    const req = two.service.createRequirement({ projectId: b.id, title: '只属于二', sourceNote: '人工' })
    expect(one.store.requirements.get(req.id)).toBeUndefined()
    one.close(); two.close()
  })
})
