/**
 * Part projection and artifact accumulation: converts A2A protocol parts
 * into plain values, detects the platform's reasoning/thinking part
 * convention, and merges streamed artifact chunks by artifact id.
 *
 * @module dsh-plugin-inkstone/a2a/parts
 */
import type { Artifact, Message, Part, TaskArtifactUpdateEvent } from '@a2a-js/sdk';
/** One projected part; `kind` selects which value field is set. */
export interface A2aPartValue {
    /** Which protocol content variant this part carries. */
    readonly kind: 'text' | 'data' | 'file';
    /** Text content, set when `kind` is `text`. */
    readonly text?: string;
    /** Structured JSON content, set when `kind` is `data`. */
    readonly data?: unknown;
    /** File URL, set when `kind` is `file` and the part carried a URL. */
    readonly url?: string;
    /** Base64 file bytes, set when `kind` is `file` and the part carried raw content. */
    readonly base64?: string;
    /** Optional file name for `file` parts. */
    readonly filename?: string;
    /** MIME type of the content; empty string when the part omitted it. */
    readonly mediaType: string;
    /** Whether the part matches the platform's reasoning/thinking convention. */
    readonly reasoning: boolean;
}
/** One fully-merged artifact assembled from its streamed chunks. */
export interface A2aArtifactValue {
    /** Protocol artifact id, unique within its task. */
    readonly artifactId: string;
    /** Human-readable artifact name; empty string when omitted. */
    readonly name: string;
    /** Human-readable artifact description; empty string when omitted. */
    readonly description: string;
    /** The artifact's parts, in chunk arrival order. */
    readonly parts: readonly A2aPartValue[];
}
/**
 * Detect a reasoning/thinking part by the platform convention: part metadata
 * `kind`/`role` equal to `reasoning`, a reasoning media type, or a data
 * object carrying a thinking/reasoning/reasoning_content field.
 * @param part - the protocol part.
 * @returns whether the part represents reasoning.
 */
export declare function isReasoningPart(part: Part): boolean;
/**
 * Project one protocol part to a plain value.
 * @param part - the protocol part.
 * @returns the projected part with its reasoning classification.
 */
export declare function projectPart(part: Part): A2aPartValue;
/**
 * Join the text of a part list.
 * @param parts - projected parts.
 * @param options - `reasoning` selects reasoning parts instead of ordinary text.
 * @returns the concatenated text.
 */
export declare function joinPartText(parts: readonly A2aPartValue[], options?: {
    reasoning?: boolean;
}): string;
/**
 * Project one protocol artifact's parts.
 * @param artifact - the protocol artifact.
 * @returns the projected artifact value.
 */
export declare function projectArtifact(artifact: Artifact): A2aArtifactValue;
/**
 * Project one protocol message's parts.
 * @param message - the protocol message.
 * @returns the projected parts.
 */
export declare function projectMessageParts(message: Message): readonly A2aPartValue[];
/**
 * Merge one streamed artifact update into the accumulating artifact map.
 * @param artifacts - the mutable map keyed by artifact id; updated in place.
 * @param event - the streamed artifact update event.
 */
export declare function mergeArtifactUpdate(artifacts: Map<string, A2aArtifactValue>, event: TaskArtifactUpdateEvent): void;
