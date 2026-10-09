/**
 * Experimental A2A 1.0 protocol client library: card resolution, streaming
 * turns, task reads, part projection, and state classification over the
 * official `@a2a-js/sdk` transport.
 *
 * @module dsh-plugin-inkstone/a2a
 */

export { A2aError, classifyA2aError, type A2aErrorCode } from './error'
export {
  classifyTaskState,
  isInterruptedOutcome,
  isTerminalOutcome,
  type A2aTaskOutcome,
} from './states'
export {
  isReasoningPart,
  joinPartText,
  mergeArtifactUpdate,
  projectArtifact,
  projectMessageParts,
  projectPart,
  type A2aArtifactValue,
  type A2aPartValue,
} from './parts'
export { assertA2aEndpointUrl } from './url'
export {
  createA2aAgent,
  type A2aAgent,
  type A2aAgentOptions,
  type A2aCardSummary,
  type A2aTaskRef,
  type A2aTaskSnapshot,
  type A2aTurnOutcome,
  type A2aTurnRequest,
} from './client'
