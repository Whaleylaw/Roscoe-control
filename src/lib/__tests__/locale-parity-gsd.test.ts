import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Wave 0 Task 1 already seeded project.lifecycle.* across all 10 locales.
// These assertions pin that contract for future waves. Covers: GSD-29.

const LOCALES = ['en', 'de', 'es', 'fr', 'ja', 'ko', 'pt', 'ru', 'ar', 'zh'] as const

const REQUIRED_LIFECYCLE_KEYS = [
  'title',
  'currentPhase',
  'phaseTimeline',
  'gateTasks',
  'gateTasksNone',
  'cta.enable',
  'cta.bootstrap',
  'cta.advance',
  'gate.approve',
  'gate.reject',
  'gate.statusApproved',
  'gate.statusRequired',
  'settings.heading',
  'settings.enableLabel',
  'settings.trackLabel',
  'settings.gateModeLabel',
  'empty.heading',
  'empty.body',
  'error.illegalTransition',
  'error.gateBlocked',
] as const

function getDeep(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => {
    if (o == null || typeof o !== 'object') return undefined
    return (o as Record<string, unknown>)[k]
  }, obj)
}

function loadLocale(loc: string): Record<string, unknown> {
  const raw = readFileSync(join(process.cwd(), 'messages', `${loc}.json`), 'utf8')
  return JSON.parse(raw) as Record<string, unknown>
}

describe('locale parity for project.lifecycle.* (GSD-29)', () => {
  for (const loc of LOCALES) {
    describe(`${loc}.json`, () => {
      const j = loadLocale(loc)
      const project = (j.project ?? {}) as Record<string, unknown>
      const lifecycle = (project.lifecycle ?? {}) as Record<string, unknown>
      const nav = (project.nav ?? {}) as Record<string, unknown>

      it('has project.lifecycle.title', () => {
        expect(typeof lifecycle.title).toBe('string')
        expect((lifecycle.title as string).length).toBeGreaterThan(0)
      })

      it('has project.nav.lifecycle = "Lifecycle"', () => {
        expect(nav.lifecycle).toBe('Lifecycle')
      })

      it('has project.lifecycle.gate.statusApproved containing "✓ Approved"', () => {
        const v = getDeep(lifecycle, 'gate.statusApproved')
        expect(typeof v).toBe('string')
        expect(v as string).toContain('✓')
        expect(v as string).toContain('Approved')
      })

      it('has project.lifecycle.gate.statusRequired containing "🔒 Approval required"', () => {
        const v = getDeep(lifecycle, 'gate.statusRequired')
        expect(typeof v).toBe('string')
        expect(v as string).toContain('🔒')
        expect(v as string).toContain('Approval required')
      })

      for (const key of REQUIRED_LIFECYCLE_KEYS) {
        it(`has project.lifecycle.${key}`, () => {
          const v = getDeep(lifecycle, key)
          expect(typeof v).toBe('string')
          expect((v as string).length).toBeGreaterThan(0)
        })
      }
    })
  }

  it('key parity — en.json keys under project.lifecycle ⊆ every other locale', () => {
    const en = loadLocale('en')
    const enLifecycle = getDeep(en, 'project.lifecycle') as Record<string, unknown>
    expect(enLifecycle).toBeTruthy()

    function collectKeys(obj: unknown, prefix = ''): string[] {
      if (obj == null || typeof obj !== 'object') return []
      const out: string[] = []
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        const path = prefix ? `${prefix}.${k}` : k
        if (v != null && typeof v === 'object') {
          out.push(...collectKeys(v, path))
        } else {
          out.push(path)
        }
      }
      return out
    }

    const enKeys = collectKeys(enLifecycle)
    expect(enKeys.length).toBeGreaterThan(0)

    for (const loc of LOCALES) {
      if (loc === 'en') continue
      const j = loadLocale(loc)
      const lifecycle = getDeep(j, 'project.lifecycle')
      for (const key of enKeys) {
        const v = getDeep(lifecycle, key)
        expect(typeof v, `${loc}.json missing project.lifecycle.${key}`).toBe('string')
      }
    }
  })
})
