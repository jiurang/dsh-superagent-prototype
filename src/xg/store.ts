/** SQLite repositories for the xg business tables, sharing one database with the upstream orchestrator. */
import { copyFileSync } from 'node:fs'
import type { DatabaseSync, SQLInputValue } from 'node:sqlite'
import type {
  Artifact, ArtifactType, Attempt, AttemptStatus, AuditEntry, InboxChannel, InboxItem, InboxStatus, MemoryEntry, MemoryRef, MemoryRefType,
  MemorySourceType, MemoryStatus, MemoryType, Page, Priority, Proposal, ProposalStatus, Project, ProjectSettings, ProjectStatus, Requirement,
  RequirementStatus, Review, ReviewDecision, Sensitivity, Spec, SpecStatus, Task, TaskEvent, TaskStatus, TaskType, TriageStage, TriageStep,
} from './domain.ts'
import { newId, normalizeShortCode, requirementId as requirementIdOf, taskId as taskIdOf } from './ids.ts'
import { migrateXg } from './schema.ts'

type Row = Record<string, unknown>
const text = (value: unknown): string => String(value ?? '')
const nullable = (value: unknown): string | null => value === null || value === undefined ? null : String(value)
const number = (value: unknown): number => Number(value ?? 0)
const flag = (value: unknown): boolean => number(value) !== 0
const json = (value: unknown): unknown => {
  if (value === null || value === undefined) return null
  try { return JSON.parse(String(value)) as unknown } catch { return String(value) }
}
const tags = (value: unknown): string[] => {
  if (value === null || value === undefined || value === '') return []
  try {
    const parsed = JSON.parse(String(value)) as unknown
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch { return String(value).split(',').map(item => item.trim()).filter(Boolean) }
}
const likeEscape = (value: string): string => value.replace(/[\\%_]/g, match => `\\${match}`)

const projectOf = (row: Row): Project => ({
  id: text(row.id), shortCode: text(row.short_code), name: text(row.name), rootPath: nullable(row.root_path),
  sensitivity: text(row.sensitivity) as Sensitivity, status: text(row.status) as ProjectStatus,
  createdAt: text(row.created_at), updatedAt: text(row.updated_at),
})
const projectSettingsOf = (row: Row | undefined, projectId: string): ProjectSettings => ({
  projectId,
  workerProvider: row ? nullable(row.worker_provider) : null,
  workerModel: row ? nullable(row.worker_model) : null,
  workerEffort: row ? nullable(row.worker_effort) : null,
  autoDispatch: row ? flag(row.auto_dispatch) : false,
  defaultPriority: row ? nullable(row.default_priority) as ProjectSettings['defaultPriority'] : null,
  updatedAt: row ? nullable(row.updated_at) : null,
})
const inboxOf = (row: Row): InboxItem => ({
  id: text(row.id), projectId: nullable(row.project_id), channel: text(row.channel) as InboxChannel, contact: nullable(row.contact),
  rawContext: nullable(row.raw_context), externalRef: nullable(row.external_ref), status: text(row.status) as InboxStatus,
  receivedAt: text(row.received_at), triagedAt: nullable(row.triaged_at), deletedAt: nullable(row.deleted_at),
})
const requirementOf = (row: Row): Requirement => ({
  id: text(row.id), projectId: text(row.project_id), seqNo: number(row.seq_no), sourceId: nullable(row.source_id),
  sourceNote: nullable(row.source_note), title: text(row.title), description: nullable(row.description),
  status: text(row.status) as RequirementStatus, priority: nullable(row.priority) as Priority | null,
  deletedAt: nullable(row.deleted_at), createdAt: text(row.created_at), updatedAt: text(row.updated_at),
})
const taskOf = (row: Row): Task => ({
  id: text(row.id), projectId: text(row.project_id), requirementId: text(row.requirement_id), seqNo: number(row.seq_no),
  title: text(row.title), description: nullable(row.description), type: text(row.type) as TaskType, status: text(row.status) as TaskStatus,
  priority: text(row.priority) as Priority, acceptance: nullable(row.acceptance), currentAttemptId: nullable(row.current_attempt_id),
  autoDispatch: flag(row.auto_dispatch), blockedFromStatus: nullable(row.blocked_from_status) as TaskStatus | null,
  acceptedBy: nullable(row.accepted_by), acceptedAt: nullable(row.accepted_at),
  completedAt: nullable(row.completed_at), deletedAt: nullable(row.deleted_at), createdAt: text(row.created_at), updatedAt: text(row.updated_at),
})
const attemptOf = (row: Row): Attempt => ({
  id: text(row.id), taskId: text(row.task_id), ticketId: nullable(row.ticket_id), assignmentId: nullable(row.assignment_id),
  workerSessionId: nullable(row.worker_session_id), stage: nullable(row.stage), status: text(row.status) as AttemptStatus,
  lastReportAt: nullable(row.last_report_at), attention: nullable(row.attention), tokenCost: row.token_cost === null ? null : number(row.token_cost),
  runtimeVersion: nullable(row.runtime_version), createdAt: text(row.created_at), endedAt: nullable(row.ended_at),
})
const artifactOf = (row: Row): Artifact => ({
  id: text(row.id), taskId: text(row.task_id), attemptId: nullable(row.attempt_id), type: text(row.type) as ArtifactType,
  title: nullable(row.title), content: nullable(row.content), uri: nullable(row.uri), createdAt: text(row.created_at),
})
const reviewOf = (row: Row): Review => ({
  id: text(row.id), taskId: text(row.task_id), reviewAttemptId: text(row.review_attempt_id),
  implementationAttemptId: text(row.implementation_attempt_id), reviewer: nullable(row.reviewer),
  decision: text(row.decision) as ReviewDecision, comments: nullable(row.comments), createdAt: text(row.created_at),
})
const memoryOf = (row: Row): MemoryEntry => ({
  id: text(row.id), projectId: text(row.project_id), type: text(row.type) as MemoryType, title: text(row.title), content: text(row.content),
  status: text(row.status) as MemoryStatus, sourceType: text(row.source_type) as MemorySourceType, sourceRef: nullable(row.source_ref),
  tags: tags(row.tags), lastVerifiedAt: nullable(row.last_verified_at), confirmedBy: nullable(row.confirmed_by),
  confirmedAt: nullable(row.confirmed_at), supersededBy: nullable(row.superseded_by),
  createdAt: text(row.created_at), updatedAt: text(row.updated_at),
})
const memoryRefOf = (row: Row): MemoryRef => ({
  id: number(row.id), memoryId: text(row.memory_id), refType: text(row.ref_type) as MemoryRefType,
  refPath: text(row.ref_path), refHash: nullable(row.ref_hash), lastCheckedAt: nullable(row.last_checked_at),
})
const triageOf = (row: Row): TriageStep => ({
  id: number(row.id), taskId: text(row.task_id), attemptId: nullable(row.attempt_id), stage: text(row.stage) as TriageStage,
  content: text(row.content), artifactId: nullable(row.artifact_id), createdAt: text(row.created_at),
})
const eventOf = (row: Row): TaskEvent => ({
  id: number(row.id), taskId: text(row.task_id), eventType: text(row.event_type), actor: nullable(row.actor),
  payload: json(row.payload), createdAt: text(row.created_at),
})
const auditOf = (row: Row): AuditEntry => ({
  id: number(row.id), projectId: nullable(row.project_id), actor: nullable(row.actor), action: text(row.action),
  entityType: text(row.entity_type), entityId: text(row.entity_id), beforeState: json(row.before_state),
  afterState: json(row.after_state), createdAt: text(row.created_at),
})
const specOf = (row: Row): Spec => ({
  id: text(row.id), projectId: text(row.project_id), taskId: nullable(row.task_id), content: text(row.content),
  status: text(row.status) as SpecStatus, approvedBy: nullable(row.approved_by), approvedAt: nullable(row.approved_at),
  createdAt: text(row.created_at), updatedAt: text(row.updated_at),
})
const proposalOf = (row: Row): Proposal => ({
  id: text(row.id), projectId: text(row.project_id), kind: text(row.kind), targetType: text(row.target_type),
  targetId: text(row.target_id), baseRevision: nullable(row.base_revision), title: text(row.title), summary: nullable(row.summary),
  payload: json(row.payload), status: text(row.status) as ProposalStatus, createdBy: text(row.created_by),
  createdAt: text(row.created_at), resolvedBy: nullable(row.resolved_by), resolvedAt: nullable(row.resolved_at),
  resolution: nullable(row.resolution),
})

export interface StoreOptions {
  /** Clock used for every inserted timestamp; tests inject a deterministic one. */
  now?: () => string
  /** Database file, used only by `backupTo`; an in-memory database has none. */
  path?: string
}

/** Validated payloads accepted by `XgStore`; the service layer owns cross-record rules. */
export interface CreateProject { shortCode: string; name: string; rootPath?: string | null; sensitivity?: Sensitivity; status?: ProjectStatus }
export interface UpdateProject { name?: string; rootPath?: string | null; sensitivity?: Sensitivity; status?: ProjectStatus }
export interface CreateInboxItem {
  projectId?: string | null; channel: InboxChannel; contact?: string | null; rawContext?: string | null
  externalRef?: string | null; receivedAt?: string
}
export interface CreateRequirement {
  projectId: string; title: string; description?: string | null; sourceId?: string | null; sourceNote?: string | null
  priority?: Priority | null; status?: RequirementStatus
}
export interface CreateTask {
  projectId: string; requirementId: string; title: string; description?: string | null; type: TaskType
  priority: Priority; status?: TaskStatus; acceptance?: string | null; autoDispatch?: boolean
}
export interface CreateAttempt {
  taskId: string; ticketId?: string | null; assignmentId?: string | null; workerSessionId?: string | null
  stage?: string | null; status?: AttemptStatus; runtimeVersion?: string | null; endedAt?: string | null
}
export interface UpdateAttempt {
  ticketId?: string | null; assignmentId?: string | null; workerSessionId?: string | null; stage?: string | null
  status?: AttemptStatus; lastReportAt?: string | null; attention?: string | null; tokenCost?: number | null
  runtimeVersion?: string | null; endedAt?: string | null
}
export interface CreateProposal {
  projectId: string; kind: string; targetType: string; targetId: string; baseRevision?: string | null
  title: string; summary?: string | null; payload: unknown; createdBy?: string
}
export interface ResolveProposal {
  status: ProposalStatus; resolvedBy: string; resolution?: string | null
}
export interface CreateMemory {
  projectId: string; type: MemoryType; title: string; content: string; status?: MemoryStatus
  sourceType: MemorySourceType; sourceRef?: string | null; tags?: string[]
}
export interface SearchMemoryOptions { projectId: string; query: string; types?: MemoryType[]; statuses?: MemoryStatus[]; limit?: number }

/**
 * xg repositories on an existing `node:sqlite` database. `migrate()` creates only xg tables and the xg version row,
 * leaving the upstream schema untouched; a shared database is backed up by copying it once.
 */
export class XgStore {
  readonly db: DatabaseSync
  private readonly now: () => string
  private readonly path?: string
  private depth = 0

  constructor(db: DatabaseSync, options: StoreOptions = {}) {
    this.db = db
    this.now = options.now ?? (() => new Date().toISOString())
    this.path = options.path
    migrateXg(db)
  }

  /** Run `operation` in a savepoint; nested calls reuse the outer transaction. */
  atomic<T>(operation: () => T): T {
    const level = this.depth++
    const savepoint = `xg_atomic_${level}`
    this.db.exec(`SAVEPOINT ${savepoint}`)
    try {
      const value = operation()
      this.db.exec(`RELEASE ${savepoint}`)
      return value
    } catch (error) {
      this.db.exec(`ROLLBACK TO ${savepoint}`)
      this.db.exec(`RELEASE ${savepoint}`)
      throw error
    } finally { this.depth-- }
  }

  /** Copy the database file after a WAL checkpoint; requires the store to have been opened with `path`. */
  backupTo(destination: string): void {
    if (!this.path) throw new Error('内存数据库无法备份到文件')
    this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    copyFileSync(this.path, destination)
  }

  /** Close the shared database handle; the owner of the handle may prefer to keep it open. */
  close(): void { this.db.close() }

  private all(sql: string, ...parameters: SQLInputValue[]): Row[] {
    return this.db.prepare(sql).all(...parameters) as unknown as Row[]
  }
  private one(sql: string, ...parameters: SQLInputValue[]): Row | undefined {
    return this.db.prepare(sql).get(...parameters) as unknown as Row | undefined
  }
  private nextSeq(table: 'xg_requirements' | 'xg_tasks', projectId: string): number {
    return number(this.one(`SELECT COALESCE(MAX(seq_no), 0) + 1 AS next FROM ${table} WHERE project_id = ?`, projectId)?.next)
  }
  private requireProject(projectId: string): Project {
    const project = this.projects.get(projectId)
    if (!project) throw new Error(`项目不存在：${projectId}`)
    return project
  }

  readonly projects = {
    create: (input: CreateProject): Project => {
      const shortCode = normalizeShortCode(input.shortCode)
      if (this.projects.byShortCode(shortCode)) throw new Error(`项目短码已存在：${shortCode}`)
      const id = newId('PRJ'), at = this.now()
      this.db.prepare(`INSERT INTO xg_projects
        (id, short_code, name, root_path, sensitivity, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`)
        .run(id, shortCode, input.name.trim(), input.rootPath ?? null, input.sensitivity ?? '内部', input.status ?? '活跃', at, at)
      return this.projects.get(id)!
    },
    get: (id: string): Project | undefined => {
      const row = this.one('SELECT * FROM xg_projects WHERE id = ?', id)
      return row ? projectOf(row) : undefined
    },
    byShortCode: (shortCode: string): Project | undefined => {
      const row = this.one('SELECT * FROM xg_projects WHERE short_code = ?', shortCode)
      return row ? projectOf(row) : undefined
    },
    list: (): Project[] => this.all('SELECT * FROM xg_projects ORDER BY created_at, id').map(projectOf),
    update: (id: string, patch: UpdateProject): Project => {
      const current = this.requireProject(id)
      const at = this.now()
      this.db.prepare(`UPDATE xg_projects SET name=?, root_path=?, sensitivity=?, status=?, updated_at=? WHERE id=?`)
        .run(patch.name ?? current.name, patch.rootPath === undefined ? current.rootPath : patch.rootPath,
          patch.sensitivity ?? current.sensitivity, patch.status ?? current.status, at, id)
      return this.projects.get(id)!
    },
  }

  readonly projectSettings = {
    get: (projectId: string): ProjectSettings => {
      if (!this.projects.get(projectId)) throw new Error(`项目不存在：${projectId}`)
      const row = this.one('SELECT * FROM xg_project_settings WHERE project_id = ?', projectId)
      return projectSettingsOf(row, projectId)
    },
    save: (projectId: string, patch: { workerProvider?: string | null; workerModel?: string | null; workerEffort?: string | null;
      autoDispatch?: boolean; defaultPriority?: Priority | null }): ProjectSettings => {
      if (!this.projects.get(projectId)) throw new Error(`项目不存在：${projectId}`)
      const current = this.projectSettings.get(projectId)
      this.db.prepare(`INSERT INTO xg_project_settings
        (project_id, worker_provider, worker_model, worker_effort, auto_dispatch, default_priority, updated_at)
        VALUES (?,?,?,?,?,?,?)
        ON CONFLICT(project_id) DO UPDATE SET worker_provider=excluded.worker_provider, worker_model=excluded.worker_model,
          worker_effort=excluded.worker_effort, auto_dispatch=excluded.auto_dispatch,
          default_priority=excluded.default_priority, updated_at=excluded.updated_at`)
        .run(projectId, patch.workerProvider === undefined ? current.workerProvider : patch.workerProvider,
          patch.workerModel === undefined ? current.workerModel : patch.workerModel,
          patch.workerEffort === undefined ? current.workerEffort : patch.workerEffort,
          (patch.autoDispatch === undefined ? current.autoDispatch : patch.autoDispatch) ? 1 : 0,
          patch.defaultPriority === undefined ? current.defaultPriority : patch.defaultPriority, this.now())
      return this.projectSettings.get(projectId)
    },
  }

  readonly inbox = {
    /** Insert once by `(channel, external_ref)`; a duplicate returns the existing row with `created: false`. */
    add: (input: CreateInboxItem): { item: InboxItem; created: boolean } => {
      if (input.projectId) this.requireProject(input.projectId)
      if (input.externalRef) {
        const existing = this.one('SELECT * FROM xg_inbox_items WHERE channel = ? AND external_ref = ?', input.channel, input.externalRef)
        if (existing) return { item: inboxOf(existing), created: false }
      }
      const id = newId('INB'), at = input.receivedAt ?? this.now()
      this.db.prepare(`INSERT INTO xg_inbox_items
        (id, project_id, channel, contact, raw_context, external_ref, status, received_at, triaged_at)
        VALUES (?,?,?,?,?,?,'未处理',?,NULL)`)
        .run(id, input.projectId ?? null, input.channel, input.contact ?? null, input.rawContext ?? null, input.externalRef ?? null, at)
      return { item: this.inbox.get(id)!, created: true }
    },
    get: (id: string): InboxItem | undefined => {
      const row = this.one('SELECT * FROM xg_inbox_items WHERE id = ?', id)
      return row ? inboxOf(row) : undefined
    },
    list: (filter: { projectId?: string; status?: InboxStatus; limit?: number; includeDeleted?: boolean } = {}): Page<InboxItem> => {
      const clauses = [filter.includeDeleted ? '1=1' : 'deleted_at IS NULL'], values: SQLInputValue[] = []
      if (filter.projectId) { clauses.push('project_id = ?'); values.push(filter.projectId) }
      if (filter.status) { clauses.push('status = ?'); values.push(filter.status) }
      const where = clauses.join(' AND ')
      const total = number(this.one(`SELECT COUNT(*) AS total FROM xg_inbox_items WHERE ${where}`, ...values)?.total)
      const items = this.all(`SELECT * FROM xg_inbox_items WHERE ${where} ORDER BY received_at DESC, id DESC LIMIT ?`,
        ...values, filter.limit ?? 200).map(inboxOf)
      return { items, total }
    },
    markTriaged: (id: string, status: Exclude<InboxStatus, '未处理'> = '已建需求'): InboxItem => {
      this.db.prepare('UPDATE xg_inbox_items SET status=?, triaged_at=? WHERE id=?').run(status, this.now(), id)
      const item = this.inbox.get(id)
      if (!item) throw new Error(`收件不存在：${id}`)
      return item
    },
    delete: (id: string, at = this.now()): InboxItem => {
      this.db.prepare('UPDATE xg_inbox_items SET deleted_at=? WHERE id=?').run(at, id)
      const item = this.inbox.get(id)
      if (!item) throw new Error(`收件不存在：${id}`)
      return item
    },
  }

  readonly requirements = {
    create: (input: CreateRequirement): Requirement => {
      const project = this.requireProject(input.projectId)
      if (!input.sourceId && !input.sourceNote) throw new Error('需求必须有来源（收件记录或人工说明）')
      const seqNo = this.nextSeq('xg_requirements', project.id), id = requirementIdOf(project.shortCode, seqNo), at = this.now()
      this.db.prepare(`INSERT INTO xg_requirements
        (id, project_id, seq_no, source_id, source_note, title, description, status, priority, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
        .run(id, project.id, seqNo, input.sourceId ?? null, input.sourceNote ?? null, input.title.trim(), input.description ?? null,
          input.status ?? '待确认', input.priority ?? null, at, at)
      return this.requirements.get(id)!
    },
    get: (id: string): Requirement | undefined => {
      const row = this.one('SELECT * FROM xg_requirements WHERE id = ?', id)
      return row ? requirementOf(row) : undefined
    },
    list: (filter: { projectId?: string; status?: RequirementStatus; limit?: number; includeDeleted?: boolean } = {}): Page<Requirement> => {
      const clauses = [filter.includeDeleted ? '1=1' : 'deleted_at IS NULL'], values: SQLInputValue[] = []
      if (filter.projectId) { clauses.push('project_id = ?'); values.push(filter.projectId) }
      if (filter.status) { clauses.push('status = ?'); values.push(filter.status) }
      const where = clauses.join(' AND ')
      const total = number(this.one(`SELECT COUNT(*) AS total FROM xg_requirements WHERE ${where}`, ...values)?.total)
      const items = this.all(`SELECT * FROM xg_requirements WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ?`,
        ...values, filter.limit ?? 200).map(requirementOf)
      return { items, total }
    },
    update: (id: string, patch: { title?: string; description?: string | null; status?: RequirementStatus; priority?: Priority | null }): Requirement => {
      const current = this.requirements.get(id)
      if (!current) throw new Error(`需求不存在：${id}`)
      this.db.prepare('UPDATE xg_requirements SET title=?, description=?, status=?, priority=?, updated_at=? WHERE id=?')
        .run(patch.title ?? current.title, patch.description === undefined ? current.description : patch.description,
          patch.status ?? current.status, patch.priority === undefined ? current.priority : patch.priority, this.now(), id)
      return this.requirements.get(id)!
    },
    delete: (id: string, at = this.now()): Requirement => {
      this.db.prepare('UPDATE xg_requirements SET deleted_at=?, updated_at=? WHERE id=?').run(at, at, id)
      const requirement = this.requirements.get(id)
      if (!requirement) throw new Error(`需求不存在：${id}`)
      return requirement
    },
  }

  readonly tasks = {
    create: (input: CreateTask): Task => {
      const project = this.requireProject(input.projectId)
      const requirement = this.requirements.get(input.requirementId)
      if (!requirement) throw new Error(`需求不存在：${input.requirementId}`)
      if (requirement.projectId !== project.id) throw new Error('任务与需求必须属于同一项目')
      const seqNo = this.nextSeq('xg_tasks', project.id), id = taskIdOf(project.shortCode, seqNo), at = this.now()
      this.db.prepare(`INSERT INTO xg_tasks
        (id, project_id, requirement_id, seq_no, title, description, type, status, priority, acceptance, current_attempt_id,
         auto_dispatch, blocked_from_status, accepted_by, accepted_at, completed_at, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,NULL,?,NULL,NULL,NULL,NULL,?,?)`)
        .run(id, project.id, input.requirementId, seqNo, input.title.trim(), input.description ?? null, input.type,
          input.status ?? '就绪', input.priority, input.acceptance ?? null, input.autoDispatch ? 1 : 0, at, at)
      return this.tasks.get(id)!
    },
    get: (id: string): Task | undefined => {
      const row = this.one('SELECT * FROM xg_tasks WHERE id = ?', id)
      return row ? taskOf(row) : undefined
    },
    list: (filter: { projectId?: string; status?: TaskStatus; type?: TaskType; requirementId?: string; limit?: number; includeDeleted?: boolean } = {}): Page<Task> => {
      const clauses = [filter.includeDeleted ? '1=1' : 'deleted_at IS NULL'], values: SQLInputValue[] = []
      for (const [column, value] of [['project_id', filter.projectId], ['status', filter.status], ['type', filter.type],
        ['requirement_id', filter.requirementId]] as const) {
        if (value !== undefined) { clauses.push(`${column} = ?`); values.push(value) }
      }
      const where = clauses.join(' AND ')
      const total = number(this.one(`SELECT COUNT(*) AS total FROM xg_tasks WHERE ${where}`, ...values)?.total)
      const items = this.all(`SELECT * FROM xg_tasks WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ?`,
        ...values, filter.limit ?? 200).map(taskOf)
      return { items, total }
    },
    /** Ready tasks the runtime may dispatch automatically, oldest first. */
    ready: (): Task[] => this.all("SELECT * FROM xg_tasks WHERE status = '就绪' AND auto_dispatch = 1 AND deleted_at IS NULL ORDER BY created_at, id").map(taskOf),
    save: (task: Task): Task => {
      this.db.prepare(`UPDATE xg_tasks SET title=?, description=?, type=?, status=?, priority=?, acceptance=?, current_attempt_id=?,
        auto_dispatch=?, blocked_from_status=?, accepted_by=?, accepted_at=?, completed_at=?, deleted_at=?, updated_at=? WHERE id=?`)
        .run(task.title, task.description, task.type, task.status, task.priority, task.acceptance, task.currentAttemptId,
          task.autoDispatch ? 1 : 0, task.blockedFromStatus ?? null, task.acceptedBy, task.acceptedAt, task.completedAt, task.deletedAt,
          this.now(), task.id)
      return this.tasks.get(task.id)!
    },
    counts: (projectId?: string): Record<TaskStatus, number> => {
      const rows = projectId
        ? this.all('SELECT status, COUNT(*) AS n FROM xg_tasks WHERE project_id = ? AND deleted_at IS NULL GROUP BY status', projectId)
        : this.all('SELECT status, COUNT(*) AS n FROM xg_tasks WHERE deleted_at IS NULL GROUP BY status')
      const counts = { 就绪: 0, 进行中: 0, 评审: 0, 待验收: 0, 完成: 0, 阻塞: 0, 取消: 0 } as Record<TaskStatus, number>
      for (const row of rows) counts[text(row.status) as TaskStatus] = number(row.n)
      return counts
    },
  }

  readonly attempts = {
    create: (input: CreateAttempt): Attempt => {
      if (!this.tasks.get(input.taskId)) throw new Error(`任务不存在：${input.taskId}`)
      const seq = number(this.one('SELECT COUNT(*) AS n FROM xg_attempts WHERE task_id = ?', input.taskId)?.n) + 1
      const id = `${input.taskId}-A${seq}`, at = this.now()
      this.db.prepare(`INSERT INTO xg_attempts
        (id, task_id, ticket_id, assignment_id, worker_session_id, stage, status, last_report_at, attention, token_cost,
         runtime_version, created_at, ended_at) VALUES (?,?,?,?,?,?,?,NULL,NULL,NULL,?,?,?)`)
        .run(id, input.taskId, input.ticketId ?? null, input.assignmentId ?? null, input.workerSessionId ?? null,
          input.stage ?? null, input.status ?? '运行中', input.runtimeVersion ?? null, at, input.endedAt ?? null)
      return this.attempts.get(id)!
    },
    get: (id: string): Attempt | undefined => {
      const row = this.one('SELECT * FROM xg_attempts WHERE id = ?', id)
      return row ? attemptOf(row) : undefined
    },
    list: (taskId: string): Attempt[] => this.all('SELECT * FROM xg_attempts WHERE task_id = ? ORDER BY created_at, id', taskId).map(attemptOf),
    update: (id: string, patch: UpdateAttempt): Attempt => {
      const current = this.attempts.get(id)
      if (!current) throw new Error(`执行尝试不存在：${id}`)
      this.db.prepare(`UPDATE xg_attempts SET ticket_id=?, assignment_id=?, worker_session_id=?, stage=?, status=?, last_report_at=?,
        attention=?, token_cost=?, runtime_version=?, ended_at=? WHERE id=?`)
        .run(patch.ticketId === undefined ? current.ticketId : patch.ticketId,
          patch.assignmentId === undefined ? current.assignmentId : patch.assignmentId,
          patch.workerSessionId === undefined ? current.workerSessionId : patch.workerSessionId,
          patch.stage === undefined ? current.stage : patch.stage, patch.status ?? current.status,
          patch.lastReportAt === undefined ? current.lastReportAt : patch.lastReportAt,
          patch.attention === undefined ? current.attention : patch.attention,
          patch.tokenCost === undefined ? current.tokenCost : patch.tokenCost,
          patch.runtimeVersion === undefined ? current.runtimeVersion : patch.runtimeVersion,
          patch.endedAt === undefined ? current.endedAt : patch.endedAt, id)
      return this.attempts.get(id)!
    },
    active: (taskId: string): Attempt | undefined => {
      const row = this.one(`SELECT * FROM xg_attempts WHERE task_id = ? AND status IN ('运行中','就绪','阻塞','失败')
        ORDER BY created_at DESC, id DESC LIMIT 1`, taskId)
      return row ? attemptOf(row) : undefined
    },
    byTicket: (ticketId: string): Attempt | undefined => {
      const row = this.one('SELECT * FROM xg_attempts WHERE ticket_id = ? ORDER BY created_at DESC, id DESC LIMIT 1', ticketId)
      return row ? attemptOf(row) : undefined
    },
    nextSeq: (taskId: string): number => number(this.one('SELECT COUNT(*) AS n FROM xg_attempts WHERE task_id = ?', taskId)?.n) + 1,
  }

  readonly artifacts = {
    add: (input: { taskId: string; attemptId?: string | null; type: ArtifactType; title?: string | null; content?: string | null; uri?: string | null }): Artifact => {
      if (!this.tasks.get(input.taskId)) throw new Error(`任务不存在：${input.taskId}`)
      if (input.attemptId) {
        const attempt = this.attempts.get(input.attemptId)
        if (!attempt) throw new Error(`执行尝试不存在：${input.attemptId}`)
        if (attempt.taskId !== input.taskId) throw new Error('产物与执行尝试必须属于同一任务')
      }
      const id = newId('ART'), at = this.now()
      this.db.prepare('INSERT INTO xg_artifacts (id, task_id, attempt_id, type, title, content, uri, created_at) VALUES (?,?,?,?,?,?,?,?)')
        .run(id, input.taskId, input.attemptId ?? null, input.type, input.title ?? null, input.content ?? null, input.uri ?? null, at)
      return this.artifacts.get(id)!
    },
    get: (id: string): Artifact | undefined => {
      const row = this.one('SELECT * FROM xg_artifacts WHERE id = ?', id)
      return row ? artifactOf(row) : undefined
    },
    list: (taskId: string, type?: ArtifactType): Artifact[] => type
      ? this.all('SELECT * FROM xg_artifacts WHERE task_id = ? AND type = ? ORDER BY created_at, id', taskId, type).map(artifactOf)
      : this.all('SELECT * FROM xg_artifacts WHERE task_id = ? ORDER BY created_at, id', taskId).map(artifactOf),
  }

  readonly triage = {
    add: (input: { taskId: string; attemptId?: string | null; stage: TriageStage; content: string; artifactId?: string | null }): TriageStep => {
      if (!this.tasks.get(input.taskId)) throw new Error(`任务不存在：${input.taskId}`)
      if (input.artifactId) {
        const artifact = this.artifacts.get(input.artifactId)
        if (!artifact) throw new Error(`证据不存在：${input.artifactId}`)
        if (artifact.taskId !== input.taskId) throw new Error('证据必须属于同一任务')
      }
      this.db.prepare('INSERT INTO xg_triage_steps (task_id, attempt_id, stage, content, artifact_id, created_at) VALUES (?,?,?,?,?,?)')
        .run(input.taskId, input.attemptId ?? null, input.stage, input.content, input.artifactId ?? null, this.now())
      return this.triage.list(input.taskId).at(-1)!
    },
    list: (taskId: string): TriageStep[] => this.all('SELECT * FROM xg_triage_steps WHERE task_id = ? ORDER BY id', taskId).map(triageOf),
  }

  readonly reviews = {
    add: (input: { taskId: string; reviewAttemptId: string; implementationAttemptId: string; reviewer?: string | null;
      decision: ReviewDecision; comments?: string | null }): Review => {
      if (input.reviewAttemptId === input.implementationAttemptId) throw new Error('评审尝试必须独立于实现尝试')
      for (const attemptId of [input.reviewAttemptId, input.implementationAttemptId]) {
        const attempt = this.attempts.get(attemptId)
        if (!attempt) throw new Error(`执行尝试不存在：${attemptId}`)
        if (attempt.taskId !== input.taskId) throw new Error('评审尝试必须属于同一任务')
      }
      const id = newId('REV')
      this.db.prepare(`INSERT INTO xg_reviews
        (id, task_id, review_attempt_id, implementation_attempt_id, reviewer, decision, comments, created_at)
        VALUES (?,?,?,?,?,?,?,?)`)
        .run(id, input.taskId, input.reviewAttemptId, input.implementationAttemptId, input.reviewer ?? null,
          input.decision, input.comments ?? null, this.now())
      return this.reviews.get(id)!
    },
    get: (id: string): Review | undefined => {
      const row = this.one('SELECT * FROM xg_reviews WHERE id = ?', id)
      return row ? reviewOf(row) : undefined
    },
    list: (taskId: string): Review[] => this.all('SELECT * FROM xg_reviews WHERE task_id = ? ORDER BY created_at DESC, id DESC', taskId).map(reviewOf),
    /** Reviews across the tasks of one project, newest first, with the task title. */
    listProject: (projectId: string, limit = 200): (Review & { taskTitle: string })[] => this.all(
      `SELECT r.*, t.title AS task_title FROM xg_reviews r JOIN xg_tasks t ON t.id = r.task_id
       WHERE t.project_id = ? ORDER BY r.created_at DESC, r.id DESC LIMIT ?`, projectId, limit)
      .map(row => ({ ...reviewOf(row), taskTitle: text(row.task_title) })),
    /** Reviews across every project, newest first, with the task title. */
    listAll: (limit = 200): (Review & { taskTitle: string })[] => this.all(
      `SELECT r.*, t.title AS task_title FROM xg_reviews r JOIN xg_tasks t ON t.id = r.task_id
       ORDER BY r.created_at DESC, r.id DESC LIMIT ?`, limit)
      .map(row => ({ ...reviewOf(row), taskTitle: text(row.task_title) })),
    count: (projectId?: string): number => projectId
      ? number(this.one('SELECT COUNT(*) AS n FROM xg_reviews r JOIN xg_tasks t ON t.id = r.task_id WHERE t.project_id = ?', projectId)?.n)
      : number(this.one('SELECT COUNT(*) AS n FROM xg_reviews')?.n),
  }

  readonly specs = {
    create: (input: { projectId: string; taskId?: string | null; content: string; status?: SpecStatus }): Spec => {
      this.requireProject(input.projectId)
      if (input.taskId) {
        const task = this.tasks.get(input.taskId)
        if (!task) throw new Error(`任务不存在：${input.taskId}`)
        if (task.projectId !== input.projectId) throw new Error('规格与任务必须属于同一项目')
      }
      const id = newId('SPEC'), at = this.now()
      this.db.prepare(`INSERT INTO xg_specs (id, project_id, task_id, content, status, approved_by, approved_at, created_at, updated_at)
        VALUES (?,?,?,?,?,NULL,NULL,?,?)`)
        .run(id, input.projectId, input.taskId ?? null, input.content, input.status ?? '草稿', at, at)
      return this.specs.get(id)!
    },
    get: (id: string): Spec | undefined => {
      const row = this.one('SELECT * FROM xg_specs WHERE id = ?', id)
      return row ? specOf(row) : undefined
    },
    forTask: (taskId: string): Spec | undefined => {
      const row = this.one("SELECT * FROM xg_specs WHERE task_id = ? AND status <> '已废弃' ORDER BY created_at DESC LIMIT 1", taskId)
      return row ? specOf(row) : undefined
    },
    update: (id: string, patch: { content?: string; status?: SpecStatus }): Spec => {
      const current = this.specs.get(id)
      if (!current) throw new Error(`规格不存在：${id}`)
      const status = patch.status ?? current.status
      this.db.prepare(`UPDATE xg_specs SET content=?, status=?, approved_by=?, approved_at=?, updated_at=? WHERE id=?`)
        .run(patch.content ?? current.content, status, status === '草稿' ? null : current.approvedBy,
          status === '草稿' ? null : current.approvedAt, this.now(), id)
      return this.specs.get(id)!
    },
    approve: (id: string, by: string): Spec => {
      this.db.prepare("UPDATE xg_specs SET status='已批准', approved_by=?, approved_at=?, updated_at=? WHERE id=?").run(by, this.now(), this.now(), id)
      const spec = this.specs.get(id)
      if (!spec) throw new Error(`规格不存在：${id}`)
      return spec
    },
  }

  readonly proposals = {
    create: (input: CreateProposal): Proposal => {
      this.requireProject(input.projectId)
      const id = newId('PROP'), at = this.now()
      this.db.prepare(`INSERT INTO xg_proposals
        (id, project_id, kind, target_type, target_id, base_revision, title, summary, payload, status, created_by,
         created_at, resolved_by, resolved_at, resolution)
        VALUES (?,?,?,?,?,?,?,?,?,'待确认',?,?,NULL,NULL,NULL)`)
        .run(id, input.projectId, input.kind, input.targetType, input.targetId, input.baseRevision ?? null,
          input.title.trim(), input.summary ?? null, JSON.stringify(input.payload), input.createdBy ?? '智能体', at)
      return this.proposals.get(id)!
    },
    get: (id: string): Proposal | undefined => {
      const row = this.one('SELECT * FROM xg_proposals WHERE id = ?', id)
      return row ? proposalOf(row) : undefined
    },
    list: (filter: { projectId?: string; status?: ProposalStatus; targetType?: string; targetId?: string; limit?: number } = {}): Page<Proposal> => {
      const clauses = ['1=1'], values: SQLInputValue[] = []
      for (const [column, value] of [['project_id', filter.projectId], ['status', filter.status],
        ['target_type', filter.targetType], ['target_id', filter.targetId]] as const) {
        if (value !== undefined) { clauses.push(`${column} = ?`); values.push(value) }
      }
      const where = clauses.join(' AND ')
      const total = number(this.one(`SELECT COUNT(*) AS total FROM xg_proposals WHERE ${where}`, ...values)?.total)
      const items = this.all(`SELECT * FROM xg_proposals WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ?`,
        ...values, filter.limit ?? 200).map(proposalOf)
      return { items, total }
    },
    resolve: (id: string, patch: ResolveProposal): Proposal => {
      this.db.prepare(`UPDATE xg_proposals SET status=?, resolved_by=?, resolved_at=?, resolution=? WHERE id=?`)
        .run(patch.status, patch.resolvedBy, this.now(), patch.resolution ?? null, id)
      const proposal = this.proposals.get(id)
      if (!proposal) throw new Error(`提案不存在：${id}`)
      return proposal
    },
  }

  readonly memory = {
    add: (input: CreateMemory): MemoryEntry => {
      this.requireProject(input.projectId)
      const id = newId('MEM'), at = this.now()
      this.db.prepare(`INSERT INTO xg_memory_entries
        (id, project_id, type, title, content, status, source_type, source_ref, tags, last_verified_at, confirmed_by, confirmed_at,
         superseded_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,NULL,NULL,NULL,NULL,?,?)`)
        .run(id, input.projectId, input.type, input.title, input.content, input.status ?? '草稿', input.sourceType, input.sourceRef ?? null,
          JSON.stringify(input.tags ?? []), at, at)
      return this.memory.get(id)!
    },
    get: (id: string): MemoryEntry | undefined => {
      const row = this.one('SELECT * FROM xg_memory_entries WHERE id = ?', id)
      return row ? memoryOf(row) : undefined
    },
    list: (filter: { projectId?: string; status?: MemoryStatus; type?: MemoryType; limit?: number } = {}): Page<MemoryEntry> => {
      const clauses = ['1=1'], values: SQLInputValue[] = []
      for (const [column, value] of [['project_id', filter.projectId], ['status', filter.status], ['type', filter.type]] as const) {
        if (value !== undefined) { clauses.push(`${column} = ?`); values.push(value) }
      }
      const where = clauses.join(' AND ')
      const total = number(this.one(`SELECT COUNT(*) AS total FROM xg_memory_entries WHERE ${where}`, ...values)?.total)
      const items = this.all(`SELECT * FROM xg_memory_entries WHERE ${where} ORDER BY updated_at DESC, id DESC LIMIT ?`,
        ...values, filter.limit ?? 200).map(memoryOf)
      return { items, total }
    },
    save: (entry: MemoryEntry): MemoryEntry => {
      this.db.prepare(`UPDATE xg_memory_entries SET type=?, title=?, content=?, status=?, source_type=?, source_ref=?, tags=?,
        last_verified_at=?, confirmed_by=?, confirmed_at=?, superseded_by=?, updated_at=? WHERE id=?`)
        .run(entry.type, entry.title, entry.content, entry.status, entry.sourceType, entry.sourceRef, JSON.stringify(entry.tags),
          entry.lastVerifiedAt, entry.confirmedBy, entry.confirmedAt, entry.supersededBy, this.now(), entry.id)
      return this.memory.get(entry.id)!
    },
    /** Keyword search over title and content: FTS5 trigram for terms of three or more characters, LIKE otherwise. */
    search: (options: SearchMemoryOptions): MemoryEntry[] => {
      const terms = options.query.trim().split(/\s+/).filter(Boolean).slice(0, 8)
      if (!terms.length) return []
      const clauses = ['e.project_id = ?'], values: SQLInputValue[] = [options.projectId]
      // Memory packs and the search tool read only confirmed entries unless a caller explicitly asks for review states.
      const statuses = options.statuses?.length ? options.statuses : ['已确认'] as const
      clauses.push(`e.status IN (${statuses.map(() => '?').join(',')})`); values.push(...statuses)
      if (options.types?.length) {
        clauses.push(`e.type IN (${options.types.map(() => '?').join(',')})`); values.push(...options.types)
      }
      const limit = Math.max(1, Math.min(options.limit ?? 20, 100))
      try {
        if (terms.every(term => [...term].length >= 3)) {
          const match = terms.map(term => `"${term.replaceAll('"', '""')}"`).join(' AND ')
          const rows = this.all(`SELECT e.*, bm25(xg_memory_fts) AS rank FROM xg_memory_fts
            JOIN xg_memory_entries e ON e.rowid = xg_memory_fts.rowid
            WHERE xg_memory_fts MATCH ? AND ${clauses.join(' AND ')}
            ORDER BY rank, e.updated_at DESC LIMIT ?`, match, ...values, limit)
          if (rows.length) return rows.map(memoryOf)
        }
      } catch { /* Fall through to LIKE for a query FTS cannot parse. */ }
      const likeClauses = terms.map(() => "(e.title LIKE ? ESCAPE '\\' OR e.content LIKE ? ESCAPE '\\')")
      const likeValues = terms.flatMap(term => [`%${likeEscape(term)}%`, `%${likeEscape(term)}%`])
      return this.all(`SELECT e.* FROM xg_memory_entries e WHERE ${clauses.join(' AND ')} AND ${likeClauses.join(' AND ')}
        ORDER BY e.updated_at DESC LIMIT ?`, ...values, ...likeValues, limit).map(memoryOf)
    },
    addEvidence: (memoryIdValue: string, artifactId: string): void => {
      const memory = this.memory.get(memoryIdValue)
      if (!memory) throw new Error(`记忆不存在：${memoryIdValue}`)
      if (!this.artifacts.get(artifactId)) throw new Error(`证据不存在：${artifactId}`)
      const sameProject = this.one(`SELECT 1 AS ok FROM xg_artifacts a JOIN xg_tasks t ON t.id = a.task_id
        WHERE a.id = ? AND t.project_id = ?`, artifactId, memory.projectId)
      if (!sameProject) throw new Error('记忆证据必须属于同一项目')
      this.db.prepare('INSERT OR IGNORE INTO xg_memory_evidence (memory_id, artifact_id, created_at) VALUES (?,?,?)')
        .run(memoryIdValue, artifactId, this.now())
    },
    evidence: (memoryIdValue: string): string[] => this.all('SELECT artifact_id FROM xg_memory_evidence WHERE memory_id = ? ORDER BY created_at',
      memoryIdValue).map(row => text(row.artifact_id)),
    addRef: (input: { memoryId: string; refType: MemoryRefType; refPath: string; refHash?: string | null }): MemoryRef => {
      if (!this.memory.get(input.memoryId)) throw new Error(`记忆不存在：${input.memoryId}`)
      this.db.prepare(`INSERT INTO xg_memory_refs (memory_id, ref_type, ref_path, ref_hash, last_checked_at) VALUES (?,?,?,?,?)
        ON CONFLICT(memory_id, ref_type, ref_path) DO UPDATE SET ref_hash=excluded.ref_hash, last_checked_at=excluded.last_checked_at`)
        .run(input.memoryId, input.refType, input.refPath, input.refHash ?? null, this.now())
      const row = this.one('SELECT * FROM xg_memory_refs WHERE memory_id = ? AND ref_type = ? AND ref_path = ?',
        input.memoryId, input.refType, input.refPath)
      return memoryRefOf(row!)
    },
    refs: (memoryIdValue: string): MemoryRef[] => this.all('SELECT * FROM xg_memory_refs WHERE memory_id = ? ORDER BY id', memoryIdValue).map(memoryRefOf),
    updateRefHash: (id: number, refHash: string | null): void => {
      this.db.prepare('UPDATE xg_memory_refs SET ref_hash=?, last_checked_at=? WHERE id=?').run(refHash, this.now(), id)
    },
  }

  readonly events = {
    add: (taskIdValue: string, eventType: string, actor: string | null = null, payload: unknown = null): TaskEvent => {
      this.db.prepare('INSERT INTO xg_task_events (task_id, event_type, actor, payload, created_at) VALUES (?,?,?,?,?)')
        .run(taskIdValue, eventType, actor, payload === null ? null : JSON.stringify(payload), this.now())
      return this.events.list(taskIdValue).at(-1)!
    },
    list: (taskIdValue: string): TaskEvent[] => this.all('SELECT * FROM xg_task_events WHERE task_id = ? ORDER BY id', taskIdValue).map(eventOf),
  }

  readonly audit = {
    add: (entry: { projectId?: string | null; actor?: string | null; action: string; entityType: string; entityId: string;
      beforeState?: unknown; afterState?: unknown }): AuditEntry => {
      this.db.prepare(`INSERT INTO xg_audit_log (project_id, actor, action, entity_type, entity_id, before_state, after_state, created_at)
        VALUES (?,?,?,?,?,?,?,?)`)
        .run(entry.projectId ?? null, entry.actor ?? null, entry.action, entry.entityType, entry.entityId,
          entry.beforeState === undefined ? null : JSON.stringify(entry.beforeState),
          entry.afterState === undefined ? null : JSON.stringify(entry.afterState), this.now())
      return this.audit.list({}).at(-1)!
    },
    list: (filter: { projectId?: string; limit?: number }): AuditEntry[] => filter.projectId
      ? this.all('SELECT * FROM xg_audit_log WHERE project_id = ? ORDER BY id DESC LIMIT ?', filter.projectId, filter.limit ?? 200).map(auditOf)
      : this.all('SELECT * FROM xg_audit_log ORDER BY id DESC LIMIT ?', filter.limit ?? 200).map(auditOf),
  }
}
