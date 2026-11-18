/** Project context remembered across tabs; storage is convenience only, never a source of truth. */
export const PROJECT_KEY = 'xg-workbench.project'

export function rememberedProject(): string {
  try { return sessionStorage.getItem(PROJECT_KEY) ?? '' } catch { return '' }
}

export function rememberProject(id: string): void {
  try { sessionStorage.setItem(PROJECT_KEY, id) } catch { /* private mode / blocked storage */ }
}
