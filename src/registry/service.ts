/**
 * The host-side agent-registry service (`ctx.a2aRegistry`): owns the OpenXLab
 * SSO session built from stored AK/SK credentials, exposes login/logout and
 * status, discovers the A2A directory over MCP, and resolves per-agent
 * data-plane headers through the STS exchange for delegation consumers.
 *
 * The Cordis service is a thin shell over {@link RegistryClientCore}; the
 * shell keeps only public members because the root Context hands consumers a
 * tracing proxy where private members are inaccessible.
 *
 * @module dsh-plugin-inkstone/registry/service
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import { credentialKey, type CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { RegistryError } from './error'
import { OpenXLabSso, type SsoTokenState } from './sso'
import { StsExchange, type RegistryAuthScheme } from './sts'
import { RegistryDirectory, type RegistryAgentEntry } from './discovery'

declare module '@deepseek-ai/cordis' {
  interface Context {
    a2aRegistry: A2aRegistryService
  }
}

/** The credential-store surface the registry core consumes. */
export interface RegistryCredentialStore {
  /** Read one durable record; `undefined` when absent. */
  readRecord(key: ReturnType<typeof credentialKey>): Promise<CredentialRecord | undefined>
  /** Write one durable record through a producer. */
  modifyRecord(key: ReturnType<typeof credentialKey>, produce: () => Promise<CredentialRecord>): Promise<CredentialRecord | undefined>
  /** Remove one durable record. */
  deleteRecord(key: ReturnType<typeof credentialKey>): Promise<void>
}

/** The durable record holding the OpenXLab AK/SK pair. */
export interface OpenXLabGrant {
  readonly ak: string
  readonly sk: string
}

/** Resolved deployment configuration for the registry client. */
export interface RegistryServiceConfig {
  readonly registryBaseUrl: string
  readonly ssoBaseUrl: string
  /** Injectable fetch for tests; defaults to global fetch. */
  readonly fetchImpl?: typeof fetch
}

/** Client-facing login state. */
export interface RegistryLoginState extends SsoTokenState {
  /** Whether an AK/SK record is stored. */
  readonly configured: boolean
  /** The registry root in use. */
  readonly registryBaseUrl: string
}

const GRANT_KEY = credentialKey('a2a-registry', 'openxlab')

/**
 * The registry client core: SSO lifecycle, STS exchange, and directory
 * discovery over one credential store and deployment configuration.
 */
export class RegistryClientCore {
  readonly #store: RegistryCredentialStore
  readonly #config: RegistryServiceConfig
  #sso: OpenXLabSso | undefined
  #ssoAk = ''
  #sts: StsExchange | undefined
  #directory: RegistryDirectory | undefined

  constructor(store: RegistryCredentialStore, config: RegistryServiceConfig) {
    this.#store = store
    this.#config = config
  }

  /**
   * Report the login state without network activity.
   * @returns whether credentials are stored and the cached token state.
   */
  async status(): Promise<RegistryLoginState> {
    const grant = await this.#readGrant()
    if (grant === undefined) {
      return {
        configured: false,
        registryBaseUrl: this.#config.registryBaseUrl,
        authenticated: false,
        expiresAtMs: undefined,
        userId: undefined,
      }
    }
    // Prime the session so `authenticated` answers whether the stored pair
    // still works, not merely whether a cached token happens to exist.
    try {
      await this.#ssoFor(grant).bearerToken()
    } catch {
      // A rejected pair reports unauthenticated; the sign-in form is the fix.
    }
    return {
      configured: true,
      registryBaseUrl: this.#config.registryBaseUrl,
      ...this.#ssoFor(grant).state(),
    }
  }

  /**
   * Store an AK/SK pair and prime the SSO session, rejecting bad pairs.
   * @param ak - the access key.
   * @param sk - the secret key.
   */
  async login(ak: string, sk: string): Promise<void> {
    if (ak.trim() === '' || sk.trim() === '') {
      throw new RegistryError('sso-missing', 'both access key and secret key are required')
    }
    const sso = this.#newSso(ak.trim(), sk.trim())
    await sso.bearerToken()
    await this.#store.modifyRecord(GRANT_KEY, async () => ({
      kind: 'grant',
      payload: { ak: ak.trim(), sk: sk.trim() } satisfies OpenXLabGrant,
    }))
    this.#sso = sso
    this.#ssoAk = ak.trim()
    this.#resetLazies()
  }

  /**
   * Remove the stored AK/SK pair and every in-memory token.
   */
  async logout(): Promise<void> {
    await this.#store.deleteRecord(GRANT_KEY)
    this.#sso = undefined
    this.#ssoAk = ''
    this.#resetLazies()
  }

  /**
   * Discover the visible A2A agents from the registry directory.
   * @param signal - cooperative cancellation.
   * @returns the directory entries.
   * @throws RegistryError (`not-configured`) before login.
   */
  async discover(signal?: AbortSignal): Promise<RegistryAgentEntry[]> {
    const grant = await this.#requireGrant()
    this.#directory ??= new RegistryDirectory({
      registryBaseUrl: this.#config.registryBaseUrl,
      bearer: () => this.#bearer(grant),
      ...this.#fetchOption(),
    })
    return await this.#directory.list(signal)
  }

  /**
   * Resolve the data-plane headers for one agent under its auth scheme.
   * @param agentName - the registry resource name.
   * @param scheme - the resource's auth scheme.
   * @returns header name/value pairs for the agent's endpoint.
   */
  async agentHeaders(agentName: string, scheme: RegistryAuthScheme): Promise<Record<string, string>> {
    const grant = await this.#requireGrant()
    this.#sts ??= new StsExchange({
      registryBaseUrl: this.#config.registryBaseUrl,
      identity: async () => ({ bearer: await this.#bearer(grant), userId: this.#ssoFor(grant).state().userId }),
      ...this.#fetchOption(),
    })
    return await this.#sts.headersFor(agentName, scheme)
  }

  /**
   * Drop cached STS tickets so the next call exchanges fresh ones.
   * @param agentName - one agent; omit to clear every agent.
   */
  invalidateTickets(agentName?: string): void {
    this.#sts?.invalidate(agentName)
  }

  /**
   * The current SSO bearer and uid; shared with sibling services (SCP Hub)
   * so one OpenXLab session serves every consumer.
   * @returns the bearer token and user id.
   * @throws RegistryError (`not-configured`) before login.
   */
  async identity(): Promise<{ bearer: string, userId: string | null }> {
    const grant = await this.#requireGrant()
    const userId = this.#ssoFor(grant).state().userId
    return { bearer: await this.#bearer(grant), userId: userId === undefined ? null : userId }
  }

  #fetchOption(): { fetchImpl?: typeof fetch } {
    return this.#config.fetchImpl !== undefined ? { fetchImpl: this.#config.fetchImpl } : {}
  }

  #newSso(ak: string, sk: string): OpenXLabSso {
    return new OpenXLabSso({ ak, sk, baseUrl: this.#config.ssoBaseUrl, ...this.#fetchOption() })
  }

  #resetLazies(): void {
    this.#sts = undefined
    this.#directory = undefined
  }

  async #readGrant(): Promise<OpenXLabGrant | undefined> {
    const record = await this.#store.readRecord(GRANT_KEY)
    const payload = record?.kind === 'grant' ? record.payload as Partial<OpenXLabGrant> : undefined
    if (payload === undefined || typeof payload.ak !== 'string' || typeof payload.sk !== 'string') {
      return undefined
    }
    return { ak: payload.ak, sk: payload.sk }
  }

  async #requireGrant(): Promise<OpenXLabGrant> {
    const grant = await this.#readGrant()
    if (grant === undefined) {
      throw new RegistryError('not-configured', 'no OpenXLab credentials stored; sign in on the A2A settings page first')
    }
    return grant
  }

  #ssoFor(grant: OpenXLabGrant): OpenXLabSso {
    if (this.#sso === undefined || this.#ssoAk !== grant.ak) {
      this.#sso = this.#newSso(grant.ak, grant.sk)
      this.#ssoAk = grant.ak
    }
    return this.#sso
  }

  #bearer(grant: OpenXLabGrant): Promise<string> {
    return this.#ssoFor(grant).bearerToken()
  }
}

/**
 * The `ctx.a2aRegistry` service shell over {@link RegistryClientCore}.
 */
export class A2aRegistryService extends Service {
  static inject = ['credentials']

  /** The client core this shell exposes; public for tracing-proxy access. */
  readonly core: RegistryClientCore

  constructor(ctx: Context, config: RegistryServiceConfig) {
    super(ctx, 'a2aRegistry')
    this.core = new RegistryClientCore(ctx.credentials, config)
  }

  /** @returns the login state without network activity. */
  status(): Promise<RegistryLoginState> {
    return this.core.status()
  }

  /**
   * Store an AK/SK pair and prime the SSO session.
   * @param ak - the access key.
   * @param sk - the secret key.
   */
  login(ak: string, sk: string): Promise<void> {
    return this.core.login(ak, sk)
  }

  /** Remove the stored AK/SK pair and every in-memory token. */
  logout(): Promise<void> {
    return this.core.logout()
  }

  /**
   * The current SSO bearer and uid, shared with sibling services.
   * @returns the bearer token and user id.
   */
  identity(): Promise<{ bearer: string, userId: string | null }> {
    return this.core.identity()
  }

  /**
   * Discover the visible A2A agents.
   * @param signal - cooperative cancellation.
   * @returns the directory entries.
   */
  discover(signal?: AbortSignal): Promise<RegistryAgentEntry[]> {
    return this.core.discover(signal)
  }

  /**
   * Resolve the data-plane headers for one agent.
   * @param agentName - the registry resource name.
   * @param scheme - the resource's auth scheme.
   * @returns header name/value pairs.
   */
  agentHeaders(agentName: string, scheme: RegistryAuthScheme): Promise<Record<string, string>> {
    return this.core.agentHeaders(agentName, scheme)
  }

  /**
   * Drop cached STS tickets.
   * @param agentName - one agent; omit to clear every agent.
   */
  invalidateTickets(agentName?: string): void {
    this.core.invalidateTickets(agentName)
  }
}
