/**
 * Delegation mirror for 端砚: one remote subagent provider per enabled roster
 * agent plus the `subagent_a2a` delegation tool, rebuilt by the host entry
 * whenever the volatile roster changes.
 *
 * @module dsh-plugin-inkstone/subagent
 */
export { ContinuationStore, createA2aProvider } from './provider';
export { registerA2aTool, describeTool } from './tool';
