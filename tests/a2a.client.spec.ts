// @vitest-environment jsdom
/** Browser-half registration and controller flows of the A2A settings page. */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { RemoteError, TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply as settingsApply, inject as settingsInject, type ConfigForm, type ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { A2aCardController } from '../src/client/a2a-card-controller'
import type { RosterRow } from '../src/client/a2a-card-controller'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '../src/client/typert.remote-client'
import { apply, inject, NS, INKSTONE_ENTRY } from '../src/client/index'
import { apply as hostApply } from '../src/index'

/** One Host view of a served namespace. */
function view(ns: string, revision = 0) {
  return { ns, schema: {}, value: {}, applies: 'live' as const, secrets: [], revision }
}

/** @param served - namespaces the Host describes; omitted answers a failed read. */
async function bench(served?: string[]) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  const describeSettings = vi.fn(() => Promise.resolve(served === undefined
    ? { ok: false as const, error: new RemoteError('gateway/internal', 'no provider', {}) }
    : { ok: true as const, value: { writable: true, hasDocument: true, namespaces: served.map(ns => view(ns)) } }))
  const remote = new TestRemote(ctx, {
    settings: { describe: describeSettings },
    a2aRegistry: {
      status: () => Promise.resolve({
        ok: true as const,
        value: { configured: false, authenticated: false, registryBaseUrl: 'https://a2a.test', expiresAtMs: null, userId: null },
      }),
    },
  })
  // The double's $mount rejects by contract; this page mounts its own
  // namespace, so the bench stands in with a no-op mount.
  remote.$mount = () => Promise.resolve(async () => {})
  await ctx.plugin({ inject: [...settingsInject], apply: settingsApply }).await()
  return { ctx, slots: ctx.get('slots') as SlotRegistry, describeSettings, remote }
}

/** A mutable ConfigForm double over an in-memory snapshot. */
class FormDouble {
  snapshot: ConfigFormSnapshot<{ agents?: unknown }>
  sets: Array<{ field: string; value: unknown }> = []
  readonly #listeners = new Set<() => void>()
  constructor(agents: unknown) {
    this.snapshot = {
      status: 'ready', value: { agents }, base: {}, user: {}, revision: 1, writable: true, mode: 'host',
    }
  }
  getSnapshot(): ConfigFormSnapshot<{ agents?: unknown }> {
    return this.snapshot
  }
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }
  async mutate(): Promise<boolean> {
    return true
  }
  async set(field: string, value: unknown): Promise<boolean> {
    this.sets.push({ field, value })
    this.snapshot = { ...this.snapshot, value: { agents: value } }
    for (const listener of this.#listeners) listener()
    return true
  }
  async unset(): Promise<boolean> {
    return true
  }
}

function formOf(double: FormDouble): ConfigForm<{ agents?: unknown }> {
  return double
}

/** A context whose remote namespace answers a minimal signed-out status. */
function quietCtx(): Context {
  const ctx = new Context()
  new TestRemote(ctx, {
    a2aRegistry: {
      status: () => Promise.resolve({
        ok: true as const,
        value: { configured: false, authenticated: false, registryBaseUrl: 'https://a2a.test', expiresAtMs: null, userId: null },
      }),
    },
  })
  return ctx
}

const PAPER_ROW = { name: 'paper-agent', endpointUrl: 'https://paper.test/a2a', authScheme: 'orbit_jwt', description: '', enabled: true }

const PAPER_DIRECTORY = { name: 'paper-agent', description: 'writes papers', endpointUrl: 'https://paper.test/a2a', authScheme: 'orbit_jwt', probeStatus: 'ok' }

const AUTHENTICATED_STATUS = { configured: true, authenticated: true, registryBaseUrl: 'https://a2a.test', expiresAtMs: null, userId: 'uid-1' }

describe('ui-settings-a2a apply failure path', () => {
  it('rethrows and unwinds when the page registration fails', async () => {
    const ctx = new Context()
    const locale = new LocaleRuntime(ctx)
    locale.setLocale('zh')
    ctx.provide('locale', locale)
    const remote = new TestRemote(ctx, {
      a2aRegistry: {
        status: () => Promise.resolve({
          ok: true as const,
          value: { configured: false, authenticated: false, registryBaseUrl: 'https://a2a.test', expiresAtMs: null, userId: null },
        }),
      },
    })
    remote.$mount = () => Promise.resolve(async () => {})
    ctx.provide('configForms', {
      get: () => formOf(new FormDouble([])),
      whileServed: () => {
        throw new Error('page registration failed')
      },
    } as never)
    ctx.provide('slots', {
      inject: () => {
        throw new Error('unreachable')
      },
      register: () => () => {},
    } as never)
    await expect(ctx.plugin({ inject: [...inject], apply })).rejects.toThrow('page registration failed')
  })
})

describe('ui-settings-a2a apply', () => {
  it('exports the host entry surface for Loader mounting', () => {
    expect(typeof hostApply).toBe('function')
  })

  it('mounts the remote namespace, dictionaries, and the page while the roster entry is served', async () => {
    const { ctx, slots } = await bench([INKSTONE_ENTRY])
    slots.register({
      name: 'root',
      children: { 'settings.section': { kind: 'list', scope: 'root' } },
    } as never, () => null)
    const fiber = await ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    await vi.waitFor(() => { expect(slots.entries('settings.section')).toHaveLength(1) })
    const entry = slots.entries('settings.section')[0]!
    expect(entry.options).toMatchObject({ id: 'inkstone-agents', order: 50 })
    expect(resolveSlotLabel(entry.options.label)).toBe('端砚 · A2A 远程 Agent')
    expect(entry.locale).toBe(NS)
    const bound = (entry.inject as () => { refresh(): Promise<void> })()
    expect(typeof bound.refresh).toBe('function')
    const locale = ctx.get('locale') as { bind(ns: string): (key: string) => string }
    expect(locale.bind(NS)('title')).toBe('端砚 · A2A 远程 Agent')
    expect(typeof ctx.remote.a2aRegistry.status).toBe('function')
    await fiber.dispose()
    expect(slots.entries('settings.section')).toHaveLength(0)
  })
})

describe('A2aCardController', () => {
  it('publishes the roster from the form and skips malformed rows', () => {
    const ctx = quietCtx()
    const form = new FormDouble([PAPER_ROW, { name: '' }, 'junk', { name: 3 }, { name: 'a', endpointUrl: 5 }, { name: 'b', endpointUrl: 'https://b.test', description: 9, enabled: false }])
    const controller = new A2aCardController(ctx, formOf(form))
    const state = controller.inject().hooks.a2aCard.getSnapshot()
    expect(state.roster).toEqual([PAPER_ROW, { name: 'b', endpointUrl: 'https://b.test', authScheme: 'none', description: '', enabled: false }])
    expect(state.rosterStatus).toBe('ready')
    controller.dispose()
  })

  it('maps the roster form sync state onto the card status', () => {
    const loading = new FormDouble([])
    loading.snapshot = { ...loading.snapshot, status: 'loading' }
    const loadingController = new A2aCardController(quietCtx(), formOf(loading))
    expect(loadingController.inject().hooks.a2aCard.getSnapshot().rosterStatus).toBe('loading')
    loadingController.dispose()

    const unserved = new FormDouble([])
    unserved.snapshot = { ...unserved.snapshot, status: 'unavailable' }
    const unservedController = new A2aCardController(quietCtx(), formOf(unserved))
    expect(unservedController.inject().hooks.a2aCard.getSnapshot().rosterStatus).toBe('unavailable')
    unservedController.dispose()

    const readonly = new FormDouble([])
    readonly.snapshot = { ...readonly.snapshot, writable: false }
    const readonlyController = new A2aCardController(quietCtx(), formOf(readonly))
    expect(readonlyController.inject().hooks.a2aCard.getSnapshot().rosterStatus).toBe('unavailable')
    readonlyController.dispose()
  })

  it('adds, toggles, and removes roster rows through form writes', async () => {
    const ctx = quietCtx()
    const form = new FormDouble([])
    const face = new A2aCardController(ctx, formOf(form)).inject()
    await face.addToRoster(PAPER_DIRECTORY)
    expect(form.sets).toHaveLength(1)
    expect((form.sets[0]!.value as RosterRow[])[0]).toMatchObject({ name: 'paper-agent', enabled: true })
    await face.setRosterEnabled('paper-agent', false)
    expect((form.sets.at(-1)!.value as RosterRow[])[0]).toMatchObject({ enabled: false })
    await face.removeFromRoster('paper-agent')
    expect(form.sets.at(-1)!.value).toEqual([])
    const state = face.hooks.a2aCard.getSnapshot()
    expect(state.roster).toEqual([])
    expect(state.rosterBusy).toBe(false)
  })

  it('skips adding a directory agent whose name is already on the roster', async () => {
    const ctx = quietCtx()
    const form = new FormDouble([PAPER_ROW])
    const face = new A2aCardController(ctx, formOf(form)).inject()
    await face.addToRoster(PAPER_DIRECTORY)
    expect(form.sets).toHaveLength(1)
    expect(form.sets[0]!.value).toEqual([PAPER_ROW])
  })

  it('publishes accepted rows without waiting for the form snapshot', async () => {
    const ctx = quietCtx()
    const form = new FormDouble([])
    form.set = async () => true
    const face = new A2aCardController(ctx, formOf(form)).inject()
    await face.addToRoster(PAPER_DIRECTORY)
    expect(face.hooks.a2aCard.getSnapshot().roster).toEqual([{ ...PAPER_ROW, description: 'writes papers' }])
  })

  it('reports remote failures and ignores cancellations', async () => {
    const cancelledCtx = new Context()
    new TestRemote(cancelledCtx, {
      a2aRegistry: {
        status: () => Promise.resolve({ ok: false as const, error: new RemoteError('gateway/cancelled', 'This operation was aborted', {}) }),
      },
    })
    const face = new A2aCardController(cancelledCtx, formOf(new FormDouble([]))).inject()
    await face.refresh()
    let state = face.hooks.a2aCard.getSnapshot()
    expect(state.error).toBeNull()

    const failingCtx = new Context()
    new TestRemote(failingCtx, {
      a2aRegistry: {
        status: () => Promise.resolve({ ok: false as const, error: new RemoteError('a2a/not-configured', 'sign in first', { reason: 'x' }) }),
        login: () => Promise.resolve({ ok: false as const, error: new RemoteError('a2a/sso-rejected', 'bad keys', { reason: 'bad keys' }) }),
        discover: () => Promise.resolve({ ok: false as const, error: new RemoteError('a2a/discovery-unavailable', 'registry down', { reason: 'registry down' }) }),
      },
    })
    const face2 = new A2aCardController(failingCtx, formOf(new FormDouble([]))).inject()
    await face2.refresh()
    state = face2.hooks.a2aCard.getSnapshot()
    expect(state.error).toBe('sign in first')
    await expect(face2.signIn('ak', 'sk')).resolves.toBe(false)
    state = face2.hooks.a2aCard.getSnapshot()
    expect(state.error).toBe('bad keys')
    await face2.loadDirectory()
    expect(face2.hooks.a2aCard.getSnapshot().error).toBe('registry down')
    expect(state.ready).toBe(false)
  })

  it('ignores a second action while one is in flight', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const gatedCtx = new Context()
    new TestRemote(gatedCtx, {
      a2aRegistry: {
        status: () => Promise.resolve({
          ok: true as const,
          value: { configured: false, authenticated: false, registryBaseUrl: 'https://a2a.test', expiresAtMs: null, userId: null },
        }),
        logout: () => gate.then(() => ({ ok: true as const, value: undefined })),
      },
    })
    const face = new A2aCardController(gatedCtx, formOf(new FormDouble([]))).inject()
    const first = face.signOut()
    const second = face.signOut()
    release()
    await Promise.all([first, second])
    expect(face.hooks.a2aCard.getSnapshot().busy).toBeNull()
  })

  it('reports a host-refused roster write', async () => {
    const ctx = quietCtx()
    const form = new FormDouble([])
    form.set = async () => false
    const face = new A2aCardController(ctx, formOf(form)).inject()
    await face.addToRoster(PAPER_DIRECTORY)
    expect(face.hooks.a2aCard.getSnapshot().error).toBe('roster write refused by the host')
  })

  it('reports a roster write transport failure', async () => {
    const ctx = quietCtx()
    const form = new FormDouble([])
    form.set = async () => {
      throw new Error('transport died')
    }
    const face = new A2aCardController(ctx, formOf(form)).inject()
    await face.addToRoster(PAPER_DIRECTORY)
    expect(face.hooks.a2aCard.getSnapshot().error).toBe('transport died')
    form.set = async () => {
      throw 'plain string failure'
    }
    await face.removeFromRoster('paper-agent')
    expect(face.hooks.a2aCard.getSnapshot().error).toBe('plain string failure')
  })

  it('ignores a toggle for a name not on the roster', async () => {
    const ctx = quietCtx()
    const form = new FormDouble([PAPER_ROW])
    const face = new A2aCardController(ctx, formOf(form)).inject()
    await face.setRosterEnabled('ghost', true)
    expect(form.sets).toHaveLength(1)
    expect(form.sets[0]!.value).toEqual([PAPER_ROW])
  })

  it('reports a logout failure', async () => {
    const logoutCtx = new Context()
    new TestRemote(logoutCtx, {
      a2aRegistry: {
        status: () => Promise.resolve({ ok: true as const, value: { configured: false, authenticated: false, registryBaseUrl: 'https://a2a.test', expiresAtMs: null, userId: null } }),
        logout: () => Promise.resolve({ ok: false as const, error: new RemoteError('a2a/not-configured', 'already out', { reason: 'x' }) }),
      },
    })
    const face = new A2aCardController(logoutCtx, formOf(new FormDouble([]))).inject()
    await face.signOut()
    expect(face.hooks.a2aCard.getSnapshot().error).toBe('already out')
    expect(face.hooks.a2aCard.getSnapshot().directory).toEqual([])
  })

  it('retries a failed automatic directory load once', async () => {
    vi.useFakeTimers()
    try {
      let discovers = 0
      const retryCtx = new Context()
      new TestRemote(retryCtx, {
        a2aRegistry: {
          status: () => Promise.resolve({ ok: true as const, value: AUTHENTICATED_STATUS }),
          discover: () => {
            discovers += 1
            return Promise.resolve({ ok: false as const, error: new RemoteError('a2a/discovery-unavailable', 'registry down', { reason: 'x' }) })
          },
        },
      })
      const controller = new A2aCardController(retryCtx, formOf(new FormDouble([])))
      await vi.advanceTimersByTimeAsync(0)
      expect(controller.inject().hooks.a2aCard.getSnapshot().error).toBe('registry down')
      await vi.advanceTimersByTimeAsync(1500)
      expect(discovers).toBe(2)
      controller.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('clears the error line once the retried directory load lands', async () => {
    vi.useFakeTimers()
    try {
      let discovers = 0
      const retryCtx = new Context()
      new TestRemote(retryCtx, {
        a2aRegistry: {
          status: () => Promise.resolve({ ok: true as const, value: AUTHENTICATED_STATUS }),
          discover: () => {
            discovers += 1
            return discovers === 1
              ? Promise.resolve({ ok: false as const, error: new RemoteError('a2a/discovery-unavailable', 'registry down', { reason: 'x' }) })
              : Promise.resolve({ ok: true as const, value: [{ name: 'paper-agent', uri: null, description: '', endpointUrl: 'https://paper.test/a2a', authScheme: 'orbit_jwt', probeStatus: 'ok' }] })
          },
        },
      })
      const controller = new A2aCardController(retryCtx, formOf(new FormDouble([])))
      await vi.advanceTimersByTimeAsync(0)
      const face = controller.inject()
      expect(face.hooks.a2aCard.getSnapshot().error).toBe('registry down')
      await vi.advanceTimersByTimeAsync(1500)
      const state = face.hooks.a2aCard.getSnapshot()
      expect(state.error).toBeNull()
      expect(state.directory).toHaveLength(1)
      controller.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('cancels the directory retry when the controller is disposed', async () => {
    vi.useFakeTimers()
    try {
      let discovers = 0
      const retryCtx = new Context()
      new TestRemote(retryCtx, {
        a2aRegistry: {
          status: () => Promise.resolve({ ok: true as const, value: AUTHENTICATED_STATUS }),
          discover: () => {
            discovers += 1
            return Promise.resolve({ ok: false as const, error: new RemoteError('a2a/discovery-unavailable', 'registry down', { reason: 'x' }) })
          },
        },
      })
      const controller = new A2aCardController(retryCtx, formOf(new FormDouble([])))
      await vi.advanceTimersByTimeAsync(0)
      controller.dispose()
      await vi.advanceTimersByTimeAsync(1500)
      expect(discovers).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('auto-loads the directory once for an authenticated session', async () => {
    let discovers = 0
    const autoCtx = new Context()
    const autoRemote = new TestRemote(autoCtx, {
      a2aRegistry: {
        status: () => Promise.resolve({ ok: true as const, value: AUTHENTICATED_STATUS }),
        discover: () => {
          discovers += 1
          return Promise.resolve({
            ok: true as const,
            value: [{ name: 'paper-agent', uri: null, description: '', endpointUrl: 'https://paper.test/a2a', authScheme: 'orbit_jwt', probeStatus: 'ok' }],
          })
        },
      },
    })
    autoRemote.$mount = () => Promise.resolve(async () => {})
    const autoForm = new FormDouble([])
    const face = new A2aCardController(autoCtx, formOf(autoForm)).inject()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(face.hooks.a2aCard.getSnapshot().directory).toHaveLength(1)
    await face.refresh()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(discovers).toBe(1)
  })

  it('loads the directory into rows and clears it on sign-out', async () => {
    const liveCtx = new Context()
    new TestRemote(liveCtx, {
      a2aRegistry: {
        status: () => Promise.resolve({
          ok: true as const,
          value: { configured: true, authenticated: true, registryBaseUrl: 'https://a2a.test', expiresAtMs: 1234, userId: 'uid-1' },
        }),
        login: () => Promise.resolve({ ok: true as const, value: undefined }),
        logout: () => Promise.resolve({ ok: true as const, value: undefined }),
        discover: () => Promise.resolve({
          ok: true as const,
          value: [{ name: 'paper-agent', uri: null, description: '', endpointUrl: 'https://paper.test/a2a', authScheme: 'orbit_jwt', probeStatus: 'ok' }],
        }),
      },
    })
    const face = new A2aCardController(liveCtx, formOf(new FormDouble([]))).inject()
    await expect(face.signIn('ak', 'sk')).resolves.toBe(true)
    let state = face.hooks.a2aCard.getSnapshot()
    expect(state.login).toMatchObject({ configured: true, authenticated: true, userId: 'uid-1', expiresAtMs: 1234 })
    await face.loadDirectory()
    state = face.hooks.a2aCard.getSnapshot()
    expect(state.directory).toEqual([{ name: 'paper-agent', description: '', endpointUrl: 'https://paper.test/a2a', authScheme: 'orbit_jwt', probeStatus: 'ok' }])
    await face.signOut()
    state = face.hooks.a2aCard.getSnapshot()
    expect(state.directory).toEqual([])
    expect(state.busy).toBeNull()
  })
})
