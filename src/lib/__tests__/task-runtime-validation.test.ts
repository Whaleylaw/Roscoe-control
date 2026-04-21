/**
 * Plan 17-02 GAP AUDIT (RTEST-01 sharp-edge checklist):
 *   - symlink escape via fs.realpath → OUT_OF_ALLOWLIST → PRE-EXISTING (line 306-316)
 *   - trailing-sep semantics (/foo vs /foo-other)       → PRE-EXISTING (line 318-334)
 *   - ENOENT parent-walk acceptance                     → PRE-EXISTING (line 270-280)
 *   - symlink pointing INTO allowlist accepted          → PRE-EXISTING (line 295-304)
 *   - empty allowlist rejection                         → PRE-EXISTING (line 248-258)
 *
 * No new tests added by 17-02: symlink-escape coverage already exists.
 * See .planning/phases/17-integration-testing-reference-pipeline/17-02-SUMMARY.md.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { z } from 'zod'

// vi.mock is hoisted — keep the allowlist mutable from each test.
const hoisted = vi.hoisted(() => ({
  allowlist: [] as string[],
}))

vi.mock('@/lib/task-runtime-settings', () => ({
  getMountAllowlist: () => hoisted.allowlist,
}))

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

// Import AFTER mocks so the module binds to them.
import {
  WorkspaceSourceSchema,
  ReadOnlyMountSchema,
  readOnlyMountsArraySchema,
  extraSkillsArraySchema,
  validateHostPathAgainstAllowlist,
  buildAggregatedValidationResponse,
  zodErrorToIssues,
  TASK_RUNTIME_ERROR_CODES,
} from '../task-runtime-validation'

// ---------------------------------------------------------------------------
// Shared tmp-dir fixture — real filesystem because the whole point of
// validateHostPathAgainstAllowlist is fs.realpath + symlink resolution.
// ---------------------------------------------------------------------------

let tmpRoot: string
let tmpRootReal: string
let tmpRootSibling: string
let tmpRootSiblingReal: string

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'mc-tr-validation-'))
  // tmpdir() on macOS is often a symlink itself (e.g. /var → /private/var);
  // tests compare against the realpath, not the literal.
  tmpRootReal = await realpath(tmpRoot)

  // Create a sibling directory sharing a common prefix with tmpRoot, specifically
  // to exercise the trailing-sep guard (a prefix-string match would over-admit).
  // tmpRoot is something like /tmp/mc-tr-validation-abcDEF; sibling gets the
  // literal '-other' suffix so the two share the first 25+ chars.
  tmpRootSibling = `${tmpRoot}-other`
  await mkdir(tmpRootSibling, { recursive: true })
  tmpRootSiblingReal = await realpath(tmpRootSibling)

  // Populate: <tmpRoot>/sub exists; <tmpRoot>/doesnotexist does NOT.
  await mkdir(join(tmpRoot, 'sub'), { recursive: true })
  await writeFile(join(tmpRoot, 'sub', 'file.txt'), 'hello')

  // Reset allowlist for each test.
  hoisted.allowlist = []
})

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true })
  await rm(tmpRootSibling, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// WorkspaceSourceSchema — 8 cases
// ---------------------------------------------------------------------------

describe('WorkspaceSourceSchema', () => {
  it('parses { project_id: 1, base_ref: "main" }', () => {
    const result = WorkspaceSourceSchema.safeParse({ project_id: 1, base_ref: 'main' })
    expect(result.success).toBe(true)
  })

  it('parses a slash-bearing ref like "refs/heads/main"', () => {
    const result = WorkspaceSourceSchema.safeParse({
      project_id: 1,
      base_ref: 'refs/heads/main',
    })
    expect(result.success).toBe(true)
  })

  it('parses a SHA-like prefix "abc1234"', () => {
    const result = WorkspaceSourceSchema.safeParse({ project_id: 1, base_ref: 'abc1234' })
    expect(result.success).toBe(true)
  })

  it('rejects empty base_ref', () => {
    const result = WorkspaceSourceSchema.safeParse({ project_id: 1, base_ref: '' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message.includes('empty'))).toBe(true)
    }
  })

  it('rejects a base_ref containing whitespace', () => {
    const result = WorkspaceSourceSchema.safeParse({
      project_id: 1,
      base_ref: 'main with space',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message.includes('whitespace'))).toBe(true)
    }
  })

  it("rejects a base_ref containing '..'", () => {
    const result = WorkspaceSourceSchema.safeParse({
      project_id: 1,
      base_ref: '../etc/passwd',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message.includes(".."))).toBe(true)
    }
  })

  it('rejects non-positive project_id', () => {
    const result = WorkspaceSourceSchema.safeParse({ project_id: -1, base_ref: 'main' })
    expect(result.success).toBe(false)
  })

  it('rejects non-number project_id', () => {
    const result = WorkspaceSourceSchema.safeParse({
      project_id: 'abc' as unknown as number,
      base_ref: 'main',
    })
    expect(result.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// ReadOnlyMountSchema — 6 cases
// ---------------------------------------------------------------------------

describe('ReadOnlyMountSchema', () => {
  it('parses a fully-specified entry', () => {
    const result = ReadOnlyMountSchema.safeParse({
      host_path: '/a',
      container_path: '/b',
      label: 'lab1',
    })
    expect(result.success).toBe(true)
  })

  it('rejects a missing label', () => {
    const result = ReadOnlyMountSchema.safeParse({ host_path: '/a', container_path: '/b' })
    expect(result.success).toBe(false)
  })

  it('rejects a missing host_path', () => {
    const result = ReadOnlyMountSchema.safeParse({ container_path: '/b', label: 'lab1' })
    expect(result.success).toBe(false)
  })

  it('rejects a missing container_path', () => {
    const result = ReadOnlyMountSchema.safeParse({ host_path: '/a', label: 'lab1' })
    expect(result.success).toBe(false)
  })

  it('rejects a label containing a space', () => {
    const result = ReadOnlyMountSchema.safeParse({
      host_path: '/a',
      container_path: '/b',
      label: 'my lab',
    })
    expect(result.success).toBe(false)
  })

  it('rejects an empty-string label', () => {
    const result = ReadOnlyMountSchema.safeParse({
      host_path: '/a',
      container_path: '/b',
      label: '',
    })
    expect(result.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// readOnlyMountsArraySchema — 3 cases
// ---------------------------------------------------------------------------

describe('readOnlyMountsArraySchema', () => {
  it('parses an array of two entries with distinct labels', () => {
    const result = readOnlyMountsArraySchema.safeParse([
      { host_path: '/a', container_path: '/ca', label: 'a' },
      { host_path: '/b', container_path: '/cb', label: 'b' },
    ])
    expect(result.success).toBe(true)
  })

  it('rejects an array with duplicate labels', () => {
    const result = readOnlyMountsArraySchema.safeParse([
      { host_path: '/a', container_path: '/ca', label: 'a' },
      { host_path: '/b', container_path: '/cb', label: 'a' },
    ])
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message.includes('duplicate labels'))).toBe(true)
    }
  })

  it('parses an empty array (zero-length is legal)', () => {
    const result = readOnlyMountsArraySchema.safeParse([])
    expect(result.success).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// extraSkillsArraySchema — 4 cases
// ---------------------------------------------------------------------------

describe('extraSkillsArraySchema', () => {
  it('parses two entries with distinct basenames', () => {
    const result = extraSkillsArraySchema.safeParse(['/a/skill-one', '/b/skill-two'])
    expect(result.success).toBe(true)
  })

  it('rejects two entries with the same basename in different directories', () => {
    const result = extraSkillsArraySchema.safeParse(['/a/skill-one', '/b/skill-one'])
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message.includes('duplicate basenames'))).toBe(true)
    }
  })

  it('parses a single entry', () => {
    const result = extraSkillsArraySchema.safeParse(['/a/skill'])
    expect(result.success).toBe(true)
  })

  it('parses an empty array', () => {
    const result = extraSkillsArraySchema.safeParse([])
    expect(result.success).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// validateHostPathAgainstAllowlist — 8 cases
// ---------------------------------------------------------------------------

describe('validateHostPathAgainstAllowlist', () => {
  it('returns ALLOWLIST_EMPTY when the allowlist is []', async () => {
    hoisted.allowlist = []
    const result = await validateHostPathAgainstAllowlist('/whatever')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe(TASK_RUNTIME_ERROR_CODES.ALLOWLIST_EMPTY)
      expect(result.message).toContain('/whatever')
      expect(result.hint).toContain('runtime.mount_allowlist')
      expect(result.hint).toContain('PUT /api/settings')
    }
  })

  it('returns ok for an existing path inside the allowlist', async () => {
    hoisted.allowlist = [tmpRootReal]
    const target = join(tmpRoot, 'sub')
    const result = await validateHostPathAgainstAllowlist(target)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.realpath).toBe(await realpath(target))
    }
  })

  it('returns ok for a non-existent path under an allowed prefix (ENOENT walks parents)', async () => {
    hoisted.allowlist = [tmpRootReal]
    const target = join(tmpRoot, 'doesnotexist', 'yet.txt')
    const result = await validateHostPathAgainstAllowlist(target)
    expect(result.ok).toBe(true)
    if (result.ok) {
      // The resolver re-attaches the unresolved tail to the realpath of the
      // nearest existing ancestor (tmpRootReal).
      expect(result.realpath).toBe(tmpRootReal + sep + 'doesnotexist' + sep + 'yet.txt')
    }
  })

  it('returns OUT_OF_ALLOWLIST for a path outside every prefix', async () => {
    hoisted.allowlist = [tmpRootReal]
    const outside = '/completely/outside/path'
    const result = await validateHostPathAgainstAllowlist(outside)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe(TASK_RUNTIME_ERROR_CODES.OUT_OF_ALLOWLIST)
      expect(result.message).toContain(outside)
      // Message contains JSON-encoded allowlist
      expect(result.message).toContain(JSON.stringify([tmpRootReal]))
    }
  })

  it('accepts a symlink pointing into the allowlist (realpath resolves the target)', async () => {
    hoisted.allowlist = [tmpRootReal]
    const symlinkPath = join(tmpRoot, 'link-to-sub')
    await symlink(join(tmpRoot, 'sub'), symlinkPath, 'dir')
    const result = await validateHostPathAgainstAllowlist(symlinkPath)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.realpath).toBe(await realpath(join(tmpRoot, 'sub')))
    }
  })

  it('rejects a symlink pointing OUTSIDE the allowlist (defense against symlink escape)', async () => {
    hoisted.allowlist = [tmpRootReal]
    const symlinkPath = join(tmpRoot, 'escape-link')
    // sibling directory is outside tmpRoot — the symlink points to it
    await symlink(tmpRootSiblingReal, symlinkPath, 'dir')
    const result = await validateHostPathAgainstAllowlist(symlinkPath)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe(TASK_RUNTIME_ERROR_CODES.OUT_OF_ALLOWLIST)
    }
  })

  it('enforces trailing-sep semantics so allowlist=/foo does NOT admit /foo-other', async () => {
    // Allowlist: sibling directory (e.g. /tmp/mc-tr-validation-abc-other).
    // Target:    a path inside tmpRoot  (e.g. /tmp/mc-tr-validation-abc/sub).
    // String-prefix match of tmpRootSiblingReal against tmpRoot's realpath
    // would ONLY match if tmpRootReal happened to share the sibling's prefix —
    // which it does NOT because the sibling's realpath is e.g. `/private/var/...-other`
    // and tmpRoot's realpath is `/private/var/...`. So the inverse is the
    // meaningful case: allowlist = tmpRootReal, target inside tmpRootSiblingReal
    // would be a false positive under a naive startsWith. Test that.
    hoisted.allowlist = [tmpRootReal]
    const target = join(tmpRootSiblingReal, 'file')
    const result = await validateHostPathAgainstAllowlist(target)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe(TASK_RUNTIME_ERROR_CODES.OUT_OF_ALLOWLIST)
    }
  })

  it('treats an allowlist entry that does not resolve as silently skipped (OUT_OF_ALLOWLIST)', async () => {
    hoisted.allowlist = ['/path/that/does/not/exist']
    const target = join(tmpRoot, 'sub')
    const result = await validateHostPathAgainstAllowlist(target)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe(TASK_RUNTIME_ERROR_CODES.OUT_OF_ALLOWLIST)
    }
  })
})

// ---------------------------------------------------------------------------
// buildAggregatedValidationResponse — 2 cases
// ---------------------------------------------------------------------------

describe('buildAggregatedValidationResponse', () => {
  it('returns a 400 NextResponse with { errors: [...] }', async () => {
    const response = buildAggregatedValidationResponse([
      { field: 'x', code: 'Y', message: 'z', hint: 'h' },
    ])
    expect(response.status).toBe(400)
    const body = (await response.json()) as { errors: unknown[] }
    expect(body).toEqual({
      errors: [{ field: 'x', code: 'Y', message: 'z', hint: 'h' }],
    })
  })

  it('returns a 400 even with an empty errors array (caller responsibility to skip)', async () => {
    const response = buildAggregatedValidationResponse([])
    expect(response.status).toBe(400)
    const body = (await response.json()) as { errors: unknown[] }
    expect(body).toEqual({ errors: [] })
  })
})

// ---------------------------------------------------------------------------
// zodErrorToIssues — 2 cases
// ---------------------------------------------------------------------------

describe('zodErrorToIssues', () => {
  it('maps a model-registry refine message to UNKNOWN_MODEL with a model_override hint', () => {
    const schema = z.string().refine((v) => v === 'claude-opus-4-7', {
      message: `model_override 'gpt-4' is not in the model registry. Known models: claude-opus-4-7`,
    })
    const result = schema.safeParse('gpt-4')
    if (result.success) throw new Error('expected failure')
    const issues = zodErrorToIssues(result.error)
    expect(issues.length).toBeGreaterThan(0)
    const unknown = issues.find((i) => i.code === TASK_RUNTIME_ERROR_CODES.UNKNOWN_MODEL)
    expect(unknown).toBeDefined()
    expect(unknown!.hint).toContain('model_override')
  })

  it('maps a nested path to a dotted field and INVALID_FIELD by default', () => {
    const schema = z.object({
      read_only_mounts: z.array(z.object({ host_path: z.string().min(10) })),
    })
    const result = schema.safeParse({ read_only_mounts: [{ host_path: 'short' }] })
    if (result.success) throw new Error('expected failure')
    const issues = zodErrorToIssues(result.error)
    const target = issues.find((i) => i.field === 'read_only_mounts.0.host_path')
    expect(target).toBeDefined()
    expect(target!.code).toBe(TASK_RUNTIME_ERROR_CODES.INVALID_FIELD)
  })
})
