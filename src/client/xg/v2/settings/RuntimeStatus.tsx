/** Read-only runtime status: sources, 24-hour flow, executor load, problems and model credentials. */
import type { Problem, SourceStatusRow } from '../../../api.ts'
import { usePoll } from '../../../api.ts'
import { usePanel, usePanelData } from '../../../provider.tsx'

const time = (value: string): string => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}
const sourceTone = (state: SourceStatusRow['state']): string => state === 'error' ? 'block'
  : state === 'ready' ? 'ok' : state === 'starting' || state === 'setup' ? 'run' : 'idle'
const sourceLabel: Record<SourceStatusRow['state'], string> = {
  ready: '正常', starting: '启动中', setup: '待部署', off: '已关闭', missing: '未安装', error: '异常', paused: '已暂停',
}
const problemTitle: Record<string, string> = {
  setup: '部署未完成', 'no-source': '没有可用来源', 'no-allowed': '没有允许的发送者', 'source-error': '来源异常',
  'executor-paused': '执行器已暂停', 'runtime-error': '运行时异常', 'eval-overdue': '评估超时',
  'eval-unavailable': '评估不可用', outgoing: '消息发送失败',
}
const problemHint: Record<string, string> = {
  setup: '按「部署」里的提示继续完成部署。',
  'no-source': '先在「来源」里启用一个来源。',
  'no-allowed': '在「评估」里把允许的发送者加入名单，否则消息不会生成工单。',
  'source-error': '检查来源配置和连接状态。',
  'executor-paused': '恢复处理后，排队中的工单才会继续。',
  'runtime-error': '检查运行时日志和对应组件状态。',
  'eval-overdue': '评估排队超时，检查评估模型和凭据。',
  'eval-unavailable': '最近的评估不可用，检查模型和凭据。',
  outgoing: '消息发送失败，检查渠道配置。',
}
const problemDetail = (problem: Problem): string => {
  if ('detail' in problem && typeof problem.detail === 'string') return problem.detail
  if ('source' in problem) return problem.source.health.detail
  if ('thread' in problem) return problem.thread.title
  if ('outgoing' in problem) return problem.outgoing.error
  return problemHint[problem.kind] ?? ''
}
const Dot = ({ tone }: { tone: string }) => <span className={`wb-dot ${tone}`} />

function SourceCard({ source }: { source: SourceStatusRow }) {
  const errors = source.health.filter(part => part.state === 'error')
  return <div className="wb-sourcecard">
    <div className="wb-sourcehead"><Dot tone={sourceTone(source.state)} /><b>{source.title.zh}</b>
      <span className={`wb-sourcechip ${source.state}`}>{sourceLabel[source.state]}</span></div>
    <div className="wb-sourcemeta">24 小时：收到 {source.stats.received} · 过滤 {source.stats.filtered} · 丢弃 {source.dropped.length}
      {source.stats.lastAt ? ` · 最近 ${time(source.stats.lastAt)}` : ''}</div>
    {errors.length ? <div className="wb-sourceerror">{errors.map(part => <p key={part.name}>{part.detail || part.name}</p>)}</div> : null}
  </div>
}

export function RuntimeStatus() {
  const { call } = usePanel()
  const { state, setup } = usePanelData()
  const { data: sources, error: sourceError } = usePoll(() => call('GET sources'), [call], 10000)
  const { data: overview, error: overviewError } = usePoll(() => call('GET overview'), [call], 10000)
  const { data: catalog } = usePoll(() => call('GET models'), [call], 30000)
  const flow = overview?.flow
  const executor = overview?.executor
  const problems = overview?.problems ?? []
  const model = catalog?.default
  const modelHealth = state?.health.models
  return <div className="wb-runtime">
    <div className="wb-runtimegrid">
      <section className="wb-card">
        <h2>执行</h2><div className="sub">当前实例的 Worker 与主 Session</div>
        <div className="wb-settingrow"><span>主 Session</span><b>{state?.masterId ? '已就绪' : '未就绪'}</b></div>
        <div className="wb-settingrow"><span>暂停处理</span><b>{state?.paused ? '是' : '否'}</b></div>
        <div className="wb-settingrow"><span>执行中</span><b>{state?.load.running ?? 0} / {state?.load.maxWorkers ?? 0}</b></div>
        <div className="wb-settingrow"><span>排队 / 空闲</span><b>{state?.load.queued ?? 0} / {executor?.idle ?? 0}</b></div>
        <div className="wb-settingrow"><span>stateDir</span><b>{setup?.machine?.stateDir ?? '—'}</b></div>
      </section>
      <section className="wb-card">
        <h2>24 小时流转</h2><div className="sub">从消息进入，到评估和触发</div>
        <div className="wb-settingrow"><span>收到 / 过滤</span><b>{flow?.received ?? 0} / {flow?.filtered ?? 0}</b></div>
        <div className="wb-settingrow"><span>触发</span><b>{flow?.triggers ?? 0}</b></div>
        <div className="wb-settingrow"><span>评估 / 接受</span><b>{flow?.judged ?? 0} / {flow?.accepted ?? 0}</b></div>
        <div className="wb-settingrow"><span>正在评估 / 丢弃</span><b>{flow?.evaluating ?? 0} / {flow?.dropped ?? 0}</b></div>
        <div className="wb-settingrow"><span>Policy 版本</span><b>{overview?.policyVersion ? overview.policyVersion.slice(0, 8) : '—'}</b></div>
      </section>
      <section className="wb-card">
        <h2>模型与凭据</h2><div className="sub">主 Session 使用 DSH 已配置的 provider</div>
        <div className="wb-settingrow"><span>默认模型</span><b>{model ? `${model.provider} / ${model.model}` : '未配置'}</b></div>
        <div className="wb-settingrow"><span>模型健康</span><b>{modelHealth ? modelHealth.state === 'error' ? '异常' : modelHealth.state === 'starting' ? '启动中' : '正常' : '—'}</b></div>
        {modelHealth?.state === 'error' ? <p className="wb-cardnote error">{modelHealth.detail}</p> : null}
        <p className="wb-cardnote">凭据在 DSH 设置 → 模型中配置；工作台不会显示或保存 API Key。Worker 和评估模型可分别在「执行」「评估」中覆盖。</p>
      </section>
      <section className="wb-card">
        <h2>来源</h2><div className="sub">{sources?.length ?? 0} 个来源实例</div>
        {sourceError ? <p className="wb-error">{sourceError.message}</p> : null}
        {!sources ? <p className="wb-empty">正在读取来源状态…</p> : sources.length ? sources.map(source => <SourceCard key={source.id} source={source} />)
          : <p className="wb-empty">还没有配置来源。</p>}
      </section>
    </div>
    <section className="wb-section">
      <div className="wb-sectionhead"><h2>运行问题</h2><span className="hint">{problems.length ? `${problems.length} 项` : '没有发现'}</span></div>
      {overviewError ? <p className="wb-error">{overviewError.message}</p> : null}
      {problems.length ? problems.slice(0, 10).map((problem, index) => <div className="wb-run" key={`${problem.kind}:${index}`}>
        <Dot tone={problem.kind === 'executor-paused' ? 'idle' : 'block'} />
        <span className="wb-runmain"><span className="wb-runtitle">{problemTitle[problem.kind] ?? problem.kind}</span>
          <span className="wb-runmeta">{problemDetail(problem) || problemHint[problem.kind] || '需要处理'}</span></span>
      </div>) : <p className="wb-empty">运行状态正常。</p>}
      {problems.length > 10 ? <p className="wb-hintline">还有 {problems.length - 10} 项，先处理上面的。</p> : null}
    </section>
  </div>
}
