/**
 * A2A client failure vocabulary. One error class with stable codes so the
 * delegation provider can map failures to subagent stop reasons without
 * parsing message text.
 *
 * @module dsh-plugin-inkstone/a2a/error
 */

/** Stable failure code for one A2A client error. */
export type A2aErrorCode =
  | 'endpoint'
  | 'card'
  | 'auth'
  | 'forbidden'
  | 'aborted'
  | 'transport'
  | 'protocol'

/** One A2A client failure carrying a stable {@link A2aErrorCode}. */
export class A2aError extends Error {
  /** Stable classification of the failure. */
  readonly code: A2aErrorCode

  constructor(code: A2aErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'A2aError'
    this.code = code
  }
}

/**
 * Classify one thrown error from the A2A SDK or the fetch layer into an
 * {@link A2aErrorCode}. Walks the cause chain so transport wrapping does not
 * hide the HTTP status.
 * @param error - the thrown error from a client call.
 * @returns the stable code; `transport` when nothing more specific matches.
 */
export function classifyA2aError(error: unknown): A2aErrorCode {
  let current: unknown = error
  const seen = new Set<unknown>()
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current)
    if (/abort/i.test(current.name) || current.message.includes('This operation was aborted')) return 'aborted'
    const status = (current as { status?: unknown }).status ?? (current as { statusCode?: unknown }).statusCode
    if (status === 401) {
      return 'auth'
    }
    if (status === 403) {
      return 'forbidden'
    }
    if (/\b401\b|unauthorized/i.test(current.message)) {
      return 'auth'
    }
    if (/\b403\b|forbidden/i.test(current.message)) {
      return 'forbidden'
    }
    current = (current as { cause?: unknown }).cause
  }
  return 'transport'
}
