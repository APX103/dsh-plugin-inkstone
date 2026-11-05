/**
 * The academic search settings card: source toggles for the aggregate tool
 * and the optional polite-pool mailto, rendered as one standalone settings
 * section beside the Remote and Local Inkstone sections.
 *
 * @module dsh-plugin-inkstone/client/client/AcadSearchCard
 */

import type { ReactNode } from 'react'
import { useEffect, useId, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './A2aCard.module.css'
import type { AcadSearchState } from './acadsearch-card-controller'

/** The merged inject face of the academic search section. */
export interface AcadSearchSlotFace {
  hooks: { acadSearch: import('@deepseek-ai/dsh-client-store').SnapshotStore<AcadSearchState> }
  /** Toggle one aggregate source. */
  toggleSource(id: 'arxiv' | 'crossref' | 'openalex' | 'pubmed' | 'europepmc' | 'biorxiv', enabled: boolean): Promise<void>
  /** Update the draft mailto. */
  setMailto(value: string): void
  /** Update the draft OpenAlex premium key. */
  setOpenAlexKey(value: string): void
  /** Update the draft NCBI API key. */
  setNcbiKey(value: string): void
  /** Commit mailto and keys; resolves false when the Host refused. */
  saveAcad(): Promise<boolean>
}

/** Framework-derived props for the academic search settings section. */
export type AcadSearchCardProps = PropsRuntime<'settings.section'>
  & PropsLocale<'settings.a2a'> & InjectFace<AcadSearchSlotFace>

type AcadLocale = AcadSearchCardProps['t']

/** Labels for the bundled sources. */
function sourceLabel(t: AcadLocale, id: 'arxiv' | 'crossref' | 'openalex' | 'pubmed' | 'europepmc' | 'biorxiv'): string {
  switch (id) {
    case 'arxiv': return t('sourceArxiv')
    case 'crossref': return t('sourceCrossref')
    case 'openalex': return t('sourceOpenalex')
    case 'pubmed': return t('sourcePubmed')
    case 'europepmc': return t('sourceEuropepmc')
    default: return t('sourceBiorxiv')
  }
}

/**
 * Render the academic search configuration card.
 * @param props - Locale, state hooks, and actions.
 * @returns The section content.
 */
export function AcadSearchCard(props: AcadSearchCardProps): ReactNode {
  const { t } = props
  const state = props.useAcadSearch(snapshot => snapshot)
  const headingId = useId()
  const [saved, setSaved] = useState(false)
  useEffect(() => {
    if (!saved) return
    const timer = window.setTimeout(() => { setSaved(false) }, 2500)
    return () => { window.clearTimeout(timer) }
  }, [saved])
  const errorText = state.error === 'rejected'
    ? t('acadRejected')
    : state.error === 'readonly'
      ? t('acadReadonly')
      : state.error
  return (
    <div className={css.section}>
      {errorText !== null ? <p className={css.error} role="alert">{t('errorPrefix')}: {errorText}</p> : null}
      <section className={css.card} aria-labelledby={headingId}>
        <h3 className={css.cardTitle} id={headingId}>{t('acadSources')}</h3>
        <p className={css.hint}>{t('acadSummary')}</p>
        {state.status !== 'ready'
          ? <p>{state.status === 'loading' ? '…' : t('acadUnavailable')}</p>
          : (
              <>
                <div className={css.rows}>
                  {state.sources.map(row => (
                    <label key={row.id} className={css.row}>
                      <input
                        type="checkbox"
                        checked={row.enabled}
                        disabled={state.busy}
                        onChange={event => { void props.toggleSource(row.id, event.target.checked) }}
                      />
                      <span className={css.rowName}>{sourceLabel(t, row.id)}</span>
                    </label>
                  ))}
                </div>
                <form
                  className={css.fields}
                  onSubmit={event => {
                    event.preventDefault()
                    void props.saveAcad().then(ok => { setSaved(ok) })
                  }}
                >
                  <label className={css.field}>
                    <span>{t('acadMailto')}</span>
                    <Input
                      value={state.mailto}
                      onChange={(event) => { props.setMailto(event.target.value) }}
                      placeholder={t('acadMailtoHint')}
                      autoComplete="off"
                      type="email"
                    />
                  </label>
                  <label className={css.field}>
                    <span>{t('acadOpenAlexKey')}</span>
                    <Input
                      value={state.openalexApiKey}
                      onChange={(event) => { props.setOpenAlexKey(event.target.value) }}
                      placeholder={t('acadOpenAlexKeyHint')}
                      autoComplete="off"
                      type="password"
                    />
                  </label>
                  <label className={css.field}>
                    <span>{t('acadNcbiKey')}</span>
                    <Input
                      value={state.ncbiApiKey}
                      onChange={(event) => { props.setNcbiKey(event.target.value) }}
                      placeholder={t('acadNcbiKeyHint')}
                      autoComplete="off"
                      type="password"
                    />
                  </label>
                  <div className={css.fieldActions}>
                    <Button size="sm" variant="primary" type="submit" disabled={state.busy}>{t('acadSave')}</Button>
                    {saved ? <span className={css.hint}>{t('acadSaved')}</span> : null}
                  </div>
                </form>
              </>
            )}
      </section>
    </div>
  )
}
