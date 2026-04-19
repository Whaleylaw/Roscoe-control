import { describe, expect, it } from 'vitest'
import { createTaskSchema, updateTaskSchema } from '@/lib/validation'

/**
 * Phase 13-01 — SHAPE-layer behavior for the four new runtime-context fields
 * on createTaskSchema / updateTaskSchema. Business rules (recipe existence,
 * workspace_source gap, allowlist membership, caps) are tested in Plans 13-02
 * and 13-03 against their respective route handlers.
 */
describe('createTaskSchema runtime-context fields (Phase 13)', () => {
  it('parses legacy bodies with no runtime fields (backwards compatible)', () => {
    const result = createTaskSchema.safeParse({ title: 'x' })
    expect(result.success).toBe(true)
  })

  it('accepts a valid kebab-case recipe_slug', () => {
    const result = createTaskSchema.safeParse({ title: 'x', recipe_slug: 'my-recipe' })
    expect(result.success).toBe(true)
  })

  it('rejects an UPPERCASE recipe_slug', () => {
    const result = createTaskSchema.safeParse({ title: 'x', recipe_slug: 'UPPER' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes('recipe_slug'))).toBe(true)
    }
  })

  it('rejects an empty recipe_slug', () => {
    const result = createTaskSchema.safeParse({ title: 'x', recipe_slug: '' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes('recipe_slug'))).toBe(true)
    }
  })

  it('accepts a valid workspace_source', () => {
    const result = createTaskSchema.safeParse({
      title: 'x',
      workspace_source: { project_id: 1, base_ref: 'main' },
    })
    expect(result.success).toBe(true)
  })

  it("rejects workspace_source with '..' in base_ref", () => {
    const result = createTaskSchema.safeParse({
      title: 'x',
      workspace_source: { project_id: 1, base_ref: 'bad..ref' },
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes('workspace_source'))).toBe(true)
    }
  })

  it('rejects workspace_source with whitespace in base_ref', () => {
    const result = createTaskSchema.safeParse({
      title: 'x',
      workspace_source: { project_id: 1, base_ref: 'has space' },
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes('workspace_source'))).toBe(true)
    }
  })

  it('accepts a read_only_mounts with a fully-specified entry', () => {
    const result = createTaskSchema.safeParse({
      title: 'x',
      read_only_mounts: [{ host_path: '/a', container_path: '/b', label: 'l' }],
    })
    expect(result.success).toBe(true)
  })

  it('rejects read_only_mounts with duplicate labels', () => {
    const result = createTaskSchema.safeParse({
      title: 'x',
      read_only_mounts: [
        { host_path: '/a', container_path: '/ca', label: 'l' },
        { host_path: '/b', container_path: '/cb', label: 'l' },
      ],
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes('read_only_mounts'))).toBe(true)
    }
  })

  it('rejects extra_skills with duplicate basenames across different directories', () => {
    const result = createTaskSchema.safeParse({
      title: 'x',
      extra_skills: ['/a/x', '/b/x'],
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes('extra_skills'))).toBe(true)
    }
  })

  it('updateTaskSchema (= createTaskSchema.partial) accepts a single recipe_slug field', () => {
    const result = updateTaskSchema.safeParse({ recipe_slug: 'foo' })
    expect(result.success).toBe(true)
  })

  it('updateTaskSchema accepts an empty patch body (all fields optional)', () => {
    const result = updateTaskSchema.safeParse({})
    expect(result.success).toBe(true)
  })
})
