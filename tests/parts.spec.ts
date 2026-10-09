import { describe, expect, it } from 'vitest'
import { TaskArtifactUpdateEvent, type Part } from '@a2a-js/sdk'
import {
  isReasoningPart,
  joinPartText,
  mergeArtifactUpdate,
  projectMessageParts,
  projectPart,
} from '../src/a2a/parts'

const textPart = (text: string, extra: Partial<Part> = {}): Part => ({
  content: { $case: 'text', value: text },
  metadata: undefined,
  filename: '',
  mediaType: 'text/plain',
  ...extra,
})

describe('isReasoningPart', () => {
  it('detects metadata kind and role markers', () => {
    expect(isReasoningPart(textPart('thinking', { metadata: { kind: 'reasoning' } }))).toBe(true)
    expect(isReasoningPart(textPart('thinking', { metadata: { role: 'reasoning' } }))).toBe(true)
  })

  it('detects a reasoning media type', () => {
    expect(isReasoningPart(textPart('x', { mediaType: 'application/vnd.acme.reasoning+json' }))).toBe(true)
    expect(isReasoningPart(textPart('x'))).toBe(false)
  })

  it('detects a data object with a reasoning field', () => {
    const part: Part = { content: { $case: 'data', value: { thinking: 'why' } }, metadata: undefined, filename: '', mediaType: 'application/json' }
    expect(isReasoningPart(part)).toBe(true)
    const reasoningKey: Part = { content: { $case: 'data', value: { reasoning: 'because' } }, metadata: undefined, filename: '', mediaType: 'application/json' }
    expect(isReasoningPart(reasoningKey)).toBe(true)
    const reasoningContent: Part = { content: { $case: 'data', value: { reasoning_content: 'chain' } }, metadata: undefined, filename: '', mediaType: 'application/json' }
    expect(isReasoningPart(reasoningContent)).toBe(true)
    const other: Part = { content: { $case: 'data', value: { answer: 1 } }, metadata: undefined, filename: '', mediaType: 'application/json' }
    expect(isReasoningPart(other)).toBe(false)
  })

  it('handles a contentless part and null data without classifying reasoning', () => {
    const empty: Part = { content: undefined, metadata: undefined, filename: '', mediaType: '' }
    expect(isReasoningPart(empty)).toBe(false)
    const nullData: Part = { content: { $case: 'data', value: null }, metadata: undefined, filename: '', mediaType: 'application/json' }
    expect(isReasoningPart(nullData)).toBe(false)
  })
})

describe('projectPart', () => {
  it('projects text, data, url, and raw parts', () => {
    expect(projectPart(textPart('hello'))).toMatchObject({ kind: 'text', text: 'hello', reasoning: false })
    const data: Part = { content: { $case: 'data', value: [1, 2] }, metadata: undefined, filename: '', mediaType: 'application/json' }
    expect(projectPart(data)).toMatchObject({ kind: 'data', data: [1, 2] })
    const url: Part = { content: { $case: 'url', value: 'https://example.com/f.pdf' }, metadata: undefined, filename: 'f.pdf', mediaType: 'application/pdf' }
    expect(projectPart(url)).toMatchObject({ kind: 'file', url: 'https://example.com/f.pdf', filename: 'f.pdf' })
    const urlUnnamed: Part = { content: { $case: 'url', value: 'https://example.com/x' }, metadata: undefined, filename: '', mediaType: 'text/uri-list' }
    expect(projectPart(urlUnnamed)).toEqual({ kind: 'file', url: 'https://example.com/x', mediaType: 'text/uri-list', reasoning: false })
    const raw: Part = { content: { $case: 'raw', value: Buffer.from('hi') }, metadata: undefined, filename: 'a.txt', mediaType: 'text/plain' }
    expect(projectPart(raw)).toMatchObject({ kind: 'file', base64: 'aGk=', filename: 'a.txt' })
    const rawBuffer: Part = { content: { $case: 'raw', value: Buffer.from('hi') }, metadata: undefined, filename: '', mediaType: 'text/plain' }
    expect(projectPart(rawBuffer)).toEqual({ kind: 'file', base64: 'aGk=', mediaType: 'text/plain', reasoning: false })
  })

  it('projects a contentless part as empty text', () => {
    const empty: Part = { content: undefined, metadata: undefined, filename: '', mediaType: '' }
    expect(projectPart(empty)).toEqual({ kind: 'text', text: '', mediaType: '', reasoning: false })
  })

  it('marks reasoning parts', () => {
    expect(projectPart(textPart('why', { metadata: { kind: 'reasoning' } })).reasoning).toBe(true)
  })
})

describe('joinPartText', () => {
  it('joins ordinary and reasoning text separately', () => {
    const projected = [
      projectPart(textPart('a')),
      projectPart(textPart('why', { metadata: { kind: 'reasoning' } })),
      projectPart(textPart('b')),
    ]
    const parts = [...projected, { kind: 'data' as const, data: { n: 1 }, mediaType: 'application/json', reasoning: false }]
    expect(joinPartText(parts)).toBe('ab')
    expect(joinPartText(parts, { reasoning: true })).toBe('why')
  })
})

describe('mergeArtifactUpdate', () => {
  it('appends chunk parts and replaces fresh artifacts', () => {
    const artifacts = new Map<string, import('../src/a2a/parts.ts').A2aArtifactValue>()
    const first = update('a-1', 'one', false)
    mergeArtifactUpdate(artifacts, first)
    mergeArtifactUpdate(artifacts, update('a-1', 'two', true))
    expect(artifacts.get('a-1')?.parts.map(part => part.text)).toEqual(['one', 'two'])
    mergeArtifactUpdate(artifacts, update('a-1', 'fresh', false))
    expect(artifacts.get('a-1')?.parts.map(part => part.text)).toEqual(['fresh'])
    expect(artifacts.size).toBe(1)
  })

  it('ignores an update without an artifact', () => {
    const artifacts = new Map<string, import('../src/a2a/parts.ts').A2aArtifactValue>()
    const update = { taskId: 't', contextId: 'c', artifact: undefined, append: false, lastChunk: true }
    mergeArtifactUpdate(artifacts, update as TaskArtifactUpdateEvent)
    expect(artifacts.size).toBe(0)
  })
})

describe('projectMessageParts', () => {
  it('projects every part of one message', () => {
    const parts = projectMessageParts({
      messageId: 'm',
      contextId: 'c',
      taskId: '',
      role: 2,
      parts: [textPart('x'), textPart('y')],
      metadata: undefined,
      extensions: [],
      referenceTaskIds: [],
    })
    expect(parts.map(part => part.text)).toEqual(['x', 'y'])
  })
})

function update(artifactId: string, text: string, append: boolean): TaskArtifactUpdateEvent {
  return {
    taskId: 't',
    contextId: 'c',
    artifact: {
      artifactId,
      name: 'n',
      description: '',
      parts: [textPart(text, { mediaType: 'text/markdown' })],
      metadata: undefined,
      extensions: [],
    },
    append,
    lastChunk: true,
    metadata: undefined,
  }
}
