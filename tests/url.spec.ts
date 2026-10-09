import { describe, expect, it } from 'vitest'
import { A2aError } from '../src/a2a/error'
import { classifyA2aError } from '../src/a2a/error'
import { assertA2aEndpointUrl } from '../src/a2a/url'

describe('assertA2aEndpointUrl', () => {
  it('accepts https endpoints', () => {
    expect(assertA2aEndpointUrl('https://agent.example.com/a2a').href).toBe('https://agent.example.com/a2a')
  })

  it('accepts http only for literal loopback hosts', () => {
    expect(assertA2aEndpointUrl('http://127.0.0.1:8080/a2a').hostname).toBe('127.0.0.1')
    expect(assertA2aEndpointUrl('http://[::1]:8080/a2a').hostname).toBe('[::1]')
  })

  it('rejects http outside loopback, credentials, query, and fragments', () => {
    expectRejection('http://agent.example.com/a2a')
    expectRejection('https://user:pass@agent.example.com/a2a')
    expectRejection('https://agent.example.com/a2a?token=1')
    expectRejection('https://agent.example.com/a2a#frag')
  })

  it('rejects non-URLs', () => {
    expectRejection('not a url')
    expectRejection('')
  })
})

describe('classifyA2aError', () => {
  it('classifies abort, auth, and forbidden by name, status, and message', () => {
    expect(classifyA2aError(new DOMException('aborted', 'AbortError'))).toBe('aborted')
    expect(classifyA2aError(new Error('This operation was aborted'))).toBe('aborted')
    expect(classifyA2aError(Object.assign(new Error('HTTP error for SendStreamingMessage! Status: 401 Unauthorized'), { status: 401 }))).toBe('auth')
    expect(classifyA2aError(new Error('HTTP error establishing stream for SendStreamingMessage: 401 Unauthorized'))).toBe('auth')
    expect(classifyA2aError(Object.assign(new Error('HTTP error for SendMessage! Status: 403 Forbidden'), { status: 403 }))).toBe('forbidden')
    expect(classifyA2aError(new Error('HTTP error for SendStreamingMessage! Status: 403 Forbidden'))).toBe('forbidden')
  })

  it('walks the cause chain and defaults to transport', () => {
    const inner = Object.assign(new Error('Status: 401'), { cause: undefined })
    expect(classifyA2aError(new Error('wrapped', { cause: inner }))).toBe('auth')
    expect(classifyA2aError(new Error('something broke'))).toBe('transport')
    expect(classifyA2aError('not an error')).toBe('transport')
  })

  it('terminates on cause cycles', () => {
    const first: Error & { cause?: unknown } = new Error('a')
    const second: Error & { cause?: unknown } = new Error('b')
    first.cause = second
    second.cause = first
    expect(classifyA2aError(first)).toBe('transport')
  })
})

function expectRejection(raw: string): void {
  const call = () => assertA2aEndpointUrl(raw)
  expect(call).toThrow(A2aError)
  expect(call).toThrow(/endpoint/)
}
