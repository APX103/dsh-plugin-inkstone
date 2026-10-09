/** The A2A agents settings section. */

import type { ReactNode } from 'react'
import { useId, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Button, Input, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { A2aCardFace, A2aCardState } from './a2a-card-controller'
import css from './A2aCard.module.css'

/** Framework-derived props for the A2A agents settings section. */
export type A2aCardProps = PropsRuntime<'settings.section'>
  & PropsLocale<'settings.a2a'> & InjectFace<A2aCardFace>

/** Format one token expiry instant as a short locale string. */
function expiryText(expiresAtMs: number): string {
  return new Date(expiresAtMs).toLocaleTimeString()
}

/**
 * Render the registry sign-in, the directory, and the delegation roster.
 * @param props - Locale, the section snapshot, and the section actions.
 * @returns The section content.
 */
export function A2aCard(props: A2aCardProps) {
  const { t } = props
  const state = props.useA2aCard(snapshot => snapshot)
  const headingId = useId()
  const [ak, setAk] = useState('')
  const [sk, setSk] = useState('')
  const [editing, setEditing] = useState(false)
  const busy = state.busy !== null || state.rosterBusy
  const directoryBusy = busy || state.directoryLoading
  return (
    <div className={css.section}>
      {state.error !== null ? <p className={css.error} role="alert">{t('errorPrefix')}: {state.error}</p> : null}
      <section className={css.card} aria-labelledby={`${headingId}-sso`}>
        <h3 className={css.cardTitle} id={`${headingId}-sso`}>{t('ssoTitle')}</h3>
        <SsoFacts t={t} state={state} />
        {state.login?.configured === true && !editing
          ? (
            <div className={css.fields}>
              <label className={css.field}>
                <span>{t('akLabel')}</span>
                <Input value="········" readOnly disabled />
              </label>
              <label className={css.field}>
                <span>{t('skLabel')}</span>
                <Input value="········" readOnly disabled />
              </label>
              <div className={css.fieldActions}>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => { setEditing(true) }}>{t('ssoModify')}</Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => { void props.signOut() }}>{t('signOut')}</Button>
              </div>
            </div>
          )
          : state.login?.configured === true && editing
            ? (
              <form className={css.fields} onSubmit={(event) => {
                event.preventDefault()
                void props.signIn(ak, sk).then((ok) => {
                  if (!ok) return
                  setAk('')
                  setSk('')
                  setEditing(false)
                })
              }}>
                <label className={css.field}>
                  <span>{t('akLabel')}</span>
                  <Input value={ak} onChange={(event) => { setAk(event.target.value) }} autoComplete="off" />
                </label>
                <label className={css.field}>
                  <span>{t('skLabel')}</span>
                  <Input value={sk} onChange={(event) => { setSk(event.target.value) }} type="password" autoComplete="off" />
                </label>
                <div className={css.fieldActions}>
                  <Button size="sm" variant="primary" type="submit" disabled={busy || ak === '' || sk === ''}>{t('ssoSave')}</Button>
                  <Button size="sm" variant="ghost" type="button" disabled={busy} onClick={() => { setEditing(false) }}>{t('ssoCancel')}</Button>
                </div>
              </form>
            )
            : (
              <form className={css.fields} onSubmit={(event) => {
                event.preventDefault()
                void props.signIn(ak, sk)
              }}>
                <label className={css.field}>
                  <span>{t('akLabel')}</span>
                  <Input value={ak} onChange={(event) => { setAk(event.target.value) }} autoComplete="off" />
                </label>
                <label className={css.field}>
                  <span>{t('skLabel')}</span>
                  <Input value={sk} onChange={(event) => { setSk(event.target.value) }} type="password" autoComplete="off" />
                </label>
                <div className={css.fieldActions}>
                  <Button size="sm" variant="primary" type="submit" disabled={busy || ak === '' || sk === ''}>{t('signIn')}</Button>
                </div>
              </form>
            )}
      </section>
      <section className={css.card} aria-labelledby={`${headingId}-directory`}>
        <div className={css.cardHead}>
          <h3 className={css.cardTitle} id={`${headingId}-directory`}>{t('directoryTitle')}</h3>
          <Button size="sm" variant="outline" disabled={directoryBusy || state.login?.configured !== true} onClick={() => { void props.loadDirectory() }}>
            {t('directoryRefresh')}
          </Button>
        </div>
        {state.directory.length === 0
          ? <p className={css.hint}>{state.directoryLoading ? t('loading') : t('directoryEmpty')}</p>
          : <ul className={css.rows}>
            {state.directory.map(row => (
              <AgentRow key={row.name} name={row.name} scheme={row.authScheme} description={row.description}
                added={state.roster.some(entry => entry.name === row.name)}
                actions={added => added
                  ? <Tag tone="neutral">{t('inRoster')}</Tag>
                  : (
                    <Button size="sm" variant="outline" disabled={busy || state.rosterStatus !== 'ready'} onClick={() => { void props.addToRoster(row) }}>
                      {t('addToRoster')}
                    </Button>
                  )}
              />
            ))}
          </ul>}
      </section>
      <section className={css.card} aria-labelledby={`${headingId}-roster`}>
        <h3 className={css.cardTitle} id={`${headingId}-roster`}>{t('rosterTitle')}</h3>
        {state.rosterStatus !== 'ready'
          ? <p className={css.hint}>{state.rosterStatus === 'loading' ? t('loading') : t('rosterUnavailable')}</p>
          : state.roster.length === 0
            ? <p className={css.hint}>{t('rosterEmpty')}</p>
            : <ul className={css.rows}>
              {state.roster.map(row => (
                <AgentRow key={row.name} name={row.name} scheme={row.authScheme} description={row.description} added={false}
                  actions={() => (
                    <>
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => { void props.setRosterEnabled(row.name, !row.enabled) }}>
                        {row.enabled ? t('rosterDisable') : t('rosterEnable')}
                      </Button>
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => { void props.removeFromRoster(row.name) }}>
                        {t('rosterRemove')}
                      </Button>
                    </>
                  )}
                />
              ))}
            </ul>}
      </section>
    </div>
  )
}

type CardLocale = A2aCardProps['t']

/**
 * One directory or roster agent row: identity, scheme tag, description, and
 * the caller-supplied trailing action.
 * @param props - row identity facts and the trailing action renderer.
 * @returns one list row.
 */
function AgentRow({ name, scheme, description, added, actions }: {
  name: string
  scheme: string
  description: string
  added: boolean
  actions: (added: boolean) => ReactNode
}) {
  return (
    <li className={css.row}>
      <div className={css.rowIdentity}>
        <span className={css.rowName}>{name}</span>
        <Tag tone="neutral">{scheme}</Tag>
      </div>
      <p className={css.rowDescription} title={description}>{description}</p>
      <div className={css.rowActions}>{actions(added)}</div>
    </li>
  )
}

/** One line of login facts. */
function SsoFacts({ t, state }: { t: CardLocale; state: A2aCardState }) {
  if (state.login === undefined) {
    return <p className={css.hint}>{t('loading')}</p>
  }
  const facts = [
    state.login.configured ? t('ssoConfigured') : t('ssoNotConfigured'),
    state.login.configured && state.login.authenticated ? t('ssoAuthenticated') : null,
    state.login.userId !== null ? `${t('ssoUserId')}: ${state.login.userId}` : null,
    state.login.expiresAtMs !== null ? `${t('ssoExpiresIn')}: ${expiryText(state.login.expiresAtMs)}` : null,
  ].filter((entry): entry is string => entry !== null)
  return <p className={css.facts}>{facts.join(' · ')}</p>
}
