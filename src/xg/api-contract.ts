/** Type-only contract between the xg business pages and the `/xg/api` routes. */
import type {
  Artifact, Attempt, AuditEntry, InboxItem, InboxStatus, MemoryEntry, MemoryStatus, Proposal, ProposalStatus, Project, ProjectSettings,
  Requirement, Review, Spec, Task, TaskEvent, TaskStatus, TaskType, TriageStep,
} from './domain.ts'

export interface XgTaskDetail {
  task: Task
  project: Project
  requirement: Requirement
  attempts: Attempt[]
  artifacts: Artifact[]
  triage: TriageStep[]
  reviews: Review[]
  events: TaskEvent[]
  spec: Spec | null
}

export interface XgOverview {
  projects: number
  tasks: Record<TaskStatus, number>
  active: Task[]
  inbox: number
  memoryPending: number
  reviews: number
}

/** One snapshot for the workbench panel: every list the three columns need, in one round trip. */
export interface XgWorkbench {
  overview: XgOverview
  projects: Project[]
  requirements: Requirement[]
  tasks: Task[]
  inbox: InboxItem[]
  memory: MemoryEntry[]
  proposals: Proposal[]
  reviews: (Review & { taskTitle: string })[]
  audit: AuditEntry[]
}

export interface XgTaskInput {
  projectId: string
  requirementId: string
  title: string
  type: TaskType
  priority: Task['priority']
  description?: string
  acceptance?: string
  autoDispatch?: boolean
}

export interface XgTaskSplitInput {
  title: string
  type: TaskType
  priority: Task['priority']
  description?: string
  acceptance?: string
}

export interface XgApi {
  'GET /overview': { response: XgOverview }
  'GET /workbench': { response: XgWorkbench }
  'GET /projects': { response: { items: Project[]; total: number } }
  'POST /projects': { body: { shortCode: string; name: string; rootPath?: string; sensitivity?: Project['sensitivity'] }; response: Project }
  'GET /projects/:id/settings': { response: { project: Project; settings: ProjectSettings } }
  'POST /projects/:id/settings': { body: { rootPath?: string | null; sensitivity?: Project['sensitivity'];
    workerModel?: { provider: string; model: string; reasoningEffort?: string } | null; autoDispatch?: boolean;
    defaultPriority?: ProjectSettings['defaultPriority'] }; response: { project: Project; settings: ProjectSettings } }
  'GET /requirements': { query?: { projectId?: string; status?: Requirement['status'] }; response: { items: Requirement[]; total: number } }
  'POST /requirements': { body: { projectId: string; title: string; description?: string; sourceNote?: string; priority?: Requirement['priority'] }; response: Requirement }
  'POST /requirements/:id/confirm': { response: Requirement }
  'POST /requirements/:id/split': { body: { tasks: XgTaskSplitInput[] }; response: { requirement: Requirement; tasks: Task[] } }
  'POST /requirements/:id/delete': { response: Requirement }
  'GET /inbox': { query?: { projectId?: string; status?: InboxStatus }; response: { items: InboxItem[]; total: number } }
  'POST /inbox': { body: { channel: InboxItem['channel']; contact?: string; rawContext?: string; projectId?: string; externalRef?: string }; response: InboxItem }
  'POST /inbox/:id/triage': { body: { projectId: string; title: string; description?: string; priority?: Requirement['priority'] }; response: { item: InboxItem; requirement: Requirement } }
  'POST /inbox/:id/ignore': { response: InboxItem }
  'POST /inbox/:id/delete': { response: InboxItem }
  'GET /proposals': { query?: { projectId?: string; status?: ProposalStatus; targetType?: string; targetId?: string };
    response: { items: Proposal[]; total: number } }
  'POST /proposals': { body: { kind: 'requirement.split'; targetType: 'requirement'; targetId: string; title: string; summary?: string;
    payload: { tasks: XgTaskSplitInput[] }; createdBy?: string }; response: Proposal }
  'POST /proposals/:id/apply': { body: { by?: string }; response: { proposal: Proposal; requirement: Requirement; tasks: Task[] } }
  'POST /proposals/:id/reject': { body: { by?: string; reason?: string }; response: Proposal }
  'GET /tasks': { query?: { projectId?: string; status?: TaskStatus; type?: TaskType }; response: { items: Task[]; total: number } }
  'GET /tasks/:id': { response: XgTaskDetail }
  'POST /tasks': { body: XgTaskInput; response: Task }
  'POST /tasks/:id/dispatch': { response: { task: Task; attempt: Attempt } }
  'POST /tasks/:id/retry': { response: { task: Task; attempt: Attempt } }
  'POST /tasks/:id/cancel': { response: Task }
  'POST /tasks/:id/delete': { response: Task }
  'POST /tasks/:id/accept': { body: { acceptedBy?: string }; response: Task }
  'POST /tasks/:id/review': { body: { decision: Review['decision']; comments?: string; reviewer?: string; reviewerSession?: string };
    response: { task: Task; review: Review } }
  'POST /tasks/:id/spec': { body: { content: string; approve?: boolean; approvedBy?: string }; response: Spec }
  'GET /memory': { query?: { projectId?: string; q?: string; status?: MemoryStatus; type?: MemoryEntry['type'] }; response: { items: MemoryEntry[]; total: number } }
  'POST /memory': { body: { projectId: string; type: MemoryEntry['type']; title: string; content: string; sourceType: MemoryEntry['sourceType'];
    sourceRef?: string; tags?: string[]; artifactIds?: string[] }; response: MemoryEntry }
  'POST /memory/:id/confirm': { body: { by?: string }; response: MemoryEntry }
  'POST /memory/:id/reject': { body: { by?: string; reason?: string }; response: MemoryEntry }
  'POST /memory/verify': { body: { projectId: string }; response: { checked: number; changed: number; missing: number } }
  'GET /reviews': { query?: { projectId?: string }; response: { items: (Review & { taskTitle: string })[]; total: number } }
  'GET /audit': { query?: { projectId?: string }; response: { items: AuditEntry[]; total: number } }
}

/** Keys of the xg API, used by the client and the route table. */
export type XgRoute = keyof XgApi
export type XgResponse<K extends XgRoute> = XgApi[K]['response']
