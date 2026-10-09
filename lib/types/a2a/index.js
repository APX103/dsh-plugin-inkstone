/**
 * Experimental A2A 1.0 protocol client library: card resolution, streaming
 * turns, task reads, part projection, and state classification over the
 * official `@a2a-js/sdk` transport.
 *
 * @module dsh-plugin-inkstone/a2a
 */
export { A2aError, classifyA2aError } from './error';
export { classifyTaskState, isInterruptedOutcome, isTerminalOutcome, } from './states';
export { isReasoningPart, joinPartText, mergeArtifactUpdate, projectArtifact, projectMessageParts, projectPart, } from './parts';
export { assertA2aEndpointUrl } from './url';
export { createA2aAgent, } from './client';
