/** Source settings cards, extracted from the old Source status page for the v2 settings panel. */
import { useEffect, useState } from 'react'
import type { FieldSpec } from '../../../../sources/kind.ts'
import type { SourceView } from '../../../api.ts'
import { DisclosureRow, Icon, InfoTip, Switch, Tag } from '../../../controls.tsx'
import { SaveBar } from '../../../draft.tsx'
import { usePanel, usePanelData } from '../../../provider.tsx'
import { ConfigHistory, Fields, SourceField, useBlockDraft, useSettings } from '../../../settings-kit.tsx'
import { localized } from '../../../text.ts'
import { CheckSetupButton, Hint, SetupMessage } from '../../../widgets.tsx'

function SourceCard({ source }: { source: SourceView }) {
  const { t, call } = usePanel()
  const { running } = usePanelData()
  const { reload } = useSettings()
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const refreshLabels = async () => { const { added } = await call('POST sources/:id/labels',
    { id: source.id }); await reload(); return added }
  const draft = useBlockDraft(`source:${source.id}`, source.value, source.revision)
  const value = draft.value
  const { problem, value: saved } = source
  const changed = (key: string) => String(value.config[key] ?? '') !== String(saved.config[key] ?? '')
  // Saving a modified setup-sensitive field restarts dsh-superagent, interrupting running Assignments.
  const restarts = draft.dirty && source.restarts.some(changed)
  const description = localized(t, source.description)
  // Hide derived facts for unsaved field edits until the new value is saved.
  const field = (spec: FieldSpec) => <SourceField key={spec.key} field={spec} value={value.config[spec.key]} saved={saved.config[spec.key]}
    labels={source.labels}
    refreshLabels={refreshLabels} fact={spec.type === 'fact' || !changed(spec.key) ? source.facts[spec.key] : undefined}
    onChange={next => draft.edit({ ...value, config: { ...value.config, [spec.key]: next } })} />
  const advanced = source.fields.filter(spec => spec.advanced)
  return <form id={`dt-source-${source.id}`} className="dt-card" onSubmit={event => { void draft.submit(event) }}>
    <Fields disabled={draft.busy}>
      <div className="dt-card-head">
        <div className="dt-row-main">
          <div className="dt-row-title">
            <span className="dt-card-title">{localized(t, source.title)}</span>{description && <InfoTip text={description} />}
            {!source.installed && <Tag tone="warning">{t('sourceNotInstalled')}</Tag>}
          </div>
        </div>
        {source.installed && <Switch checked={value.enabled} onChange={enabled => draft.edit({ ...value, enabled })}
          label={t('sourceEnable', { name: localized(t, source.title) })} />}
      </div>
      {problem && <div className="dt-row-buttons">
        <p className="dt-error" role="status"><SetupMessage problem={problem} lead /></p><CheckSetupButton />
      </div>}
      {!source.installed && <Hint>{t('sourceNotInstalledHint')}</Hint>}
      {source.installed && source.fields.filter(spec => !spec.advanced).map(field)}
      {source.installed && advanced.length > 0 && <DisclosureRow icon={<Icon name="settings" />} title={t('advanced')} open={advancedOpen}
        onToggle={() => setAdvancedOpen(!advancedOpen)}>
        <div className="dt-disclosure-body">{advanced.map(field)}</div>
      </DisclosureRow>}
    </Fields>
    <SaveBar {...draft} status={restarts && running > 0 ? t('restartInterrupts', { count: running }) : undefined}
      onDiscard={draft.discard} />
  </form>
}

export function SourceSettings({ focus }: { focus?: string }) {
  const { sources } = useSettings().settings
  useEffect(() => { if (focus) document.getElementById(`dt-source-${focus}`)?.scrollIntoView?.({ block: 'start' }) }, [focus])
  return <div className="dt-form">
    {sources.map(source => <SourceCard key={source.id} source={source} />)}
    <ConfigHistory blocks={['source:']} />
  </div>
}
