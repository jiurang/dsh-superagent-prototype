import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Ticket } from '../src/core/index.ts'
import { XgStore } from '../src/xg/store.ts'
import { XgService, type TicketGateway } from '../src/xg/service.ts'

let db: DatabaseSync
let store: XgStore
let service: XgService
let dispatched: { taskId: string; ticketId: string }[]
let stopped: string[]
let tickets: Map<string, Ticket>

const gateway = (): TicketGateway => ({
  dispatch: input => {
    const ticketId = `T-${input.sequence}`
    const ticket: Ticket = {
      id: ticketId, title: input.task.title, decisionId: '', mandate: { strength: 'explicit', policyVersion: '', basis: { via: 'followup' },
        actor: { source: 'xg', id: 'owner' }, scope: '' }, channels: [], assignments: [{ id: `A-${input.sequence}`, state: 'pending', createdAt: '' }],
      inputs: [], undelivered: [], createdAt: '', updatedAt: '', origin: { triggerId: '', triggerIds: [] },
    }
    tickets.set(ticketId, ticket)
    dispatched.push({ taskId: input.task.id, ticketId })
    return { ticketId, assignmentId: `A-${input.sequence}`, workerSessionId: `worker-${ticketId}` }
  },
  retry: ticketId => { stopped.push(`retry:${ticketId}`) },
  stop: ticketId => { stopped.push(`stop:${ticketId}`) },
})

beforeEach(() => {
  db = new DatabaseSync(':memory:')
  store = new XgStore(db, { now: () => '2026-11-17T00:00:00.000Z' })
  dispatched = []; stopped = []; tickets = new Map()
  service = new XgService({ store, gateway: gateway(), tickets: { get: id => tickets.get(id) }, runtimeVersion: 'test' })
})
afterEach(() => { db.close() })

function project() {
  return service.createProject({ shortCode: 'BIL', name: '账单系统' })
}
function requirement(projectId: string) {
  const inbox = service.createInboxItem({ channel: '邮箱', contact: 'alice@example.com', rawContext: '登录页报错', projectId })
  return service.triageInbox(inbox.id, { projectId, title: '修复登录', priority: 'P1' }).requirement
}
function task(projectId: string, requirementId: string, type: '开发' | '排障' = '开发') {
  return service.createTask({ projectId, requirementId, title: '实现登录修复', type, priority: 'P1', acceptance: '登录成功' })
}

describe('xg inbox, requirements, and tasks', () => {
  it('turns an inbox item into a requirement, splits tasks, and writes one task list', () => {
    const p = project()
    const item = service.createInboxItem({ channel: '邮箱', contact: 'alice@example.com', rawContext: '登录页报错', projectId: p.id })
    expect(item.status).toBe('未处理')
    const { requirement, item: triaged } = service.triageInbox(item.id, { projectId: p.id, title: '修复登录', priority: 'P1' })
    expect(requirement.id).toBe('BIL-R1')
    expect(triaged.status).toBe('已建需求')
    service.confirmRequirement(requirement.id)
    const split = service.splitRequirement(requirement.id, [
      { title: '改登录接口', type: '开发', priority: 'P1' },
      { title: '写登录测试', type: '评审', priority: 'P2' },
    ])
    expect(split.requirement.status).toBe('已拆分')
    expect(split.tasks.map(task => task.id)).toEqual(['BIL-1', 'BIL-2'])
    expect(store.tasks.list().total).toBe(2)
    expect(store.requirements.get(requirement.id)?.status).toBe('已拆分')
  })

  it('keeps project-level overrides separate from the instance settings', () => {
    const p = project()
    const saved = service.saveProjectSettings(p.id, { rootPath: '/work/app', sensitivity: '机密', autoDispatch: true, defaultPriority: 'P1',
      workerModel: { provider: 'opencode-go', model: 'deepseek-v4.1-flash', reasoningEffort: 'max' } })
    expect(saved.project).toMatchObject({ rootPath: '/work/app', sensitivity: '机密' })
    expect(saved.settings).toMatchObject({ autoDispatch: true, defaultPriority: 'P1', workerProvider: 'opencode-go',
      workerModel: 'deepseek-v4.1-flash', workerEffort: 'max' })
    expect(service.workerModelFor(p.id)).toEqual({ provider: 'opencode-go', model: 'deepseek-v4.1-flash', reasoningEffort: 'max' })
    const requirement = service.createRequirement({ projectId: p.id, title: 'r', sourceNote: '人工' })
    expect(service.createTask({ projectId: p.id, requirementId: requirement.id, title: 't', type: '开发', priority: 'P2' }).autoDispatch)
      .toBe(true)
    expect(service.saveProjectSettings(p.id, { workerModel: null }).settings.workerModel).toBeNull()
  })

  it('deduplicates inbox items by channel and external reference', () => {
    const p = project()
    expect(service.createInboxItem({ channel: '邮箱', externalRef: 'm1', rawContext: 'a', projectId: p.id }).status).toBe('未处理')
    expect(service.createInboxItem({ channel: '邮箱', externalRef: 'm1', rawContext: 'b', projectId: p.id }).rawContext).toBe('a')
    expect(store.inbox.list().total).toBe(1)
  })
})

describe('dispatch, report, review, and acceptance', () => {
  it('dispatches a ready task to a Ticket, reports ready into 评审, and never completes before human acceptance', () => {
    const p = project()
    const r = requirement(p.id)
    const t = task(p.id, r.id)
    const run = service.dispatchTask(t.id)
    expect(run.task.status).toBe('进行中')
    expect(run.attempt.ticketId).toBe('T-1')
    expect(dispatched).toEqual([{ taskId: t.id, ticketId: 'T-1' }])
    const ready = service.report(t.id, { state: 'ready', summary: '修好了', stage: '评审' })
    expect(ready.task.status).toBe('评审')
    expect(ready.attempt.status).toBe('就绪')
    expect(stopped).toEqual([])
    const review = service.submitReview(t.id, { decision: '通过', reviewerSession: 'review-1' })
    expect(review.task.status).toBe('待验收')
    expect(() => service.submitReview(t.id, { decision: '通过' })).toThrow('只有评审中的任务')
    expect(service.acceptTask(t.id, '你').status).toBe('完成')
    expect(store.tasks.get(t.id)?.acceptedBy).toBe('你')
  })

  it('refuses a review from the implementation session', () => {
    const p = project()
    const r = requirement(p.id)
    const t = task(p.id, r.id)
    service.dispatchTask(t.id)
    service.report(t.id, { state: 'ready', summary: 'ok' })
    const implementation = store.attempts.get(store.tasks.get(t.id)!.currentAttemptId!)!
    expect(() => service.submitReview(t.id, { decision: '通过', reviewerSession: implementation.workerSessionId! }))
      .toThrow('独立会话')
  })

  it('cancels a ticket and retries into a new attempt without creating a second task', () => {
    const p = project()
    const r = requirement(p.id)
    const t = task(p.id, r.id)
    const first = service.dispatchTask(t.id)
    service.cancelTask(t.id)
    expect(stopped).toContain(`stop:${first.attempt.ticketId}`)
    expect(store.tasks.get(t.id)?.status).toBe('取消')
    expect(() => service.retryTask(t.id)).toThrow('已完成或已取消')
    const t2 = task(p.id, r.id)
    service.dispatchTask(t2.id)
    service.report(t2.id, { state: 'blocked', summary: '缺权限' })
    const retry = service.retryTask(t2.id)
    expect(retry.attempt.id).toBe('BIL-2-A2')
    expect(store.tasks.list().total).toBe(2)
    expect(store.attempts.list(t2.id)).toHaveLength(2)
  })

  it('soft-deletes a task from lists and counts while keeping its run history and audit', () => {
    const p = project()
    const r = requirement(p.id)
    const t = task(p.id, r.id)
    const run = service.dispatchTask(t.id)
    const deleted = service.deleteTask(t.id)
    expect(deleted.deletedAt).toBeTruthy()
    expect(store.tasks.list().total).toBe(0)
    expect(store.tasks.list({ includeDeleted: true }).total).toBe(1)
    expect(store.tasks.get(t.id)?.deletedAt).toBeTruthy()
    expect(store.attempts.get(run.attempt.id)?.status).toBe('取消')
    expect(service.overview().active).toEqual([])
    expect(stopped).toContain(`stop:${run.attempt.ticketId}`)
    expect(store.audit.list({ projectId: p.id }).some(entry => entry.action === '删除任务')).toBe(true)
    expect(() => service.dispatchTask(t.id)).toThrow('已删除')
  })

  it('soft-deletes requirements once their tasks are gone, and inbox items on demand', () => {
    const p = project()
    const r = requirement(p.id)
    const t = task(p.id, r.id)
    expect(() => service.deleteRequirement(r.id)).toThrow('还有 1 个未取消的任务')
    service.deleteTask(t.id)
    const deleted = service.deleteRequirement(r.id)
    expect(deleted.deletedAt).toBeTruthy()
    expect(store.requirements.list().total).toBe(0)
    expect(store.requirements.list({ includeDeleted: true }).total).toBe(1)
    expect(store.audit.list({ projectId: p.id }).some(entry => entry.action === '删除需求')).toBe(true)

    const item = service.createInboxItem({ channel: '电话', contact: 'Bob', rawContext: '没事了', projectId: p.id })
    const gone = service.deleteInbox(item.id)
    expect(gone.deletedAt).toBeTruthy()
    expect(store.inbox.list().items.some(entry => entry.id === item.id)).toBe(false)
    expect(store.inbox.list({ includeDeleted: true }).items.some(entry => entry.id === item.id)).toBe(true)
    expect(store.audit.list({ projectId: p.id }).some(entry => entry.action === '删除收件')).toBe(true)
  })

  it('applies and rejects requirement split proposals without touching the target before apply', () => {
    const p = project()
    const r = requirement(p.id)
    const proposal = service.createProposal({ kind: 'requirement.split', targetType: 'requirement', targetId: r.id,
      title: '把登录修复拆成两个任务', summary: '接口和测试分开', createdBy: '智能体',
      payload: { tasks: [{ title: '改登录接口', type: '开发', priority: 'P1' }, { title: '写登录测试', type: '评审', priority: 'P2' }] } })
    expect(proposal.status).toBe('待确认')
    expect(store.tasks.list().total).toBe(0)
    expect(store.requirements.get(r.id)?.status).toBe('待确认')

    const applied = service.applyProposal(proposal.id)
    expect(applied.proposal.status).toBe('已应用')
    expect(applied.tasks.map(task => task.id)).toEqual(['BIL-1', 'BIL-2'])
    expect(applied.requirement.status).toBe('已拆分')
    expect(store.audit.list({ projectId: p.id }).some(entry => entry.action === '应用提案')).toBe(true)
    expect(() => service.applyProposal(proposal.id)).toThrow('提案已处理')

    const second = service.createProposal({ kind: 'requirement.split', targetType: 'requirement', targetId: r.id,
      title: '再拆一次', payload: { tasks: [{ title: '多余任务', type: '开发', priority: 'P3' }] } })
    const rejected = service.rejectProposal(second.id, '不需要')
    expect(rejected.status).toBe('已拒绝')
    expect(rejected.resolution).toBe('不需要')
    expect(store.tasks.list().total).toBe(2)
  })

  it('expires a proposal when its target changed after drafting', () => {
    const p = project()
    const r = requirement(p.id)
    const proposal = service.createProposal({ kind: 'requirement.split', targetType: 'requirement', targetId: r.id,
      title: '拆解', payload: { tasks: [{ title: '任务', type: '开发', priority: 'P2' }] } })
    db.prepare('UPDATE xg_requirements SET updated_at=? WHERE id=?').run('2026-11-17T01:00:00.000Z', r.id)
    expect(() => service.applyProposal(proposal.id)).toThrow('提案已过期')
    expect(store.proposals.get(proposal.id)?.status).toBe('已过期')
    expect(store.tasks.list().total).toBe(0)
  })

  it('refuses to create a queued Ticket while the deployment is blocked', () => {
    const p = project()
    const r = requirement(p.id)
    const t = task(p.id, r.id)
    const blocked = new XgService({ store, gateway: gateway(), tickets: { get: id => tickets.get(id) },
      dispatchBlocked: () => 'dsh-superagent 部署未完成' })
    expect(() => blocked.dispatchTask(t.id)).toThrow('部署未完成')
    expect(store.tasks.get(t.id)?.status).toBe('就绪')
    expect(store.attempts.list(t.id)).toHaveLength(0)
    expect(dispatched).toEqual([])
  })

  it('reconciles a Ticket report into the attempt and task', () => {
    const p = project()
    const r = requirement(p.id)
    const t = task(p.id, r.id)
    const run = service.dispatchTask(t.id)
    const ticket = tickets.get(run.attempt.ticketId!)!
    ticket.assignments[0]!.report = { state: 'ready', summary: 'done', at: '2026-11-17T01:00:00.000Z' }
    expect(service.syncTask(t.id)).toBe(true)
    expect(store.tasks.get(t.id)?.status).toBe('评审')
    expect(store.attempts.get(run.attempt.id)?.lastReportAt).toBe('2026-11-17T01:00:00.000Z')
  })
})

describe('troubleshooting gate', () => {
  it('requires evidence, hypotheses, and a root cause before ready', () => {
    const p = project()
    const r = requirement(p.id)
    const t = task(p.id, r.id, '排障')
    service.dispatchTask(t.id)
    expect(() => service.report(t.id, { state: 'ready', summary: 'no evidence' })).toThrow('没有取证')
    const evidence = service.addArtifact(t.id, { type: '证据', title: '日志', content: 'Timeout at 10s' })
    expect(() => service.recordTriage(t.id, { stage: '假设', content: '连接池' })).toThrow('没有取证')
    service.recordTriage(t.id, { stage: '取证', content: '超时日志', artifactId: evidence.id })
    service.recordTriage(t.id, { stage: '假设', content: '连接池耗尽' })
    service.recordTriage(t.id, { stage: '根因', content: '连接池上限过低' })
    expect(service.report(t.id, { state: 'ready', summary: '已修复' }).task.status).toBe('评审')
    expect(store.triage.list(t.id).map(step => step.stage)).toEqual(['取证', '假设', '根因'])
  })
})

describe('memory', () => {
  it('proposes with evidence, confirms, and searches confirmed entries', () => {
    const p = project()
    const r = requirement(p.id)
    const t = task(p.id, r.id, '排障')
    const evidence = service.addArtifact(t.id, { type: '证据', title: '日志', content: '连接池超时' })
    const memory = service.proposeMemory({ projectId: p.id, type: '故障', title: '连接池超时', content: '把连接池从 5 调到 20',
      sourceType: '任务', sourceRef: t.id, artifactIds: [evidence.id] })
    expect(memory.status).toBe('待复核')
    expect(service.searchMemory({ projectId: p.id, query: '连接池' })).toHaveLength(0)
    service.confirmMemory(memory.id)
    expect(service.searchMemory({ projectId: p.id, query: '连接池', statuses: ['已确认'] }).map(item => item.id)).toEqual([memory.id])
    expect(() => service.proposeMemory({ projectId: p.id, type: '故障', title: '无证据', content: 'x', sourceType: '人工', artifactIds: [] }))
      .toThrow('至少关联一条证据')
  })

  it('marks a confirmed memory for review when a referenced file changes', () => {
    const root = mkdtempSync(join(tmpdir(), 'xg-refs-'))
    try {
      const p = service.createProject({ shortCode: 'REF', name: '引用项目', rootPath: root })
      const r = service.createRequirement({ projectId: p.id, title: 'r', sourceNote: '人工' })
      const t = service.createTask({ projectId: p.id, requirementId: r.id, title: 't', type: '开发', priority: 'P2' })
      const evidence = service.addArtifact(t.id, { type: '证据', title: 'log', content: 'ok' })
      const memory = service.proposeMemory({ projectId: p.id, type: '领域', title: '协议', content: 'v1', sourceType: '任务', sourceRef: t.id,
        artifactIds: [evidence.id] })
      const file = join(root, 'protocol.md')
      writeFileSync(file, 'v1')
      store.memory.addRef({ memoryId: memory.id, refType: '文档', refPath: 'protocol.md', refHash: createHash('sha256').update('v1').digest('hex') })
      service.confirmMemory(memory.id)
      writeFileSync(file, 'v2')
      expect(service.verifyMemoryRefs(p.id)).toEqual({ checked: 1, changed: 1, missing: 0 })
      expect(store.memory.get(memory.id)?.status).toBe('待复核')
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
})
