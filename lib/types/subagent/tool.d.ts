/**
 * The `subagent_a2a` delegation tool: one model-facing tool whose `agent`
 * parameter selects among the enabled roster agents, routing through the
 * subagent seam's provider registered for that agent.
 *
 * @module dsh-plugin-inkstone/subagent/tool
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ResolvedSubagentStartRequest, SubagentResult } from '@deepseek-ai/dsh-subagent';
import type { RosterAgent } from './types';
/** Tool configuration surface. */
export interface A2aToolOptions {
    /** Model-facing tool name. */
    readonly toolName: string;
    /** Absolute delegation-depth cap; a delegation at or beyond it is refused. */
    readonly maxDepth: number;
}
/** The published delegation this tool awaits and disposes. */
export interface DelegationRun {
    /** The settled remote outcome. */
    readonly result: Promise<SubagentResult>;
    /** Release the delegation after the outcome is consumed. */
    dispose(): Promise<void>;
}
/**
 * Publish one delegation on whichever seam this harness build exposes.
 * @param ctx - registrant context carrying the subagent service.
 * @param provider - the provider name (`a2a/<agent>`).
 * @param request - prompt, parent, and cancellation.
 * @returns the published run, awaiting settlement and disposal by the caller.
 */
export declare function startDelegation(ctx: Context, provider: string, request: Omit<ResolvedSubagentStartRequest, 'descriptor'> & {
    label?: string;
}): Promise<DelegationRun>;
/**
 * Compose the model-facing tool description from the roster.
 * @param agents - the enabled roster agents.
 * @returns the description text.
 */
export declare function describeTool(agents: readonly RosterAgent[]): string;
/**
 * Register the delegation tool on `ctx.tools`.
 * @param ctx - registrant context carrying the subagent and tool services.
 * @param agents - the enabled roster agents.
 * @param options - tool name and depth cap.
 * @returns the registration disposer.
 */
export declare function registerA2aTool(ctx: Context, agents: readonly RosterAgent[], options: A2aToolOptions): () => void;
