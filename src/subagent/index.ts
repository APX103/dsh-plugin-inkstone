/**
 * Delegation mirror for 端砚: one remote subagent provider per enabled roster
 * agent plus the `subagent_a2a` delegation tool, rebuilt by the host entry
 * whenever the volatile roster changes.
 *
 * @module dsh-plugin-inkstone/subagent
 */

import type { Volatile } from '@deepseek-ai/cordis'
import type { RosterAgent } from './types'

export { ContinuationStore, createA2aProvider } from './provider'
export { registerA2aTool, describeTool, type A2aToolOptions } from './tool'
export type { A2aContinuation, A2aHeadersSource, RosterAgent } from './types'

/** Delegation configuration owned by the unified plugin entry. */
export interface DelegationConfig {
  /** The discovered roster of remote agents; edit through the settings tab or cordis.yml. */
  agents: Volatile<RosterAgent[]>
  /** Model-facing delegation tool name. */
  toolName: string
  /** Absolute delegation-depth cap; a delegation at or beyond it is refused. */
  maxDepth: number
}
