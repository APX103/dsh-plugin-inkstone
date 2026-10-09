/**
 * Task-state classification: the A2A `TaskState` enum mapped onto this
 * library's outcome vocabulary with terminal and interrupted predicates.
 *
 * @module dsh-plugin-inkstone/a2a/states
 */
import { TaskState } from '@a2a-js/sdk';
/**
 * Map one A2A task state onto the outcome vocabulary.
 * @param state - the protocol task state.
 * @returns the outcome; `unknown` for `UNSPECIFIED` and unrecognized values.
 */
export function classifyTaskState(state) {
    switch (state) {
        case TaskState.TASK_STATE_SUBMITTED: return 'submitted';
        case TaskState.TASK_STATE_WORKING: return 'working';
        case TaskState.TASK_STATE_INPUT_REQUIRED: return 'input-required';
        case TaskState.TASK_STATE_AUTH_REQUIRED: return 'auth-required';
        case TaskState.TASK_STATE_COMPLETED: return 'completed';
        case TaskState.TASK_STATE_FAILED: return 'failed';
        case TaskState.TASK_STATE_CANCELED: return 'canceled';
        case TaskState.TASK_STATE_REJECTED: return 'rejected';
        default: return 'unknown';
    }
}
/**
 * Whether one outcome is a protocol terminal state after which the task
 * accepts no further messages.
 * @param outcome - the classified outcome.
 * @returns true for completed, failed, canceled, and rejected.
 */
export function isTerminalOutcome(outcome) {
    return outcome === 'completed' || outcome === 'failed' || outcome === 'canceled' || outcome === 'rejected';
}
/**
 * Whether one outcome is an interrupted state that expects the client to
 * answer (more input or re-authentication) by continuing the same task.
 * @param outcome - the classified outcome.
 * @returns true for input-required and auth-required.
 */
export function isInterruptedOutcome(outcome) {
    return outcome === 'input-required' || outcome === 'auth-required';
}
