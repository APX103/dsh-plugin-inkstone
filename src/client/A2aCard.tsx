/** The A2A agents settings section. */

import type { ReactNode } from 'react'
import { useId, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Button, Input, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { A2aCardFace, A2aCardState, DirectoryRow } from './a2a-card-controller'
import type { LocalScpRow, ScpHubPanelFace, ScpHubPanelState } from './scp-hub-panel-controller'
import css from './A2aCard.module.css'

/** The merged inject face: registry panel plus SCP Hub panel. */
export interface InkstoneFace extends Omit<A2aCardFace, 'hooks'>, Omit<ScpHubPanelFace, 'hooks'> {
  hooks: A2aCardFace['hooks'] & ScpHubPanelFace['hooks']
}

/** Framework-derived props for the A2A agents settings section. */
export type A2aCardProps = PropsRuntime<'settings.section'>
  & PropsLocale<'settings.a2a'> & InjectFace<InkstoneFace>

type CardLocale = A2aCardProps['t']

/** Format one token expiry instant as a short locale string. */
function expiryText(expiresAtMs: number): string {
  return new Date(expiresAtMs).toLocaleTimeString()
}

/** The three panels below the sign-in card. */
type PanelId = 'agents' | 'scps' | 'skills' | 'builtin'

/**
 * Render the registry sign-in, then the three panels: agent registry, SCP
 * services, and skills.
 * @param props - Locale, both panel snapshots, and both action sets.
 * @returns The section content.
 */
export function A2aCard(props: A2aCardProps) {
  const { t } = props
  const state = props.useA2aCard(snapshot => snapshot)
  const panel = props.useScpHubPanel(snapshot => snapshot)
  const headingId = useId()
  const [ak, setAk] = useState('')
  const [sk, setSk] = useState('')
  const [editing, setEditing] = useState(false)
  const [active, setActive] = useState<PanelId>('agents')
  const busy = state.busy !== null || state.rosterBusy
  const panelBusy = panel.mutating !== null || panel.searching !== null
  return (
    <div className={css.section}>
      {state.error !== null ? <p className={css.error} role="alert">{t('errorPrefix')}: {state.error}</p> : null}
      {panel.error !== null ? <p className={css.error} role="alert">{t('errorPrefix')}: {panel.error}</p> : null}
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
              <form className={css.fields} onSubmit={event => {
                event.preventDefault()
                void props.signIn(ak, sk).then(ok => {
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
              <form className={css.fields} onSubmit={event => {
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
      <div className={css.tabs} role="tablist" aria-label={t('title')}>
        {(['agents', 'scps', 'skills', 'builtin'] as const).map(id => (
          <button
            key={id}
            type="button"
            role="tab"
            className={css.tab}
            aria-selected={active === id}
            onClick={() => { setActive(id); if (id === 'builtin') { void props.loadBuiltinSkills() } }}
          >
            {id === 'agents' ? t('tabAgents') : id === 'scps' ? t('tabScps') : id === 'skills' ? t('tabSkills') : t('tabBuiltin')}
          </button>
        ))}
      </div>
      {active === 'agents'
        ? <AgentsPanel t={t} face={props} state={state} busy={busy} headingId={headingId} />
        : active === 'scps'
          ? <ScpsPanel t={t} headingId={headingId} panel={panel} face={props} busy={panelBusy} />
          : active === 'skills'
            ? <SkillsPanel t={t} headingId={headingId} panel={panel} face={props} busy={panelBusy} />
            : <BuiltinPanel t={t} panel={panel} face={props} busy={panelBusy} headingId={headingId} />}
    </div>
  )
}


/**
 * The agent registry panel: the directory plus the delegation roster.
 */
function AgentsPanel({ t, face, state, busy, headingId }: { t: CardLocale, face: Omit<InkstoneFace, 'hooks'>, state: A2aCardState, busy: boolean, headingId: string }): ReactNode {
  const directoryBusy = busy || state.directoryLoading
  return (
    <>
      <section className={css.card} aria-labelledby={`${headingId}-directory`}>
        <div className={css.cardHead}>
          <h3 className={css.cardTitle} id={`${headingId}-directory`}>{t('directoryTitle')}</h3>
          <Button size="sm" variant="outline" disabled={directoryBusy || state.login?.configured !== true} onClick={() => { void face.loadDirectory() }}>
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
                    <Button size="sm" variant="outline" disabled={busy || state.rosterStatus !== 'ready'} onClick={() => { void face.addToRoster(row) }}>
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
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => { void face.setRosterEnabled(row.name, !row.enabled) }}>
                        {row.enabled ? t('rosterDisable') : t('rosterEnable')}
                      </Button>
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => { void face.removeFromRoster(row.name) }}>
                        {t('rosterRemove')}
                      </Button>
                    </>
                  )}
                />
              ))}
            </ul>}
      </section>
    </>
  )
}

/**
 * The SCP services panel: catalog search plus the local add/remove list.
 */
function ScpsPanel({ t, headingId, panel, face, busy }: { t: CardLocale, headingId: string, panel: ScpHubPanelState, face: Omit<ScpHubPanelFace, 'hooks'>, busy: boolean }): ReactNode {
  return (
    <section className={css.card} aria-labelledby={`${headingId}-scps`}>
      <h3 className={css.cardTitle} id={`${headingId}-scps`}>{t('scpTitle')}</h3>
      <CatalogSearch
        t={t}
        searching={panel.searching === 'scp'}
        keyword={panel.keyword}
        onSearch={keyword => { void face.searchCatalog('scp', keyword) }}
      />
      {panel.pages.scp === undefined
        ? <p className={css.hint}>{panel.searching === 'scp' ? t('loading') : t('catalogHint')}</p>
        : panel.pages.scp.items.length === 0
          ? <p className={css.hint}>{t('catalogEmpty')}</p>
          : <ul className={css.rows}>
            {panel.pages.scp.items.map(row => (
              <li key={row.id} className={css.row}>
                <div className={css.rowIdentity}>
                  <span className={css.rowName}>{row.name}</span>
                  {row.official ? <Tag tone="solid">{t('officialTag')}</Tag> : null}
                </div>
                <p className={css.rowDescription} title={row.description}>{row.description}</p>
                <div className={css.rowActions}>
                  <Button size="sm" variant="outline" disabled={busy || panel.mutating !== null} onClick={() => { void face.addScp(row.id) }}>
                    {t('catalogAdd')}
                  </Button>
                </div>
              </li>
            ))}
          </ul>}
      <h4 className={css.subTitle}>{t('localScpsTitle')}</h4>
      {panel.scps.length === 0
        ? <p className={css.hint}>{t('localScpsEmpty')}</p>
        : <ul className={css.rows}>
          {panel.scps.map(row => (
            <li key={row.id} className={css.row}>
              <div className={css.rowIdentity}>
                <span className={css.rowName}>{row.name}</span>
                <Tag tone="neutral">{row.selectedTools.length > 0 ? `${row.selectedTools.length} ${t('toolsSelectedTag')}` : t('noToolsSelectedTag')}</Tag>
              </div>
              <p className={css.rowDescription} title={row.description}>{row.description}</p>
              <div className={css.rowActions}>
                <Button size="sm" variant="outline" disabled={panel.mutating !== null} onClick={() => { void face.openToolPicker(row.id) }}>
                  {panel.picker?.scpId === row.id ? t('toolPickerClose') : t('toolPickerOpen')}
                </Button>
                <Button size="sm" variant="ghost" disabled={panel.mutating !== null} onClick={() => { void face.setScpEnabled(row.id, !row.enabled) }}>
                  {row.enabled ? t('localDisable') : t('localEnable')}
                </Button>
                <Button size="sm" variant="ghost" disabled={panel.mutating !== null} onClick={() => { void face.removeScp(row.id) }}>
                  {t('localRemove')}
                </Button>
              </div>
              {row.selectedTools.length === 0
                ? <p className={css.hint}>{t('scpParkedHint')}</p>
                : null}
              {panel.picker?.scpId === row.id
                ? <ToolPicker t={t} panel={panel} row={row} face={face} />
                : null}
            </li>
          ))}
        </ul>}
    </section>
  )
}

/** Tools per picker page. */
const PICKER_PAGE_SIZE = 50

/**
 * The per-server tool picker: a paged, tickable inventory; only ticked tools
 * mount. No search — a plain paged list keeps selection deliberate.
 */
function ToolPicker({ t, panel, row, face }: { t: CardLocale, panel: ScpHubPanelState, row: LocalScpRow, face: Omit<ScpHubPanelFace, 'hooks'> }): ReactNode {
  const picker = panel.picker
  if (picker === null || picker.scpId !== row.id) return null
  if (picker.loading) {
    return <p className={css.hint}>{t('loading')}</p>
  }
  const last = Math.max(0, Math.ceil(picker.tools.length / PICKER_PAGE_SIZE) - 1)
  const page = picker.tools.slice(picker.page * PICKER_PAGE_SIZE, (picker.page + 1) * PICKER_PAGE_SIZE)
  const selected = new Set(row.selectedTools)
  return (
    <div className={css.picker}>
      <p className={css.hint}>{t('toolPickerCount', { selected: String(row.selectedTools.length), total: String(picker.tools.length) })}</p>
      <ul className={css.rows}>
        {page.map(tool => (
          <li key={tool.name} className={css.row}>
            <label className={css.pick}>
              <input
                type="checkbox"
                checked={selected.has(tool.name)}
                disabled={panel.mutating !== null}
                onChange={event => { void face.toggleTool(row.id, tool.name, event.target.checked) }}
              />
              <span className={css.rowName}>{tool.name}</span>
            </label>
            <p className={css.rowDescription} title={tool.description}>{tool.description}</p>
          </li>
        ))}
      </ul>
      <div className={css.rowActions}>
        <Button size="sm" variant="ghost" disabled={picker.page === 0} onClick={() => { face.setToolPickerPage(picker.page - 1) }}>
          {t('toolPickerPrev')}
        </Button>
        <span className={css.hint}>{t('toolPickerPage', { page: String(picker.page + 1), pages: String(last + 1) })}</span>
        <Button size="sm" variant="ghost" disabled={picker.page >= last} onClick={() => { face.setToolPickerPage(picker.page + 1) }}>
          {t('toolPickerNext')}
        </Button>
      </div>
    </div>
  )
}

/**
 * The bundled scientific skills panel: the shipped catalog with per-skill
 * enable switches; everything is on by default.
 */
function BuiltinPanel({ t, headingId, panel, face, busy }: { t: CardLocale, headingId: string, panel: ScpHubPanelState, face: Omit<ScpHubPanelFace, 'hooks'>, busy: boolean }): ReactNode {
  const disabled = new Set(panel.builtinDisabled)
  return (
    <section className={css.card} aria-labelledby={`${headingId}-builtin`}>
      <h3 className={css.cardTitle} id={`${headingId}-builtin`}>{t('builtinTitle')}</h3>
      <p className={css.hint}>{t('builtinHint')}</p>
      {panel.builtinLoading && panel.builtin.length === 0
        ? <p className={css.hint}>{t('loading')}</p>
        : panel.builtin.length === 0
          ? <p className={css.hint}>{t('builtinEmpty')}</p>
          : <ul className={css.rows}>
            {panel.builtin.map(row => (
              <li key={row.name} className={css.row}>
                <div className={css.rowIdentity}>
                  <span className={css.rowName}>{row.name}</span>
                  <Tag tone={disabled.has(row.name) ? 'neutral' : 'solid'}>{disabled.has(row.name) ? t('builtinOff') : t('builtinOn')}</Tag>
                </div>
                <p className={css.rowDescription} title={row.description}>{row.description}</p>
                <div className={css.rowActions}>
                  <Button size="sm" variant="ghost" disabled={busy || panel.mutating !== null} onClick={() => { void face.setBuiltinEnabled(row.name, disabled.has(row.name)) }}>
                    {disabled.has(row.name) ? t('localEnable') : t('localDisable')}
                  </Button>
                </div>
              </li>
            ))}
          </ul>}
    </section>
  )
}

/**
 * The skills panel: catalog search plus the installed list.
 */
function SkillsPanel({ t, headingId, panel, face, busy }: { t: CardLocale, headingId: string, panel: ScpHubPanelState, face: Omit<ScpHubPanelFace, 'hooks'>, busy: boolean }): ReactNode {
  return (
    <section className={css.card} aria-labelledby={`${headingId}-skills`}>
      <h3 className={css.cardTitle} id={`${headingId}-skills`}>{t('skillsTitle')}</h3>
      <CatalogSearch
        t={t}
        searching={panel.searching === 'skill'}
        keyword={panel.keyword}
        onSearch={keyword => { void face.searchCatalog('skill', keyword) }}
      />
      {panel.pages.skill === undefined
        ? <p className={css.hint}>{panel.searching === 'skill' ? t('loading') : t('catalogHint')}</p>
        : panel.pages.skill.items.length === 0
          ? <p className={css.hint}>{t('catalogEmpty')}</p>
          : <ul className={css.rows}>
            {panel.pages.skill.items.map(row => (
              <li key={row.id} className={css.row}>
                <div className={css.rowIdentity}>
                  <span className={css.rowName}>{row.name}</span>
                  {row.official ? <Tag tone="solid">{t('officialTag')}</Tag> : null}
                </div>
                <p className={css.rowDescription} title={row.description}>{row.description}</p>
                <div className={css.rowActions}>
                  <Button size="sm" variant="outline" disabled={busy || panel.mutating !== null} onClick={() => { void face.installSkill(row.id) }}>
                    {t('catalogInstall')}
                  </Button>
                </div>
              </li>
            ))}
          </ul>}
      <h4 className={css.subTitle}>{t('localSkillsTitle')}</h4>
      {panel.skills.length === 0
        ? <p className={css.hint}>{t('localSkillsEmpty')}</p>
        : <ul className={css.rows}>
          {panel.skills.map(row => (
      <li key={row.id} className={css.row}>
        <div className={css.rowIdentity}>
          <span className={css.rowName}>{row.name}</span>
          <Tag tone="neutral">{row.skillName}</Tag>
        </div>
        <p className={css.rowDescription} title={row.description}>{row.description}</p>
            <div className={css.rowActions}>
              <Button size="sm" variant="ghost" disabled={panel.mutating !== null} onClick={() => { void face.setSkillEnabled(row.id, !row.enabled) }}>
                {row.enabled ? t('localDisable') : t('localEnable')}
              </Button>
              <Button size="sm" variant="ghost" disabled={panel.mutating !== null} onClick={() => { void face.removeSkill(row.id) }}>
                {t('localRemove')}
              </Button>
            </div>
          </li>
          ))}
        </ul>}
    </section>
  )
}

/**
 * One catalog search bar: keyword input plus the search button.
 */
function CatalogSearch({ t, searching, keyword, onSearch }: { t: CardLocale, searching: boolean, keyword: string, onSearch: (keyword: string) => void }): ReactNode {
  const [text, setText] = useState(keyword)
  return (
    <form className={css.search} onSubmit={event => {
      event.preventDefault()
      onSearch(text)
    }}>
      <Input value={text} onChange={(event) => { setText(event.target.value) }} placeholder={t('catalogSearchPlaceholder')} autoComplete="off" />
      <Button size="sm" variant="outline" type="submit" disabled={searching}>{searching ? t('loading') : t('catalogSearch')}</Button>
    </form>
  )
}

/**
 * One agent registry row: identity, scheme tag, description, and the trailing
 * action.
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
function SsoFacts({ t, state }: { t: CardLocale, state: A2aCardState }) {
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
