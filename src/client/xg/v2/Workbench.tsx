/** Workbench v2: a three-column, real-data workbench inside the DSH main panel. */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { XgTaskDetail, XgWorkbench } from '../../../xg/api-contract.ts'
import type { InboxItem, MemoryEntry, Priority, Proposal, Project, Requirement, Task, TaskStatus, TaskType } from '../../../xg/domain.ts'
import { usePoll } from '../../api.ts'
import type { DeploymentForm } from '../../deployment.tsx'
import { usePanel, usePanelData } from '../../provider.tsx'
import { xgGet, xgPost } from '../client.ts'
import { readViewState, subscribeViewState, updateViewState, type WorkbenchSelection, type WorkbenchView } from './navigation.ts'
import { SettingsPanel } from './SettingsPanel.tsx'
import STYLES from './workbench.css?raw'

type AttentionKind = 'blocked' | 'accept' | 'requirement' | 'proposal' | 'inbox' | 'memory' | 'dispatch'

interface Attention {
  key: string
  kind: AttentionKind
  title: string
  meta: string
  at: string
  priority: Priority | null
  project?: Project
  requirement?: Requirement
  task?: Task
  proposal?: Proposal
  inboxItem?: InboxItem
  memory?: MemoryEntry
}
interface SplitRow { title: string; type: TaskType; priority: Priority; description: string; acceptance: string }
interface SplitDraft { requirement: Requirement; rows: SplitRow[] }
interface TriageDraft { itemId: string; projectId: string; title: string; priority: Priority; description: string }
interface RequirementDraft { projectId: string; title: string; description: string; sourceNote: string; priority: Priority }

const asError = (failure: unknown): Error => failure instanceof Error ? failure : new Error(String(failure))
const firstLine = (value: string | null | undefined): string => (value ?? '').split('\n').find(line => line.trim())?.trim().slice(0, 80) ?? ''
const timeAgo = (value: string | null | undefined): string => {
  if (!value) return '—'
  const then = new Date(value).getTime()
  if (Number.isNaN(then)) return value
  const minutes = Math.floor((Date.now() - then) / 60000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  return `${Math.floor(hours / 24)} 天前`
}
const clock = (value: string | null | undefined): string => {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}
const taskTone = (status: TaskStatus): string => status === '阻塞' ? 'block' : status === '待验收' ? 'signal'
  : status === '完成' ? 'ok' : status === '就绪' || status === '取消' ? 'idle' : 'run'
const requirementTone = (status: Requirement['status']): string => status === '待确认' ? 'signal'
  : status === '已拆分' ? 'ok' : status === '已关闭' ? 'idle' : 'run'
const taskStatusLabel = (status: TaskStatus): string => status === '就绪' ? '待派发' : status === '评审' ? '评审中'
  : status === '完成' ? '已完成' : status === '取消' ? '已取消' : status
const taskStatusNote = (status: TaskStatus): string => status === '就绪' ? '等待派发，派发后 Agent 开始执行'
  : status === '进行中' ? 'Agent 正在执行' : status === '评审' ? 'Agent 已提交评审，等待结果'
  : status === '待验收' ? 'Agent 已交付，等你验收' : status === '阻塞' ? '需要你回答，Agent 才能继续'
  : status === '完成' ? '已验收完成' : '已取消'
const requirementStatusLabel = (status: Requirement['status']): string => status
const requirementStatusNote = (status: Requirement['status']): string => status === '待确认' ? '等你确认'
  : status === '已确认' ? '已确认，等待拆解' : status === '已拆分' ? '已拆解为任务' : '已关闭'
const needsHuman = (status: TaskStatus | Requirement['status']): string | undefined =>
  status === '待验收' || status === '阻塞' || status === '就绪' || status === '待确认' ? '需要你' : undefined
const eventLabel = (type: string): string => {
  if (type.startsWith('排障-')) return `排障：${type.slice(3)}`
  const labels: Record<string, string> = {
    创建: '任务创建', 派发: '开始执行', 绑定工单: '开始执行', 删除: '删除任务',
    产物: '提交证据', 报告: 'Agent 汇报', 汇报: 'Agent 汇报', 评审: '提交评审', 验收: '验收通过',
    规格: '更新规格', 状态变化: '状态更新', 记忆: '更新记忆',
  }
  return labels[type] ?? type
}
const priorityRank = (priority: Priority | null): number => priority === 'P0' ? 0 : priority === 'P1' ? 1 : priority === 'P2' ? 2 : 3
const attentionRank: Record<AttentionKind, number> = { blocked: 0, accept: 1, requirement: 2, proposal: 3, inbox: 4, memory: 5, dispatch: 6 }

type WorkLens = 'all' | 'you' | 'agent' | 'done'
type WorkHolder = 'you' | 'agent' | 'block' | 'done' | 'none'
type WorkAction = 'confirm' | 'split' | 'dispatch' | 'review' | 'accept' | 'handle' | 'view' | 'none'
interface WorkSignal { holder: WorkHolder; tone: string; next: string; action: WorkAction }
interface WorkSummary { total: number; you: number; agent: number; done: number }

const taskTypeSeal = (type: TaskType): string => type === '设计' ? '设' : type === '排障' ? '排' : type === '评审' ? '评' : '开'
const holderLabel = (holder: WorkHolder): string => holder === 'you' ? '你持有' : holder === 'agent' ? 'Agent 持有'
  : holder === 'block' ? '等你处理' : holder === 'done' ? '已收口' : '无持棒人'
const holderTone = (holder: WorkHolder): string => holder === 'you' ? 'you' : holder === 'agent' ? 'agent'
  : holder === 'block' ? 'block' : holder === 'done' ? 'done' : 'idle'
const holderText = (signal: WorkSignal): string => holderLabel(signal.holder) === signal.next
  ? holderLabel(signal.holder) : `${holderLabel(signal.holder)} · ${signal.next}`
const readableReport = (text: string): string => text
  .replace(/\bART_[A-Za-z0-9]+\b/g, '证据')
  .replace(/\bMEM_[A-Za-z0-9]+\b/g, '记忆草稿')
  .replace(/\bPROP_[A-Za-z0-9]+\b/g, '提案')
  .replace(/\bINB_[A-Za-z0-9]+\b/g, '收件')
  .replace(/\b[A-Z_]+-\d+-A\d+\b/g, '本次尝试')
  .replace(/（证据(?:、证据)+）/g, '（相关证据）')
  .replace(/记忆草稿\s*记忆草稿/g, '记忆草稿')
  .replace(/证据\s*证据/g, '证据')
const taskSignal = (task: Task): WorkSignal => {
  if (task.status === '就绪') return { holder: 'you', tone: 'you', next: '等你派发', action: 'dispatch' }
  if (task.status === '进行中') return { holder: 'agent', tone: 'agent', next: 'Agent 执行中', action: 'view' }
  if (task.status === '评审') return { holder: 'you', tone: 'you', next: '等你评审', action: 'review' }
  if (task.status === '待验收') return { holder: 'you', tone: 'you', next: '等你验收', action: 'accept' }
  if (task.status === '阻塞') return { holder: 'block', tone: 'block', next: '等你回答', action: 'handle' }
  if (task.status === '完成') return { holder: 'done', tone: 'done', next: '已收口', action: 'view' }
  return { holder: 'none', tone: 'idle', next: '已取消', action: 'none' }
}
const requirementSignal = (requirement: Requirement, related: Task[]): WorkSignal => {
  if (requirement.status === '待确认') return { holder: 'you', tone: 'you', next: '等你确认', action: 'confirm' }
  if (requirement.status === '已确认') return { holder: 'you', tone: 'you', next: '等你拆解', action: 'split' }
  if (requirement.status === '已关闭') return { holder: 'none', tone: 'idle', next: '已关闭', action: 'view' }
  const live = related.filter(task => task.status !== '取消')
  if (live.some(task => task.status === '阻塞')) return { holder: 'block', tone: 'block', next: '有任务等你回答', action: 'view' }
  if (live.some(task => task.status === '进行中')) return { holder: 'agent', tone: 'agent', next: 'Agent 正在执行', action: 'view' }
  if (live.some(task => task.status === '就绪' || task.status === '评审' || task.status === '待验收')) {
    return { holder: 'you', tone: 'you', next: '有任务等你', action: 'view' }
  }
  if (live.length && live.every(task => task.status === '完成')) return { holder: 'done', tone: 'done', next: '已收口', action: 'view' }
  return { holder: 'none', tone: 'idle', next: '已拆分', action: 'view' }
}
const workSummary = (requirements: Requirement[], tasks: Task[]): WorkSummary => {
  const byRequirement = new Map<string, Task[]>()
  for (const task of tasks) {
    const list = byRequirement.get(task.requirementId) ?? []
    list.push(task)
    byRequirement.set(task.requirementId, list)
  }
  const signals: WorkSignal[] = []
  for (const requirement of requirements) {
    if (requirement.status === '已拆分' || requirement.status === '已关闭') continue
    signals.push(requirementSignal(requirement, byRequirement.get(requirement.id) ?? []))
  }
  for (const task of tasks) if (task.status !== '取消') signals.push(taskSignal(task))
  return {
    total: signals.length,
    you: signals.filter(signal => signal.holder === 'you').length,
    agent: signals.filter(signal => signal.holder === 'agent').length,
    done: signals.filter(signal => signal.holder === 'done').length,
  }
}
const relaySteps = (kind: 'requirement' | 'task', status: Requirement['status'] | TaskStatus): { label: string; actor: string }[] =>
  kind === 'requirement'
    ? [{ label: '待确认', actor: '你' }, { label: '已确认', actor: '你' }, { label: '已拆分', actor: '你 + Agent' }]
    : [{ label: '待派发', actor: '你' }, { label: '进行中', actor: 'Agent' }, { label: '评审中', actor: '你' },
      { label: '待验收', actor: '你' }, { label: '已完成', actor: '你' }]
const relayCurrent = (kind: 'requirement' | 'task', status: Requirement['status'] | TaskStatus): number => {
  if (kind === 'requirement') return status === '待确认' ? 0 : status === '已确认' ? 1 : status === '已关闭' ? 3 : 2
  return status === '就绪' ? 0 : status === '进行中' || status === '阻塞' ? 1 : status === '评审' ? 2
    : status === '待验收' ? 3 : status === '完成' ? 4 : -1
}
const proposalTaskRows = (proposal: Proposal): { title?: string; type?: string; priority?: string; description?: string; acceptance?: string }[] => {
  const payload = proposal.payload as { tasks?: unknown } | null | undefined
  return Array.isArray(payload?.tasks) ? payload.tasks as { title?: string; type?: string; priority?: string }[] : []
}

function buildAttention(data: XgWorkbench | undefined): Attention[] {
  if (!data) return []
  const projects = new Map(data.projects.map(project => [project.id, project]))
  const items: Attention[] = []
  for (const requirement of data.requirements) {
    if (requirement.status !== '待确认') continue
    items.push({ key: `requirement:${requirement.id}`, kind: 'requirement', title: requirement.title,
      meta: `来源 ${requirement.sourceNote || '人工录入'} · 等你确认`, at: requirement.updatedAt,
      priority: requirement.priority, project: projects.get(requirement.projectId), requirement })
  }
  for (const task of data.tasks) {
    const project = projects.get(task.projectId)
    if (task.status === '阻塞') {
      items.push({ key: `blocked:${task.id}`, kind: 'blocked', title: task.title, meta: '需要你回答，Agent 才能继续',
        at: task.updatedAt, priority: task.priority, project, task })
    } else if (task.status === '待验收') {
      items.push({ key: `accept:${task.id}`, kind: 'accept', title: task.title, meta: 'Agent 已交付，等你验收',
        at: task.updatedAt, priority: task.priority, project, task })
    } else if (task.status === '就绪') {
      items.push({ key: `dispatch:${task.id}`, kind: 'dispatch', title: task.title, meta: '待派发，等待你',
        at: task.updatedAt, priority: task.priority, project, task })
    }
  }
  for (const proposal of data.proposals ?? []) {
    if (proposal.status !== '待确认') continue
    const target = proposal.targetType === 'requirement' ? data.requirements.find(item => item.id === proposal.targetId) : undefined
    items.push({ key: `proposal:${proposal.id}`, kind: 'proposal', title: proposal.title,
      meta: proposal.summary || 'Agent 想改工作台，等你确认', at: proposal.createdAt,
      priority: target?.priority ?? null, project: projects.get(proposal.projectId), requirement: target, proposal })
  }
  for (const item of data.inbox) {
    if (item.status !== '未处理') continue
    items.push({ key: `inbox:${item.id}`, kind: 'inbox', title: firstLine(item.rawContext) || item.contact || '新收件',
      meta: `${item.channel}${item.contact ? ` · ${item.contact}` : ''}`, at: item.receivedAt, priority: null,
      project: item.projectId ? projects.get(item.projectId) : undefined, inboxItem: item })
  }
  for (const memory of data.memory) {
    if (memory.status !== '待复核') continue
    items.push({ key: `memory:${memory.id}`, kind: 'memory', title: memory.title,
      meta: `${memory.type} · ${memory.sourceType}`, at: memory.updatedAt, priority: null,
      project: projects.get(memory.projectId), memory })
  }
  return items.sort((left, right) => attentionRank[left.kind] - attentionRank[right.kind]
    || priorityRank(left.priority) - priorityRank(right.priority)
    || new Date(right.at).getTime() - new Date(left.at).getTime())
}

function useTaskDetail(id: string | undefined, version: number) {
  const [state, setState] = useState<{ id?: string; data?: XgTaskDetail; error?: Error }>({})
  useEffect(() => {
    if (!id) { setState({}); return }
    let live = true
    setState({ id })
    xgGet('/tasks/:id', { params: { id } }).then(data => { if (live) setState({ id, data }) },
      failure => { if (live) setState({ id, error: asError(failure) }) })
    return () => { live = false }
  }, [id, version])
  return state
}

const displayProject = (project: Project): string => project.shortCode.startsWith('NEW') ? 'NCA' : project.shortCode
function ProjectTag({ project }: { project?: Project }) {
  if (!project) return null
  const nca = project.shortCode.startsWith('NCA') || project.shortCode.startsWith('NEW')
  return <span className={`wb-ptag ${nca ? 'nca' : ''}`}>{displayProject(project)}</span>
}
function Dot({ tone }: { tone: string }) {
  return <span className={`wb-dot ${tone}`} />
}
function Btn({ variant = 'outline', size, busy, disabled, children, onClick, title }: {
  variant?: 'primary' | 'signal' | 'outline' | 'ghost'; size?: 'sm'; busy?: boolean; disabled?: boolean; children: ReactNode
  onClick?: () => void; title?: string
}) {
  return <button type="button" className={`wb-btn wb-btn-${variant}${size === 'sm' ? ' wb-btn-sm' : ''}`} disabled={busy || disabled}
    onClick={onClick} title={title}>{children}</button>
}

export function Workbench({ view, deploymentForm, onNavigate }: {
  view: WorkbenchView; deploymentForm: DeploymentForm; onNavigate: (view: WorkbenchView) => void
}) {
  const { openSession } = usePanel()
  const { state: panel } = usePanelData()
  const { data, error, reload } = usePoll(() => xgGet('/workbench'), [], 5000)
  const stored = useSyncExternalStore(subscribeViewState, () => readViewState(view), () => readViewState(view))
  const [workLens, setWorkLens] = useState<WorkLens>('all')
  const [workProject, setWorkProject] = useState('all')
  const [workSearch, setWorkSearch] = useState('')
  const [openDone, setOpenDone] = useState<Set<string>>(new Set())
  const [inboxProject, setInboxProject] = useState('all')
  const [memoryProject, setMemoryProject] = useState('all')
  const [triage, setTriage] = useState<TriageDraft | null>(null)
  const [split, setSplit] = useState<SplitDraft | null>(null)
  const [newRequirement, setNewRequirement] = useState<RequirementDraft | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  const [openArtifact, setOpenArtifact] = useState<string | null>(null)
  const [reportOpen, setReportOpen] = useState(false)
  const [reviewComment, setReviewComment] = useState('')
  const center = useRef<HTMLElement | null>(null)
  const reviewBox = useRef<HTMLElement | null>(null)
  const triageFor = useRef<string | null>(null)

  const projects = data?.projects ?? []
  const tasks = data?.tasks ?? []
  const requirements = data?.requirements ?? []
  const inbox = data?.inbox ?? []
  const memory = data?.memory ?? []
  const proposals = data?.proposals ?? []
  const audit = data?.audit ?? []
  const projectsById = useMemo(() => new Map(projects.map(project => [project.id, project])), [projects])
  const attention = useMemo(() => buildAttention(data), [data])
  const running = useMemo(() => tasks.filter(task => task.status === '进行中' || task.status === '评审')
    .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()), [tasks])
  const completed = useMemo(() => tasks.filter(task => task.status === '完成')
    .sort((left, right) => new Date(right.completedAt ?? right.updatedAt).getTime() - new Date(left.completedAt ?? left.updatedAt).getTime())
    .slice(0, 5), [tasks])
  const workSelection: WorkbenchSelection | null = view === 'work' ? stored.selection ?? null : null
  const openInboxId = view === 'inbox' ? stored.inboxId ?? null : null
  const selectedRequirement = workSelection?.kind === 'requirement' ? requirements.find(item => item.id === workSelection.id) : undefined
  const selectedTask = workSelection?.kind === 'task' ? tasks.find(item => item.id === workSelection.id) : undefined
  const detail = useTaskDetail(workSelection?.kind === 'task' ? workSelection.id : undefined, version)

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 2800)
    return () => clearTimeout(timer)
  }, [toast])

  useEffect(() => { setOpenArtifact(null); setReportOpen(false); setReviewComment('') }, [workSelection?.id])

  // Open the inbox form once per selected item; later edits must not be overwritten by polling.
  useEffect(() => {
    if (view !== 'inbox' || !openInboxId || triageFor.current === openInboxId) return
    const item = inbox.find(entry => entry.id === openInboxId)
    if (!item) return
    triageFor.current = openInboxId
    setTriage(item.status === '未处理' ? {
      itemId: item.id,
      projectId: item.projectId ?? projects[0]?.id ?? '',
      title: firstLine(item.rawContext) || item.contact || '新需求',
      priority: 'P2',
      description: item.rawContext ?? '',
    } : null)
  }, [view, openInboxId, inbox, projects])

  const scrollTop = () => requestAnimationFrame(() => center.current?.scrollTo({ top: 0, behavior: 'auto' }))
  const openDoc = (kind: WorkbenchSelection['kind'], id: string) => {
    updateViewState('work', { selection: { kind, id } })
    if (view !== 'work') onNavigate('work')
    scrollTop()
  }
  const backToList = () => { updateViewState('work', { selection: null }); scrollTop() }

  const action = async (key: string, run: () => Promise<unknown>, message: string) => {
    setBusy(key)
    try {
      await run()
      await reload()
      setVersion(value => value + 1)
      setToast(message)
    } catch (failure) {
      setToast(asError(failure).message)
    } finally {
      setBusy(null)
    }
  }

  const confirmRequirement = (requirement: Requirement) => action(`confirm:${requirement.id}`,
    () => xgPost('/requirements/:id/confirm', undefined, { params: { id: requirement.id } }), '需求已确认')
  const acceptTask = (task: Task) => action(`accept:${task.id}`,
    () => xgPost('/tasks/:id/accept', { acceptedBy: '你' }, { params: { id: task.id } }), '任务已验收')
  const dispatchTask = (task: Task) => action(`dispatch:${task.id}`,
    () => xgPost('/tasks/:id/dispatch', undefined, { params: { id: task.id } }), '已派发')
  const cancelTask = (task: Task) => {
    if (typeof window !== 'undefined' && !window.confirm(`停止 ${task.id}？执行器会在当前步骤后停下。`)) return
    void action(`cancel:${task.id}`, () => xgPost('/tasks/:id/cancel', undefined, { params: { id: task.id } }), '已请求停止')
  }
  const retryTask = (task: Task) => action(`retry:${task.id}`,
    () => xgPost('/tasks/:id/retry', undefined, { params: { id: task.id } }), '已重试')
  const submitReview = (task: Task, decision: '通过' | '退回') => action(`review:${task.id}`, async () => {
    await xgPost('/tasks/:id/review', { decision, reviewer: '你',
      ...(reviewComment.trim() ? { comments: reviewComment.trim() } : {}) }, { params: { id: task.id } })
    setReviewComment('')
  }, decision === '通过' ? '评审通过，等你验收' : '已退回，Agent 继续处理')
  const confirmMemory = (entry: MemoryEntry) => action(`memory:${entry.id}`,
    () => xgPost('/memory/:id/confirm', { by: '你' }, { params: { id: entry.id } }), '记忆已确认')
  const rejectMemory = (entry: MemoryEntry) => action(`memory:${entry.id}`,
    () => xgPost('/memory/:id/reject', { by: '你' }, { params: { id: entry.id } }), '记忆已退回')
  const ignoreInbox = (item: InboxItem) => action(`inbox:${item.id}`,
    () => xgPost('/inbox/:id/ignore', undefined, { params: { id: item.id } }), '已忽略')
  const applyProposal = (proposal: Proposal) => action(`proposal:${proposal.id}`,
    () => xgPost('/proposals/:id/apply', { by: '你' }, { params: { id: proposal.id } }), '提案已应用')
  const rejectProposal = (proposal: Proposal) => {
    if (typeof window === 'undefined') return
    const reason = window.prompt(`拒绝「${proposal.title}」的原因（可留空）`)
    if (reason === null) return
    void action(`proposal:${proposal.id}`,
      () => xgPost('/proposals/:id/reject', { by: '你', reason }, { params: { id: proposal.id } }), '提案已拒绝')
  }
  const removeRequirement = (requirement: Requirement) => {
    if (typeof window !== 'undefined' && !window.confirm(`删除需求「${requirement.title}」？\n它不会再出现在工作列表，历史记录保留。`)) return
    void action(`delete:${requirement.id}`, async () => {
      await xgPost('/requirements/:id/delete', undefined, { params: { id: requirement.id } })
      updateViewState('work', { selection: null })
    }, '需求已删除')
  }
  const removeTask = (task: Task) => {
    if (typeof window !== 'undefined' && !window.confirm(`删除任务「${task.title}」？\n执行历史和证据会保留，但任务不再出现在列表。`)) return
    void action(`delete:${task.id}`, async () => {
      await xgPost('/tasks/:id/delete', undefined, { params: { id: task.id } })
      updateViewState('work', { selection: null })
    }, '任务已删除')
  }
  const removeInbox = (item: InboxItem) => {
    if (typeof window !== 'undefined' && !window.confirm('删除这条收件？它不会再出现在收件列表，原始内容保留在审计里。')) return
    void action(`delete:${item.id}`, async () => {
      await xgPost('/inbox/:id/delete', undefined, { params: { id: item.id } })
      closeInboxItem()
    }, '收件已删除')
  }

  const openNewRequirement = () => setNewRequirement({
    projectId: workProject === 'all' ? projects[0]?.id ?? '' : workProject,
    title: '', description: '', sourceNote: '人工录入', priority: 'P2',
  })
  const submitNewRequirement = () => {
    if (!newRequirement) return
    if (!newRequirement.projectId) { setToast('先选一个项目'); return }
    if (!newRequirement.title.trim()) { setToast('先填需求标题'); return }
    void action('requirement:new', async () => {
      const created = await xgPost('/requirements', {
        projectId: newRequirement.projectId,
        title: newRequirement.title.trim(),
        priority: newRequirement.priority,
        sourceNote: newRequirement.sourceNote.trim() || '人工录入',
        ...(newRequirement.description.trim() ? { description: newRequirement.description.trim() } : {}),
      })
      setNewRequirement(null)
      updateViewState('work', { selection: { kind: 'requirement', id: created.id } })
    }, '需求已创建')
  }
  const openSplit = (requirement: Requirement) => setSplit({ requirement, rows: [{
    title: requirement.title, type: '开发', priority: requirement.priority ?? 'P2',
    description: requirement.description ?? '', acceptance: '',
  }] })
  const updateSplitRow = (index: number, patch: Partial<SplitRow>) => setSplit(current => current
    ? { ...current, rows: current.rows.map((row, at) => at === index ? { ...row, ...patch } : row) } : current)
  const addSplitRow = () => setSplit(current => current ? { ...current, rows: [...current.rows, {
    title: '', type: '开发', priority: current.requirement.priority ?? 'P2', description: '', acceptance: '',
  }] } : current)
  const removeSplitRow = (index: number) => setSplit(current => current
    ? { ...current, rows: current.rows.filter((_row, at) => at !== index) } : current)
  const submitSplit = () => {
    if (!split) return
    const rows = split.rows.filter(row => row.title.trim())
    if (!rows.length) { setToast('至少填一个任务标题'); return }
    void action('split', async () => {
      await xgPost('/requirements/:id/split', { tasks: rows.map(row => ({
        title: row.title.trim(), type: row.type, priority: row.priority,
        ...(row.description.trim() ? { description: row.description.trim() } : {}),
        ...(row.acceptance.trim() ? { acceptance: row.acceptance.trim() } : {}),
      })) }, { params: { id: split.requirement.id } })
      setSplit(null)
    }, split.requirement.status === '已拆分' ? '任务已添加' : '已拆成任务')
  }

  const openInboxItem = (item: InboxItem) => {
    updateViewState('inbox', { inboxId: item.id })
    if (view !== 'inbox') onNavigate('inbox')
    scrollTop()
  }
  const closeInboxItem = () => {
    updateViewState('inbox', { inboxId: null })
    triageFor.current = null
    setTriage(null)
  }
  const submitTriage = () => {
    if (!triage) return
    if (!triage.projectId) { setToast('先选一个项目'); return }
    if (!triage.title.trim()) { setToast('先填需求标题'); return }
    void action(`triage:${triage.itemId}`, async () => {
      await xgPost('/inbox/:id/triage', { projectId: triage.projectId, title: triage.title.trim(),
        priority: triage.priority, ...(triage.description.trim() ? { description: triage.description.trim() } : {}) },
        { params: { id: triage.itemId } })
      setTriage(null)
    }, '已转为需求')
  }

  const verifyMemory = () => {
    const targets = memoryProject === 'all' ? projects : projects.filter(project => project.id === memoryProject)
    if (!targets.length) { setToast('没有可检查的项目'); return }
    void action('verify', async () => {
      let checked = 0, changed = 0, missing = 0
      for (const project of targets) {
        const result = await xgPost('/memory/verify', { projectId: project.id })
        checked += result.checked; changed += result.changed; missing += result.missing
      }
      setToast(`引用检查完成：${checked} 条，变化 ${changed}，缺失 ${missing}`)
    }, '引用检查完成')
  }

  const openMaster = () => {
    if (!panel?.masterId) { setToast('主 Session 还没准备好'); return }
    void openSession(panel.masterId).catch(failure => setToast(asError(failure).message))
  }
  const askAbout = (_label: string) => { openMaster() }

  const proposalCard = (proposal: Proposal) => {
    const rows = proposalTaskRows(proposal)
    const target = requirements.find(item => item.id === proposal.targetId)
    const pending = proposal.status === '待确认'
    const resolution = proposal.status === '已应用'
      ? `已创建 ${rows.length} 个任务`
      : proposal.status === '已拒绝' ? proposal.resolution ? `拒绝原因：${proposal.resolution}` : '已拒绝'
      : proposal.status === '已过期' ? `已过期：${proposal.resolution ?? '目标已变化'}` : null
    return <div className={`wb-proposal ${pending ? '' : 'done'}`} key={proposal.id}>
      <div className="wb-proposalhead"><span className="wb-type">Agent 提案</span><span className="sep">/</span>
        <span>{timeAgo(proposal.createdAt)}</span><span className="spacer" />
        <span className={`wb-proposalstate ${proposal.status}`}>{proposal.status}</span></div>
      <div className="wb-proposaltitle">{proposal.title}</div>
      {proposal.summary ? <p className="wb-proposalsummary">{proposal.summary}</p> : null}
      {rows.length ? <div className="wb-diff">{rows.map((row, index) => <div className="wb-diffrow add" key={index}>
        <span className="wb-diffmark">+</span><span className="wb-difftitle">{row.title || '未命名任务'}</span>
        <small>{row.type ?? '开发'} · {row.priority ?? 'P2'}</small>
      </div>)}
        {pending ? <div className="wb-diffrow change"><span className="wb-diffmark">~</span><span className="wb-difftitle">需求状态</span>
          <small>{target?.status ?? '已确认'} → 已拆分</small></div> : null}
      </div> : null}
      {resolution ? <p className="wb-proposalresolution">{resolution}</p> : null}
      <div className="wb-proposalactions">
        {pending ? <>
          <Btn variant="primary" size="sm" busy={busy === `proposal:${proposal.id}`} onClick={() => applyProposal(proposal)}>应用</Btn>
          <Btn variant="outline" size="sm" busy={busy === `proposal:${proposal.id}`} onClick={() => rejectProposal(proposal)}>拒绝</Btn>
        </> : null}
        {target && target.id !== selectedRequirement?.id ? <Btn variant="ghost" size="sm" onClick={() => openDoc('requirement', target.id)}>查看需求</Btn> : null}
      </div>
    </div>
  }

  const attentionRow = (item: Attention) => <div className={`wb-attn ${item.kind === 'blocked' ? 'block' : 'needs'}`} key={item.key}>
    <div className="wb-attnrow">
      <div className="wb-attnmain">
        <div className="wb-type">
          {item.kind === 'requirement' ? <>需求</> : null}
          {item.kind === 'proposal' ? <>Agent 提案</> : null}
          {item.kind === 'accept' ? <>待验收</> : null}
          {item.kind === 'blocked' ? <>阻塞</> : null}
          {item.kind === 'dispatch' ? <>待派发</> : null}
          {item.kind === 'inbox' ? <>收件 · {item.inboxItem?.channel}</> : null}
          {item.kind === 'memory' ? <>记忆 · {item.memory?.type}</> : null}
          {item.project ? <><span className="sep">/</span><ProjectTag project={item.project}/></> : null}
          <span className="sep">/</span>{timeAgo(item.at)}
        </div>
        <div className="wb-title">{item.title}</div>
        <div className="wb-meta"><Dot tone={item.kind === 'blocked' ? 'block' : item.kind === 'accept' ? 'ok' : 'signal'} />{item.meta}</div>
        {item.kind === 'proposal' && item.proposal ? (() => {
          const rows = proposalTaskRows(item.proposal)
          return rows.length ? <div className="wb-diff wb-attndiff">{rows.map((row, index) => <div className="wb-diffrow add" key={index}>
            <span className="wb-diffmark">+</span><span className="wb-difftitle">{row.title || '未命名任务'}</span>
            <small>{row.type ?? '开发'} · {row.priority ?? 'P2'}</small>
          </div>)}</div> : null
        })() : null}
      </div>
      <div className="wb-actions">
        {item.kind === 'requirement' && item.requirement ? <>
          <Btn variant="signal" size="sm" busy={busy === `confirm:${item.requirement.id}`} onClick={() => confirmRequirement(item.requirement!)}>确认</Btn>
          <Btn variant="ghost" size="sm" onClick={() => openSplit(item.requirement!)}>拆解</Btn>
          <Btn variant="ghost" size="sm" onClick={() => openDoc('requirement', item.requirement!.id)}>查看</Btn>
        </> : null}
        {item.kind === 'proposal' && item.proposal ? <>
          <Btn variant="primary" size="sm" busy={busy === `proposal:${item.proposal.id}`} onClick={() => applyProposal(item.proposal!)}>应用</Btn>
          <Btn variant="outline" size="sm" busy={busy === `proposal:${item.proposal.id}`} onClick={() => rejectProposal(item.proposal!)}>拒绝</Btn>
          {item.requirement ? <Btn variant="ghost" size="sm" onClick={() => openDoc('requirement', item.requirement!.id)}>查看</Btn> : null}
        </> : null}
        {item.kind === 'accept' && item.task ? <>
          <Btn variant="primary" size="sm" busy={busy === `accept:${item.task.id}`} onClick={() => acceptTask(item.task!)}>验收</Btn>
          <Btn variant="ghost" size="sm" onClick={() => openDoc('task', item.task!.id)}>查看</Btn>
        </> : null}
        {item.kind === 'blocked' && item.task ? <>
          <Btn variant="ghost" size="sm" onClick={() => openDoc('task', item.task!.id)}>查看</Btn>
          <Btn variant="outline" size="sm" onClick={() => askAbout(item.task!.id)}>问 Agent</Btn>
        </> : null}
        {item.kind === 'dispatch' && item.task ? <>
          <Btn variant="primary" size="sm" busy={busy === `dispatch:${item.task.id}`} onClick={() => dispatchTask(item.task!)}>派发</Btn>
          <Btn variant="ghost" size="sm" onClick={() => openDoc('task', item.task!.id)}>查看</Btn>
        </> : null}
        {item.kind === 'inbox' && item.inboxItem ? <>
          <Btn variant="primary" size="sm" onClick={() => openInboxItem(item.inboxItem!)}>分诊</Btn>
          <Btn variant="ghost" size="sm" busy={busy === `inbox:${item.inboxItem.id}`} onClick={() => ignoreInbox(item.inboxItem!)}>忽略</Btn>
        </> : null}
        {item.kind === 'memory' && item.memory ? <>
          <Btn variant="primary" size="sm" busy={busy === `memory:${item.memory.id}`} onClick={() => confirmMemory(item.memory!)}>确认</Btn>
          <Btn variant="ghost" size="sm" onClick={() => onNavigate('knowledge')}>去看</Btn>
        </> : null}
      </div>
    </div>
  </div>

  const today = () => <>
    <section className="wb-todayhead">
      <div className="wb-kicker">{new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' })} · 全部项目</div>
      <h1>今天</h1>
      <p>{attention.length ? `${attention.length} 件需要你，${running.length} 件在跑。其余我会盯着。`
        : `没有需要你的事。${running.length} 件在跑，我会盯着。`}</p>
    </section>
    <section className="wb-section">
      <div className="wb-sectionhead"><h2>需你决定</h2><span className="hint">{attention.length ? `${attention.length} 件` : '已清空'}</span></div>
      {attention.length ? attention.map(attentionRow) : <div className="wb-clear"><Dot tone="ok" /><div><b>现在没有需要你的事。</b>
        <p>Agent 在跑 {running.length} 件工作。你可以去「工作」看看，或者直接在右边说下一件事。</p></div></div>}
    </section>
    <section className="wb-section">
      <div className="wb-sectionhead"><h2>Agent 进行中</h2><span className="hint">{running.length} 件</span></div>
      {running.length ? running.map(task => <button className="wb-run" key={task.id} onClick={() => openDoc('task', task.id)}>
        <Dot tone={taskTone(task.status)} /><ProjectTag project={projectsById.get(task.projectId)} />
        <span className="wb-runmain"><span className="wb-runtitle">{task.title}</span>
          <span className="wb-runmeta">{taskStatusLabel(task.status)} · 更新 {timeAgo(task.updatedAt)}</span></span>
        <span className="wb-arrow">→</span>
      </button>) : <p className="wb-empty">现在没有正在执行的工作。</p>}
    </section>
    <section className="wb-section">
      <div className="wb-sectionhead"><h2>刚完成</h2><span className="hint">最近 5 件</span></div>
      {completed.length ? completed.map(task => <button className="wb-run" key={task.id} onClick={() => openDoc('task', task.id)}>
        <Dot tone="ok" /><ProjectTag project={projectsById.get(task.projectId)} />
        <span className="wb-runmain"><span className="wb-runtitle">{task.title}</span>
          <span className="wb-runmeta">完成 · {timeAgo(task.completedAt ?? task.updatedAt)}</span></span>
        <span className="wb-arrow">→</span>
      </button>) : <p className="wb-empty">还没有完成的任务。</p>}
    </section>
  </>

  const toggleDone = (id: string) => setOpenDone(current => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })
  const runRequirementAction = (requirement: Requirement, action: WorkAction) => {
    if (action === 'confirm') confirmRequirement(requirement)
    else if (action === 'split') openSplit(requirement)
    else openDoc('requirement', requirement.id)
  }
  const runTaskAction = (task: Task, action: WorkAction) => {
    if (action === 'dispatch') dispatchTask(task)
    else if (action === 'accept') acceptTask(task)
    else openDoc('task', task.id)
  }
  const taskRow = (task: Task, showHolder = true) => {
    const signal = taskSignal(task)
    const actionLabel = signal.action === 'dispatch' ? '派发' : signal.action === 'review' ? '评审'
      : signal.action === 'accept' ? '验收' : signal.action === 'handle' ? '处理' : '查看'
    return <div className={`wb-taskrow ${signal.tone}`} key={task.id}>
      <span className={`wb-taskseal ${signal.tone}`}>{taskTypeSeal(task.type)}</span>
      <button className="wb-taskmain" onClick={() => openDoc('task', task.id)}>
        <span className="wb-tasktitle">{task.title}</span>
        <span className="wb-taskmeta">{task.id} · {task.priority} · {taskStatusLabel(task.status)} · 更新 {timeAgo(task.updatedAt)}</span>
      </button>
      <span className={`wb-statechip ${signal.tone}`}>{taskStatusLabel(task.status)}</span>
      {showHolder ? <span className={`wb-holder ${signal.tone}`}><i />{signal.next}</span> : null}
      <button className={`wb-rowaction ${signal.tone}`} disabled={busy === `${signal.action}:${task.id}`}
        onClick={() => runTaskAction(task, signal.action)}>{actionLabel} →</button>
    </div>
  }
  const workList = ({ compact = false }: { compact?: boolean }) => {
    const search = workSearch.trim().toLowerCase()
    const matches = (title: string, id: string) => !search || title.toLowerCase().includes(search) || id.toLowerCase().includes(search)
    const projectRequirements = requirements.filter(item => workProject === 'all' || item.projectId === workProject)
    const projectTasks = tasks.filter(item => item.status !== '取消' && (workProject === 'all' || item.projectId === workProject))
    const scopedRequirements = projectRequirements.filter(item => matches(item.title, item.id)
      || projectTasks.some(task => task.requirementId === item.id && matches(task.title, task.id)))
    const scopedTasks = projectTasks.filter(item => matches(item.title, item.id)
      || scopedRequirements.some(requirement => requirement.id === item.requirementId && matches(requirement.title, requirement.id)))
    const summary = workSummary(scopedRequirements, scopedTasks)
    const lenses: { id: WorkLens; label: string; count: number; tone?: string }[] = [
      { id: 'all', label: '全部', count: summary.total },
      { id: 'you', label: '需要你', count: summary.you, tone: 'you' },
      { id: 'agent', label: 'Agent 在办', count: summary.agent, tone: 'agent' },
      { id: 'done', label: '已收口', count: summary.done, tone: 'done' },
    ]
    const visibleGroups = projects.map(project => {
      const groupRequirements = scopedRequirements.filter(item => item.projectId === project.id)
      const groupTasks = scopedTasks.filter(item => item.projectId === project.id)
      const blocks = groupRequirements.flatMap(requirement => {
        const related = tasks.filter(task => task.requirementId === requirement.id && task.status !== '取消')
        const signal = requirementSignal(requirement, related)
        const reqMatches = workLens === 'all' || signal.holder === workLens
        const matchingTasks = related.filter(task => workLens === 'all' || taskSignal(task).holder === workLens)
        const visibleTasks = workLens === 'all' ? related : reqMatches || matchingTasks.length ? matchingTasks : []
        const pending = proposals.filter(proposal => proposal.status === '待确认' && proposal.targetType === 'requirement'
          && proposal.targetId === requirement.id)
        const showProposal = pending.length > 0 && workLens !== 'done' && workLens !== 'agent'
        const show = reqMatches || matchingTasks.length > 0
        return show ? [{ requirement, related, signal, visibleTasks, pending, showProposal }] : []
      })
      return { project, blocks, requirements: groupRequirements, tasks: groupTasks }
    }).filter(group => group.blocks.length)
    return <div className={`wb-worklist ${compact ? 'compact' : ''}`}>
      <div className="wb-workhead">
        <div className="wb-workeyebrow">WORK / 工作台账</div>
        <div className="wb-workheadrow">
          <div><h1>工作</h1><p>{requirements.length} 条需求 · {tasks.filter(task => task.status !== '取消').length} 个任务。先处理你手里的，其余 Agent 会推进。</p></div>
          <div className="wb-pulse">
            <div className="wb-pulseitem you"><b>{summary.you}</b><span>需要你</span></div>
            <div className="wb-pulseitem agent"><b>{summary.agent}</b><span>Agent 在办</span></div>
            <div className="wb-pulseitem done"><b>{summary.done}</b><span>已收口</span></div>
          </div>
        </div>
      </div>
      <div className="wb-worktools">
        <div className="wb-lenses">
          {lenses.map(lens => <button key={lens.id} className={`wb-lens ${workLens === lens.id ? 'active' : ''}`} onClick={() => setWorkLens(lens.id)}>
            {lens.tone ? <i className={`wb-lensdot ${lens.tone}`} /> : null}{lens.label}<span className="num">{lens.count}</span>
          </button>)}
        </div>
        <div className="wb-workfilters">
          <select className="wb-projectselect" value={workProject} onChange={event => setWorkProject(event.target.value)} aria-label="项目筛选">
            <option value="all">全部项目</option>
            {projects.map(project => <option key={project.id} value={project.id}>{displayProject(project)}</option>)}
          </select>
          <input className="wb-worksearch" value={workSearch} onChange={event => setWorkSearch(event.target.value)}
            placeholder="搜标题、编号" aria-label="搜索工作" />
          <Btn variant="primary" size="sm" onClick={openNewRequirement}>＋ 新需求</Btn>
        </div>
      </div>
      {visibleGroups.length ? visibleGroups.map(group => {
        const groupSummary = workSummary(group.requirements, group.tasks)
        return <section className="wb-projectgroup" key={group.project.id}>
          <div className="wb-projecthead">
            <span className="wb-projectcode">{displayProject(group.project)}</span>
            <b>{group.project.name}</b>
            <span className="wb-projectmeta">{group.requirements.length} 条需求 · {group.tasks.length} 件工作 · {groupSummary.you} 件需要你</span>
            <span className="wb-projectpulse" aria-hidden="true">
              {groupSummary.done ? <i className="done" style={{ flex: groupSummary.done }} /> : null}
              {groupSummary.agent ? <i className="agent" style={{ flex: groupSummary.agent }} /> : null}
              {groupSummary.you ? <i className="you" style={{ flex: groupSummary.you }} /> : null}
            </span>
          </div>
          {group.blocks.map(({ requirement, related, signal, visibleTasks, pending, showProposal }) => {
            const doneTasks = visibleTasks.filter(task => task.status === '完成')
            const activeTasks = visibleTasks.filter(task => task.status !== '完成')
            const doneOpen = openDone.has(requirement.id)
            const actionLabel = signal.action === 'confirm' ? '确认' : signal.action === 'split' ? '拆解' : '查看'
            return <div className={`wb-reqblock ${signal.tone}`} key={requirement.id}>
              <div className="wb-reqrow">
                <span className="wb-reqseal">需</span>
                <button className="wb-reqmain" onClick={() => openDoc('requirement', requirement.id)}>
                  <span className="wb-reqtitle">{requirement.title}</span>
                  <span className="wb-reqmeta">{requirement.id} · {requirement.priority ?? '未定'} · 来源 {requirement.sourceNote || '人工录入'}
                    · {related.length} 个任务 · 更新 {timeAgo(requirement.updatedAt)}</span>
                </button>
                <span className={`wb-statechip ${signal.tone}`}>{requirementStatusLabel(requirement.status)}</span>
                {!compact ? <span className={`wb-holder ${signal.tone}`}><i />{signal.next}</span> : null}
                <button className={`wb-rowaction ${signal.tone}`} disabled={busy === `${signal.action}:${requirement.id}`}
                  onClick={() => runRequirementAction(requirement, signal.action)}>{actionLabel} →</button>
              </div>
              {showProposal ? pending.map(proposal => <button className="wb-proposalstrip" key={proposal.id}
                onClick={() => openDoc('requirement', requirement.id)}>
                <span className="wb-proposalmark">A</span><b>Agent 提案</b><span>{proposal.title}</span>
                <span className="wb-proposalcount">+{proposalTaskRows(proposal).length} 个任务</span><span className="wb-proposallink">看 diff →</span>
              </button>) : null}
              {activeTasks.map(task => taskRow(task, !compact))}
              {doneTasks.length ? (doneOpen || workLens === 'done'
                ? <>{doneTasks.map(task => taskRow(task, !compact))}<button className="wb-donefold open" onClick={() => toggleDone(requirement.id)}>收起已完成 {doneTasks.length}</button></>
                : <button className="wb-donefold" onClick={() => toggleDone(requirement.id)}>✓ 已完成 {doneTasks.length} <span>展开</span></button>) : null}
              {!visibleTasks.length && requirement.status === '已拆分' ? <p className="wb-reqhint">当前镜头下没有任务。</p> : null}
            </div>
          })}
        </section>
      }) : <div className="wb-workempty"><Dot tone="ok" /><div><b>当前镜头下没有工作。</b><p>切换「全部」或清空搜索；Agent 正在跑的工作会出现在「Agent 在办」。</p></div></div>}
      <div className="wb-listend">{summary.total} 项在手 · 数据来自本地 SQLite · {timeAgo(new Date().toISOString())}</div>
    </div>
  }

  const relay = (kind: 'requirement' | 'task', status: Requirement['status'] | TaskStatus) => {
    const steps = relaySteps(kind, status)
    const current = relayCurrent(kind, status)
    return <ol className={`wb-relay ${kind}`} aria-label={`${kind === 'requirement' ? '需求' : '任务'}接力`}>
      {steps.map((step, index) => <li className={index < current ? 'done' : index === current ? 'current' : 'future'} key={step.label}
        aria-current={index === current ? 'step' : undefined}>
        <span className="wb-relayactor">{step.actor}</span><span className="wb-relaynode" />
        <span className="wb-relaylabel">{step.label}</span>
      </li>)}
    </ol>
  }

  const requirementDoc = (requirement: Requirement) => {
    const project = projectsById.get(requirement.projectId)
    const related = tasks.filter(task => task.requirementId === requirement.id)
    const liveTasks = related.filter(task => task.status !== '取消')
    const doneTasks = related.filter(task => task.status === '完成')
    const signal = requirementSignal(requirement, related)
    const source = requirement.sourceId ? inbox.find(item => item.id === requirement.sourceId) : undefined
    const relatedProposals = proposals.filter(proposal => proposal.targetType === 'requirement' && proposal.targetId === requirement.id).slice(0, 5)
    const pendingProposals = relatedProposals.filter(proposal => proposal.status === '待确认').length
    const events = audit.filter(entry => entry.entityId === requirement.id).slice(0, 8)
    const holder = holderText(signal)
    const splitLabel = requirement.status === '已拆分' ? '新增任务' : '自己拆解'
    const actions = <>
      {requirement.status === '待确认' ? <Btn variant="signal" size="sm" busy={busy === `confirm:${requirement.id}`}
        onClick={() => confirmRequirement(requirement)}>确认需求</Btn> : null}
      {requirement.status !== '已关闭' ? <Btn variant="outline" size="sm" onClick={() => openSplit(requirement)}>{splitLabel}</Btn> : null}
      <Btn variant="ghost" size="sm" onClick={() => askAbout(requirement.id)}>问 Agent</Btn>
    </>
    return <div className="wb-doc wb-workdoc">
      <button className="wb-back" onClick={backToList}>← 工作列表</button>
      <div className="wb-doccrumb">需求 <span>/</span> {project ? displayProject(project) : '项目'} <span>/</span> {requirement.id}</div>
      <header className="wb-workdochead">
        <span className="wb-docseal req">需</span>
        <div className="wb-docheadmain">
          <h1>{requirement.title}</h1>
          <div className="wb-holderline"><span className={`wb-statechip ${signal.tone}`}>{requirementStatusLabel(requirement.status)}</span>
            <span className={`wb-holder ${signal.tone}`}><i />{holder}</span></div>
          <div className="wb-docmeta">P {requirement.priority ?? '未定'} · 来源 {requirement.sourceNote || '人工录入'} · 更新 {timeAgo(requirement.updatedAt)} · {related.length} 个任务</div>
        </div>
        <div className="wb-docactions">{actions}</div>
      </header>
      {relay('requirement', requirement.status)}
      <div className="wb-docgrid">
        <main className="wb-docmain">
          {source ? <blockquote className="wb-sourcequote">
            <div className="wb-sourcehead"><span>{source.channel}</span><b>{source.contact || '未知联系人'}</b><span>{timeAgo(source.receivedAt)}</span></div>
            <p>{source.rawContext || '没有原文。'}</p>
            <button className="wb-link" onClick={() => openInboxItem(source)}>查看收件 →</button>
          </blockquote> : null}
          {requirement.description ? <section className="wb-docsection"><h2>简报</h2><p className="wb-lead">{requirement.description}</p></section> : null}
          {relatedProposals.length ? <section className="wb-docsection"><h2>Agent 提案 <span className="hint">{pendingProposals ? `${pendingProposals} 条待确认` : '已处理'}</span></h2>
            <div className="wb-proposals">{relatedProposals.map(proposalCard)}</div>
          </section> : null}
          <section className="wb-docsection"><h2>任务构成 <span className="hint">{related.length} 个 · {doneTasks.length} 完成</span></h2>
            {related.length ? <div className="wb-doctasks">{related.map(task => taskRow(task))}</div>
              : <p className="wb-hintline">还没有任务。自己拆解，或让 Agent 先拟一份拆解提案。</p>}
          </section>
          {events.length ? <section className="wb-docsection"><h2>时间线</h2>
            <ol className="wb-timeline">{events.map(entry => <li className="wb-tlitem" key={entry.id}>
              <span className="wb-tltime">{clock(entry.createdAt)}</span><span className="wb-tldot signal" />
              <span className="wb-tlbody"><b>{entry.action}</b><p>{entry.actor ?? '系统'}</p></span>
            </li>)}</ol>
          </section> : null}
          <details className="wb-details">
            <summary>诊断</summary>
            <div className="wb-details-body">
              <div className="wb-kv"><span>需求 ID</span><b>{requirement.id}</b></div>
              <div className="wb-kv"><span>项目 ID</span><b>{requirement.projectId}</b></div>
              <div className="wb-kv"><span>来源</span><b>{requirement.sourceNote || '人工录入'}</b></div>
              <div className="wb-kv"><span>创建</span><b>{timeAgo(requirement.createdAt)}</b></div>
            </div>
          </details>
        </main>
        <aside className="wb-rail">
          <section className="wb-railcard">
            <div className="wb-railhead">需求信息</div>
            <div className="wb-settingrow"><span>状态</span><b>{requirementStatusLabel(requirement.status)}</b></div>
            <div className="wb-settingrow"><span>持棒人</span><b>{holderLabel(signal.holder)}</b></div>
            <div className="wb-settingrow"><span>优先级</span><b>{requirement.priority ?? '未定'}</b></div>
            <div className="wb-settingrow"><span>来源</span><b>{requirement.sourceNote || '人工录入'}</b></div>
            <div className="wb-settingrow"><span>任务</span><b>{related.length} 个 · {doneTasks.length} 完成</b></div>
            <div className="wb-settingrow"><span>待处理提案</span><b>{pendingProposals}</b></div>
          </section>
          <section className="wb-railcard">
            <div className="wb-railhead">相关记录</div>
            <div className="wb-settingrow"><span>收件</span><b>{source ? `${source.channel} · ${source.contact ?? '未知'}` : '无'}</b></div>
            <div className="wb-settingrow"><span>审计</span><b>{audit.filter(entry => entry.entityId === requirement.id).length} 条</b></div>
          </section>
          <div className="wb-docfooter">
            <Btn variant="ghost" size="sm" busy={busy === `delete:${requirement.id}`} disabled={liveTasks.length > 0}
              onClick={() => removeRequirement(requirement)}
              title={liveTasks.length ? '需求下还有未取消的任务' : '删除需求'}>删除需求</Btn>
            <span className="wb-dangerhint">{liveTasks.length ? `还有 ${liveTasks.length} 个未取消的任务，先取消或删除任务。`
              : '删除后不再出现在列表，历史保留。'}</span>
          </div>
        </aside>
      </div>
      <div className="wb-docdock">{actions}</div>
    </div>
  }

  const taskActions = (task: Task) => {
    if (task.status === '待验收') return <>
      <Btn variant="primary" size="sm" busy={busy === `accept:${task.id}`} onClick={() => acceptTask(task)}>验收通过</Btn>
      <Btn variant="ghost" size="sm" onClick={() => askAbout(task.id)}>问 Agent</Btn>
    </>
    if (task.status === '就绪') return <>
      <Btn variant="primary" size="sm" busy={busy === `dispatch:${task.id}`} onClick={() => dispatchTask(task)}>派发</Btn>
      <Btn variant="ghost" size="sm" onClick={() => cancelTask(task)}>取消</Btn>
    </>
    if (task.status === '阻塞') return <>
      <Btn variant="outline" size="sm" busy={busy === `retry:${task.id}`} onClick={() => retryTask(task)}>重试</Btn>
      <Btn variant="ghost" size="sm" onClick={() => askAbout(task.id)}>问 Agent</Btn>
      <Btn variant="ghost" size="sm" onClick={() => cancelTask(task)}>停止</Btn>
    </>
    if (task.status === '进行中') return <>
      <Btn variant="ghost" size="sm" onClick={() => askAbout(task.id)}>问 Agent</Btn>
      <Btn variant="ghost" size="sm" onClick={() => cancelTask(task)}>叫停</Btn>
    </>
    if (task.status === '评审') return <Btn variant="outline" size="sm"
      onClick={() => reviewBox.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })}>提交评审</Btn>
    return null
  }

  const taskDoc = (task: Task) => {
    const project = projectsById.get(task.projectId)
    const requirement = requirements.find(item => item.id === task.requirementId)
    const fetched = detail.id === task.id ? detail : undefined
    const evidence = fetched?.data?.artifacts ?? []
    // Evidence already has its own section; keep the timeline to human milestones.
    const events = (fetched?.data?.events ?? [])
      .filter(event => event.eventType !== '产物' && event.eventType !== '绑定工单')
      .filter((event, index, all) => index === 0 || event.eventType !== all[index - 1]?.eventType || event.actor !== all[index - 1]?.actor)
    const latestAttempt = fetched?.data?.attempts.slice()
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())[0]
    const reportEvent = [...(fetched?.data?.events ?? [])].reverse().find(event => event.eventType === '报告')
    const reportSummary = reportEvent && typeof reportEvent.payload === 'object' && reportEvent.payload !== null
      && typeof (reportEvent.payload as { summary?: unknown }).summary === 'string'
      ? (reportEvent.payload as { summary: string }).summary.trim() : ''
    const signal = taskSignal(task)
    const hasReport = !!(latestAttempt?.attention || reportSummary || latestAttempt?.lastReportAt)
    const attemptLabel = task.status === '评审' ? '已提交评审' : latestAttempt?.status ?? '—'
    const agentTitle = hasReport ? 'Agent 最近汇报' : 'Agent 状态'
    const agentNote = readableReport(latestAttempt?.attention || reportSummary
      || (latestAttempt?.lastReportAt ? `最近汇报 ${timeAgo(latestAttempt.lastReportAt)}`
        : fetched?.data ? task.status === '待验收' ? '交付物和证据已经整理好，等你验收。'
          : task.status === '评审' ? '已提交评审，等待结果。'
          : task.status === '进行中' ? '正在执行，还没有新的汇报。'
          : task.status === '阻塞' ? '停在这里，等你回答。'
          : task.status === '就绪' ? '还没有开始，等你派发。'
          : '任务已经结束。'
        : '正在读取 Agent 汇报…'))
    return <div className="wb-doc wb-workdoc">
      <button className="wb-back" onClick={backToList}>← 工作列表</button>
      <div className="wb-doccrumb">任务 <span>/</span> {project ? displayProject(project) : '项目'} <span>/</span> {task.id}</div>
      <header className="wb-workdochead">
        <span className="wb-docseal task">任</span>
        <div className="wb-docheadmain">
          <h1>{task.title}</h1>
          <div className="wb-holderline"><span className={`wb-statechip ${signal.tone}`}>{taskStatusLabel(task.status)}</span>
            <span className={`wb-holder ${signal.tone}`}><i />{holderText(signal)}</span></div>
          <div className="wb-docmeta">{task.priority} · {task.type} · {requirement ? requirement.title : task.requirementId} · 更新 {timeAgo(task.updatedAt)}</div>
        </div>
        <div className="wb-docactions">
          <Btn variant="outline" size="sm" onClick={() => askAbout(task.id)}>问 Agent</Btn>
        </div>
      </header>
      {relay('task', task.status)}
      <div className="wb-docgrid">
        <main className="wb-docmain">
          <section className={`wb-agentcard ${signal.tone}`}>
            <Dot tone={signal.tone === 'you' ? 'signal' : signal.tone} />
            <div className="wb-agentbody"><b>{agentTitle}</b><p className={reportOpen ? '' : 'clamp'}>{agentNote}</p>
              {agentNote.length > 220 ? <button className="wb-link" onClick={() => setReportOpen(value => !value)}>
                {reportOpen ? '收起汇报' : '展开完整汇报'}</button> : null}
              <div className="wb-agentmeta">阶段 {latestAttempt?.stage ?? '—'} · 尝试 {attemptLabel} · 更新 {timeAgo(task.updatedAt)}</div>
            </div>
          </section>
          {fetched?.error ? <p className="wb-error">{fetched.error.message}</p> : null}
          {task.description ? <section className="wb-docsection"><h2>简报</h2><p className="wb-lead">{task.description}</p></section> : null}
          {task.acceptance ? <section className="wb-docsection"><h2>验收标准 <span className="hint">{evidence.length} 项证据</span></h2>
            <div className="wb-checklist">{task.acceptance.split('\n').filter(Boolean).map((line, index) => <div className="wb-check" key={index}>
              <span className={`wb-tick ${task.status === '完成' ? 'done' : ''}`}>{task.status === '完成' ? '✓' : ''}</span><span>{line}</span></div>)}</div>
          </section> : null}
          {evidence.length ? <section className="wb-docsection"><h2>证据 <span className="hint">{evidence.length}</span></h2>
            <div className="wb-evidence">{evidence.map(artifact => {
              const open = openArtifact === artifact.id
              return <div className={`wb-ev ${open ? 'open' : ''}`} key={artifact.id}>
                <button type="button" className="wb-ev-toggle" onClick={() => setOpenArtifact(open ? null : artifact.id)}>
                  <span className="wb-ev-title"><b>{artifact.title || `${artifact.type}证据`}</b>
                    <small>{artifact.type} · {timeAgo(artifact.createdAt)}</small></span>
                  <span className="wb-ev-action">{open ? '收起' : '查看'}</span>
                </button>
                {open ? <div className="wb-ev-body">
                  {artifact.content ? <p>{artifact.content}</p> : <p className="wb-muted">没有正文。</p>}
                  {artifact.uri ? <p className="wb-ev-uri">{artifact.uri}</p> : null}
                </div> : null}
              </div>
            })}</div>
          </section> : null}
          {fetched?.data?.reviews.length ? <section className="wb-docsection"><h2>评审记录</h2>
            {fetched.data.reviews.map(review => <div className="wb-reviewrecord" key={review.id}>
              <b>{review.decision === '通过' ? '通过' : '退回'}</b>{' '}<span>{review.reviewer ?? '评审智能体'} · {timeAgo(review.createdAt)}</span>
              {review.comments ? <p>{review.comments}</p> : null}
            </div>)}
          </section> : null}
          {events.length ? <section className="wb-docsection"><h2>时间线</h2>
            <ol className="wb-timeline">{events.map(event => <li className="wb-tlitem" key={event.id}>
              <span className="wb-tltime">{clock(event.createdAt)}</span><span className="wb-tldot run" />
              <span className="wb-tlbody"><b>{eventLabel(event.eventType)}</b><p>{event.actor ?? '系统'}</p></span>
            </li>)}</ol>
          </section> : null}
          <details className="wb-details">
            <summary>诊断</summary>
            <div className="wb-details-body">
              <div className="wb-kv"><span>任务 ID</span><b>{task.id}</b></div>
              <div className="wb-kv"><span>需求 ID</span><b>{task.requirementId}</b></div>
              <div className="wb-kv"><span>项目 ID</span><b>{task.projectId}</b></div>
              <div className="wb-kv"><span>当前尝试</span><b>{task.currentAttemptId ?? '—'}</b></div>
              <div className="wb-kv"><span>创建</span><b>{timeAgo(task.createdAt)}</b></div>
              {fetched?.data?.attempts.length ? <div className="wb-diag-attempts">
                <h3>执行尝试</h3>
                {fetched.data.attempts.map(attempt => <div className="wb-diag-row" key={attempt.id}>
                  <b>{attempt.id}</b><span>{attempt.status} · {attempt.stage ?? '—'}</span>
                  <small>{timeAgo(attempt.createdAt)}{attempt.endedAt ? ` · 结束 ${timeAgo(attempt.endedAt)}` : ''}</small>
                </div>)}
              </div> : null}
            </div>
          </details>
        </main>
        <aside className="wb-rail">
          {task.status === '评审' ? <section className="wb-reviewbox wb-railcard" ref={reviewBox}>
            <div className="wb-railhead">评审结论</div>
            <p className="wb-railnote">通过后进入待验收；退回后 Agent 继续处理。</p>
            <textarea className="wb-textarea" rows={3} value={reviewComment} placeholder="意见（可选，退回时写清要改什么）"
              onChange={event => setReviewComment(event.target.value)} />
            <div className="wb-formactions">
              <Btn variant="primary" size="sm" busy={busy === `review:${task.id}`} onClick={() => submitReview(task, '通过')}>通过</Btn>
              <Btn variant="outline" size="sm" busy={busy === `review:${task.id}`} onClick={() => submitReview(task, '退回')}>退回</Btn>
            </div>
          </section> : null}
          {task.status !== '评审' && task.status !== '完成' && task.status !== '取消' ? <section className="wb-railcard wb-railnext">
            <div className="wb-railhead">下一步</div>
            <div className="wb-formactions">{taskActions(task)}</div>
          </section> : null}
          <section className="wb-railcard">
            <div className="wb-railhead">任务信息</div>
            <div className="wb-settingrow"><span>状态</span><b>{taskStatusLabel(task.status)}</b></div>
            <div className="wb-settingrow"><span>持棒人</span><b>{holderLabel(signal.holder)}</b></div>
            <div className="wb-settingrow"><span>需求</span><b>{requirement ? requirement.title : '—'}</b></div>
            <div className="wb-settingrow"><span>类型</span><b>{task.type}</b></div>
            <div className="wb-settingrow"><span>优先级</span><b>{task.priority}</b></div>
            <div className="wb-settingrow"><span>尝试</span><b>{fetched?.data?.attempts.length ? `第 ${fetched.data.attempts.length} 次` : '—'}</b></div>
          </section>
          <div className="wb-docfooter">
            <Btn variant="ghost" size="sm" busy={busy === `delete:${task.id}`} onClick={() => removeTask(task)}>删除任务</Btn>
            <span className="wb-dangerhint">执行历史和证据会保留，任务不再出现在列表。</span>
          </div>
        </aside>
      </div>
      <div className="wb-docdock">{taskActions(task)}
        {task.status === '完成' || task.status === '取消' ? <Btn variant="ghost" size="sm" onClick={() => askAbout(task.id)}>问 Agent</Btn> : null}
      </div>
    </div>
  }

  const selectedWork = selectedRequirement ? requirementDoc(selectedRequirement)
    : selectedTask ? taskDoc(selectedTask) : undefined
  const work = () => <div className={`wb-workbench ${selectedWork ? 'split' : ''}`}>
    <div className={`wb-index ${selectedWork ? 'compact' : ''}`}>{workList({ compact: !!selectedWork })}</div>
    {selectedWork ? <div className="wb-docpane">{selectedWork}</div> : null}
  </div>

  const inboxList = () => {
    const items = inbox.filter(item => inboxProject === 'all' || item.projectId === inboxProject)
    return <>
      <div className="wb-pagehead">
        <div><div className="wb-kicker">收件 · 全部项目</div><h1>收件</h1><p>两个项目的原始消息都在这里。Agent 先分诊，你只做确认。</p></div>
        <div className="wb-headstat"><b>{inbox.filter(item => item.status === '未处理').length}</b>条未处理</div>
      </div>
      <div className="wb-filterbar"><div className="wb-filters">
        <button className={`wb-filter ${inboxProject === 'all' ? 'active' : ''}`} onClick={() => setInboxProject('all')}>全部项目</button>
        {projects.map(project => <button key={project.id} className={`wb-filter ${inboxProject === project.id ? 'active' : ''}`}
          onClick={() => setInboxProject(project.id)}>{displayProject(project)}</button>)}
      </div></div>
      {items.length ? <div>{items.map(item => {
        const open = openInboxId === item.id
        const project = item.projectId ? projectsById.get(item.projectId) : undefined
        return <div className="wb-inbox-item" key={item.id}>
          <button className="wb-inbox-row" onClick={() => open ? closeInboxItem() : openInboxItem(item)}>
            <span className="wb-source">{item.channel}</span>
            <span className="wb-inboxmain"><span className="wb-inboxtitle"><ProjectTag project={project} /> {item.contact || '未知联系人'}</span>
              <span className="wb-inboxpreview">{firstLine(item.rawContext) || '（无内容）'}</span></span>
            <span className="wb-inboxtime">{timeAgo(item.receivedAt)}</span>
            <span className={`wb-inboxstate ${item.status === '未处理' ? '' : 'done'}`}>{item.status}</span>
          </button>
          {open ? <div className="wb-inboxbody">
            <blockquote className="wb-quote">{item.rawContext || '（无内容）'}</blockquote>
            {triage && triage.itemId === item.id ? <div className="wb-triage">
              <h3>转为需求</h3>
              <div className="wb-formrow">
                <label className="wb-field">项目<select className="wb-select" value={triage.projectId}
                  onChange={event => setTriage({ ...triage, projectId: event.target.value })}>
                  <option value="">选择项目</option>{projects.map(project => <option key={project.id} value={project.id}>{project.shortCode} {project.name}</option>)}
                </select></label>
                <label className="wb-field">优先级<select className="wb-select" value={triage.priority}
                  onChange={event => setTriage({ ...triage, priority: event.target.value as Priority })}>
                  {['P0', 'P1', 'P2', 'P3'].map(value => <option key={value}>{value}</option>)}
                </select></label>
              </div>
              <label className="wb-field" style={{ marginTop: 6 }}>标题<input className="wb-input" value={triage.title}
                onChange={event => setTriage({ ...triage, title: event.target.value })} /></label>
              <label className="wb-field" style={{ marginTop: 6 }}>描述<textarea className="wb-textarea" value={triage.description}
                onChange={event => setTriage({ ...triage, description: event.target.value })} /></label>
              <div className="wb-formactions">
                <Btn variant="primary" busy={busy === `triage:${item.id}`} onClick={submitTriage}>转为需求</Btn>
                <Btn variant="outline" busy={busy === `inbox:${item.id}`} onClick={() => ignoreInbox(item)}>忽略</Btn>
                <Btn variant="ghost" onClick={closeInboxItem}>收起</Btn>
              </div>
            </div> : <p className="wb-empty">{item.status === '未处理' ? '点击上方按钮开始分诊。' : `已处理：${item.status}`}</p>}
            <div className="wb-inboxfoot">
              <Btn variant="ghost" size="sm" busy={busy === `delete:${item.id}`} onClick={() => removeInbox(item)}>删除收件</Btn>
              <span className="wb-dangerhint">删除后不再出现在收件列表，原始内容保留在审计里。</span>
            </div>
          </div> : null}
        </div>
      })}</div> : <p className="wb-empty">当前筛选下没有收件。</p>}
    </>
  }

  const knowledge = () => {
    const pending = memory.filter(entry => entry.status === '待复核' && (memoryProject === 'all' || entry.projectId === memoryProject))
    const confirmed = memory.filter(entry => entry.status === '已确认' && (memoryProject === 'all' || entry.projectId === memoryProject))
    return <>
      <div className="wb-pagehead">
        <div><div className="wb-kicker">知识 · 全部项目</div><h1>知识</h1><p>两个项目的记忆都在这里。Agent 提出、你确认后才会被复用。</p></div>
        <div className="wb-headstat"><b>{pending.length}</b>条待复核</div>
      </div>
      <div className="wb-filterbar"><div className="wb-filters">
        <button className={`wb-filter ${memoryProject === 'all' ? 'active' : ''}`} onClick={() => setMemoryProject('all')}>全部项目</button>
        {projects.map(project => <button key={project.id} className={`wb-filter ${memoryProject === project.id ? 'active' : ''}`}
          onClick={() => setMemoryProject(project.id)}>{displayProject(project)}</button>)}
      </div><Btn variant="outline" size="sm" busy={busy === 'verify'} onClick={verifyMemory}>检查引用</Btn></div>
      {pending.length ? <section className="wb-section"><div className="wb-sectionhead"><h2>待你复核</h2><span className="hint">{pending.length} 条</span></div>
        {pending.map(entry => <div className="wb-memorycard" key={entry.id}>
          <div className="wb-memorytitle"><ProjectTag project={projectsById.get(entry.projectId)} /> {entry.title}</div>
          <div className="wb-memorybody">{entry.content}</div>
          <div className="wb-memorymeta">{entry.type} · {entry.sourceType} · 更新 {timeAgo(entry.updatedAt)}</div>
          <div className="wb-memoryactions">
            <Btn variant="primary" size="sm" busy={busy === `memory:${entry.id}`} onClick={() => confirmMemory(entry)}>确认</Btn>
            <Btn variant="outline" size="sm" busy={busy === `memory:${entry.id}`} onClick={() => rejectMemory(entry)}>退回</Btn>
          </div>
        </div>)}</section> : <p className="wb-empty">没有待复核的记忆。</p>}
      <section className="wb-section"><div className="wb-sectionhead"><h2>已确认</h2><span className="hint">{confirmed.length} 条</span></div>
        {confirmed.length ? confirmed.map(entry => <div className="wb-memoryrow" key={entry.id}>
          <b><ProjectTag project={projectsById.get(entry.projectId)} /> {entry.title}</b>
          <small>{entry.type} · {entry.confirmedBy ?? '你'}{entry.confirmedAt ? ` · ${timeAgo(entry.confirmedAt)}` : ''}</small>
        </div>) : <p className="wb-empty">还没有已确认的记忆。</p>}
      </section>
    </>
  }

  const settings = () => <SettingsPanel deploymentForm={deploymentForm} audit={audit} />

  const current = view === 'today' ? '今天' : view === 'work' ? '工作' : view === 'inbox' ? '收件'
    : view === 'knowledge' ? '知识' : '工作台设置'

  return <div className="wb-page">
    <style>{STYLES}</style>
    <div className="wb-app">
      <main className="wb-center" ref={center}>
        <header className="wb-top">
          <div className="wb-crumb">全部项目 <span>/</span> <b>{current}</b></div>
          <div className="wb-tools">
            <button className="wb-searchbtn" onClick={() => onNavigate('settings')} title="工作台设置">设置</button>
            <button className="wb-btn wb-btn-outline wb-btn-sm" onClick={openMaster}>＋ 新委托</button>
          </div>
        </header>
        <div className={`wb-view ${view === 'work' ? 'wb-view-work' : ''}`}>
          {error ? <p className="wb-error">{error.message}</p> : !data ? <p className="wb-loading">正在读取工作台…</p>
            : view === 'today' ? today() : view === 'work' ? work() : view === 'inbox' ? inboxList()
            : view === 'knowledge' ? knowledge() : settings()}
        </div>
      </main>
    </div>
    {newRequirement ? <div className="wb-sheet">
      <div className="wb-sheetbox">
        <h2>新增需求</h2>
        <div className="wb-sub">需求先进入待确认；确认后再拆任务。</div>
        <div className="wb-formrow">
          <label className="wb-field">项目<select className="wb-select" value={newRequirement.projectId}
            onChange={event => setNewRequirement({ ...newRequirement, projectId: event.target.value })}>
            <option value="">选择项目</option>
            {projects.map(project => <option key={project.id} value={project.id}>{project.shortCode} {project.name}</option>)}
          </select></label>
          <label className="wb-field">优先级<select className="wb-select" value={newRequirement.priority}
            onChange={event => setNewRequirement({ ...newRequirement, priority: event.target.value as Priority })}>
            {['P0', 'P1', 'P2', 'P3'].map(value => <option key={value}>{value}</option>)}
          </select></label>
        </div>
        <label className="wb-field" style={{ marginTop: 6 }}>标题<input className="wb-input" autoFocus value={newRequirement.title}
          onChange={event => setNewRequirement({ ...newRequirement, title: event.target.value })} /></label>
        <label className="wb-field" style={{ marginTop: 6 }}>描述<textarea className="wb-textarea" rows={3} value={newRequirement.description}
          onChange={event => setNewRequirement({ ...newRequirement, description: event.target.value })} /></label>
        <label className="wb-field" style={{ marginTop: 6 }}>来源<input className="wb-input" value={newRequirement.sourceNote}
          onChange={event => setNewRequirement({ ...newRequirement, sourceNote: event.target.value })} /></label>
        <div className="wb-formactions">
          <Btn variant="primary" busy={busy === 'requirement:new'} onClick={submitNewRequirement}>创建需求</Btn>
          <Btn variant="ghost" onClick={() => setNewRequirement(null)}>取消</Btn>
        </div>
      </div>
    </div> : null}
    {split ? <div className="wb-sheet">
      <div className="wb-sheetbox">
        <h2>{split.requirement.status === '已拆分' ? '新增任务' : '拆解'} · {split.requirement.id}</h2>
        <div className="wb-sub">{split.requirement.title}</div>
        <div className="wb-splitrows">{split.rows.map((row, index) => <div className="wb-draft" key={index}>
          <div className="wb-formrow">
            <label className="wb-field" style={{ gridColumn: '1 / -1' }}>任务标题
              <input className="wb-input" value={row.title} onChange={event => updateSplitRow(index, { title: event.target.value })} /></label>
          </div>
          <div className="wb-formrow">
            <label className="wb-field">类型<select className="wb-select" value={row.type}
              onChange={event => updateSplitRow(index, { type: event.target.value as TaskType })}>
              {['设计', '开发', '排障', '评审'].map(value => <option key={value}>{value}</option>)}</select></label>
            <label className="wb-field">优先级<select className="wb-select" value={row.priority}
              onChange={event => updateSplitRow(index, { priority: event.target.value as Priority })}>
              {['P0', 'P1', 'P2', 'P3'].map(value => <option key={value}>{value}</option>)}</select></label>
          </div>
          <label className="wb-field">描述<textarea className="wb-textarea" value={row.description}
            onChange={event => updateSplitRow(index, { description: event.target.value })} /></label>
          <label className="wb-field" style={{ marginTop: 5 }}>验收标准<textarea className="wb-textarea" value={row.acceptance}
            onChange={event => updateSplitRow(index, { acceptance: event.target.value })} /></label>
          {split.rows.length > 1 ? <button className="wb-x" onClick={() => removeSplitRow(index)}>移除</button> : null}
        </div>)}</div>
        <div className="wb-formactions">
          <Btn variant="outline" onClick={addSplitRow}>＋ 加一行</Btn>
          <Btn variant="primary" busy={busy === 'split'} onClick={submitSplit}>{split.requirement.status === '已拆分' ? '创建任务' : '拆成任务'}</Btn>
          <Btn variant="ghost" onClick={() => setSplit(null)}>取消</Btn>
        </div>
      </div>
    </div> : null}
    {toast ? <div className="wb-toast show">{toast}</div> : null}
  </div>
}
