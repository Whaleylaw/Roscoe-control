import { describe, expect, it } from 'vitest'
import { computeRemainingTimeoutMs } from '../runner-timeout'

describe('computeRemainingTimeoutMs', () => {
  it('CONTAINER-03: happy path — started 10s ago, timeout 60s → ~50_000 ms remaining', () => {
    const nowUnix = 1_700_000_010
    const startedAt = 1_700_000_000
    const timeoutSeconds = 60
    expect(computeRemainingTimeoutMs(startedAt, timeoutSeconds, nowUnix)).toBe(50_000)
  })

  it('elapsed > timeout returns 0 (kill immediately)', () => {
    const nowUnix = 1_700_000_120
    const startedAt = 1_700_000_000
    const timeoutSeconds = 60 // deadline 60s past
    expect(computeRemainingTimeoutMs(startedAt, timeoutSeconds, nowUnix)).toBe(0)
  })

  it('timeout zero returns 0', () => {
    expect(computeRemainingTimeoutMs(1_700_000_000, 0, 1_700_000_000)).toBe(0)
  })

  it('startedAtUnix in the future returns timeout * 1000 clamped (defensive against clock skew)', () => {
    // startedAt > now (should never happen, but defensive).
    const nowUnix = 1_700_000_000
    const startedAt = 1_700_000_100 // 100s in the future
    const timeoutSeconds = 60
    // Defensive clamp returns full timeout window.
    expect(computeRemainingTimeoutMs(startedAt, timeoutSeconds, nowUnix)).toBe(60_000)
  })

  it('non-finite inputs return 0', () => {
    expect(computeRemainingTimeoutMs(Number.NaN, 60, 1_700_000_000)).toBe(0)
    expect(computeRemainingTimeoutMs(1_700_000_000, Number.NaN, 1_700_000_000)).toBe(0)
    expect(computeRemainingTimeoutMs(1_700_000_000, 60, Number.NaN)).toBe(0)
    expect(computeRemainingTimeoutMs(Number.POSITIVE_INFINITY, 60, 1_700_000_000)).toBe(0)
  })
})
