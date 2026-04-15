// Phase 09 Plan 03 — Covers GSD-17, GSD-18.
//
// loadGsdTemplate(track) resolves <DATA_DIR>/gsd-templates/<track>.json with
// soft-miss fallback to DEFAULT_TEMPLATE (D-16). Must NEVER throw — bootstrap
// depends on this contract to always succeed.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_TEMPLATE } from '@/lib/gsd-templates'
import { gsdTemplateSchema } from '@/lib/validation'

describe('DEFAULT_TEMPLATE (GSD-18)', () => {
  it('validates cleanly against gsdTemplateSchema.parse()', () => {
    expect(() => gsdTemplateSchema.parse(DEFAULT_TEMPLATE)).not.toThrow()
  })

  it('has exactly 8 entries across 4 phases (2 per phase)', () => {
    const counts = {
      discuss: DEFAULT_TEMPLATE.phases.discuss.length,
      plan: DEFAULT_TEMPLATE.phases.plan.length,
      execute: DEFAULT_TEMPLATE.phases.execute.length,
      verify: DEFAULT_TEMPLATE.phases.verify.length,
    }
    expect(counts).toEqual({ discuss: 2, plan: 2, execute: 2, verify: 2 })
    const total = Object.values(counts).reduce((n, c) => n + c, 0)
    expect(total).toBe(8)
  })

  it('contains DISCUSS-01/02, PLAN-01/02, EXEC-01/02, VERIFY-01/02 ticket refs', () => {
    const refs: string[] = []
    for (const phase of ['discuss', 'plan', 'execute', 'verify'] as const) {
      for (const entry of DEFAULT_TEMPLATE.phases[phase]) {
        refs.push(entry.ticket_ref)
      }
    }
    expect(refs).toEqual([
      'DISCUSS-01', 'DISCUSS-02',
      'PLAN-01', 'PLAN-02',
      'EXEC-01', 'EXEC-02',
      'VERIFY-01', 'VERIFY-02',
    ])
  })

  it('PLAN-02 has gate_required=1', () => {
    const entry = DEFAULT_TEMPLATE.phases.plan.find((e) => e.ticket_ref === 'PLAN-02')
    expect(entry?.gate_required).toBe(1)
  })

  it('EXEC-02 has gate_required=1', () => {
    const entry = DEFAULT_TEMPLATE.phases.execute.find((e) => e.ticket_ref === 'EXEC-02')
    expect(entry?.gate_required).toBe(1)
  })

  it('all other entries have gate_required=0', () => {
    const nonGated = [
      ['discuss', 'DISCUSS-01'], ['discuss', 'DISCUSS-02'],
      ['plan', 'PLAN-01'],
      ['execute', 'EXEC-01'],
      ['verify', 'VERIFY-01'], ['verify', 'VERIFY-02'],
    ] as const
    for (const [phase, ref] of nonGated) {
      const entry = DEFAULT_TEMPLATE.phases[phase].find((e) => e.ticket_ref === ref)
      expect(entry?.gate_required).toBe(0)
    }
  })
})

describe('loadGsdTemplate (GSD-17, D-16 fallback)', () => {
  let tmp: string

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'gsd-tpl-'))
    mkdirSync(join(tmp, 'gsd-templates'), { recursive: true })
    // Point config.dataDir at our tmp scratch dir
    vi.resetModules()
    vi.doMock('@/lib/config', () => ({
      config: { dataDir: tmp },
      ensureDirExists: () => {},
    }))
  })

  afterEach(() => {
    vi.doUnmock('@/lib/config')
    vi.resetModules()
    try { rmSync(tmp, { recursive: true, force: true }) } catch {}
  })

  it('loadGsdTemplate(null) → DEFAULT_TEMPLATE (default.json absent)', async () => {
    const { loadGsdTemplate, DEFAULT_TEMPLATE: DEF } = await import('@/lib/gsd-templates')
    const result = loadGsdTemplate(null)
    expect(result).toEqual(DEF)
  })

  it('loadGsdTemplate("nonexistent-track") → DEFAULT_TEMPLATE (unknown track normalizes to default.json)', async () => {
    const { loadGsdTemplate, DEFAULT_TEMPLATE: DEF } = await import('@/lib/gsd-templates')
    const result = loadGsdTemplate('nonexistent-track')
    expect(result).toEqual(DEF)
  })

  it('loadGsdTemplate("ops") with no ops.json on disk → DEFAULT_TEMPLATE (D-16 soft miss)', async () => {
    const { loadGsdTemplate, DEFAULT_TEMPLATE: DEF } = await import('@/lib/gsd-templates')
    const result = loadGsdTemplate('ops')
    expect(result).toEqual(DEF)
  })

  it('loadGsdTemplate("ops") with malformed JSON → logs warning + DEFAULT_TEMPLATE (Pitfall 8)', async () => {
    writeFileSync(join(tmp, 'gsd-templates', 'ops.json'), '{not json', 'utf8')
    const warn = vi.fn()
    vi.doMock('@/lib/logger', () => ({
      logger: { warn, info: () => {}, error: () => {}, debug: () => {} },
    }))
    const { loadGsdTemplate, DEFAULT_TEMPLATE: DEF } = await import('@/lib/gsd-templates')
    const result = loadGsdTemplate('ops')
    expect(result).toEqual(DEF)
    expect(warn).toHaveBeenCalled()
    vi.doUnmock('@/lib/logger')
  })

  it('loadGsdTemplate("ops") with Zod-invalid JSON shape → logs warning + DEFAULT_TEMPLATE', async () => {
    writeFileSync(
      join(tmp, 'gsd-templates', 'ops.json'),
      JSON.stringify({ name: 'ops', phases: { bogus: [] } }),
      'utf8',
    )
    const warn = vi.fn()
    vi.doMock('@/lib/logger', () => ({
      logger: { warn, info: () => {}, error: () => {}, debug: () => {} },
    }))
    const { loadGsdTemplate, DEFAULT_TEMPLATE: DEF } = await import('@/lib/gsd-templates')
    const result = loadGsdTemplate('ops')
    expect(result).toEqual(DEF)
    expect(warn).toHaveBeenCalled()
    vi.doUnmock('@/lib/logger')
  })

  it('loadGsdTemplate("ops") with valid ops.json → parsed+validated tree', async () => {
    const valid = {
      name: 'ops',
      phases: {
        discuss: [{ ticket_ref: 'DISCUSS-01', title: 'custom discuss', gate_required: 0 }],
        plan: [{ ticket_ref: 'PLAN-01', title: 'custom plan', gate_required: 1 }],
        execute: [{ ticket_ref: 'EXEC-01', title: 'custom exec', gate_required: 0 }],
        verify: [{ ticket_ref: 'VERIFY-01', title: 'custom verify', gate_required: 0 }],
      },
    }
    writeFileSync(join(tmp, 'gsd-templates', 'ops.json'), JSON.stringify(valid), 'utf8')
    const { loadGsdTemplate } = await import('@/lib/gsd-templates')
    const result = loadGsdTemplate('ops')
    expect(result.name).toBe('ops')
    expect(result.phases.plan[0].ticket_ref).toBe('PLAN-01')
    expect(result.phases.plan[0].gate_required).toBe(1)
  })
})
