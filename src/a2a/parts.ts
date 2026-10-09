/**
 * Part projection and artifact accumulation: converts A2A protocol parts
 * into plain values, detects the platform's reasoning/thinking part
 * convention, and merges streamed artifact chunks by artifact id.
 *
 * @module dsh-plugin-inkstone/a2a/parts
 */

import type { Artifact, Message, Part, TaskArtifactUpdateEvent } from '@a2a-js/sdk'

/** One projected part; `kind` selects which value field is set. */
export interface A2aPartValue {
  /** Which protocol content variant this part carries. */
  readonly kind: 'text' | 'data' | 'file'
  /** Text content, set when `kind` is `text`. */
  readonly text?: string
  /** Structured JSON content, set when `kind` is `data`. */
  readonly data?: unknown
  /** File URL, set when `kind` is `file` and the part carried a URL. */
  readonly url?: string
  /** Base64 file bytes, set when `kind` is `file` and the part carried raw content. */
  readonly base64?: string
  /** Optional file name for `file` parts. */
  readonly filename?: string
  /** MIME type of the content; empty string when the part omitted it. */
  readonly mediaType: string
  /** Whether the part matches the platform's reasoning/thinking convention. */
  readonly reasoning: boolean
}

/** One fully-merged artifact assembled from its streamed chunks. */
export interface A2aArtifactValue {
  /** Protocol artifact id, unique within its task. */
  readonly artifactId: string
  /** Human-readable artifact name; empty string when omitted. */
  readonly name: string
  /** Human-readable artifact description; empty string when omitted. */
  readonly description: string
  /** The artifact's parts, in chunk arrival order. */
  readonly parts: readonly A2aPartValue[]
}

/**
 * Detect a reasoning/thinking part by the platform convention: part metadata
 * `kind`/`role` equal to `reasoning`, a reasoning media type, or a data
 * object carrying a thinking/reasoning/reasoning_content field.
 * @param part - the protocol part.
 * @returns whether the part represents reasoning.
 */
export function isReasoningPart(part: Part): boolean {
  const kind: unknown = part.metadata?.kind
  const role: unknown = part.metadata?.role
  if (kind === 'reasoning' || role === 'reasoning') {
    return true
  }
  if (part.mediaType.includes('reasoning')) {
    return true
  }
  const data: unknown = part.content?.$case === 'data' ? part.content.value : undefined
  if (data !== null && data !== undefined && typeof data === 'object') {
    const fields = data as Record<string, unknown>
    return ['thinking', 'reasoning', 'reasoning_content'].some(key => key in fields)
  }
  return false
}

/**
 * Project one protocol part to a plain value.
 * @param part - the protocol part.
 * @returns the projected part with its reasoning classification.
 */
export function projectPart(part: Part): A2aPartValue {
  const reasoning = isReasoningPart(part)
  const content = part.content
  if (content === undefined) {
    return { kind: 'text', text: '', mediaType: part.mediaType, reasoning }
  }
  switch (content.$case) {
    case 'text':
      return { kind: 'text', text: content.value, mediaType: part.mediaType, reasoning }
    case 'data':
      return { kind: 'data', data: content.value, mediaType: part.mediaType, reasoning }
    case 'url':
      return {
        kind: 'file', url: content.value, mediaType: part.mediaType, reasoning,
        ...(part.filename !== '' ? { filename: part.filename } : {}),
      }
    case 'raw': {
      // The SDK converts wire base64 to Buffer during fromJSON.
      const base64 = Buffer.from(content.value).toString('base64')
      return {
        kind: 'file', base64, mediaType: part.mediaType, reasoning,
        ...(part.filename !== '' ? { filename: part.filename } : {}),
      }
    }
  }
}

/**
 * Join the text of a part list.
 * @param parts - projected parts.
 * @param options - `reasoning` selects reasoning parts instead of ordinary text.
 * @returns the concatenated text.
 */
export function joinPartText(parts: readonly A2aPartValue[], options?: { reasoning?: boolean }): string {
  const wantReasoning = options?.reasoning === true
  return parts
    .filter(part => part.kind === 'text')
    .filter(part => part.reasoning === wantReasoning)
    // A text-kind part always carries its text; undefined joins as the empty string.
    .map(part => part.text)
    .join('')
}

/**
 * Project one protocol artifact's parts.
 * @param artifact - the protocol artifact.
 * @returns the projected artifact value.
 */
export function projectArtifact(artifact: Artifact): A2aArtifactValue {
  return {
    artifactId: artifact.artifactId,
    name: artifact.name,
    description: artifact.description,
    parts: artifact.parts.map(projectPart),
  }
}

/**
 * Project one protocol message's parts.
 * @param message - the protocol message.
 * @returns the projected parts.
 */
export function projectMessageParts(message: Message): readonly A2aPartValue[] {
  return message.parts.map(projectPart)
}

/**
 * Merge one streamed artifact update into the accumulating artifact map.
 * @param artifacts - the mutable map keyed by artifact id; updated in place.
 * @param event - the streamed artifact update event.
 */
export function mergeArtifactUpdate(artifacts: Map<string, A2aArtifactValue>, event: TaskArtifactUpdateEvent): void {
  const artifact = event.artifact
  if (artifact === undefined) return
  const projected = projectArtifact(artifact)
  const existing = artifacts.get(artifact.artifactId)
  if (event.append && existing !== undefined) {
    artifacts.set(artifact.artifactId, { ...existing, parts: [...existing.parts, ...projected.parts] })
  } else {
    artifacts.set(artifact.artifactId, projected)
  }
}
