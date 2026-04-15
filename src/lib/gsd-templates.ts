import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { config } from '@/lib/config'
import { gsdTemplateSchema, GSD_TRACKS } from '@/lib/validation'
import { logger } from '@/lib/logger'

/**
 * Phase 09 — Bundled default GSD lifecycle template (D-18).
 *
 * Shipped in source so bootstrap ALWAYS succeeds (D-16) even when no
 * user-authored `<track>.json` exists at
 * `<MISSION_CONTROL_DATA_DIR>/gsd-templates/`.
 *
 * Matches the plan-spec default pack: DISCUSS-01/02 + PLAN-01/02 +
 * EXEC-01/02 + VERIFY-01/02 (8 entries total). PLAN-02 and EXEC-02 are
 * gate-required (the "approved plan package" and "integration tasks"
 * gates per 09-00-SPEC and D-25 discuss→execute rule).
 */
export const DEFAULT_TEMPLATE = {
  name: 'default',
  phases: {
    discuss: [
      { ticket_ref: 'DISCUSS-01', title: 'Clarify goal, scope, and success criteria', gate_required: 0 as const },
      { ticket_ref: 'DISCUSS-02', title: 'Identify constraints and risks', gate_required: 0 as const },
    ],
    plan: [
      { ticket_ref: 'PLAN-01', title: 'Draft implementation plan', gate_required: 0 as const },
      { ticket_ref: 'PLAN-02', title: 'Approval package', gate_required: 1 as const },
    ],
    execute: [
      { ticket_ref: 'EXEC-01', title: 'Core implementation', gate_required: 0 as const },
      { ticket_ref: 'EXEC-02', title: 'Integration tasks', gate_required: 1 as const },
    ],
    verify: [
      { ticket_ref: 'VERIFY-01', title: 'Verify acceptance criteria', gate_required: 0 as const },
      { ticket_ref: 'VERIFY-02', title: 'Ship / readout', gate_required: 0 as const },
    ],
  },
} as const

export type GsdTemplate = z.infer<typeof gsdTemplateSchema>

/**
 * Load a GSD lifecycle template from disk with bundled fallback.
 *
 * Resolution order:
 * 1. `track` is a known GSD_TRACKS value → attempt `<dataDir>/gsd-templates/<track>.json`.
 * 2. Otherwise → attempt `<dataDir>/gsd-templates/default.json`.
 * 3. Missing file → return DEFAULT_TEMPLATE (D-16 soft miss).
 * 4. Malformed JSON or Zod-invalid shape → log warning + return DEFAULT_TEMPLATE (Pitfall 8).
 *
 * NEVER throws — bootstrap must always succeed per D-16.
 */
export function loadGsdTemplate(track: string | null): GsdTemplate {
  const safeTrack =
    track && (GSD_TRACKS as readonly string[]).includes(track) ? track : null
  const fileName = safeTrack ? `${safeTrack}.json` : 'default.json'
  const filePath = join(config.dataDir, 'gsd-templates', fileName)
  if (!existsSync(filePath)) return DEFAULT_TEMPLATE as unknown as GsdTemplate
  try {
    const raw = readFileSync(filePath, 'utf8')
    const parsed = JSON.parse(raw)
    return gsdTemplateSchema.parse(parsed)
  } catch (err) {
    logger.warn(
      { err, filePath },
      'Invalid GSD template file, falling back to bundled default',
    )
    return DEFAULT_TEMPLATE as unknown as GsdTemplate
  }
}
