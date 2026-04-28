import { describe, it, expect } from 'vitest'
import {
  MODELS,
  MODEL_IDS,
  getModel,
  isKnownModel,
  type Model,
  type ModelId,
} from '../model-registry'

describe('model-registry: MODELS seeded entries', () => {
  it('exposes Anthropic + OpenRouter model IDs required by runtime recipes', () => {
    expect(MODEL_IDS.length).toBe(7)
    expect(MODEL_IDS).toEqual(
      expect.arrayContaining([
        'claude-opus-4-7',
        'claude-sonnet-4-6',
        'claude-haiku-4-5-20251001',
        'openai/gpt-5.3-codex',
        'openai/gpt-5.4-mini',
        'google/gemini-3-flash',
        'google/gemini-2.5-flash',
      ])
    )
  })

  it('seeds Opus 4.7 with the expected metadata', () => {
    const opus = MODELS['claude-opus-4-7']
    expect(opus).toEqual<Model>({
      provider: 'anthropic',
      context_window: 200000,
      output_tokens_max: 32000,
      supports_tools: true,
      supports_thinking: true,
    })
  })

  it('seeds Sonnet 4.6 with the expected metadata', () => {
    const sonnet = MODELS['claude-sonnet-4-6']
    expect(sonnet).toEqual<Model>({
      provider: 'anthropic',
      context_window: 200000,
      output_tokens_max: 64000,
      supports_tools: true,
      supports_thinking: true,
    })
  })

  it('seeds Haiku 4.5 with the expected metadata (no thinking support)', () => {
    const haiku = MODELS['claude-haiku-4-5-20251001']
    expect(haiku).toEqual<Model>({
      provider: 'anthropic',
      context_window: 200000,
      output_tokens_max: 8192,
      supports_tools: true,
      supports_thinking: false,
    })
  })

  it('seeds OpenRouter GPT-5.3 Codex with expected metadata', () => {
    const codex = MODELS['openai/gpt-5.3-codex']
    expect(codex).toEqual<Model>({
      provider: 'openai-codex',
      context_window: 200000,
      output_tokens_max: 32000,
      supports_tools: true,
      supports_thinking: true,
    })
  })

  it('seeds OpenRouter GPT-5.4 Mini with expected metadata', () => {
    const gptMini = MODELS['openai/gpt-5.4-mini']
    expect(gptMini).toEqual<Model>({
      provider: 'openrouter',
      context_window: 200000,
      output_tokens_max: 32000,
      supports_tools: true,
      supports_thinking: true,
    })
  })

  it('seeds OpenRouter Gemini 3 Flash with expected metadata', () => {
    const geminiFlash = MODELS['google/gemini-3-flash']
    expect(geminiFlash).toEqual<Model>({
      provider: 'openrouter',
      context_window: 1048576,
      output_tokens_max: 8192,
      supports_tools: true,
      supports_thinking: true,
    })
  })

  it('seeds OpenRouter Gemini 2.5 Flash with expected metadata', () => {
    const geminiFlash = MODELS['google/gemini-2.5-flash']
    expect(geminiFlash).toEqual<Model>({
      provider: 'openrouter',
      context_window: 1048576,
      output_tokens_max: 8192,
      supports_tools: true,
      supports_thinking: false,
    })
  })
})

describe('model-registry: getModel()', () => {
  it('returns the metadata object for a known id', () => {
    const result = getModel('claude-opus-4-7')
    expect(result).not.toBeNull()
    expect(result?.provider).toBe('anthropic')
    expect(result?.context_window).toBe(200000)
    expect(result?.supports_thinking).toBe(true)
  })

  it('returns non-null for all seeded runtime models', () => {
    expect(getModel('claude-opus-4-7')).not.toBeNull()
    expect(getModel('claude-sonnet-4-6')).not.toBeNull()
    expect(getModel('claude-haiku-4-5-20251001')).not.toBeNull()
    expect(getModel('openai/gpt-5.3-codex')).not.toBeNull()
    expect(getModel('openai/gpt-5.4-mini')).not.toBeNull()
    expect(getModel('google/gemini-3-flash')).not.toBeNull()
    expect(getModel('google/gemini-2.5-flash')).not.toBeNull()
  })

  it('returns null (not undefined, not a throw) for an unknown id', () => {
    const result = getModel('gpt-4')
    expect(result).toBeNull()
    // Explicitly assert the distinction from undefined — the contract promises `null`.
    expect(result).not.toBeUndefined()
  })

  it('returns null for an empty string', () => {
    expect(getModel('')).toBeNull()
  })

  it('does not throw when called with a nonsense id', () => {
    expect(() => getModel('__definitely_not_a_model__')).not.toThrow()
  })
})

describe('model-registry: isKnownModel()', () => {
  it('returns true for a known id', () => {
    expect(isKnownModel('claude-opus-4-7')).toBe(true)
    expect(isKnownModel('claude-sonnet-4-6')).toBe(true)
    expect(isKnownModel('claude-haiku-4-5-20251001')).toBe(true)
    expect(isKnownModel('openai/gpt-5.3-codex')).toBe(true)
    expect(isKnownModel('openai/gpt-5.4-mini')).toBe(true)
    expect(isKnownModel('google/gemini-3-flash')).toBe(true)
    expect(isKnownModel('google/gemini-2.5-flash')).toBe(true)
  })

  it('returns false for an unknown id', () => {
    expect(isKnownModel('random')).toBe(false)
    expect(isKnownModel('gpt-4')).toBe(false)
    expect(isKnownModel('')).toBe(false)
  })

  it('narrows the type to ModelId inside the positive branch', () => {
    const candidate: string = 'claude-opus-4-7'
    if (isKnownModel(candidate)) {
      // At this point TS should treat `candidate` as `ModelId`.
      const narrowed: ModelId = candidate
      expect(narrowed).toBe('claude-opus-4-7')
    } else {
      throw new Error('type guard unexpectedly rejected a seeded id')
    }
  })
})

describe('model-registry: compile-time literal union guard', () => {
  it('accepts the seeded identifiers as ModelId', () => {
    const valid: ModelId = 'claude-opus-4-7'
    expect(valid).toBe('claude-opus-4-7')
  })

  it('rejects arbitrary strings at the type level', () => {
    // @ts-expect-error — 'gpt-4' is not a member of the ModelId literal union.
    const invalid: ModelId = 'gpt-4'
    // Runtime-only assertion to keep the variable live so the @ts-expect-error
    // comment stays anchored to the assignment above.
    expect(typeof invalid).toBe('string')
  })
})
