/** Project-level settings: only the selected project; system settings stay in the instance settings. */
import { useEffect, useState } from 'react'
import type { Project, ProjectSettings } from '../../xg/domain.ts'
import { Button, Input } from '../controls.tsx'
import { Field, ModelField } from '../settings-kit.tsx'
import { xgGet, xgPost } from './client.ts'
import { rememberProject, rememberedProject } from './scope.ts'

type Model = { provider: string; model: string; reasoningEffort?: string }

/** A project selector plus its root, sensitivity, routing defaults and optional Worker model override. */
export function ProjectSettingsPage() {
  const [projects, setProjects] = useState<Project[]>([])
  const [projectId, setProjectId] = useState('')
  const [project, setProject] = useState<Project>()
  const [settings, setSettings] = useState<ProjectSettings>()
  const [rootPath, setRootPath] = useState('')
  const [sensitivity, setSensitivity] = useState<Project['sensitivity']>('内部')
  const [priority, setPriority] = useState<ProjectSettings['defaultPriority']>(null)
  const [autoDispatch, setAutoDispatch] = useState(false)
  const [model, setModel] = useState<Model | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let live = true
    xgGet('/projects').then(data => {
      if (!live) return
      setProjects(data.items)
      setProjectId(current => current || (() => {
        const remembered = rememberedProject()
        return data.items.some(item => item.id === remembered) ? remembered : data.items[0]?.id ?? ''
      })())
      setLoading(false)
    }, failure => { if (live) { setError(failure.message); setLoading(false) } })
    return () => { live = false }
  }, [])

  useEffect(() => {
    if (!projectId) return
    let live = true
    setLoading(true); setError(undefined)
    xgGet('/projects/:id/settings', { params: { id: projectId } }).then(data => {
      if (!live) return
      setProject(data.project); setSettings(data.settings)
      setRootPath(data.project.rootPath ?? '')
      setSensitivity(data.project.sensitivity)
      setPriority(data.settings.defaultPriority)
      setAutoDispatch(data.settings.autoDispatch)
      setModel(data.settings.workerProvider && data.settings.workerModel ? { provider: data.settings.workerProvider,
        model: data.settings.workerModel, ...(data.settings.workerEffort ? { reasoningEffort: data.settings.workerEffort } : {}) } : null)
      setLoading(false)
    }, failure => { if (live) { setError(failure.message); setLoading(false) } })
    return () => { live = false }
  }, [projectId])

  const save = async () => {
    if (!projectId) return
    setBusy(true); setSaved(false); setError(undefined)
    try {
      const data = await xgPost('/projects/:id/settings', { rootPath: rootPath.trim() || null, sensitivity,
        workerModel: model, autoDispatch, defaultPriority: priority }, { params: { id: projectId } })
      setProject(data.project); setSettings(data.settings); setSaved(true)
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { setBusy(false) }
  }

  return <div className="dt-column">
    <section className="dt-section">
      <h2 className="dt-section-title">项目设置</h2>
      <p className="dt-hint">项目级设置只影响当前项目；模型服务商、密钥、端口、stateDir、备份等共享配置在左侧「系统设置」。</p>
      <Field label="选择项目"><select className="dt-select" value={projectId} onChange={event => { setProjectId(event.target.value); rememberProject(event.target.value); setSaved(false) }}>
        {!projects.length && <option value="">暂无项目</option>}
        {projects.map(item => <option key={item.id} value={item.id}>{item.shortCode} · {item.name}</option>)}
      </select></Field>
      {loading && <p className="dt-hint">正在读取项目设置…</p>}
      {error && <p className="dt-error" role="alert">{error}</p>}
      {project && settings && !loading && <>
        <div className="dt-grid3">
          <Field label="项目短码"><Input value={project.shortCode} readOnly /></Field>
          <Field label="敏感级别"><select className="dt-select" value={sensitivity}
            onChange={event => setSensitivity(event.target.value as Project['sensitivity'])}>
            <option value="公开">公开</option><option value="内部">内部</option><option value="机密">机密</option>
          </select></Field>
          <Field label="默认优先级"><select className="dt-select" value={priority ?? ''}
            onChange={event => setPriority((event.target.value || null) as ProjectSettings['defaultPriority'])}>
            <option value="">继承系统默认</option>
            {['P0', 'P1', 'P2', 'P3'].map(value => <option key={value} value={value}>{value}</option>)}
          </select></Field>
        </div>
        <Field label="本地项目根目录" hint="Worker 直接在这个目录工作；留空则使用「系统设置 → 来源 → 本地」的根目录">
          <Input value={rootPath} placeholder="例如 G:/Projects/center-app" onChange={event => { setRootPath(event.target.value); setSaved(false) }} />
        </Field>
        <label className="dt-field"><span>新任务默认自动派发</span>
          <input type="checkbox" checked={autoDispatch} onChange={event => { setAutoDispatch(event.target.checked); setSaved(false) }} />
        </label>
        <Field label="项目 Worker 模型（可选）" hint="留空继承系统设置里的执行器模型；这里只覆盖这个项目的 Worker">
          <ModelField id={`xg-project-model-${project.id}`} value={model} onChange={next => { setModel(next); setSaved(false) }} />
        </Field>
        <div className="dt-actions">
          <Button variant="primary" disabled={busy} onClick={() => { void save() }}>{busy ? '保存中…' : '保存项目设置'}</Button>
          {saved && <span className="dt-hint">已保存</span>}
        </div>
      </>}
    </section>
  </div>
}
