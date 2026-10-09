import { describe, expect, it } from 'vitest'
import { TaskState } from '@a2a-js/sdk'
import { classifyTaskState, isInterruptedOutcome, isTerminalOutcome } from '../src/a2a/states'

describe('classifyTaskState', () => {
  it('maps every named state', () => {
    expect(classifyTaskState(TaskState.TASK_STATE_SUBMITTED)).toBe('submitted')
    expect(classifyTaskState(TaskState.TASK_STATE_WORKING)).toBe('working')
    expect(classifyTaskState(TaskState.TASK_STATE_INPUT_REQUIRED)).toBe('input-required')
    expect(classifyTaskState(TaskState.TASK_STATE_AUTH_REQUIRED)).toBe('auth-required')
    expect(classifyTaskState(TaskState.TASK_STATE_COMPLETED)).toBe('completed')
    expect(classifyTaskState(TaskState.TASK_STATE_FAILED)).toBe('failed')
    expect(classifyTaskState(TaskState.TASK_STATE_CANCELED)).toBe('canceled')
    expect(classifyTaskState(TaskState.TASK_STATE_REJECTED)).toBe('rejected')
  })

  it('maps unspecified and unknown values to unknown', () => {
    expect(classifyTaskState(TaskState.TASK_STATE_UNSPECIFIED)).toBe('unknown')
    expect(classifyTaskState(TaskState.UNRECOGNIZED)).toBe('unknown')
    expect(classifyTaskState(99 as TaskState)).toBe('unknown')
  })
})

describe('isTerminalOutcome', () => {
  it('accepts terminal states only', () => {
    expect(isTerminalOutcome('completed')).toBe(true)
    expect(isTerminalOutcome('failed')).toBe(true)
    expect(isTerminalOutcome('canceled')).toBe(true)
    expect(isTerminalOutcome('rejected')).toBe(true)
    expect(isTerminalOutcome('working')).toBe(false)
    expect(isTerminalOutcome('input-required')).toBe(false)
    expect(isTerminalOutcome('auth-required')).toBe(false)
    expect(isTerminalOutcome('unknown')).toBe(false)
    expect(isTerminalOutcome('stream-ended')).toBe(false)
    expect(isTerminalOutcome('submitted')).toBe(false)
  })
})

describe('isInterruptedOutcome', () => {
  it('accepts interrupted states only', () => {
    expect(isInterruptedOutcome('input-required')).toBe(true)
    expect(isInterruptedOutcome('auth-required')).toBe(true)
    expect(isInterruptedOutcome('completed')).toBe(false)
    expect(isInterruptedOutcome('working')).toBe(false)
  })
})
