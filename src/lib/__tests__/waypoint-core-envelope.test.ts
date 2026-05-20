import { describe, expect, it } from 'vitest'
import { normalizeValidationDetails } from '../../../packages/waypoint-core/src/envelope/validation-details'
import { makeErrorEnvelope } from '../../../packages/waypoint-core/src/envelope/error-envelope'

describe('waypoint-core envelope helpers', () => {
  it('normalizes validation details with root fallback', () => {
    const details = normalizeValidationDetails([
      { code: 'invalid_type', path: ['max_iterations'], message: 'Expected number' },
      { code: 'unrecognized_keys', path: [], message: 'Unknown key(s)' },
    ])

    expect(details).toEqual([
      { code: 'invalid_type', path: 'max_iterations', message: 'Expected number' },
      { code: 'unrecognized_keys', path: '$', message: 'Unknown key(s)' },
    ])
  })

  it('builds standard error envelope', () => {
    expect(makeErrorEnvelope('Invalid request body')).toEqual({
      ok: false,
      action: 'error',
      error: 'Invalid request body',
    })

    expect(makeErrorEnvelope('Invalid request body', [{ code: 'x', path: '$', message: 'bad' }])).toEqual({
      ok: false,
      action: 'error',
      error: 'Invalid request body',
      details: [{ code: 'x', path: '$', message: 'bad' }],
    })
  })
})
