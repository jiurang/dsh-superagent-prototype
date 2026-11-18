/** Business services over `XgStore`: inbox triage, requirement splitting, dispatch, reports, review, acceptance, and memory. */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import type { Decision, Ticket, Trigger } from '../core/index.ts'
import { latestReport, ticketOutcome } from '../core/index.ts'
import type { Artifact, ArtifactType, Attempt, InboxChannel, InboxItem, MemoryEntry, MemoryType, Priority, Project, ProjectSettings, Requirement, Review,
  ReviewDecision, Sensitivity, Spec, Task, TaskStatus, TaskType, TriageStage } from './domain.ts'
import type { XgStore } from './store.ts'

/** Host-side text guard; `XgPolicy` implements it, tests may pass a pass-through. */
export interface XgTextGuard {
  guard(text: string, sensitivity: Sensitivity): { text: string; findings: readonly unknown[]; blocked: boolean }
  guardFields<T extends Record<string, unknown>>(value: T, sensitivity: Sensitivity): T
}

/** Port for turning an xg attempt into a Super-agent Ticket. The engine gateway is the production implementation. */
export interface TicketGateway {
  dispatch(input: { task: Task; project: Project; attempt: Attempt; sequence: number; text: string }): { ticketId: string; assignmentId: string | null;
    workerSessionId: string }
  retry(ticketId: string): void
  stop(ticketId: string): void
}

export interface TicketReader { get(id: string): Ticket | undefined }

export interface XgServiceOptions {
  store: XgStore
  gateway: TicketGateway
  tickets: TicketReader
  policy?: XgTextGuard
  /** Human-readable runtime version recorded on new attempts. */
  runtimeVersion?: string
  /** Why dispatching must wait, such as an incomplete dsh-superagent deployment or a paused runtime; undefined when ready. */
  dispatchBlocked?: () => string | undefined
}

export interface TaskReportInput {
  state: 'progress' | 'waiting' | 'ready' | 'blocked' | 'failed' | 'dropped'
  summary: string
  attention?: string | null
  stage?: string | null
}

export interface ReviewInput {
  decision: ReviewDecision
  comments?: string
  reviewer?: string
  /** Session of the reviewer; must differ from the implementation attempt's session. */
  reviewerSession?: string
}

export interface MemoryProposal {
  projectId: string
  type: MemoryType
  title: string
  content: string
  sourceType: '任务' | '会话' | '人工'
  sourceRef?: string
  tags?: string[]
  artifactIds?: string[]
}

/**
 * The workbench's business layer. It owns task state transitions and writes every change as a task event
 * (and key actions as audit entries); Tickets are execution attempts, never the task list.
 */
export class XgService {
  readonly store: XgStore
  private readonly gateway: TicketGateway
  private readonly tickets: TicketReader
  private readonly policy?: XgTextGuard
  private readonly runtimeVersion?: string
  private readonly dispatchBlocked?: () => string | undefined

  constructor(options: XgServiceOptions) {
    this.store = options.store
    this.gateway = options.gateway
    this.tickets = options.tickets
    this.policy = options.policy
    this.runtimeVersion = options.runtimeVersion
    this.dispatchBlocked = options.dispatchBlocked
  }

  /** The outbound filter, when the host configured one; tools use it for their read results. */
  get guard(): XgTextGuard | undefined { return this.policy }

  createProject(input: { shortCode: string; name: string; rootPath?: string; sensitivity?: Sensitivity; status?: Project['status'] }): Project {
    return this.store.projects.create({ ...input, name: input.name.trim() })
  }

  /** The project card plus its project-level overrides. */
  projectSettings(projectId: string): { project: Project; settings: ProjectSettings } {
    return { project: this.requireProject(projectId), settings: this.store.projectSettings.get(projectId) }
  }

  /** Save project-level overrides; the system settings stay in the upstream instance settings. */
  saveProjectSettings(projectId: string, input: {
    rootPath?: string | null
    sensitivity?: Sensitivity
    workerModel?: { provider: string; model: string; reasoningEffort?: string } | null
    autoDispatch?: boolean
    defaultPriority?: Priority | null
  }): { project: Project; settings: ProjectSettings } {
    const before = this.store.projectSettings.get(projectId)
    const project = this.store.projects.get(projectId)
    if (!project) throw new Error(`项目不存在：${projectId}`)
    const updated = this.store.projects.update(projectId, {
      ...(input.rootPath === undefined ? {} : { rootPath: input.rootPath }),
      ...(input.sensitivity === undefined ? {} : { sensitivity: input.sensitivity }),
    })
    const settings = this.store.projectSettings.save(projectId, {
      ...(input.workerModel === undefined ? {} : { workerProvider: input.workerModel?.provider ?? null,
        workerModel: input.workerModel?.model ?? null, workerEffort: input.workerModel?.reasoningEffort ?? null }),
      ...(input.autoDispatch === undefined ? {} : { autoDispatch: input.autoDispatch }),
      ...(input.defaultPriority === undefined ? {} : { defaultPriority: input.defaultPriority }),
    })
    this.store.audit.add({ projectId, actor: '人', action: '保存项目设置', entityType: 'project', entityId: projectId,
      beforeState: { project, settings: before }, afterState: { project: updated, settings } })
    return { project: updated, settings }
  }

  /** The project's Worker model override, if it names both provider and model. */
  workerModelFor(projectId: string): { provider: string; model: string; reasoningEffort?: string } | undefined {
    const settings = this.store.projectSettings.get(projectId)
    if (!settings.workerProvider || !settings.workerModel) return undefined
    return { provider: settings.workerProvider, model: settings.workerModel,
      ...(settings.workerEffort ? { reasoningEffort: settings.workerEffort } : {}) }
  }

  createInboxItem(input: { channel: InboxChannel; contact?: string; rawContext?: string; projectId?: string; externalRef?: string }): InboxItem {
    const project = input.projectId ? this.requireProject(input.projectId) : undefined
    const rawContext = project && input.rawContext ? this.clean(input.rawContext, project, 'inbox', 'new') : input.rawContext
    return this.store.inbox.add({ ...input, rawContext }).item
  }

  /** Turn an inbox item into a requirement and mark the item triaged. */
  triageInbox(itemId: string, input: { projectId: string; title: string; description?: string; priority?: Priority }): { item: InboxItem; requirement: Requirement } {
    const item = this.store.inbox.get(itemId)
    if (!item) throw new Error(`收件不存在：${itemId}`)
    if (item.status !== '未处理') throw new Error('该收件已处理')
    return this.store.atomic(() => {
      const description = input.description ?? item.rawContext ?? undefined
      const requirement = this.createRequirement({ projectId: input.projectId, title: input.title, description,
        sourceId: item.id, priority: input.priority })
      const updated = this.store.inbox.markTriaged(itemId, '已建需求')
      return { item: updated, requirement }
    })
  }

  ignoreInbox(itemId: string): InboxItem {
    const item = this.store.inbox.get(itemId)
    if (!item) throw new Error(`收件不存在：${itemId}`)
    return this.store.inbox.markTriaged(itemId, '已忽略')
  }

  createRequirement(input: { projectId: string; title: string; description?: string; sourceId?: string; sourceNote?: string; priority?: Priority }): Requirement {
    const project = this.requireProject(input.projectId)
    const title = this.clean(input.title, project, 'requirement', 'new') ?? ''
    const description = this.clean(input.description, project, 'requirement', 'new')
    const sourceNote = this.clean(input.sourceNote, project, 'requirement', 'new')
    return this.store.requirements.create({ ...input, title, description: description ?? undefined, sourceNote: sourceNote ?? undefined })
  }

  confirmRequirement(id: string): Requirement {
    const requirement = this.store.requirements.get(id)
    if (!requirement) throw new Error(`需求不存在：${id}`)
    if (requirement.status !== '待确认') throw new Error('只有待确认的需求可以确认')
    const updated = this.store.requirements.update(id, { status: '已确认' })
    this.store.audit.add({ projectId: requirement.projectId, actor: '人', action: '确认需求', entityType: 'requirement', entityId: id,
      beforeState: requirement, afterState: updated })
    return updated
  }

  /** Split a confirmed requirement into tasks; all tasks are created in one transaction. */
  splitRequirement(requirementId: string, inputs: { title: string; type: TaskType; priority: Priority; description?: string; acceptance?: string }[]): { requirement: Requirement; tasks: Task[] } {
    const requirement = this.store.requirements.get(requirementId)
    if (!requirement) throw new Error(`需求不存在：${requirementId}`)
    if (requirement.status === '已关闭') throw new Error('已关闭的需求不能拆任务')
    if (!inputs.length) throw new Error('至少拆出一个任务')
    return this.store.atomic(() => {
      const tasks = inputs.map(input => this.createTask({ projectId: requirement.projectId, requirementId, ...input }))
      const updated = this.store.requirements.update(requirementId, { status: '已拆分' })
      this.store.audit.add({ projectId: requirement.projectId, actor: '人', action: '拆分需求', entityType: 'requirement', entityId: requirementId,
        beforeState: requirement, afterState: { requirement: updated, tasks: tasks.map(task => task.id) } })
      return { requirement: updated, tasks }
    })
  }

  createTask(input: { projectId: string; requirementId: string; title: string; type: TaskType; priority: Priority; description?: string;
    acceptance?: string; autoDispatch?: boolean; status?: TaskStatus }): Task {
    const project = this.requireProject(input.projectId)
    const title = this.clean(input.title, project, 'task', 'new') ?? ''
    const description = this.clean(input.description, project, 'task', 'new')
    const acceptance = this.clean(input.acceptance, project, 'task', 'new')
    const autoDispatch = input.autoDispatch ?? this.store.projectSettings.get(project.id).autoDispatch
    const task = this.store.tasks.create({ ...input, title, description, acceptance, autoDispatch })
    this.event(task, '创建', '人', { title: task.title, type: task.type, status: task.status })
    return task
  }

  /** Create the next execution attempt and turn it into a Ticket. A ready task becomes 进行中. */
  dispatchTask(taskId: string): { task: Task; attempt: Attempt } {
    const blocked = this.dispatchBlocked?.()
    if (blocked) throw new Error(`暂时不能派发：${blocked}`)
    const task = this.requireTask(taskId)
    if (task.status === '完成' || task.status === '取消' || task.status === '待验收') throw new Error('已完成、待验收或已取消的任务不能再派发')
    const active = this.store.attempts.active(taskId)
    if (active && (active.status === '运行中' || active.status === '就绪')) throw new Error(`任务已有活动尝试：${active.id}`)
    if (active) {
      if (active.ticketId) {
        try { this.gateway.stop(active.ticketId) } catch { /* An already ended Ticket is still closed in xg. */ }
      }
      this.store.attempts.update(active.id, { status: '取消', endedAt: this.now() })
    }
    const project = this.requireProject(task.projectId)
    const requirement = this.store.requirements.get(task.requirementId)
    if (!requirement) throw new Error(`需求不存在：${task.requirementId}`)
    const sequence = this.store.attempts.nextSeq(taskId)
    const attempt = this.store.attempts.create({ taskId, status: '运行中', stage: '派发', runtimeVersion: this.runtimeVersion ?? null })
    this.store.tasks.save({ ...task, status: '进行中', currentAttemptId: attempt.id })
    this.event(task, '派发', '系统', { attemptId: attempt.id, sequence })
    try {
      const result = this.gateway.dispatch({ task, project, attempt, sequence,
        text: [`任务：${task.title}`, task.description ?? '', `验收：${task.acceptance ?? '未填写'}`].filter(Boolean).join('\n') })
      this.store.attempts.update(attempt.id, { ticketId: result.ticketId, assignmentId: result.assignmentId, workerSessionId: result.workerSessionId, stage: '执行' })
      const updated = this.requireTask(taskId)
      this.event(updated, '绑定工单', '系统', { ticketId: result.ticketId, attemptId: attempt.id })
      return { task: updated, attempt: this.store.attempts.get(attempt.id)! }
    } catch (error) {
      this.store.attempts.update(attempt.id, { status: '失败', endedAt: new Date().toISOString(), attention: String(error) })
      this.setTaskStatus(taskId, '阻塞', '系统', { reason: '派发失败' })
      throw error
    }
  }

  /** Start a fresh attempt; a blocked, failed, or reviewed task returns to 进行中. */
  retryTask(taskId: string): { task: Task; attempt: Attempt } {
    const task = this.requireTask(taskId)
    if (task.status === '取消' || task.status === '完成') throw new Error('已完成或已取消的任务不能重试')
    const current = task.currentAttemptId ? this.store.attempts.get(task.currentAttemptId) : undefined
    if (current && (current.status === '运行中' || current.status === '就绪')) {
      if (current.ticketId) this.gateway.stop(current.ticketId)
      this.store.attempts.update(current.id, { status: '取消', endedAt: this.now() })
    }
    this.store.tasks.save({ ...task, status: '就绪', currentAttemptId: null, blockedFromStatus: null })
    return this.dispatchTask(taskId)
  }

  cancelTask(taskId: string): Task {
    const task = this.requireTask(taskId)
    if (task.status === '完成') throw new Error('已完成的任务不能取消')
    const attempt = task.currentAttemptId ? this.store.attempts.get(task.currentAttemptId) : undefined
    if (attempt && attempt.status !== '结束' && attempt.status !== '取消' && attempt.ticketId) {
      try { this.gateway.stop(attempt.ticketId) } catch { /* A ticket that already ended is still cancelled in xg. */ }
      this.store.attempts.update(attempt.id, { status: '取消', endedAt: this.now() })
    }
    const updated = this.setTaskStatus(taskId, '取消', '人', { reason: '取消任务' })
    this.store.audit.add({ projectId: task.projectId, actor: '人', action: '取消任务', entityType: 'task', entityId: taskId,
      beforeState: task, afterState: updated })
    return updated
  }

  /** Soft-delete a task: it leaves lists and counts, while attempts, evidence, memory and audit stay for history. */
  deleteTask(taskId: string, actor = '你'): Task {
    const task = this.store.tasks.get(taskId)
    if (!task) throw new Error(`任务不存在：${taskId}`)
    if (task.deletedAt) return task
    const attempt = task.currentAttemptId ? this.store.attempts.get(task.currentAttemptId) : undefined
    if (attempt && attempt.status !== '结束' && attempt.status !== '取消' && attempt.ticketId) {
      try { this.gateway.stop(attempt.ticketId) } catch { /* An already ended Ticket is still hidden in xg. */ }
      this.store.attempts.update(attempt.id, { status: '取消', endedAt: this.now() })
    }
    const deleted = this.store.tasks.save({ ...task, deletedAt: this.now() })
    this.event(deleted, '删除', actor, { previousStatus: task.status })
    this.store.audit.add({ projectId: task.projectId, actor, action: '删除任务', entityType: 'task', entityId: taskId,
      beforeState: task, afterState: { deletedAt: deleted.deletedAt } })
    return deleted
  }

  /** Worker report: progress, waiting, ready, blocked, failed, or dropped. Ready moves the task to 评审, never to 完成. */
  report(taskId: string, input: TaskReportInput): { task: Task; attempt: Attempt } {
    const task = this.requireTask(taskId)
    const attemptId = task.currentAttemptId
    if (!attemptId) throw new Error('任务没有当前执行尝试')
    const attempt = this.store.attempts.get(attemptId)
    if (!attempt) throw new Error(`执行尝试不存在：${attemptId}`)
    if (attempt.status === '结束' || attempt.status === '取消') throw new Error('当前执行尝试已结束')
    const project = this.requireProject(task.projectId)
    const summary = this.clean(input.summary, project, 'attempt', attemptId) ?? ''
    const attention = this.clean(input.attention ?? null, project, 'attempt', attemptId)
    if (input.state === 'ready' && task.type === '排障') this.assertTriageComplete(task)
    const now = this.now()
    const status: Attempt['status'] = input.state === 'ready' ? '就绪' : input.state === 'blocked' ? '阻塞'
      : input.state === 'failed' ? '失败' : '运行中'
    this.store.attempts.update(attemptId, { status, stage: input.stage ?? (input.state === 'ready' ? '评审' : '执行'),
      lastReportAt: now, attention })
    const next: TaskStatus = input.state === 'ready' ? '评审' : input.state === 'blocked' || input.state === 'failed' ? '阻塞' : '进行中'
    const updated = this.setTaskStatus(taskId, next, '智能体', { report: input.state, summary, attemptId })
    this.event(updated, '报告', '智能体', { attemptId, state: input.state, summary, attention })
    return { task: updated, attempt: this.store.attempts.get(attemptId)! }
  }

  /** Save the task's spec as a draft, or approve it in the same call; a person approves, not an Agent. */
  saveSpec(taskId: string, input: { content: string; approve?: boolean; approvedBy?: string }): Spec {
    const task = this.requireTask(taskId)
    const project = this.requireProject(task.projectId)
    const content = this.clean(input.content, project, 'spec', taskId) ?? ''
    return this.store.atomic(() => {
      const existing = this.store.specs.forTask(taskId)
      let spec = existing
        ? this.store.specs.update(existing.id, { content, status: '草稿' })
        : this.store.specs.create({ projectId: project.id, taskId, content, status: '草稿' })
      if (input.approve) spec = this.store.specs.approve(spec.id, input.approvedBy ?? '你')
      this.event(task, '规格', '人', { specId: spec.id, status: spec.status })
      this.store.audit.add({ projectId: project.id, actor: input.approvedBy ?? '人', action: input.approve ? '批准规格' : '保存规格',
        entityType: 'spec', entityId: spec.id, afterState: { taskId, status: spec.status } })
      return spec
    })
  }

  /** Add evidence, code, docs, a retrospective, or another artifact; content passes the outbound filter. */
  addArtifact(taskId: string, input: { type: ArtifactType; title?: string; content?: string; uri?: string; attemptId?: string }): Artifact {
    const task = this.requireTask(taskId)
    const project = this.requireProject(task.projectId)
    const content = this.clean(input.content ?? null, project, 'artifact', taskId)
    const uri = this.clean(input.uri ?? null, project, 'artifact', taskId)
    const title = this.clean(input.title ?? null, project, 'artifact', taskId)
    const artifact = this.store.artifacts.add({ taskId, attemptId: input.attemptId ?? task.currentAttemptId, type: input.type,
      title, content, uri })
    this.event(task, '产物', '智能体', { artifactId: artifact.id, type: artifact.type, title: artifact.title })
    return artifact
  }

  /** Record one of the three troubleshooting stages; evidence comes first, and a root cause needs evidence. */
  recordTriage(taskId: string, input: { stage: TriageStage; content: string; artifactId?: string; attemptId?: string }): { step: ReturnType<XgStore['triage']['add']>; task: Task } {
    const task = this.requireTask(taskId)
    if (task.type !== '排障') throw new Error('只有排障任务记录取证、假设、根因')
    const steps = this.store.triage.list(taskId)
    if (input.stage === '取证') {
      if (!input.artifactId) throw new Error('取证必须引用一条已有的“证据”产物，请先调用 xg.artifact.add')
      const artifact = this.store.artifacts.get(input.artifactId)
      if (!artifact || artifact.type !== '证据') throw new Error('取证必须引用 type=证据 的产物')
    }
    if (input.stage === '假设' && !steps.some(step => step.stage === '取证')) throw new Error('没有取证不能进入假设')
    if (input.stage === '根因') {
      if (!steps.some(step => step.stage === '取证')) throw new Error('没有取证不能下根因')
      if (!steps.some(step => step.stage === '假设')) throw new Error('没有假设不能下根因')
      if (!steps.some(step => step.stage === '根因')) {
        const evidence = this.store.artifacts.list(taskId, '证据')
        if (!evidence.length) throw new Error('根因必须引用至少一条证据')
      }
    }
    const project = this.requireProject(task.projectId)
    const content = this.clean(input.content, project, 'triage', taskId) ?? ''
    const step = this.store.triage.add({ taskId, attemptId: input.attemptId ?? task.currentAttemptId, stage: input.stage, content,
      artifactId: input.artifactId ?? null })
    this.event(task, `排障-${input.stage}`, '智能体', { stepId: step.id, artifactId: step.artifactId })
    return { step, task }
  }

  /** Reviewer conclusion: 通过 → 待验收, 退回 → 进行中. The review attempt must differ from the implementation attempt. */
  submitReview(taskId: string, input: ReviewInput): { task: Task; review: Review } {
    const task = this.requireTask(taskId)
    if (task.status !== '评审') throw new Error('只有评审中的任务可以提交评审结论')
    if (!task.currentAttemptId) throw new Error('任务没有实现尝试')
    const implementation = this.store.attempts.get(task.currentAttemptId)
    if (!implementation) throw new Error('实现尝试不存在')
    const reviewerSession = input.reviewerSession ?? `review-${taskId}-${this.store.attempts.nextSeq(taskId)}`
    if (implementation.workerSessionId && reviewerSession === implementation.workerSessionId) {
      throw new Error('评审必须使用独立会话，不能与实现会话相同')
    }
    const project = this.requireProject(task.projectId)
    const comments = this.clean(input.comments ?? null, project, 'review', taskId)
    return this.store.atomic(() => {
      const reviewAttempt = this.store.attempts.create({ taskId, status: '结束', stage: '评审', workerSessionId: reviewerSession,
        endedAt: this.now() })
      const review = this.store.reviews.add({ taskId, reviewAttemptId: reviewAttempt.id, implementationAttemptId: implementation.id,
        reviewer: input.reviewer ?? '评审智能体', decision: input.decision, comments })
      const next: TaskStatus = input.decision === '通过' ? '待验收' : '进行中'
      const updated = this.setTaskStatus(taskId, next, '智能体', { reviewId: review.id, decision: input.decision })
      this.event(updated, '评审', '智能体', { reviewId: review.id, decision: input.decision, comments: input.comments ?? '' })
      this.store.audit.add({ projectId: task.projectId, actor: input.reviewer ?? '评审智能体', action: '提交评审', entityType: 'task', entityId: taskId,
        beforeState: { status: task.status }, afterState: { status: next, reviewId: review.id } })
      return { task: updated, review }
    })
  }

  /** Human final acceptance: only 待验收 → 完成. */
  acceptTask(taskId: string, acceptedBy = '你'): Task {
    const task = this.requireTask(taskId)
    if (task.status !== '待验收') throw new Error('只有待验收的任务可以最终验收')
    const now = this.now()
    const updated = this.store.tasks.save({ ...task, status: '完成', acceptedBy, acceptedAt: now, completedAt: now })
    if (task.currentAttemptId) {
      const attempt = this.store.attempts.get(task.currentAttemptId)
      if (attempt && attempt.status !== '结束' && attempt.status !== '取消') this.store.attempts.update(attempt.id, { status: '结束', endedAt: now })
    }
    this.event(updated, '验收', '人', { acceptedBy })
    this.store.audit.add({ projectId: task.projectId, actor: acceptedBy, action: '最终验收', entityType: 'task', entityId: taskId,
      beforeState: task, afterState: updated })
    return updated
  }

  /** Worker or main Session proposes memory; evidence is mandatory and stored beside the draft. */
  proposeMemory(input: MemoryProposal): MemoryEntry {
    const project = this.requireProject(input.projectId)
    if (!input.artifactIds?.length) throw new Error('记忆必须至少关联一条证据')
    const title = this.clean(input.title, project, 'memory', 'new') ?? ''
    const content = this.clean(input.content, project, 'memory', 'new') ?? ''
    const duplicate = this.store.memory.list({ projectId: input.projectId, status: '已确认', limit: 1000 }).items
      .find(entry => entry.type === input.type && entry.title.trim() === title.trim())
    if (duplicate) throw new Error(`已存在相同标题的已确认记忆：${duplicate.id}`)
    const tags = (input.tags ?? []).map(tag => this.clean(tag, project, 'memory', 'new') ?? '').filter(Boolean)
    return this.store.atomic(() => {
      const entry = this.store.memory.add({ ...input, title, content, tags, status: '待复核' })
      for (const artifactId of input.artifactIds!) this.store.memory.addEvidence(entry.id, artifactId)
      this.store.audit.add({ projectId: input.projectId, actor: '智能体', action: '提交记忆草稿', entityType: 'memory', entityId: entry.id,
        afterState: { title: entry.title, type: entry.type } })
      return entry
    })
  }

  confirmMemory(id: string, by = '你'): MemoryEntry {
    const entry = this.store.memory.get(id)
    if (!entry) throw new Error(`记忆不存在：${id}`)
    if (entry.status === '已确认') return entry
    if (entry.status === '已废弃') throw new Error('已废弃的记忆不能确认')
    if (!this.store.memory.evidence(id).length) throw new Error('记忆没有证据，不能确认')
    const now = this.now()
    const updated = this.store.memory.save({ ...entry, status: '已确认', confirmedBy: by, confirmedAt: now, lastVerifiedAt: now })
    this.store.audit.add({ projectId: entry.projectId, actor: by, action: '确认记忆', entityType: 'memory', entityId: id,
      beforeState: entry, afterState: updated })
    return updated
  }

  rejectMemory(id: string, by = '你', reason = ''): MemoryEntry {
    const entry = this.store.memory.get(id)
    if (!entry) throw new Error(`记忆不存在：${id}`)
    if (entry.status === '已废弃') throw new Error('已废弃的记忆不能退回')
    const updated = this.store.memory.save({ ...entry, status: '草稿', confirmedBy: null, confirmedAt: null })
    this.store.audit.add({ projectId: entry.projectId, actor: by, action: '退回记忆', entityType: 'memory', entityId: id,
      beforeState: entry, afterState: { ...updated, reason } })
    return updated
  }

  /** Search memory with the outbound filter applied; a 机密 project blocks instead of returning redacted text. */
  searchMemory(input: { projectId: string; query: string; types?: MemoryType[]; statuses?: MemoryEntry['status'][]; limit?: number }): MemoryEntry[] {
    const project = this.requireProject(input.projectId)
    return this.store.memory.search(input).map(entry => {
      if (!this.policy) return entry
      const title = this.policy.guard(entry.title, project.sensitivity)
      const content = this.policy.guard(entry.content, project.sensitivity)
      const findings = [...title.findings, ...content.findings]
      if (title.blocked || content.blocked) {
        this.store.audit.add({ projectId: project.id, actor: '系统', action: '过滤阻断', entityType: 'memory', entityId: entry.id,
          afterState: { findings } })
        return { ...entry, title: '[因敏感级别被阻断]', content: '[因敏感级别被阻断]' }
      }
      return { ...entry, title: title.text, content: content.text }
    })
  }

  /**
   * Check each memory entry's code/document/spec references against the files on disk; a changed or missing file
   * marks a confirmed entry 待复核. Relative paths resolve against the project's root path.
   */
  verifyMemoryRefs(projectId: string): { checked: number; changed: number; missing: number } {
    const project = this.requireProject(projectId)
    let checked = 0, changed = 0, missing = 0
    for (const entry of this.store.memory.list({ projectId, limit: 1000 }).items) {
      let mark = false
      for (const ref of this.store.memory.refs(entry.id)) {
        checked++
        if (!isAbsolute(ref.refPath) && !project.rootPath) { missing++; mark = true; continue }
        const path = isAbsolute(ref.refPath) ? ref.refPath : join(project.rootPath!, ref.refPath)
        let hash: string
        try { hash = createHash('sha256').update(readFileSync(path)).digest('hex') }
        catch {
          missing++; mark = true
          this.store.memory.updateRefHash(ref.id, null)
          continue
        }
        if (ref.refHash && ref.refHash !== hash) { changed++; mark = true }
        this.store.memory.updateRefHash(ref.id, hash)
      }
      if (mark && entry.status === '已确认') {
        this.store.memory.save({ ...entry, status: '待复核' })
        this.store.audit.add({ projectId, actor: '系统', action: '引用变化待复核', entityType: 'memory', entityId: entry.id,
          beforeState: { status: entry.status }, afterState: { status: '待复核' } })
      }
    }
    return { checked, changed, missing }
  }

  /** Reconcile every non-terminal task's current attempt with its Ticket. */
  syncAll(): number {
    let changed = 0
    for (const task of this.store.tasks.list({ limit: 1000 }).items) {
      if (!task.currentAttemptId || ['完成', '取消'].includes(task.status)) continue
      if (this.syncTask(task)) changed++
    }
    return changed
  }

  /** Reconcile one task and return whether anything changed. */
  syncTask(taskOrId: Task | string): boolean {
    const task = typeof taskOrId === 'string' ? this.store.tasks.get(taskOrId) : taskOrId
    if (!task?.currentAttemptId) return false
    const attempt = this.store.attempts.get(task.currentAttemptId)
    if (!attempt?.ticketId) return false
    const ticket = this.tickets.get(attempt.ticketId)
    if (!ticket) return false
    const report = latestReport(ticket)
    let attemptStatus: Attempt['status'] = attempt.status
    let stage = attempt.stage
    let taskStatus: TaskStatus = task.status
    if (ticket.ended) {
      attemptStatus = ticket.ended.outcome === 'stopped' ? '取消' : '结束'
      if (task.status !== '完成' && task.status !== '取消' && task.status !== '待验收') taskStatus = report?.state === 'ready' ? '评审' : '阻塞'
    } else if (report?.state === 'ready') {
      attemptStatus = '就绪'; stage = '评审'
      if (['进行中', '阻塞', '就绪'].includes(task.status)) taskStatus = '评审'
    } else if (report?.state === 'blocked' || report?.state === 'failed') {
      attemptStatus = report.state === 'failed' ? '失败' : '阻塞'
      if (['进行中', '就绪'].includes(task.status)) taskStatus = '阻塞'
    } else if (report?.state === 'progress' || report?.state === 'waiting') {
      attemptStatus = '运行中'; stage = '执行'
      if (task.status === '就绪') taskStatus = '进行中'
    }
    if (ticket.attention) {
      attemptStatus = '阻塞'
      if (!['完成', '取消', '待验收'].includes(task.status)) taskStatus = '阻塞'
    }
    const assignment = ticket.assignments.at(-1)
    const patch = {
      ...(attemptStatus !== attempt.status ? { status: attemptStatus } : {}),
      ...(stage !== attempt.stage ? { stage } : {}),
      ...(report && report.at !== attempt.lastReportAt ? { lastReportAt: report.at } : {}),
      ...(ticket.attention?.question !== attempt.attention ? { attention: ticket.attention?.question ?? null } : {}),
      ...(assignment?.id !== attempt.assignmentId ? { assignmentId: assignment?.id ?? null } : {}),
      ...(ticket.ended ? { endedAt: ticket.ended.at } : {}),
    }
    const attemptChanged = Object.keys(patch).length > 0
    if (attemptChanged) this.store.attempts.update(attempt.id, patch)
    const taskChanged = taskStatus !== task.status
    if (taskChanged) this.setTaskStatus(task.id, taskStatus, '系统', { ticketId: ticket.id, outcome: ticketOutcome(ticket) ?? null })
    return attemptChanged || taskChanged
  }

  /** All tasks currently in flight, for the scheduler's scans. */
  readyTasks(): Task[] { return this.store.tasks.ready() }

  overview() {
    const tasks = this.store.tasks.counts()
    const active = this.store.tasks.list({ limit: 1000 }).items.filter(task => ['进行中', '评审', '待验收', '阻塞'].includes(task.status))
    return {
      projects: this.store.projects.list().length,
      tasks,
      active,
      inbox: this.store.inbox.list({ status: '未处理', limit: 1 }).total,
      memoryPending: this.store.memory.list({ status: '待复核', limit: 1 }).total,
      reviews: this.store.reviews.count(),
    }
  }

  taskDetail(taskId: string) {
    const task = this.requireTask(taskId)
    return {
      task,
      project: this.requireProject(task.projectId),
      requirement: this.requireRequirement(task.requirementId),
      attempts: this.store.attempts.list(taskId),
      artifacts: this.store.artifacts.list(taskId),
      triage: this.store.triage.list(taskId),
      reviews: this.store.reviews.list(taskId),
      events: this.store.events.list(taskId),
      spec: this.store.specs.forTask(taskId) ?? null,
    }
  }

  private assertTriageComplete(task: Task): void {
    const steps = this.store.triage.list(task.id)
    if (!steps.some(step => step.stage === '取证')) throw new Error('排障没有取证记录，不能报告 ready')
    if (!steps.some(step => step.stage === '假设')) throw new Error('排障没有假设记录，不能报告 ready')
    if (!steps.some(step => step.stage === '根因')) throw new Error('排障没有根因记录，不能报告 ready')
  }

  private setTaskStatus(taskId: string, status: TaskStatus, actor: string, payload: Record<string, unknown> = {}): Task {
    const task = this.requireTask(taskId)
    if (task.status === status) return task
    const blockedFromStatus = status === '阻塞' ? task.blockedFromStatus ?? task.status : task.status === '阻塞' ? null : task.blockedFromStatus
    const updated = this.store.tasks.save({ ...task, status, blockedFromStatus })
    this.event(updated, '状态变化', actor, { from: task.status, to: status, ...payload })
    return updated
  }

  private event(task: Task, eventType: string, actor: string, payload: Record<string, unknown>): void {
    this.store.events.add(task.id, eventType, actor, payload)
  }

  private clean(value: string | null | undefined, project: Project, entityType: string, entityId: string): string | null {
    if (value === null || value === undefined) return null
    if (!this.policy) return value
    const result = this.policy.guard(value, project.sensitivity)
    if (result.blocked) {
      this.store.audit.add({ projectId: project.id, actor: '系统', action: '过滤阻断', entityType, entityId,
        afterState: { findings: result.findings } })
      throw new Error('内容包含敏感信息，按项目敏感级别已阻断')
    }
    return result.text
  }

  private requireProject(id: string): Project {
    const project = this.store.projects.get(id)
    if (!project) throw new Error(`项目不存在：${id}`)
    return project
  }
  private requireRequirement(id: string): Requirement {
    const requirement = this.store.requirements.get(id)
    if (!requirement) throw new Error(`需求不存在：${id}`)
    return requirement
  }
  private requireTask(id: string): Task {
    const task = this.store.tasks.get(id)
    if (!task) throw new Error(`任务不存在：${id}`)
    if (task.deletedAt) throw new Error(`任务已删除：${id}`)
    return task
  }
  private now(): string { return new Date().toISOString() }
}

/** Production gateway: an authorized xg Trigger becomes a Super-agent Ticket through `Engine.authorizeTicket`. */
export class EngineTicketGateway implements TicketGateway {
  constructor(private readonly engine: {
    authorizeTicket(trigger: Trigger, outcome: { title: string; scope: string; reason: string; name?: string }): Decision
    retryTicket(ticketId: string): unknown
    stopTicket(ticketId: string): unknown
  }, private readonly tickets: TicketReader) {}

  dispatch(input: { task: Task; project: Project; attempt: Attempt; sequence: number; text: string }): { ticketId: string; assignmentId: string | null;
    workerSessionId: string } {
    const { task, project, attempt, sequence } = input
    const trigger: Trigger = {
      id: `xg:task:${task.id}:${sequence}`,
      source: 'xg',
      threads: [{ source: 'xg', id: `task:${task.id}` }, { source: 'xg', id: `requirement:${task.requirementId}` }],
      actor: { source: 'xg', id: 'owner' },
      human: true,
      addressed: 'direct',
      at: new Date().toISOString(),
      text: input.text,
      channel: { source: 'xg', thread: `task:${task.id}`, address: { taskId: task.id, projectId: project.id } },
      meta: { taskId: task.id, attemptId: attempt.id, projectId: project.id, requirementId: task.requirementId },
    }
    const decision = this.engine.authorizeTicket(trigger, {
      title: task.title,
      scope: task.acceptance ?? task.description ?? task.title,
      reason: `雄大工作台任务 ${task.id}`,
      name: `xg-task-${task.seqNo}-a${sequence}`,
    })
    if (decision.kind !== 'accept' || !decision.ticketId) throw new Error(`Ticket 未创建：${decision.kind}`)
    const ticket = this.tickets.get(decision.ticketId)
    if (!ticket) throw new Error(`Ticket 不存在：${decision.ticketId}`)
    return { ticketId: ticket.id, assignmentId: ticket.assignments.at(-1)?.id ?? null, workerSessionId: `worker-${ticket.id}` }
  }

  retry(ticketId: string): void { this.engine.retryTicket(ticketId) }
  stop(ticketId: string): void { this.engine.stopTicket(ticketId) }
}
