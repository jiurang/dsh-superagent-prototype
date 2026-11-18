/** Browser plugin entry point: the workbench panels in the DSH sidebar, their main views, and the Plugin Manager config view. */
import { useCallback, useEffect, useRef } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { SidebarFooterActionOwnerProps, SidebarPanelIconOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { PluginConfigViewProps } from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { openKnownSession, SessionNavigationError } from '../navigation.ts'
import { PluginConfig, usePageForm } from './deployment.tsx'
import { en, zh } from './locales.ts'
import { PanelProvider } from './provider.tsx'
import type { T } from './text.ts'
import type { WorkbenchView } from './xg/v2/navigation.ts'
import { SidebarBadge } from './xg/v2/SidebarBadge.tsx'
import { Workbench } from './xg/v2/Workbench.tsx'

type ClientContext = Context & { sessions: ISessions }
const NS = 'dshSuperagent'
/** Kept as an alias so a layout that still points at the old single panel opens Today. */
const PANEL_ALIAS = 'dsh-superagent' as MainPanelId
const SETTINGS_PANEL = 'xg-settings' as MainPanelId
const ENTRY = 'dsh-superagent'

function iconProps(size: number) {
  return { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7,
    strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true }
}
function TodayIcon({ size }: SidebarPanelIconOwnerProps) {
  return <svg {...iconProps(size)}><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
}
function WorkIcon({ size }: SidebarPanelIconOwnerProps) {
  return <svg {...iconProps(size)}><path d="M4 7h16M4 12h16M4 17h10"/></svg>
}
function InboxIcon({ size }: SidebarPanelIconOwnerProps) {
  return <svg {...iconProps(size)}><path d="M4 13h4l2 3h4l2-3h4"/><path d="M5 5h14l1 8v6H4v-6z"/></svg>
}
function KnowledgeIcon({ size }: SidebarPanelIconOwnerProps) {
  return <svg {...iconProps(size)}><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v18H6.5A2.5 2.5 0 0 1 4 18.5z"/><path d="M8 7h8M8 11h6"/></svg>
}

/** The four workbench entries the DSH sidebar owns. Settings is reached from the panel header. */
const SIDEBAR_PANELS = [
  { id: 'xg-today' as MainPanelId, view: 'today' as WorkbenchView, labelKey: 'panelToday' as const, order: 1, Icon: TodayIcon },
  { id: 'xg-work' as MainPanelId, view: 'work' as WorkbenchView, labelKey: 'panelWork' as const, order: 2, Icon: WorkIcon },
  { id: 'xg-inbox' as MainPanelId, view: 'inbox' as WorkbenchView, labelKey: 'panelInbox' as const, order: 3, Icon: InboxIcon },
  { id: 'xg-knowledge' as MainPanelId, view: 'knowledge' as WorkbenchView, labelKey: 'panelKnowledge' as const, order: 4, Icon: KnowledgeIcon },
] as const

const PANEL_VIEWS: Record<WorkbenchView, MainPanelId> = {
  today: SIDEBAR_PANELS[0].id,
  work: SIDEBAR_PANELS[1].id,
  inbox: SIDEBAR_PANELS[2].id,
  knowledge: SIDEBAR_PANELS[3].id,
  settings: SETTINGS_PANEL,
}

/** Mounted panel wrapper; cancels any pending Session navigation when a new one starts or the panel unmounts. */
function Mounted({ ctx, t, view }: { ctx: ClientContext; t: T; view: WorkbenchView }) {
  const pending = useRef<AbortController>(undefined)
  useEffect(() => () => { pending.current?.abort() }, [])
  const openSession = useCallback(async (id: string) => {
    pending.current?.abort()
    const request = new AbortController(); pending.current = request
    try {
      await openKnownSession(ctx.sessions, id as SessionId, target => { ctx.uiWorkspace.openSession(target) }, request.signal)
    } catch (error) {
      if (error instanceof SessionNavigationError) throw new Error(t(error.code === 'not-ready' ? 'sessionListNotReady' : 'sessionNotListed'))
      throw error
    }
  }, [ctx, t])
  const openPanel = useCallback((next: WorkbenchView) => { ctx.layout.selectPanel(PANEL_VIEWS[next]) }, [ctx])
  const form = usePageForm(ctx.get('configForms')?.get<Record<string, unknown>>(ENTRY))
  return <PanelProvider t={t} openSession={openSession}>
    <Workbench view={view} deploymentForm={form} onNavigate={openPanel} />
  </PanelProvider>
}

export const inject = ['slots', 'locale', 'sessions', 'uiWorkspace', 'layout']
/** Registers the four workbench panels, their DSH sidebar entries, and the Plugin Manager config view. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-superagent: dictionaries')
  const t = ctx.locale.bind(NS)
  ctx.slots.inject('main', () => {
    const panels: { id: MainPanelId; view: WorkbenchView }[] = [
      ...SIDEBAR_PANELS.map(panel => ({ id: panel.id, view: panel.view })),
      { id: SETTINGS_PANEL, view: 'settings' },
      { id: PANEL_ALIAS, view: 'today' },
    ]
    const disposers = panels.map(panel => ctx.slots.register({ name: 'main', key: panel.id, locale: NS, inject: () => ({}) },
      (props: { t: T }) => <Mounted ctx={ctx} t={props.t} view={panel.view} />))
    return () => { for (const dispose of disposers) dispose() }
  })
  ctx.slots.inject('sidebar.panellist', () => {
    const disposers = SIDEBAR_PANELS.map(panel => ctx.slots.register({ name: 'sidebar.panellist', id: panel.id, order: panel.order,
      label: () => t(panel.labelKey), locale: NS }, panel.Icon))
    return () => { for (const dispose of disposers) dispose() }
  })
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({ name: 'sidebar.footer.action', id: 'xg-attention', order: 1,
    locale: NS, inject: () => ({}) }, (props: SidebarFooterActionOwnerProps) =>
    <SidebarBadge wide={props.wide} onOpen={() => ctx.layout.selectPanel(PANEL_VIEWS.today)} />))
  ctx.slots.inject('plugins.row.config', () => ctx.slots.register({ name: 'plugins.row.config', key: `${ENTRY}#${ENTRY}`, locale: NS },
    (props: PluginConfigViewProps & { t: T }) => <PluginConfig t={props.t} view={props.view} form={props.form} />))
}
