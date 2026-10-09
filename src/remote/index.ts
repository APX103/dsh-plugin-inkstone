/**
 * Authenticated browser access to the experimental agent-registry client:
 * login state and sign-in for the OpenXLab SSO lifecycle, and A2A directory
 * discovery. Per-agent credential headers stay Host-side — no method here
 * returns a token or ticket.
 *
 * @module dsh-plugin-inkstone/remote
 */

import { Context } from '@deepseek-ai/cordis'
import type { RegistryAgentEntry, RegistryLoginState } from '../registry/index'
import { RegistryError } from '../registry/index'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { A2aAgentView, A2aStatusView } from './types'

export type * from './types'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Experimental agent-registry Remote controller. */
    a2aRegistryController: A2aRegistryController
  }
}

/** Project the login state onto its wire view. */
function statusView(state: RegistryLoginState): A2aStatusView {
  return {
    configured: state.configured,
    authenticated: state.authenticated,
    registryBaseUrl: state.registryBaseUrl,
    expiresAtMs: state.expiresAtMs ?? null,
    userId: state.userId ?? null,
  }
}

/** Project one directory entry onto its wire view. */
function agentView(entry: RegistryAgentEntry): A2aAgentView {
  return {
    name: entry.name,
    uri: entry.uri ?? null,
    description: entry.description,
    endpointUrl: entry.endpointUrl,
    authScheme: entry.authScheme,
    probeStatus: entry.probeStatus,
  }
}

/**
 * Classify one registry-client failure as a Remote failure. The AK/SK pair
 * never appears in a reason string.
 */
function remoteFailure(error: unknown): RemoteError {
  // Only the gateway wraps failures in RemoteError before this layer; keep
  // such a wrap intact instead of double-classifying it. The registry client
  // itself never throws one.
  /* v8 ignore next 3 -- unreachable from this controller's own services */
  if (error instanceof RemoteError) {
    return error
  }
  let reason: string
  // Registry-client failures are Error instances; anything else degrades to text.
  /* v8 ignore next 5 -- the registry client throws Error values only */
  if (error instanceof Error) {
    reason = error.message
  } else {
    reason = String(error)
  }
  if (error instanceof RegistryError) {
    if (error.code.startsWith('sso-') || error.code === 'not-configured') {
      let code: 'a2a/not-configured' | 'a2a/sso-rejected'
      if (error.code === 'not-configured') {
        code = 'a2a/not-configured'
      } else {
        code = 'a2a/sso-rejected'
      }
      return new RemoteError(code, reason, { reason })
    }
    return new RemoteError('a2a/discovery-unavailable', reason, { reason })
  }
  return new RemoteError('a2a/discovery-unavailable', reason, { reason })
}

/**
 * Remote owner of the `a2aRegistry` namespace over the Host registry client.
 */
export default class A2aRegistryController extends TypertRemoteService {
  static inject = ['a2aRegistry']

  /** @param ctx - Host context where the registry client service is mounted. */
  constructor(ctx: Context) {
    super(ctx, 'a2aRegistryController', { namespace: 'a2aRegistry' })
  }

  /**
   * Read the login state without network activity.
   * @returns whether credentials are stored and the cached token state.
   */
  @Remote
  async status(): Promise<A2aStatusView> {
    return statusView(await this.ctx.a2aRegistry.status())
  }

  /**
   * Store an AK/SK pair and prime the SSO session, rejecting bad pairs. The
   * pair crosses the wire in this direction only; no read path returns it.
   * @param ak - the access key.
   * @param sk - the secret key.
   */
  @Remote
  async login(ak: string, sk: string): Promise<void> {
    try {
      await this.ctx.a2aRegistry.login(ak, sk)
    } catch (error) {
      throw remoteFailure(error)
    }
  }

  /**
   * Remove the stored AK/SK pair and every in-memory token.
   */
  @Remote
  async logout(): Promise<void> {
    await this.ctx.a2aRegistry.logout()
  }

  /**
   * Discover the visible A2A agents from the registry directory.
   * @param signal - Client cancellation.
   * @returns the directory entries in registry order.
   */
  @Remote
  async discover(signal: AbortSignal): Promise<A2aAgentView[]> {
    try {
      signal.throwIfAborted()
      const entries = await this.ctx.a2aRegistry.discover(signal)
      return entries.map(agentView)
    } catch (error) {
      throw remoteFailure(error)
    }
  }
}
