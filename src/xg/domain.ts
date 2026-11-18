/** xg business vocabulary shared by the store, services, tools, API, and panel. */
export const PROJECT_STATUSES = ['活跃', '暂停', '归档'] as const
export const SENSITIVITIES = ['公开', '内部', '机密'] as const
export const INBOX_CHANNELS = ['企微', '邮箱', '电话', '同事', '其他'] as const
export const INBOX_STATUSES = ['未处理', '已建需求', '已忽略'] as const
export const REQUIREMENT_STATUSES = ['待确认', '已确认', '已拆分', '已关闭'] as const
export const TASK_TYPES = ['设计', '开发', '排障', '评审'] as const
export const TASK_STATUSES = ['就绪', '进行中', '评审', '待验收', '完成', '阻塞', '取消'] as const
export const PRIORITIES = ['P0', 'P1', 'P2', 'P3'] as const
export const ATTEMPT_STATUSES = ['运行中', '就绪', '阻塞', '失败', '结束', '取消'] as const
export const MEMORY_TYPES = ['领域', '决策', '经验', '故障', '交接'] as const
export const MEMORY_STATUSES = ['草稿', '待复核', '已确认', '已废弃'] as const
export const MEMORY_SOURCE_TYPES = ['任务', '会话', '人工'] as const
export const MEMORY_REF_TYPES = ['代码', '文档', '规格'] as const
export const REVIEW_DECISIONS = ['通过', '退回'] as const
export const ARTIFACT_TYPES = ['证据', '代码', '文档', '复盘', '其他'] as const
export const TRIAGE_STAGES = ['取证', '假设', '根因'] as const
export const SPEC_STATUSES = ['草稿', '已批准', '已废弃'] as const

export type ProjectStatus = typeof PROJECT_STATUSES[number]
export type Sensitivity = typeof SENSITIVITIES[number]
export type InboxChannel = typeof INBOX_CHANNELS[number]
export type InboxStatus = typeof INBOX_STATUSES[number]
export type RequirementStatus = typeof REQUIREMENT_STATUSES[number]
export type TaskType = typeof TASK_TYPES[number]
export type TaskStatus = typeof TASK_STATUSES[number]
export type Priority = typeof PRIORITIES[number]
export type AttemptStatus = typeof ATTEMPT_STATUSES[number]
export type MemoryType = typeof MEMORY_TYPES[number]
export type MemoryStatus = typeof MEMORY_STATUSES[number]
export type MemorySourceType = typeof MEMORY_SOURCE_TYPES[number]
export type MemoryRefType = typeof MEMORY_REF_TYPES[number]
export type ReviewDecision = typeof REVIEW_DECISIONS[number]
export type ArtifactType = typeof ARTIFACT_TYPES[number]
export type TriageStage = typeof TRIAGE_STAGES[number]
export type SpecStatus = typeof SPEC_STATUSES[number]

export interface Project {
  id: string
  shortCode: string
  name: string
  rootPath: string | null
  sensitivity: Sensitivity
  status: ProjectStatus
  createdAt: string
  updatedAt: string
}

export interface InboxItem {
  id: string
  projectId: string | null
  channel: InboxChannel
  contact: string | null
  rawContext: string | null
  externalRef: string | null
  status: InboxStatus
  receivedAt: string
  triagedAt: string | null
}

/** Project-level overrides; system settings remain the upstream instance settings. */
export interface ProjectSettings {
  projectId: string
  workerProvider: string | null
  workerModel: string | null
  workerEffort: string | null
  autoDispatch: boolean
  defaultPriority: Priority | null
  updatedAt: string | null
}

export interface Requirement {
  id: string
  projectId: string
  seqNo: number
  sourceId: string | null
  sourceNote: string | null
  title: string
  description: string | null
  status: RequirementStatus
  priority: Priority | null
  createdAt: string
  updatedAt: string
}

export interface Task {
  id: string
  projectId: string
  requirementId: string
  seqNo: number
  title: string
  description: string | null
  type: TaskType
  status: TaskStatus
  priority: Priority
  acceptance: string | null
  currentAttemptId: string | null
  autoDispatch: boolean
  /** Status to restore when a blocked task is unblocked. */
  blockedFromStatus: TaskStatus | null
  acceptedBy: string | null
  acceptedAt: string | null
  completedAt: string | null
  /** Set when the task is soft-deleted: it leaves lists and counts, while attempts, evidence and audit stay. */
  deletedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface Attempt {
  id: string
  taskId: string
  ticketId: string | null
  assignmentId: string | null
  workerSessionId: string | null
  stage: string | null
  status: AttemptStatus
  lastReportAt: string | null
  attention: string | null
  tokenCost: number | null
  runtimeVersion: string | null
  createdAt: string
  endedAt: string | null
}

export interface Artifact {
  id: string
  taskId: string
  attemptId: string | null
  type: ArtifactType
  title: string | null
  content: string | null
  uri: string | null
  createdAt: string
}

export interface Review {
  id: string
  taskId: string
  reviewAttemptId: string
  implementationAttemptId: string
  reviewer: string | null
  decision: ReviewDecision
  comments: string | null
  createdAt: string
}

export interface MemoryEntry {
  id: string
  projectId: string
  type: MemoryType
  title: string
  content: string
  status: MemoryStatus
  sourceType: MemorySourceType
  sourceRef: string | null
  tags: string[]
  lastVerifiedAt: string | null
  confirmedBy: string | null
  confirmedAt: string | null
  supersededBy: string | null
  createdAt: string
  updatedAt: string
}

export interface MemoryRef {
  id: number
  memoryId: string
  refType: MemoryRefType
  refPath: string
  refHash: string | null
  lastCheckedAt: string | null
}

export interface TriageStep {
  id: number
  taskId: string
  attemptId: string | null
  stage: TriageStage
  content: string
  artifactId: string | null
  createdAt: string
}

export interface TaskEvent {
  id: number
  taskId: string
  eventType: string
  actor: string | null
  payload: unknown
  createdAt: string
}

export interface AuditEntry {
  id: number
  projectId: string | null
  actor: string | null
  action: string
  entityType: string
  entityId: string
  beforeState: unknown
  afterState: unknown
  createdAt: string
}

export interface Spec {
  id: string
  projectId: string
  taskId: string | null
  content: string
  status: SpecStatus
  approvedBy: string | null
  approvedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface Page<T> {
  items: T[]
  total: number
}
