/** Shared navigation state for the five workbench main panels addressed from the DSH sidebar. */
export type WorkbenchView = 'today' | 'work' | 'inbox' | 'knowledge' | 'settings'

export interface WorkbenchSelection {
  kind: 'requirement' | 'task'
  id: string
}

interface ViewState {
  /** The work document to open when the Work panel mounts or is revisited. */
  selection?: WorkbenchSelection | null
  /** The inbox item to open when the Inbox panel mounts or is revisited. */
  inboxId?: string | null
}

const states: Record<WorkbenchView, ViewState> = {
  today: {}, work: {}, inbox: {}, knowledge: {}, settings: {},
}
const listeners = new Set<() => void>()

export function readViewState(view: WorkbenchView): ViewState {
  return states[view]
}

export function updateViewState(view: WorkbenchView, patch: ViewState): void {
  states[view] = { ...states[view], ...patch }
  for (const listener of listeners) listener()
}

export function subscribeViewState(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
