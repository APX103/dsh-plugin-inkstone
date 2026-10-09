/**
 * The `subagent_a2a` delegation tool: one model-facing tool whose `agent`
 * parameter selects among the enabled roster agents, routing through the
 * subagent seam's provider registered for that agent.
 *
 * @module dsh-plugin-inkstone/subagent/tool
 */
import type { Context } from '@deepseek-ai/cordis';
import type { RosterAgent } from './types';
/** Tool configuration surface. */
export interface A2aToolOptions {
    /** Model-facing tool name. */
    readonly toolName: string;
    /** Absolute delegation-depth cap; a delegation at or beyond it is refused. */
    readonly maxDepth: number;
}
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
