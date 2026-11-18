/** Workbench settings: the old settings forms, embedded in v2, plus a read-only diagnostics view. */
import { useState } from 'react'
import type { AuditEntry } from '../../../xg/domain.ts'
import type { DeploymentForm } from '../../deployment.tsx'
import { DeploymentPage } from '../../deployment.tsx'
import { PromptsPage } from '../../prompts.tsx'
import { usePanel, usePanelData } from '../../provider.tsx'
import { SettingsProvider } from '../../settings-kit.tsx'
import { ProjectSettingsPage } from '../project-settings.tsx'
import { EvalSettings } from './settings/EvalSettings.tsx'
import { ExecutionSettings } from './settings/ExecutionSettings.tsx'
import { SourceSettings } from './settings/SourceSettings.tsx'

type SettingsTab = 'source' | 'eval' | 'execution' | 'prompts' | 'deployment' | 'project' | 'diagnostics'
const TABS: { id: SettingsTab; label: string }[] = [
  { id: 'source', label: '来源' },
  { id: 'eval', label: '评估' },
  { id: 'execution', label: '执行' },
  { id: 'prompts', label: '提示词' },
  { id: 'deployment', label: '部署' },
  { id: 'project', label: '项目' },
  { id: 'diagnostics', label: '诊断' },
]

const errorText = (value: unknown): string => value instanceof Error ? value.message : String(value)
const time = (value: string): string => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

export function SettingsPanel({ deploymentForm, audit }: { deploymentForm: DeploymentForm; audit: AuditEntry[] }) {
  const { openSession } = usePanel()
  const { state } = usePanelData()
  const [tab, setTab] = useState<SettingsTab>('source')
  const [toast, setToast] = useState<string>()
  const setup = state?.setup
  const openMaster = () => {
    if (!state?.masterId) { setToast('主 Session 还没准备好'); return }
    void openSession(state.masterId).catch(failure => setToast(errorText(failure)))
  }

  const content = (() => {
    if (tab === 'source') return <SettingsProvider><SourceSettings /></SettingsProvider>
    if (tab === 'eval') return <SettingsProvider><EvalSettings /></SettingsProvider>
    if (tab === 'execution') return <SettingsProvider><ExecutionSettings /></SettingsProvider>
    if (tab === 'prompts') return <PromptsPage />
    if (tab === 'deployment') return setup ? <DeploymentPage setup={setup} form={deploymentForm} /> : <p className="wb-empty">正在读取部署信息…</p>
    if (tab === 'project') return <ProjectSettingsPage />
    return <div className="wb-diagnostics">
      <div className="wb-settings">
        <section className="wb-card">
          <h2>运行</h2><div className="sub">当前实例</div>
          <div className="wb-settingrow"><span>主 Session</span><b>{state?.masterId ?? '未就绪'}</b></div>
          <div className="wb-settingrow"><span>暂停处理</span><b>{state?.paused ? '是' : '否'}</b></div>
          <div className="wb-settingrow"><span>执行中</span><b>{state?.load.running ?? 0} / {state?.load.maxWorkers ?? 0}</b></div>
          <div className="wb-settingrow"><span>排队</span><b>{state?.load.queued ?? 0}</b></div>
          <div className="wb-settingrow"><span>stateDir</span><b>{setup?.machine?.stateDir ?? '—'}</b></div>
        </section>
        <section className="wb-card">
          <h2>诊断入口</h2><div className="sub">详细 Ticket / Attempt 仍在任务文档里</div>
          <div className="wb-settingrow"><span>任务文档</span><b>工作 → 任务 → 执行记录 / 证据 / 时间线</b></div>
          <div className="wb-settingrow"><span>审计</span><b>下方最近 {Math.min(audit.length, 50)} 条</b></div>
          <div className="wb-formactions" style={{ marginTop: 10 }}>
            <button className="wb-btn wb-btn-outline wb-btn-sm" onClick={openMaster}>打开主 Session</button>
          </div>
        </section>
      </div>
      <section className="wb-section">
        <div className="wb-sectionhead"><h2>审计</h2><span className="hint">最近 50 条</span></div>
        {audit.length ? audit.slice(0, 50).map(entry => <div className="wb-run" key={entry.id}>
          <span className="wb-dot idle" />
          <span className="wb-runmain"><span className="wb-runtitle">{entry.action}</span>
            <span className="wb-runmeta">{entry.actor ?? '系统'} · {entry.entityType} {entry.entityId}</span></span>
          <span className="wb-runtime">{time(entry.createdAt)}</span>
        </div>) : <p className="wb-empty">还没有审计记录。</p>}
      </section>
    </div>
  })()

  return <div className="wb-settings-page">
    <div className="wb-pagehead">
      <div><div className="wb-kicker">设置 · 全部项目</div><h1>工作台设置</h1><p>来源、评估、执行、提示词、部署和项目设置都在这里；诊断保留审计和运行状态。</p></div>
      <div className="wb-headstat"><b>{state?.load.running ?? 0}</b>执行中</div>
    </div>
    <div className="wb-filterbar"><div className="wb-filters">
      {TABS.map(item => <button key={item.id} className={`wb-filter ${tab === item.id ? 'active' : ''}`}
        onClick={() => setTab(item.id)}>{item.label}</button>)}
    </div></div>
    <div className="wb-settings-body">{content}</div>
    {toast ? <div className="wb-toast show">{toast}</div> : null}
  </div>
}
