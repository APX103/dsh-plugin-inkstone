/**
 * Selective tool bridge: register ONLY the tools the user picked for one SCP
 * server. Discovery (`tools/list`) runs once per mount; every registered tool
 * forwards execution to the stateless execution plane (`tools/call`) with the
 * caller's cancellation layered on a request deadline. Result projection
 * (text join, structured content, durable image admission) mirrors the
 * harness mcp-client bridge so model-facing behavior stays consistent.
 *
 * @module dsh-plugin-inkstone/scphub/tools-bridge
 */

import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import type { Context } from '@deepseek-ai/cordis'
import { isImageAdmissionError } from '@deepseek-ai/dsh-attachment'
import type { AttachmentStore, ImageAttachmentRef, ImageMediaType, SaveImageAttachment } from '@deepseek-ai/dsh-attachment'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { ToolDefinition, ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { assertSupportedJsonSchema } from '@deepseek-ai/dsh-tools'
import type { JsonSchemaNode } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { callScpTool, listScpTools, type McpToolSpec } from './mcp'

/** DeepSeek function-name contract: at most 64 characters. */
const MAX_PUBLIC_NAME_LENGTH = 64

/** DeepSeek function-name contract: only `[A-Za-z0-9_-]` is allowed. */
const INVALID_NAME_CHARS = /[^A-Za-z0-9_-]/g

/** Hex chars of the SHA-256 identity hash appended on lossy normalization. */
const HASH_LENGTH = 12

/** Raster formats supported by the durable attachment vocabulary. */
const IMAGE_MEDIA_TYPES: readonly ImageMediaType[] = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]

/** Canonical RFC 4648 base64, excluding whitespace and URL-safe aliases. */
const CANONICAL_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

/** Canonical MCP result this bridge returns to the tool runtime. */
export type ScpToolResult = {
  content: JsonValue[]
  structuredContent?: JsonValue
}

/** Fields read off canonical content blocks, including policy replacements. */
interface McpContentBlock {
  type: string
  text?: string
  mimeType?: string
  data?: string
  name?: string
  uri?: string
}

/** Image projection staged for one exact tool execution. */
interface PreparedProjection {
  value: ScpToolResult
  fallback: ContentBlock[]
  content: ContentBlock[]
}

/** Options for {@link registerScpTools}. */
export interface ScpToolsMountOptions {
  /** The MCP endpoint URL. */
  readonly endpoint: string
  /** Registry namespace behind `mcp__<serverName>__*` public names. */
  readonly serverName: string
  /** Raw upstream names chosen by the user; only these register. */
  readonly selectedTools: readonly string[]
  /** Execution API key supplier; consulted per request so expiry refreshes. */
  readonly apiKey: () => Promise<string>
  /** One name the mount could not resolve; reported through the callback. */
  readonly onMissingTool: (rawName: string) => void
  /** Injectable fetch for tests; defaults to global fetch. */
  readonly fetchImpl?: typeof fetch
}

/**
 * Derive the model-facing public name for one MCP tool, mirroring the harness
 * naming contract: `mcp__<serverName>__<rawName>` verbatim when it already
 * satisfies the function-name rules; otherwise normalized with a 12-hex-char
 * SHA-256 identity suffix so distinct tools never collapse.
 * @param serverName - stable local namespace from the local entry.
 * @param rawName - the SCP server's own tool name.
 * @returns the model-facing tool name.
 */
export function publicToolName(serverName: string, rawName: string): string {
  const joined = `mcp__${serverName}__${rawName}`
  const normalized = joined.replace(INVALID_NAME_CHARS, '_')
  if (normalized === joined && normalized.length <= MAX_PUBLIC_NAME_LENGTH) return normalized
  const hash = createHash('sha256').update(`${serverName}\0${rawName}`).digest('hex').slice(0, HASH_LENGTH)
  return `${normalized.slice(0, MAX_PUBLIC_NAME_LENGTH - HASH_LENGTH - 1)}_${hash}`
}

/**
 * Discover one SCP's tools and register only the selected ones.
 * @param ctx - plugin context carrying the tools registry and optional
 * attachment/llm services for image admission.
 * @param options - endpoint, namespace, selection, key supplier, hooks.
 * @returns disposer unregistering everything this call registered.
 * @throws when discovery fails; nothing is registered in that case.
 */
export async function registerScpTools(ctx: Context, options: ScpToolsMountOptions): Promise<() => void> {
  const apiKey = await options.apiKey()
  const specs = await listScpTools(options.endpoint, apiKey, options.fetchImpl ?? fetch)
  const byName = new Map(specs.map(spec => [spec.name, spec]))
  const disposers: Array<() => void> = []
  try {
    for (const rawName of new Set(options.selectedTools)) {
      const spec = byName.get(rawName)
      if (spec === undefined) {
        options.onMissingTool(rawName)
        continue
      }
      disposers.push(ctx.tools.register(scpToolDefinition(ctx, options, spec)))
    }
  } catch (error) {
    for (const dispose of disposers.splice(0)) dispose()
    throw error
  }
  return () => {
    for (const dispose of disposers.splice(0)) dispose()
  }
}

/**
 * Build one registered tool definition from an upstream spec.
 * @param ctx - plugin context for optional image admission services.
 * @param options - mount options (endpoint, namespace, key supplier).
 * @param spec - the upstream tool as `tools/list` reported it.
 * @returns the unregistered ToolRuntime definition.
 */
function scpToolDefinition(ctx: Context, options: ScpToolsMountOptions, spec: McpToolSpec): ToolDefinition {
  const projections = new WeakMap<ToolExecution, PreparedProjection>()
  return {
    name: publicToolName(options.serverName, spec.name),
    description: spec.description,
    parameters: spec.inputSchema,
    output: createOutput(spec.name, supportedOutputSchema(spec.outputSchema)),
    execute: createExecutor(ctx, options, spec, projections),
    projectContent(exec: Readonly<ToolExecution>, result: Readonly<ToolExecutionResult>) {
      const projection = projections.get(exec)
      if (projection === undefined) return undefined
      projections.delete(exec)
      if (result.isError) return undefined
      if (!isDeepStrictEqual(result.value, projection.value)) return undefined
      if (!isDeepStrictEqual(result.content, projection.fallback)) return undefined
      return projection.content
    },
  }
}

/** Build the canonical result schema and the Native text projection. */
function createOutput(rawName: string, structuredSchema: JsonSchemaNode | undefined): ToolDefinition['output'] {
  return {
    schema: {
      type: 'object',
      properties: {
        content: { type: 'array', items: {} },
        structuredContent: structuredSchema ?? {},
      },
      required: structuredSchema === undefined ? ['content'] : ['content', 'structuredContent'],
      additionalProperties: false,
    },
    render(_args: unknown, value: JsonValue) {
      const result = value as ScpToolResult
      return [{ type: 'text', text: extractText(result.content, rawName) }]
    },
  }
}

/** Keep a supported advertised schema; unsupported MCP vocabulary falls back to JsonValue. */
function supportedOutputSchema(candidate: unknown): JsonSchemaNode | undefined {
  if (candidate === undefined) return undefined
  try {
    assertSupportedJsonSchema(candidate)
    return candidate
  } catch {
    return undefined
  }
}

/**
 * Invoke the execution plane and prepare canonical content. MCP `isError`
 * results reject before image storage so ToolRuntime records failure.
 */
function createExecutor(
  ctx: Context,
  options: ScpToolsMountOptions,
  spec: McpToolSpec,
  projections: WeakMap<ToolExecution, PreparedProjection>,
): ToolDefinition['execute'] {
  const { name: rawName } = spec
  return async (args: unknown, exec: ToolExecution) => {
    // The agent loop passes `JSON.parse(model_arguments)`, which is usually an
    // object but can be any JSON value if the model misbehaves; falling back
    // to {} lets the server answer with a learnable missing-param error.
    const argsObj = (typeof args === 'object' && args !== null ? args : {}) as Record<string, unknown>
    const raw = await callScpTool(options.endpoint, await options.apiKey(), rawName, argsObj, options.fetchImpl ?? fetch, exec.signal)
    const content = (Array.isArray(raw.content) ? raw.content : []) as JsonValue[]
    const text = extractText(content, rawName)
    if (raw.isError === true) {
      throw new Error(text)
    }
    const value: ScpToolResult = {
      content,
      ...(raw.structuredContent !== undefined ? { structuredContent: raw.structuredContent as JsonValue } : {}),
    }
    if (containsImage(content)) {
      const fallback: ContentBlock[] = [{ type: 'text', text: extractText(content, rawName) }]
      const projected = await prepareImageProjection(ctx, exec, content, rawName)
      projections.set(exec, { value, fallback, content: projected })
    }
    return value
  }
}

/** Whether an untrusted MCP content array contains a declared image block. */
function containsImage(content: JsonValue[]): boolean {
  return content.some(value => isRecord(value) && value.type === 'image')
}

/** Narrow one JSON value to a string-keyed object. */
function isRecord(value: JsonValue): value is { [key in string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Narrow a declared MIME string to the durable image vocabulary. */
function isImageMediaType(value: string): value is ImageMediaType {
  return IMAGE_MEDIA_TYPES.includes(value as ImageMediaType)
}

/** Decode one projected image without accepting base64 aliases. */
function decodeImage(block: McpContentBlock): SaveImageAttachment {
  if (!isImageMediaType(block.mimeType ?? '')) {
    throw new Error('the declared media type is not PNG, JPEG, WebP, or GIF')
  }
  if (typeof block.data !== 'string' || !CANONICAL_BASE64.test(block.data)) {
    throw new Error('the image data is not canonical base64')
  }
  const data = Buffer.from(block.data, 'base64')
  if (data.toString('base64') !== block.data) {
    throw new Error('the image data is not canonical base64')
  }
  return { data, mediaType: block.mimeType as ImageMediaType }
}

/**
 * Resolve the active model route and durable store for an image-bearing result.
 * @param ctx - plugin context with optional attachment and llm services.
 * @param exec - exact tool execution whose agent supplies the latest route.
 * @returns the attachment store after exact positive image-capability proof.
 */
async function resolveImageAdmission(ctx: Context, exec: ToolExecution): Promise<AttachmentStore> {
  const attachments = ctx.get('attachments')
  if (attachments === undefined) throw new Error('no attachment store is mounted')
  const routed = exec.agent?.session.requestHeader()?.config
  const provider = routed?.provider ?? exec.agent?.options.provider
  const model = routed?.model ?? exec.agent?.options.model
  const llm = ctx.get('llm')
  if (provider === undefined || model === undefined || llm === undefined) {
    throw new Error('the current model route could not be resolved')
  }
  let info: Awaited<ReturnType<typeof llm.resolveModelInfo>>
  try {
    info = await llm.resolveModelInfo(provider, model, exec.signal)
  } catch {
    throw new Error('the current model route could not be verified')
  }
  if (info.inputModalities === undefined || !info.inputModalities.includes('image')) {
    throw new Error(`model "${model}" does not declare image input`)
  }
  if (exec.signal.aborted) throw new Error('the tool call was canceled before image storage')
  return attachments
}

/** Stable diagnostic text for an image block that was not admitted. */
function imageDiagnostic(block: McpContentBlock, reason: string): string {
  const mediaType = block.mimeType ?? 'unknown media type'
  return `[image unavailable: ${mediaType}; ${reason}; raw image data remains available to programmatic callers]`
}

/**
 * Decode, preflight, and durably save one MCP result's ordered image batch.
 * Any refusal projects every image as text while retaining the canonical raw
 * value for programmatic callers.
 */
async function prepareImageProjection(
  ctx: Context,
  exec: ToolExecution,
  content: JsonValue[],
  toolName: string,
): Promise<ContentBlock[]> {
  const decoded: SaveImageAttachment[] = []
  const validationErrors = new Map<number, string>()
  const imageIndexes: number[] = []
  for (const [index, value] of content.entries()) {
    if (!isRecord(value) || value.type !== 'image') continue
    imageIndexes.push(index)
    try {
      decoded.push(decodeImage(value as unknown as McpContentBlock))
    } catch (error: unknown) {
      validationErrors.set(index, (error as Error).message)
    }
  }
  if (validationErrors.size > 0) {
    return projectContent(content, toolName, (block, index) => ({
      type: 'text',
      text: imageDiagnostic(block, validationErrors.get(index) ?? 'another image in the same result was invalid'),
    }))
  }

  let attachments: AttachmentStore
  try {
    attachments = await resolveImageAdmission(ctx, exec)
  } catch (error: unknown) {
    const reason = (error as Error).message
    return projectContent(content, toolName, block => ({ type: 'text', text: imageDiagnostic(block, reason) }))
  }

  try {
    const refs = await attachments.saveImages(decoded)
    const byIndex = new Map(imageIndexes.map((index, offset) => [index, refs[offset] as ImageAttachmentRef] as const))
    return projectContent(content, toolName, (_block, index) => ({
      type: 'image',
      attachment: byIndex.get(index) as ImageAttachmentRef,
    }))
  } catch (error: unknown) {
    const reason = isImageAdmissionError(error)
      ? `image admission rejected the result: ${error.message}`
      : 'durable image storage rejected the result'
    return projectContent(content, toolName, block => ({ type: 'text', text: imageDiagnostic(block, reason) }))
  }
}

/**
 * Extract text from an MCP content array into a single string: text blocks
 * join with '\n'; image/audio/resource blocks become placeholders.
 */
function extractText(mcpContent: JsonValue[], toolName: string): string {
  const content = projectContent(mcpContent, toolName)
  return content.map(block => (block as Extract<ContentBlock, { type: 'text' }>).text).join('\n')
}

/**
 * Project ordered MCP blocks into the core content vocabulary. Text-like runs
 * are newline-coalesced; admitted images split those runs at their position.
 */
function projectContent(
  mcpContent: JsonValue[],
  toolName: string,
  image: (block: McpContentBlock, index: number) => ContentBlock = block => ({
    type: 'text',
    text: imageDiagnostic(block, 'this result was not admitted to durable model context'),
  }),
): ContentBlock[] {
  const projected: ContentBlock[] = []
  const text: string[] = []
  const flushText = (): void => {
    if (text.length === 0) return
    projected.push({ type: 'text', text: text.splice(0).join('\n') })
  }

  for (const [index, value] of mcpContent.entries()) {
    if (!isRecord(value)) {
      text.push('[unsupported MCP content block: expected an object]')
      continue
    }
    const block = value as unknown as McpContentBlock
    switch (block.type) {
      case 'text':
        if (block.text !== undefined) text.push(block.text)
        break
      case 'image':
        flushText()
        projected.push(image(block, index))
        break
      case 'resource_link':
        if (block.name === undefined || block.uri === undefined) {
          text.push('[resource link unavailable: the MCP block is missing its name or URI]')
        } else {
          text.push(`Resource link: ${block.name} (${block.uri})`)
        }
        break
      case 'audio':
        text.push(`[audio result unsupported: ${block.mimeType ?? 'unknown media type'}; raw audio data remains available to programmatic callers]`)
        break
      case 'resource':
        text.push('[embedded resource unsupported; raw resource data remains available to programmatic callers]')
        break
      default:
        text.push(`[unsupported MCP content type: ${block.type}]`)
    }
  }
  flushText()
  return projected.length > 0
    ? projected
    : [{ type: 'text', text: `(${toolName} returned no model-visible content)` }]
}
