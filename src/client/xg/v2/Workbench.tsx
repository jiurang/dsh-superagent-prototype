/** Workbench v2: a three-column, real-data workbench inside the DSH main panel. */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { XgTaskDetail, XgWorkbench } from '../../../xg/api-contract.ts'
import type { InboxItem, MemoryEntry, Priority, Project, Requirement, Task, TaskStatus, TaskType } from '../../../xg/domain.ts'
import { usePoll } from '../../api.ts'
import type { DeploymentForm } from '../../deployment.tsx'
import { usePanel, usePanelData } from '../../provider.tsx'
import { xgGet, xgPost } from '../client.ts'
import { readViewState, subscribeViewState, updateViewState, type WorkbenchSelection, type WorkbenchView } from './navigation.ts'
import { SettingsPanel } from './SettingsPanel.tsx'
import STYLES from './workbench.css?raw'

type AttentionKind = 'blocked' | 'accept' | 'requirement' | 'inbox' | 'memory' | 'dispatch'

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
  inboxItem?: InboxItem
  memory?: MemoryEntry
}
interface SplitRow { title: string; type: TaskType; priority: Priority; description: string; acceptance: string }
interface SplitDraft { requirement: Requirement; rows: SplitRow[] }
interface TriageDraft { itemId: string; projectId: string; title: string; priority: Priority; description: string }

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
const attentionRank: Record<AttentionKind, number> = { blocked: 0, accept: 1, requirement: 2, inbox: 3, memory: 4, dispatch: 5 }

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
function Btn({ variant = 'outline', size, busy, children, onClick, title }: {
  variant?: 'primary' | 'signal' | 'outline' | 'ghost'; size?: 'sm'; busy?: boolean; children: ReactNode
  onClick?: () => void; title?: string
}) {
  return <button type="button" className={`wb-btn wb-btn-${variant}${size === 'sm' ? ' wb-btn-sm' : ''}`} disabled={busy}
    onClick={onClick} title={title}>{children}</button>
}

export function Workbench({ view, deploymentForm, onNavigate }: {
  view: WorkbenchView; deploymentForm: DeploymentForm; onNavigate: (view: WorkbenchView) => void
}) {
  const { openSession } = usePanel()
  const { state: panel } = usePanelData()
  const { data, error, reload } = usePoll(() => xgGet('/workbench'), [], 5000)
  const stored = useSyncExternalStore(subscribeViewState, () => readViewState(view), () => readViewState(view))
  const [workType, setWorkType] = useState<'all' | 'requirement' | 'task'>('all')
  const [workProject, setWorkProject] = useState('all')
  const [inboxProject, setInboxProject] = useState('all')
  const [memoryProject, setMemoryProject] = useState('all')
  const [triage, setTriage] = useState<TriageDraft | null>(null)
  const [split, setSplit] = useState<SplitDraft | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  const [openArtifact, setOpenArtifact] = useState<string | null>(null)
  const center = useRef<HTMLElement | null>(null)
  const triageFor = useRef<string | null>(null)

  const projects = data?.projects ?? []
  const tasks = data?.tasks ?? []
  const requirements = data?.requirements ?? []
  const inbox = data?.inbox ?? []
  const memory = data?.memory ?? []
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

  useEffect(() => { setOpenArtifact(null) }, [workSelection?.id])

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
  const confirmMemory = (entry: MemoryEntry) => action(`memory:${entry.id}`,
    () => xgPost('/memory/:id/confirm', { by: '你' }, { params: { id: entry.id } }), '记忆已确认')
  const rejectMemory = (entry: MemoryEntry) => action(`memory:${entry.id}`,
    () => xgPost('/memory/:id/reject', { by: '你' }, { params: { id: entry.id } }), '记忆已退回')
  const ignoreInbox = (item: InboxItem) => action(`inbox:${item.id}`,
    () => xgPost('/inbox/:id/ignore', undefined, { params: { id: item.id } }), '已忽略')

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
    }, '已拆成任务')
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

  const attentionRow = (item: Attention) => <div className={`wb-attn ${item.kind === 'blocked' ? 'block' : 'needs'}`} key={item.key}>
    <div className="wb-attnrow">
      <div className="wb-attnmain">
        <div className="wb-type">
          {item.kind === 'requirement' ? <>需求</> : null}
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
      </div>
      <div className="wb-actions">
        {item.kind === 'requirement' && item.requirement ? <>
          <Btn variant="signal" size="sm" busy={busy === `confirm:${item.requirement.id}`} onClick={() => confirmRequirement(item.requirement!)}>确认</Btn>
          <Btn variant="ghost" size="sm" onClick={() => openSplit(item.requirement!)}>拆解</Btn>
          <Btn variant="ghost" size="sm" onClick={() => openDoc('requirement', item.requirement!.id)}>查看</Btn>
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

  const workRow = (kind: 'requirement' | 'task', item: Requirement | Task) => {
    const tone = kind === 'requirement' ? requirementTone((item as Requirement).status) : taskTone((item as Task).status)
    const state = kind === 'requirement' ? requirementStatusLabel((item as Requirement).status) : taskStatusLabel((item as Task).status)
    return <button className="wb-workrow" key={`${kind}:${item.id}`} onClick={() => openDoc(kind, item.id)}>
      <span className="wb-worktype">{kind === 'requirement' ? '需求' : '任务'}</span>
      <span className="wb-workmain"><span className="wb-worktitle">{item.title}</span>
        <span className="wb-workmeta">{item.priority ?? '—'} · 更新 {timeAgo(item.updatedAt)}</span></span>
      <span className="wb-workstate"><Dot tone={tone} />{state}</span><span className="wb-arrow">→</span>
    </button>
  }

  const workList = () => {
    const visibleRequirements = requirements.filter(item => (workType === 'all' || workType === 'requirement')
      && (workProject === 'all' || item.projectId === workProject))
    const visibleTasks = tasks.filter(item => (workType === 'all' || workType === 'task')
      && (workProject === 'all' || item.projectId === workProject) && item.status !== '取消')
    const groups = projects.map(project => ({
      project,
      requirements: visibleRequirements.filter(item => item.projectId === project.id),
      tasks: visibleTasks.filter(item => item.projectId === project.id),
    })).filter(group => group.requirements.length || group.tasks.length)
    return <>
      <div className="wb-pagehead">
        <div><div className="wb-kicker">工作 · 全部项目</div><h1>工作</h1><p>两个项目的需求和任务都在这里。默认打开文档，列表只是镜头。</p></div>
        <div className="wb-headstat"><b>{visibleRequirements.length + visibleTasks.length}</b>项</div>
      </div>
      <div className="wb-filterbar">
        <div className="wb-filters">
          <button className={`wb-filter ${workType === 'all' ? 'active' : ''}`} onClick={() => setWorkType('all')}>全部</button>
          <button className={`wb-filter ${workType === 'requirement' ? 'active' : ''}`} onClick={() => setWorkType('requirement')}>需求</button>
          <button className={`wb-filter ${workType === 'task' ? 'active' : ''}`} onClick={() => setWorkType('task')}>任务</button>
        </div>
        <div className="wb-filters">
          <button className={`wb-filter ${workProject === 'all' ? 'active' : ''}`} onClick={() => setWorkProject('all')}>全部项目</button>
          {projects.map(project => <button key={project.id} className={`wb-filter ${workProject === project.id ? 'active' : ''}`}
            onClick={() => setWorkProject(project.id)}>{displayProject(project)}</button>)}
        </div>
      </div>
      {groups.length ? groups.map(group => <div className="wb-workgroup" key={group.project.id}>
        <div className="wb-workgrouphead"><b>{displayProject(group.project)} · {group.project.name}</b><span className="spacer" />
          <small>{group.requirements.length + group.tasks.length} 项</small></div>
        {group.requirements.map(item => workRow('requirement', item))}
        {group.tasks.map(item => workRow('task', item))}
      </div>) : <p className="wb-empty">当前筛选下没有工作。</p>}
    </>
  }

  const requirementDoc = (requirement: Requirement) => {
    const project = projectsById.get(requirement.projectId)
    const related = tasks.filter(task => task.requirementId === requirement.id)
    const events = audit.filter(entry => entry.entityId === requirement.id).slice(0, 8)
    const needs = needsHuman(requirement.status)
    return <div className="wb-doc">
      <button className="wb-back" onClick={backToList}>← 工作</button>
      <div className="wb-eyebrow">需求 <span>/</span> {project ? displayProject(project) : '项目'} · {project?.name ?? ''}</div>
      <div className="wb-doc-head">
        <h1>{requirement.title}</h1>
        <div className="wb-status">
          <Dot tone={requirementTone(requirement.status)} /><b>{requirementStatusLabel(requirement.status)}</b>
          <span className="wb-statusnote">{requirementStatusNote(requirement.status)}</span>
          {needs ? <span className="wb-needs">{needs}</span> : null}
          <span className="wb-progress"><i style={{ width: related.length ? `${related.filter(task => task.status === '完成').length / related.length * 100}%` : '0%' }} /></span>
          <span className="wb-statusactions">
            {requirement.status === '待确认' ? <Btn variant="signal" size="sm" busy={busy === `confirm:${requirement.id}`}
              onClick={() => confirmRequirement(requirement)}>确认需求</Btn> : null}
            <Btn variant="outline" size="sm" onClick={() => openSplit(requirement)}>拆解</Btn>
            <Btn variant="ghost" size="sm" onClick={() => askAbout(requirement.id)}>问 Agent</Btn>
          </span>
        </div>
      </div>
      <div className="wb-metarow"><span>优先级 <b>{requirement.priority ?? '未定'}</b></span><span>来源 <b>{requirement.sourceNote || '人工录入'}</b></span>
        <span>更新 <b>{timeAgo(requirement.updatedAt)}</b></span><span>任务 <b>{related.length}</b></span></div>
      {requirement.description ? <section className="wb-docsection"><h2>简报</h2><p className="wb-lead">{requirement.description}</p></section> : null}
      {related.length ? <section className="wb-docsection"><h2>任务 <span className="hint">{related.length}</span></h2>
        <div className="wb-tasklist">{related.map(task => <button className="wb-taskrow" key={task.id} onClick={() => openDoc('task', task.id)}>
          <Dot tone={taskTone(task.status)} /><span className="wb-tasktitle">{task.title}</span>
          <span className="wb-taskstate">{taskStatusLabel(task.status)}</span></button>)}</div>
      </section> : <p className="wb-hintline">还没有任务。点上方「拆解」创建第一个。</p>}
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
    if (task.status === '评审') return <span className="wb-meta"><Dot tone="run" />等待评审结果</span>
    return null
  }

  const taskDoc = (task: Task) => {
    const project = projectsById.get(task.projectId)
    const requirement = requirements.find(item => item.id === task.requirementId)
    const fetched = detail.id === task.id ? detail : undefined
    const evidence = fetched?.data?.artifacts ?? []
    // Evidence already has its own section; keep the timeline to human milestones.
    const events = (fetched?.data?.events ?? []).filter(event => event.eventType !== '产物' && event.eventType !== '绑定工单')
    const latestAttempt = fetched?.data?.attempts.slice()
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())[0]
    const needs = needsHuman(task.status)
    const hasReport = !!(latestAttempt?.attention || latestAttempt?.lastReportAt)
    const agentTitle = hasReport ? 'Agent 最近汇报' : 'Agent 状态'
    const agentNote = latestAttempt?.attention
      || (latestAttempt?.lastReportAt ? `最近汇报 ${timeAgo(latestAttempt.lastReportAt)}`
        : fetched?.data ? task.status === '待验收' ? '交付物和证据已经整理好，等你验收。'
          : task.status === '评审' ? '已提交评审，等待结果。'
          : task.status === '进行中' ? '正在执行，还没有新的汇报。'
          : task.status === '阻塞' ? '停在这里，等你回答。'
          : task.status === '就绪' ? '还没有开始，等你派发。'
          : '任务已经结束。'
        : '正在读取 Agent 汇报…')
    return <div className="wb-doc">
      <button className="wb-back" onClick={backToList}>← 工作</button>
      <div className="wb-eyebrow">任务 <span>/</span> {project ? displayProject(project) : '项目'} · {project?.name ?? ''}</div>
      <div className="wb-doc-head">
        <h1>{task.title}</h1>
        <div className="wb-status">
          <Dot tone={taskTone(task.status)} /><b>{taskStatusLabel(task.status)}</b>
          <span className="wb-statusnote">{taskStatusNote(task.status)}</span>
          {needs ? <span className="wb-needs">{needs}</span> : null}
          <span className="wb-progress"><i style={{ width: task.status === '完成' ? '100%' : task.status === '待验收' ? '90%'
            : task.status === '进行中' || task.status === '评审' ? '60%' : '12%' }} /></span>
          <span className="wb-statusactions">{taskActions(task)}</span>
        </div>
      </div>
      <div className="wb-metarow"><span>需求 <b>{requirement ? requirement.title : '—'}</b></span>
        <span>类型 <b>{task.type}</b></span><span>优先级 <b>{task.priority}</b></span><span>更新 <b>{timeAgo(task.updatedAt)}</b></span></div>
      <div className="wb-agentline"><Dot tone={taskTone(task.status)} /><div><b>{agentTitle}</b><p>{agentNote}</p></div></div>
      {fetched?.error ? <p className="wb-error">{fetched.error.message}</p> : null}
      {task.description ? <section className="wb-docsection"><h2>简报</h2><p className="wb-lead">{task.description}</p></section> : null}
      {task.acceptance ? <section className="wb-docsection"><h2>验收标准</h2>
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
    </div>
  }

  const work = () => selectedRequirement ? requirementDoc(selectedRequirement)
    : selectedTask ? taskDoc(selectedTask) : workList()

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
        <div className="wb-view">
          {error ? <p className="wb-error">{error.message}</p> : !data ? <p className="wb-loading">正在读取工作台…</p>
            : view === 'today' ? today() : view === 'work' ? work() : view === 'inbox' ? inboxList()
            : view === 'knowledge' ? knowledge() : settings()}
        </div>
      </main>
    </div>
    {split ? <div className="wb-sheet">
      <div className="wb-sheetbox">
        <h2>拆解 {split.requirement.id}</h2>
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
          <Btn variant="primary" busy={busy === 'split'} onClick={submitSplit}>拆成任务</Btn>
          <Btn variant="ghost" onClick={() => setSplit(null)}>取消</Btn>
        </div>
      </div>
    </div> : null}
    {toast ? <div className="wb-toast show">{toast}</div> : null}
  </div>
}
