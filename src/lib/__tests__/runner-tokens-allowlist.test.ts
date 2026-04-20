import { describe, expect, it } from 'vitest'
import { RUNNER_TOKEN_ALLOWLIST } from '@/lib/runner-tokens'

/**
 * Phase 15 (15-01 / CP-01): coverage for the 7th RUNNER_TOKEN_ALLOWLIST entry.
 *
 * The Phase 15 checkpoint endpoint lives at the literal roadmap path
 * `/api/tasks/:id/checkpoints` (NOT under `/api/runner/*`). Honors the
 * 15-CONTEXT.md § "Checkpoint Endpoint Auth Path (added 2026-04-20 after research)"
 * lock. This file exists to ensure no future edit drops the entry, changes the
 * method, or broadens the regex in a way that would let unintended paths through.
 *
 * Companion gate: src/lib/auth.ts line ~526 extends the runner-token prefix filter
 * to include `/api/tasks/:id/checkpoints` in addition to `/api/runner/`. See
 * auth-runner-token-principal.test.ts for end-to-end auth coverage; this file is
 * the allowlist-shape contract.
 */

const CHECKPOINTS_TASK_ENTRY_INDEX = 6 // appended AFTER the original six /api/runner/* entries

describe('RUNNER_TOKEN_ALLOWLIST — Phase 15 CP-01 additions', () => {
  it('has exactly 7 entries (was 6 before Phase 15)', () => {
    expect(RUNNER_TOKEN_ALLOWLIST.length).toBe(7)
  })

  it('preserves the original six /api/runner/tasks/:id/* entries at positions 0-5', () => {
    const sources = RUNNER_TOKEN_ALLOWLIST.slice(0, 6).map((e) => ({
      method: e.method,
      source: e.pathPattern.source,
    }))
    expect(sources).toEqual([
      { method: 'POST', source: /^\/api\/runner\/tasks\/(\d+)\/checkpoints\/?$/.source },
      { method: 'POST', source: /^\/api\/runner\/tasks\/(\d+)\/submit\/?$/.source },
      { method: 'POST', source: /^\/api\/runner\/tasks\/(\d+)\/fail\/?$/.source },
      { method: 'GET',  source: /^\/api\/runner\/tasks\/(\d+)\/status\/?$/.source },
      { method: 'GET',  source: /^\/api\/runner\/tasks\/(\d+)\/?$/.source },
      { method: 'GET',  source: /^\/api\/runner\/tasks\/(\d+)\/comments\/?$/.source },
    ])
  })

  it('7th entry is POST /api/tasks/:id/checkpoints with digit-only id', () => {
    const entry = RUNNER_TOKEN_ALLOWLIST[CHECKPOINTS_TASK_ENTRY_INDEX]
    expect(entry.method).toBe('POST')
    expect(entry.pathPattern.source).toBe(/^\/api\/tasks\/(\d+)\/checkpoints\/?$/.source)
  })

  describe('7th entry — positive matches', () => {
    const entry = RUNNER_TOKEN_ALLOWLIST[CHECKPOINTS_TASK_ENTRY_INDEX]
    it.each([
      '/api/tasks/1/checkpoints',
      '/api/tasks/999/checkpoints',
      '/api/tasks/1/checkpoints/', // trailing slash permitted per \/?$/
      '/api/tasks/12345/checkpoints',
    ])('matches %s', (pathname) => {
      expect(entry.pathPattern.test(pathname)).toBe(true)
    })
  })

  describe('7th entry — negative matches (method mismatch handled by consumer)', () => {
    const entry = RUNNER_TOKEN_ALLOWLIST[CHECKPOINTS_TASK_ENTRY_INDEX]
    it.each([
      ['different subpath', '/api/tasks/1/comments'],
      ['different subpath (submit)', '/api/tasks/1/submit'],
      ['non-numeric id', '/api/tasks/abc/checkpoints'],
      ['empty id', '/api/tasks//checkpoints'],
      ['trailing segment', '/api/tasks/1/checkpoints/extra'],
      ['wrong prefix (runner scope)', '/api/runner/tasks/1/checkpoints'],
      ['no id', '/api/tasks/checkpoints'],
      ['query-string NOT allowed in pathname match', '/api/tasks/1/checkpoints?attempt=2'],
    ])('does NOT match %s: %s', (_label, pathname) => {
      expect(entry.pathPattern.test(pathname)).toBe(false)
    })
  })

  describe('method+path combination acceptance (mirrors the auth.ts matcher)', () => {
    function matches(method: string, pathname: string): boolean {
      return RUNNER_TOKEN_ALLOWLIST.some(
        (rule) => rule.method === method && rule.pathPattern.test(pathname),
      )
    }

    it('accepts POST /api/tasks/1/checkpoints (CP-01 happy path)', () => {
      expect(matches('POST', '/api/tasks/1/checkpoints')).toBe(true)
    })

    it('rejects GET /api/tasks/1/checkpoints (wrong method — viewer-authed via separate handler)', () => {
      expect(matches('GET', '/api/tasks/1/checkpoints')).toBe(false)
    })

    it('rejects PUT /api/tasks/1/checkpoints', () => {
      expect(matches('PUT', '/api/tasks/1/checkpoints')).toBe(false)
    })

    it('rejects DELETE /api/tasks/1/checkpoints', () => {
      expect(matches('DELETE', '/api/tasks/1/checkpoints')).toBe(false)
    })

    it('still accepts the original six /api/runner/* pairings', () => {
      expect(matches('POST', '/api/runner/tasks/1/checkpoints')).toBe(true)
      expect(matches('POST', '/api/runner/tasks/1/submit')).toBe(true)
      expect(matches('POST', '/api/runner/tasks/1/fail')).toBe(true)
      expect(matches('GET',  '/api/runner/tasks/1/status')).toBe(true)
      expect(matches('GET',  '/api/runner/tasks/1')).toBe(true)
      expect(matches('GET',  '/api/runner/tasks/1/comments')).toBe(true)
    })
  })
})
