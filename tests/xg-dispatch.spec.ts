import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { Engine, MemoryRepositories, type Assignment, type Candidate, type Executor, type OutboundMessage, type Policy, type Ticket } from '../src/core/index.ts'
import { EngineTicketGateway, XgService } from '../src/xg/service.ts'
import { XgStore } from '../src/xg/store.ts'

function harness() {
  const repo = new MemoryRepositories()
  const starts: [Ticket, Assignment][] = []
  const executor: Executor = {
    start: (ticket, assignment) => { starts.push([ticket, assignment]) },
    deliver: () => {}, stop: () => {},
  }
  const policy: Policy = {
    version: 'v1', paused: false, evalTimeoutMs: 60_000,
    gate: _trigger => ({ admissible: true, strength: 'explicit', basis: { via: 'followup' } }),
    revalidate: () => true, admitsInferred: () => true,
  }
  const outbox = { messages: [] as OutboundMessage[], send: (message: OutboundMessage) => { outbox.messages.push(message) },
    status: () => 'sent' as const, withdraw: () => {} }
  const engine = new Engine({ repo, scope: { scope: () => ({ listened: true, observed: false }) }, policy: () => policy,
    assessor: { request: (_candidate: Candidate) => {} }, executor, outbox })
  const db = new DatabaseSync(':memory:')
  const store = new XgStore(db)
  const service = new XgService({ store, gateway: new EngineTicketGateway(engine, repo.tickets), tickets: repo.tickets })
  return { repo, engine, store, service, starts, db }
}

describe('EngineTicketGateway', () => {
  it('creates a real Ticket and binds its id and assignment to the xg attempt', () => {
    const h = harness()
    const project = h.service.createProject({ shortCode: 'BIL', name: '账单' })
    const requirement = h.service.createRequirement({ projectId: project.id, title: '登录', sourceNote: '人工' })
    h.service.confirmRequirement(requirement.id)
    const task = h.service.createTask({ projectId: project.id, requirementId: requirement.id, title: '修复登录', type: '开发', priority: 'P1' })
    const run = h.service.dispatchTask(task.id)
    expect(run.task.status).toBe('进行中')
    expect(run.attempt.ticketId).toBeTruthy()
    const ticket = h.repo.tickets.get(run.attempt.ticketId!)!
    expect(ticket.title).toBe('修复登录')
    expect(ticket.mandate.strength).toBe('explicit')
    expect(ticket.mandate.basis).toMatchObject({ via: 'followup', authority: '工作台' })
    expect(h.starts).toHaveLength(1)
    expect(h.starts[0]![0].id).toBe(ticket.id)
    // A real worker report flows back through the Engine and the xg sync maps it to 评审.
    const assignment = ticket.assignments.at(-1)!
    h.engine.assignmentStarted(ticket.id, assignment.id)
    h.engine.report(ticket.id, { state: 'ready', summary: '完成' })
    expect(h.service.syncTask(task.id)).toBe(true)
    expect(h.store.tasks.get(task.id)?.status).toBe('评审')
    h.db.close()
  })
})
