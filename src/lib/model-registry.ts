/**
 * Model Registry — code-seeded, immutable.
 *
 * This module is the single source of truth for the set of LLM models Mission
 * Control knows about in v1.2. Every runtime consumer (recipe indexer in
 * Phase 12, task-override validation in Phase 11, claim-time model resolution
 * in Phase 14) imports from here.
 *
 * Design rules (locked by .planning/phases/11-runtime-foundation-v1-2/11-CONTEXT.md):
 *   - No aliases. No `opus` → latest. Callers must pin exact identifiers.
 *   - No override file in v1.2. Adding a model = a pull request against this file.
 *   - Lookup returns `null` on miss. Never throw, never return `undefined`.
 *   - Metadata fields are fixed at {provider, context_window, output_tokens_max,
 *     supports_tools, supports_thinking}. Do NOT add pricing / display_name /
 *     doc_url here — those are deferred to the phase that renders or bills.
 *
 * Requirements: MODEL-01 (typed registry), MODEL-03 (task-override validation).
 */

export interface Model {
  /**
   * Model provider used by runtime dispatch metadata.
   */
  provider: 'anthropic' | 'openrouter' | 'openai-codex'
  /** Maximum context window in tokens. */
  context_window: number
  /** Maximum output tokens per response. */
  output_tokens_max: number
  /** Whether the model supports tool / function calling. */
  supports_tools: boolean
  /** Whether the model supports extended thinking / reasoning. */
  supports_thinking: boolean
}

/**
 * Immutable registry of known models. Keyed by exact provider-issued identifier.
 *
 * The `as const satisfies Record<string, Model>` shape locks the literal keys
 * (so `keyof typeof MODELS` is a literal union) while still type-checking each
 * value against the {@link Model} contract.
 */
export const MODELS = {
  'openai/gpt-5.3-codex': {
    provider: 'openai-codex',
    context_window: 200000,
    output_tokens_max: 32000,
    supports_tools: true,
    supports_thinking: true,
  },
  'claude-opus-4-7': {
    provider: 'anthropic',
    context_window: 200000,
    output_tokens_max: 32000,
    supports_tools: true,
    supports_thinking: true,
  },
  'claude-sonnet-4-6': {
    provider: 'anthropic',
    context_window: 200000,
    output_tokens_max: 64000,
    supports_tools: true,
    supports_thinking: true,
  },
  'claude-haiku-4-5-20251001': {
    provider: 'anthropic',
    context_window: 200000,
    output_tokens_max: 8192,
    supports_tools: true,
    supports_thinking: false,
  },
  'openai/gpt-5.4-mini': {
    provider: 'openrouter',
    context_window: 200000,
    output_tokens_max: 32000,
    supports_tools: true,
    supports_thinking: true,
  },
  'google/gemini-3-flash': {
    provider: 'openrouter',
    context_window: 1048576,
    output_tokens_max: 8192,
    supports_tools: true,
    supports_thinking: true,
  },
  'google/gemini-2.5-flash': {
    provider: 'openrouter',
    context_window: 1048576,
    output_tokens_max: 8192,
    supports_tools: true,
    supports_thinking: false,
  },
} as const satisfies Record<string, Model>

/**
 * Literal union of every known model identifier. Downstream schemas /
 * refinements that want compile-time narrowing should use this type.
 */
export type ModelId = keyof typeof MODELS

/**
 * Ordered tuple of every known model identifier. Exposed so error messages and
 * validation helpers can enumerate the allowlist without re-deriving it.
 */
export const MODEL_IDS = Object.keys(MODELS) as ModelId[]

/**
 * Look up a model by its exact identifier. Returns the metadata record or
 * `null` when unknown. Never throws, never returns `undefined`.
 */
export function getModel(id: string): Model | null {
  return (MODELS as Record<string, Model>)[id] ?? null
}

/**
 * Type-guard form of {@link getModel}. Lets callers narrow an arbitrary string
 * to {@link ModelId} inside a conditional.
 */
export function isKnownModel(id: string): id is ModelId {
  return id in MODELS
}
