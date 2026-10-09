/**
 * Task-state classification: the A2A `TaskState` enum mapped onto this
 * library's outcome vocabulary with terminal and interrupted predicates.
 *
 * @module dsh-plugin-inkstone/a2a/states
 */
import { TaskState } from '@a2a-js/sdk';
/**
 * The library's outcome vocabulary. `stream-ended` is not a protocol state:
 * it reports that the SSE stream closed without a terminal or interrupted
 * status, leaving the task's real state unknown to this client.
 */
export type A2aTaskOutcome = 'unknown' | 'submitted' | 'working' | 'input-required' | 'auth-required' | 'completed' | 'failed' | 'canceled' | 'rejected' | 'stream-ended';
/**
 * Map one A2A task state onto the outcome vocabulary.
 * @param state - the protocol task state.
 * @returns the outcome; `unknown` for `UNSPECIFIED` and unrecognized values.
 */
export declare function classifyTaskState(state: TaskState): A2aTaskOutcome;
/**
 * Whether one outcome is a protocol terminal state after which the task
 * accepts no further messages.
 * @param outcome - the classified outcome.
 * @returns true for completed, failed, canceled, and rejected.
 */
export declare function isTerminalOutcome(outcome: A2aTaskOutcome): boolean;
/**
 * Whether one outcome is an interrupted state that expects the client to
 * answer (more input or re-authentication) by continuing the same task.
 * @param outcome - the classified outcome.
 * @returns true for input-required and auth-required.
 */
export declare function isInterruptedOutcome(outcome: A2aTaskOutcome): boolean;
