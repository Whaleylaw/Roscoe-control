import { describe, it, expect } from 'vitest'
import { parseRecipeYaml } from '../recipe-schema'

const minimalValid = `
slug: hello-world
name: Hello World
image: mc-hello-world-agent
workspace_mode: worktree
timeout_seconds: 300
model:
  primary: claude-sonnet-4-6
`.trim()

describe('parseRecipeYaml', () => {
  it('accepts a minimal valid recipe', () => {
    const result = parseRecipeYaml(minimalValid)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.value.slug).toBe('hello-world')
    expect(result.value.max_concurrent).toBe(1) // default
    expect(result.value.version).toBe(1) // default
    expect(result.value.env).toEqual({})
    expect(result.value.secrets).toEqual([])
    expect(result.value.tags).toEqual([])
  })

  it('rejects unparseable YAML with "YAML parse error" prefix', () => {
    const result = parseRecipeYaml(':: not valid yaml ::\n  - [')
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.error).toMatch(/YAML parse error/i)
  })

  it('rejects non-object root (array)', () => {
    const result = parseRecipeYaml('- foo\n- bar\n')
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.error).toMatch(/mapping/i)
  })

  it('rejects missing required fields (name, image, workspace_mode)', () => {
    const result = parseRecipeYaml(
      'slug: only-slug\ntimeout_seconds: 300\nmodel:\n  primary: claude-opus-4-7\n'
    )
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.error).toMatch(/name/)
    expect(result.error).toMatch(/image/)
    expect(result.error).toMatch(/workspace_mode/)
  })

  it('rejects invalid slug format (uppercase, leading dash, trailing dash, space)', () => {
    for (const badSlug of ['UPPER', '-leading', 'trailing-', 'space in slug']) {
      const result = parseRecipeYaml(minimalValid.replace('hello-world', badSlug))
      expect(result.ok).toBe(false)
    }
  })

  it('rejects unknown model.primary with registry-enumerating error (MODEL-02)', () => {
    const yaml = minimalValid.replace('claude-sonnet-4-6', 'gpt-4')
    const result = parseRecipeYaml(yaml)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.error).toMatch(/model registry/i)
    expect(result.error).toMatch(/gpt-4/)
    expect(result.error).toMatch(/claude-opus-4-7/) // one of the known IDs enumerated
  })

  it('rejects out-of-range timeout_seconds (too low, too high)', () => {
    const low = parseRecipeYaml(minimalValid.replace('timeout_seconds: 300', 'timeout_seconds: 5'))
    expect(low.ok).toBe(false)
    const high = parseRecipeYaml(
      minimalValid.replace('timeout_seconds: 300', 'timeout_seconds: 99999')
    )
    expect(high.ok).toBe(false)
  })

  it('accepts optional fields (description, when_to_use, model.fallback/provider/params, tags, env, secrets)', () => {
    const full = `
slug: kitchen-sink
name: Kitchen Sink
description: Exercises every optional field
when_to_use: When we need to test everything
image: test-agent
workspace_mode: readonly
timeout_seconds: 600
max_concurrent: 3
env:
  MC_DEBUG: '1'
secrets:
  - ANTHROPIC_API_KEY
  - GITHUB_TOKEN
tags:
  - refactor
  - test
model:
  primary: claude-opus-4-7
  fallback: claude-sonnet-4-6
  provider: anthropic
  params:
    max_tokens: 8000
    temperature: 0.7
version: 2
`.trim()
    const result = parseRecipeYaml(full)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.value.secrets).toEqual(['ANTHROPIC_API_KEY', 'GITHUB_TOKEN'])
    expect(result.value.model.fallback).toBe('claude-sonnet-4-6')
    expect(result.value.model.params?.max_tokens).toBe(8000)
  })
})
