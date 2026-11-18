/** Composition root of the xg business layer inside the dsh-superagent process. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { DatabaseSync } from 'node:sqlite'
import type { Ticket } from '../core/index.ts'
import { EngineTicketGateway, XgService, type XgTextGuard } from './service.ts'
import { XgStore } from './store.ts'
import { xgTools, type XgToolsHost } from './tools.ts'
import { registerXgHttp } from './http.ts'
import { EmailCollector } from './email.ts'

export interface XgRuntimeOptions {
  db: DatabaseSync
  path?: string
  engine: { authorizeTicket(trigger: import('../core/index.ts').Trigger, outcome: { title: string; scope: string; reason: string; name?: string }): import('../core/index.ts').Decision
    retryTicket(ticketId: string): unknown
    stopTicket(ticketId: string): unknown }
  tickets: { get(id: string): Ticket | undefined }
  policy?: XgTextGuard
  logger?: { warn(...args: unknown[]): void; error(...args: unknown[]): void }
  runtimeVersion?: string
  tickMs?: number
  /** Directory of `.eml` files polled into the inbox; omitted disables the email collector. */
  inboxDir?: string
  /** Poll interval for the email collector, in milliseconds. */
  emailPollMs?: number
  /** Why tickets cannot be dispatched yet, such as an incomplete deployment; undefined when ready. */
  dispatchBlocked?: () => string | undefined
  /** Fallback local project root when a project card has none, from the local Source. */
  defaultRoot?: () => string | undefined
}

/**
 * Owns the xg store, service, Scheduler loop, `/xg/api` routes, and per-Session tools. It shares the upstream SQLite
 * handle so business and runtime state back up together, and scans every two seconds to reconcile Tickets and dispatch
 * tasks marked `autoDispatch`.
 */
export class XgRuntime implements XgToolsHost {
  readonly store: XgStore
  readonly service: XgService
  private readonly logger?: XgRuntimeOptions['logger']
  private readonly tickMs: number
  private readonly email?: EmailCollector
  private readonly dispatchBlocked?: () => string | undefined
  private readonly defaultRoot?: () => string | undefined
  private timer?: NodeJS.Timeout
  private http?: () => void
  private ticking = false

  constructor(options: XgRuntimeOptions) {
    this.store = new XgStore(options.db, { path: options.path })
    this.service = new XgService({ store: this.store, gateway: new EngineTicketGateway(options.engine, options.tickets),
      tickets: options.tickets, policy: options.policy, runtimeVersion: options.runtimeVersion, dispatchBlocked: options.dispatchBlocked })
    this.logger = options.logger
    this.tickMs = options.tickMs ?? 2000
    this.dispatchBlocked = options.dispatchBlocked
    this.defaultRoot = options.defaultRoot
    this.email = options.inboxDir ? new EmailCollector({ inboxDir: options.inboxDir, store: this.store,
      pollMs: options.emailPollMs ?? 60_000, onError: error => this.logger?.warn('xg: email scan failed: %s', String(error)) }) : undefined
  }

  get policy(): NonNullable<XgRuntimeOptions['policy']> {
    // Tools only call `guardFields`; without a guard the identity guard keeps outputs unchanged.
    return this.service.guard ?? { guardFields: <T extends Record<string, unknown>>(value: T) => value,
      guard: (text: string) => ({ text, findings: [], blocked: false }) }
  }

  start(ctx: Context): void {
    if (!this.http) this.http = registerXgHttp(ctx, this)
    if (!this.timer) this.timer = setInterval(() => { this.tick() }, this.tickMs)
    this.timer.unref?.()
    this.email?.start()
    void this.email?.scanOnce().catch(error => this.logger?.warn('xg: email scan failed: %s', String(error)))
    this.tick()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    this.email?.stop()
    this.http?.()
    this.http = undefined
  }

  /** Reconcile attempts with Tickets and dispatch tasks marked autoDispatch. */
  tick(): void {
    if (this.ticking) return
    this.ticking = true
    try {
      this.service.syncAll()
      if (this.dispatchBlocked?.()) return
      for (const task of this.service.readyTasks()) {
        try { this.service.dispatchTask(task.id) }
        catch (error) { this.logger?.warn('xg: task %s could not be dispatched: %s', task.id, String(error)) }
      }
    } catch (error) {
      this.logger?.error('xg: pass failed: %s', String(error))
    } finally { this.ticking = false }
  }

  /** Tools for one Session; a Worker's task is resolved from its Ticket, never from model arguments. */
  tools(agent: Agent, ticket?: Ticket) {
    return xgTools(this, { agent, ...(ticket ? { ticket: { id: ticket.id } } : {}) })
  }

  /** The local project root for an xg Ticket, from its task's project or the local Source fallback. */
  rootPathForTicket(ticket: Ticket): string | undefined {
    const attempt = this.store.attempts.byTicket(ticket.id)
    const taskId = attempt?.taskId ?? (ticket.origin.triggerId.startsWith('xg:task:') ? ticket.origin.triggerId.split(':')[2] : undefined)
    const task = taskId ? this.store.tasks.get(taskId) : undefined
    const root = task ? this.store.projects.get(task.projectId)?.rootPath : undefined
    return root?.trim() || this.defaultRoot?.()?.trim() || undefined
  }

  /** True when an xg Ticket runs in an existing local project directory. */
  localWorkspace(ticket: Ticket): boolean { return !!this.rootPathForTicket(ticket) }

  /** The project's Worker model override for a Ticket, resolved from its task's project. */
  workerModelFor(ticket: Ticket): { provider: string; model: string; reasoningEffort?: string } | undefined {
    const attempt = this.store.attempts.byTicket(ticket.id)
    const taskId = attempt?.taskId ?? (ticket.origin.triggerId.startsWith('xg:task:') ? ticket.origin.triggerId.split(':')[2] : undefined)
    const task = taskId ? this.store.tasks.get(taskId) : undefined
    return task ? this.service.workerModelFor(task.projectId) : undefined
  }

  /** Workbench instructions for the main Session, or for a Worker Session whose Ticket belongs to an xg task. */
  promptFor(ticket?: Ticket): string | undefined {
    if (!ticket) return [
      '## 雄大工作台',
      '你是雄大工作台的主控 Session。业务任务在 `xg_tasks`，上游 Ticket 只是任务的一次执行尝试，不要把 Ticket 列表当成任务列表。',
      '先调用 `xg.project.list`、`xg.task.list`、`xg.overview` 或 `xg.inbox.list` 感知当前工作台；任务 ID 必须来自工具结果，不要编造。',
      '`xg.task.get` 读取任务的需求、规格、验收、运行记录、证据和评审；`xg.memory.search` 查项目记忆；`xg.memory.list` 查待复核记忆。',
      '`xg.review.get` / `xg.review.submit` 处理评审，`xg.task.accept` 只能代人做最终验收；需要人决定时明确提问。',
    ].join('\n')
    const attempt = this.store.attempts.byTicket(ticket.id)
    if (!attempt) return undefined
    const task = this.store.tasks.get(attempt.taskId)
    if (!task) return undefined
    const requirement = this.store.requirements.get(task.requirementId)
    return [
      '## 雄大工作台任务',
      `当前 Ticket 是雄大工作台业务任务 ${task.id}（${task.type}，优先级 ${task.priority}）的一次执行尝试。`,
      `需求：${requirement?.title ?? task.requirementId}`,
      `验收标准：${task.acceptance ?? '未填写'}`,
      '开工前先调用 `xg.task.get` 读取需求、规格、验收、证据和运行记录；不要修改任务归属、项目或优先级。',
      '进度、就绪、阻塞、失败用 `xg.task.report`（或 `orchestrator_report`，两者会同步）；证据、代码、文档、复盘用 `xg.artifact.add`。',
      '排障任务必须按 `xg.artifact.add(type=证据)` → `xg.triage.record(取证)` → `xg.triage.record(假设)` → `xg.triage.record(根因)` 推进；没有证据不得下根因。',
      '开工前用 `xg.memory.search` 查已确认的领域、决策、经验和相似故障；任务结束用 `xg.memory.propose` 提交带证据的记忆草稿，不能自己确认。',
      '报告 `ready` 只会让任务进入评审，不会直接完成；需要人回答时用 `xg.attention.raise`。',
    ].join('\n')
  }

  /** Copy the shared database; the workbench keeps business and runtime state in one file. */
  backupTo(destination: string): void { this.store.backupTo(destination) }
}
