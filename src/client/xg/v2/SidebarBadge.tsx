/** Sidebar footer action: total workbench items that need a person; opens Today. */
import { usePoll } from '../../api.ts'
import { xgGet } from '../client.ts'

export function SidebarBadge({ wide, onOpen }: { wide: boolean; onOpen: () => void }) {
  const { data } = usePoll(() => xgGet('/workbench'), [], 30000)
  if (!data) return null
  const count = data.requirements.filter(requirement => requirement.status === '待确认').length
    + data.tasks.filter(task => task.status === '待验收' || task.status === '阻塞' || task.status === '就绪').length
    + data.inbox.filter(item => item.status === '未处理').length
    + data.memory.filter(entry => entry.status === '待复核').length
  if (!count) return null
  return <button type="button" onClick={onOpen} title={`${count} 项需要你处理`} aria-label={`${count} 项需要你处理`} style={{
    display: 'flex', alignItems: 'center', justifyContent: wide ? 'flex-start' : 'center', gap: 6,
    width: wide ? '100%' : 'auto', padding: wide ? '6px 8px' : '6px', border: '1px solid var(--dsw-alias-border-l3, #e5e5e5)',
    borderRadius: 7, background: 'transparent', color: 'var(--dsw-alias-label-secondary, #5f5f5f)', fontSize: 11, cursor: 'pointer',
  }}>
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 16, height: 16, padding: '0 4px',
      borderRadius: 8, background: 'var(--dsw-alias-state-warn-primary, #b45309)', color: '#fff', fontSize: 9, fontWeight: 600, lineHeight: 1,
    }}>{count > 99 ? '99+' : count}</span>
    {wide ? <span>需要你</span> : null}
  </button>
}
