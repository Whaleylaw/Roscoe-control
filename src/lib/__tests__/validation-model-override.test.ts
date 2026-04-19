import { describe, it, expect } from 'vitest'
import { createTaskSchema, updateTaskSchema } from '@/lib/validation'

/**
 * MODEL-03 — task creation/update must reject unknown model_override values at
 * the schema layer. The error message is expected to:
 *   - mention "model registry" (so operators can find the registry file)
 *   - list at least one known identifier (so callers know what's valid)
 */
describe('createTaskSchema.model_override', () => {
  it('accepts a task without model_override (field is optional)', () => {
    const result = createTaskSchema.safeParse({ title: 'x' })
    expect(result.success).toBe(true)
  })

  it('accepts model_override = claude-opus-4-7', () => {
    const result = createTaskSchema.safeParse({
      title: 'x',
      model_override: 'claude-opus-4-7',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.model_override).toBe('claude-opus-4-7')
    }
  })

  it('accepts model_override = claude-sonnet-4-6', () => {
    const result = createTaskSchema.safeParse({
      title: 'x',
      model_override: 'claude-sonnet-4-6',
    })
    expect(result.success).toBe(true)
  })

  it('accepts model_override = claude-haiku-4-5-20251001', () => {
    const result = createTaskSchema.safeParse({
      title: 'x',
      model_override: 'claude-haiku-4-5-20251001',
    })
    expect(result.success).toBe(true)
  })

  it('rejects an unknown model_override with a registry-referencing error', () => {
    const result = createTaskSchema.safeParse({
      title: 'x',
      model_override: 'gpt-4-turbo',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.join('.') === 'model_override')
      expect(issue).toBeDefined()
      // Message MUST reference "model registry" so operators can find this file.
      expect(issue!.message).toMatch(/model registry/i)
      // Message MUST enumerate at least one known id so callers know what's valid.
      expect(issue!.message).toContain('claude-opus-4-7')
      // Offending input MUST be echoed for debugging.
      expect(issue!.message).toContain('gpt-4-turbo')
    }
  })

  it('rejects model_override = "" (empty string fails min(1) before the refinement)', () => {
    const result = createTaskSchema.safeParse({ title: 'x', model_override: '' })
    expect(result.success).toBe(false)
  })
})

describe('updateTaskSchema.model_override', () => {
  it('accepts a known model_override in a partial update', () => {
    const result = updateTaskSchema.safeParse({ model_override: 'claude-opus-4-7' })
    expect(result.success).toBe(true)
  })

  it('rejects an unknown model_override in a partial update', () => {
    const result = updateTaskSchema.safeParse({ model_override: 'unknown-model' })
    expect(result.success).toBe(false)
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.join('.') === 'model_override')
      expect(issue).toBeDefined()
      expect(issue!.message).toMatch(/model registry/i)
    }
  })

  it('accepts an empty patch (all fields optional including model_override)', () => {
    const result = updateTaskSchema.safeParse({})
    expect(result.success).toBe(true)
  })
})
