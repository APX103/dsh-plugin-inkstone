// @vitest-environment jsdom
/** The A2A page as the Plugins page renders it: sign-in, directory, and roster sections. */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { A2aCard, type A2aCardProps } from '../src/client/A2aCard'
import type { A2aCardState } from '../src/client/a2a-card-controller'
import type { ScpHubPanelState } from '../src/client/scp-hub-panel-controller'
import { en } from '../src/client/locales'

afterEach(cleanup)

const t = (key: keyof typeof en) => en[key]

function basePanelState(over: Partial<ScpHubPanelState> = {}): ScpHubPanelState {
  return {
    error: null,
    searching: null,
    keyword: '',
    pages: { scp: undefined, skill: undefined },
    mutating: null,
    scps: [],
    skills: [],
    ...over,
  }
}

const PAPER_DIRECTORY = { name: 'paper-agent', description: 'writes papers', endpointUrl: 'https://paper.test/a2a', authScheme: 'orbit_jwt', probeStatus: 'ok' }

const PAPER_ROSTER = { name: 'paper-agent', endpointUrl: 'https://paper.test/a2a', authScheme: 'orbit_jwt', description: '', enabled: true }

function baseState(over: Partial<A2aCardState> = {}): A2aCardState {
  return {
    ready: true,
    login: { configured: false, authenticated: false, userId: null, expiresAtMs: null },
    busy: null,
    error: null,
    directory: [],
    directoryLoading: false,
    rosterStatus: 'ready',
    rosterBusy: false,
    roster: [],
    ...over,
  }
}

/** @param state - the section snapshot. */
function renderA2a(state: Partial<A2aCardState> = {}) {
  const store = createSnapshotStore<A2aCardState>(baseState(state))
  const actions = {
    refresh: vi.fn(async () => {}),
    signIn: vi.fn(async () => true),
    signOut: vi.fn(async () => {}),
    loadDirectory: vi.fn(async () => {}),
    addToRoster: vi.fn(async () => {}),
    setRosterEnabled: vi.fn(async () => {}),
    removeFromRoster: vi.fn(async () => {}),
  }
  const panelStore = createSnapshotStore<ScpHubPanelState>(basePanelState())
  const panelActions = {
    searchCatalog: vi.fn(async () => {}),
    addScp: vi.fn(async () => {}),
    removeScp: vi.fn(async () => {}),
    setScpEnabled: vi.fn(async () => {}),
    installSkill: vi.fn(async () => {}),
    removeSkill: vi.fn(async () => {}),
    setSkillEnabled: vi.fn(async () => {}),
  }
  const props = {
    ...actions,
    ...panelActions,
    close: () => {},
    t,
    useA2aCard: bindSnapshotSelector(store),
    useScpHubPanel: bindSnapshotSelector(panelStore),
  } as A2aCardProps
  const view = render(<A2aCard {...props} />)
  return { actions, panelActions, store, unmount: view.unmount }
}

describe('A2aCard', () => {
  it('renders the sign-in form and submits the entered pair', () => {
    const { actions } = renderA2a()
    fireEvent.change(screen.getByLabelText(en.akLabel), { target: { value: 'ak-1' } })
    fireEvent.change(screen.getByLabelText(en.skLabel), { target: { value: 'sk-1' } })
    fireEvent.click(screen.getByRole('button', { name: en.signIn }))
    expect(actions.signIn).toHaveBeenCalledWith('ak-1', 'sk-1')
  })

  it('renders login facts and the sign-out control once configured', () => {
    const { actions } = renderA2a({
      login: { configured: true, authenticated: true, userId: 'uid-1', expiresAtMs: Date.parse('2026-10-08T00:00:00Z') },
    })
    expect(screen.getByText(new RegExp(en.ssoConfigured))).toBeDefined()
    expect(screen.getByText(new RegExp('uid-1'))).toBeDefined()
    expect(screen.getByText(new RegExp(en.ssoExpiresIn))).toBeDefined()
    expect(screen.queryByRole('button', { name: en.signIn })).toBeNull()
    const akField = screen.getByLabelText(en.akLabel) as HTMLInputElement
    const skField = screen.getByLabelText(en.skLabel) as HTMLInputElement
    expect(akField.value).toBe('········')
    expect(skField.value).toBe('········')
    expect(akField.disabled).toBe(true)
    expect(skField.disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: en.signOut }))
    expect(actions.signOut).toHaveBeenCalled()
  })

  it('switches to editing on modify, saves, and cancels back to masked fields', async () => {
    const { actions } = renderA2a({
      login: { configured: true, authenticated: true, userId: 'uid-1', expiresAtMs: null },
    })
    fireEvent.click(screen.getByRole('button', { name: en.ssoModify }))
    fireEvent.change(screen.getByLabelText(en.akLabel), { target: { value: 'ak-2' } })
    fireEvent.change(screen.getByLabelText(en.skLabel), { target: { value: 'sk-2' } })
    fireEvent.click(screen.getByRole('button', { name: en.ssoSave }))
    expect(actions.signIn).toHaveBeenCalledWith('ak-2', 'sk-2')
    await screen.findByRole('button', { name: en.ssoModify })

    fireEvent.click(screen.getByRole('button', { name: en.ssoModify }))
    fireEvent.click(screen.getByRole('button', { name: en.ssoCancel }))
    expect((screen.getByLabelText(en.akLabel) as HTMLInputElement).value).toBe('········')
  })

  it('keeps the editing form open when the host rejects the credentials', async () => {
    const { actions } = renderA2a({
      login: { configured: true, authenticated: true, userId: 'uid-1', expiresAtMs: null },
    })
    actions.signIn.mockImplementation(async () => false)
    fireEvent.click(screen.getByRole('button', { name: en.ssoModify }))
    fireEvent.change(screen.getByLabelText(en.akLabel), { target: { value: 'ak-2' } })
    fireEvent.change(screen.getByLabelText(en.skLabel), { target: { value: 'sk-2' } })
    fireEvent.click(screen.getByRole('button', { name: en.ssoSave }))
    await screen.findByRole('button', { name: en.ssoSave })
    expect(screen.getByRole('button', { name: en.ssoCancel })).toBeDefined()
  })

  it('omits the expiry fact for a session without one', () => {
    renderA2a({
      login: { configured: true, authenticated: false, userId: null, expiresAtMs: null },
    })
    expect(screen.getByText(new RegExp(en.ssoConfigured))).toBeDefined()
    expect(screen.queryByText(new RegExp(en.ssoExpiresIn))).toBeNull()
  })

  it('shows the loading line before the first status read', () => {
    renderA2a({ ready: false, login: undefined })
    expect(screen.getByText(en.loading)).toBeDefined()
  })

  it('renders directory rows and adds one to the roster', () => {
    const { actions } = renderA2a({
      login: { configured: true, authenticated: true, userId: 'uid-1', expiresAtMs: null },
      directory: [PAPER_DIRECTORY],
    })
    fireEvent.click(screen.getByRole('button', { name: en.directoryRefresh }))
    expect(actions.loadDirectory).toHaveBeenCalled()
    const add = screen.getByRole('button', { name: en.addToRoster })
    fireEvent.click(add)
    expect(actions.addToRoster).toHaveBeenCalledWith(PAPER_DIRECTORY)
  })

  it('marks directory agents already on the roster', () => {
    renderA2a({
      login: { configured: true, authenticated: true, userId: 'uid-1', expiresAtMs: null },
      directory: [PAPER_DIRECTORY],
      roster: [PAPER_ROSTER],
    })
    expect(screen.getByText(en.inRoster)).toBeDefined()
    expect(screen.queryByRole('button', { name: en.addToRoster })).toBeNull()
  })

  it('shows the directory loading line and freezes refresh while listing', () => {
    renderA2a({ directoryLoading: true })
    expect(screen.getByText(en.loading)).toBeDefined()
    expect(screen.queryByText(en.directoryEmpty)).toBeNull()
    expect((screen.getByRole('button', { name: en.directoryRefresh }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('disables adding while the roster form is not ready', () => {
    renderA2a({
      login: { configured: true, authenticated: true, userId: 'uid-1', expiresAtMs: null },
      directory: [PAPER_DIRECTORY],
      rosterStatus: 'unavailable',
    })
    expect((screen.getByRole('button', { name: en.addToRoster }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('toggles and removes roster rows', () => {
    const { actions } = renderA2a({
      roster: [PAPER_ROSTER],
    })
    fireEvent.click(screen.getByRole('button', { name: en.rosterDisable }))
    expect(actions.setRosterEnabled).toHaveBeenCalledWith('paper-agent', false)
    fireEvent.click(screen.getByRole('button', { name: en.rosterRemove }))
    expect(actions.removeFromRoster).toHaveBeenCalledWith('paper-agent')
  })

  it('offers enabling a disabled roster row', () => {
    const { actions } = renderA2a({
      roster: [{ ...PAPER_ROSTER, enabled: false }],
    })
    fireEvent.click(screen.getByRole('button', { name: en.rosterEnable }))
    expect(actions.setRosterEnabled).toHaveBeenCalledWith('paper-agent', true)
    fireEvent.click(screen.getByRole('button', { name: en.rosterRemove }))
    expect(actions.removeFromRoster).toHaveBeenCalledWith('paper-agent')
  })

  it('renders the roster sync notices instead of rows', () => {
    const { unmount } = renderA2a({ rosterStatus: 'loading' })
    expect(screen.getByText(en.loading)).toBeDefined()
    expect(screen.queryByText(en.rosterEmpty)).toBeNull()
    unmount()

    renderA2a({ rosterStatus: 'unavailable' })
    expect(screen.getByText(en.rosterUnavailable)).toBeDefined()
    expect(screen.queryByRole('button', { name: en.rosterRemove })).toBeNull()
  })

  it('renders the empty-state hints and error line', () => {
    renderA2a({ error: 'registry unreachable' })
    expect(screen.getByText(new RegExp(en.errorPrefix))).toBeDefined()
    expect(screen.getByText(en.directoryEmpty)).toBeDefined()
    expect(screen.getByText(en.rosterEmpty)).toBeDefined()
  })
})
