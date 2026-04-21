/**
 * Shared model-tier color palette + tier inference helpers.
 *
 * Phase 16 Wave-0 extraction — single source of truth for the opus/sonnet/haiku
 * color chip classes previously declared inline at
 * `src/components/panels/agent-detail-tabs.tsx`. Wave-1 plans (recipe badge,
 * recipes panel chip, combobox tier indicator) all import from here so a future
 * palette change lands in one file.
 *
 * The three canonical tiers match the Claude model families; strings that
 * don't match a known substring map to `'unknown'` and render with the
 * neutral muted fallback returned by `modelTierClassName`.
 */

export const MODEL_TIER_COLORS: Record<'opus' | 'sonnet' | 'haiku', string> = {
  opus: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  sonnet: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  haiku: 'bg-green-500/20 text-green-400 border-green-500/30',
}

export type ModelTier = 'opus' | 'sonnet' | 'haiku' | 'unknown'

/**
 * Derive a model tier from a free-form model string (recipe `model.primary`,
 * task `model_override`, agent config, etc.). Case-insensitive substring match:
 *   'claude-opus-4-7-20251001'    → 'opus'
 *   'anthropic/claude-sonnet-4-6' → 'sonnet'
 *   'claude-haiku-4-5'            → 'haiku'
 *   anything else / null / ''     → 'unknown'
 */
export function modelToTier(model: string | null | undefined): ModelTier {
  if (!model) return 'unknown'
  const lower = model.toLowerCase()
  if (lower.includes('opus')) return 'opus'
  if (lower.includes('sonnet')) return 'sonnet'
  if (lower.includes('haiku')) return 'haiku'
  return 'unknown'
}

const UNKNOWN_TIER_CLASSES = 'bg-muted/20 text-muted-foreground border-muted/30'

/**
 * Return the Tailwind class string for a given tier. Known tiers hit
 * `MODEL_TIER_COLORS`; `'unknown'` falls back to a neutral muted chip so
 * callers never have to branch on the `'unknown'` case themselves.
 */
export function modelTierClassName(tier: ModelTier): string {
  if (tier === 'unknown') return UNKNOWN_TIER_CLASSES
  return MODEL_TIER_COLORS[tier]
}
