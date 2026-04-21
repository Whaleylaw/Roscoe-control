/**
 * Unit tests for src/lib/model-tier-colors.ts (Phase 16 Wave-0 extraction).
 *
 * Covers:
 *  - modelToTier string inference across opus/sonnet/haiku and null/undefined/unknown
 *  - modelTierClassName maps each known tier to the exact MODEL_TIER_COLORS entry
 *    and returns the muted fallback for 'unknown'
 */

import { describe, it, expect } from 'vitest'
import {
  MODEL_TIER_COLORS,
  modelToTier,
  modelTierClassName,
  type ModelTier,
} from '@/lib/model-tier-colors'

describe('modelToTier', () => {
  it('returns "opus" for claude-opus-4-7-20251001', () => {
    expect(modelToTier('claude-opus-4-7-20251001')).toBe('opus')
  })

  it('returns "sonnet" for anthropic/claude-sonnet-4-6', () => {
    expect(modelToTier('anthropic/claude-sonnet-4-6')).toBe('sonnet')
  })

  it('returns "haiku" for claude-haiku-4-5', () => {
    expect(modelToTier('claude-haiku-4-5')).toBe('haiku')
  })

  it('returns "unknown" for empty string', () => {
    expect(modelToTier('')).toBe('unknown')
  })

  it('returns "unknown" for null', () => {
    expect(modelToTier(null)).toBe('unknown')
  })

  it('returns "unknown" for undefined', () => {
    expect(modelToTier(undefined)).toBe('unknown')
  })

  it('returns "unknown" for a non-claude model like gpt-5', () => {
    expect(modelToTier('gpt-5')).toBe('unknown')
  })

  it('is case-insensitive (OPUS uppercase → opus)', () => {
    expect(modelToTier('Claude-OPUS-4-7')).toBe('opus')
  })
})

describe('modelTierClassName', () => {
  it('returns the exact MODEL_TIER_COLORS entry for opus', () => {
    expect(modelTierClassName('opus')).toBe(MODEL_TIER_COLORS.opus)
  })

  it('returns the exact MODEL_TIER_COLORS entry for sonnet', () => {
    expect(modelTierClassName('sonnet')).toBe(MODEL_TIER_COLORS.sonnet)
  })

  it('returns the exact MODEL_TIER_COLORS entry for haiku', () => {
    expect(modelTierClassName('haiku')).toBe(MODEL_TIER_COLORS.haiku)
  })

  it('returns the muted fallback for unknown', () => {
    expect(modelTierClassName('unknown')).toBe(
      'bg-muted/20 text-muted-foreground border-muted/30',
    )
  })

  it('narrows correctly against ModelTier union', () => {
    const tier: ModelTier = 'opus'
    expect(modelTierClassName(tier)).toBe(MODEL_TIER_COLORS.opus)
  })
})

describe('MODEL_TIER_COLORS byte-for-byte parity with agent-detail-tabs.tsx', () => {
  // These exact class strings must match the map previously declared at
  // src/components/panels/agent-detail-tabs.tsx (~line 807-810). Locking
  // byte-for-byte so no visual regression slips through Wave-0 extraction.
  it('opus = bg-purple-500/20 text-purple-400 border-purple-500/30', () => {
    expect(MODEL_TIER_COLORS.opus).toBe(
      'bg-purple-500/20 text-purple-400 border-purple-500/30',
    )
  })
  it('sonnet = bg-blue-500/20 text-blue-400 border-blue-500/30', () => {
    expect(MODEL_TIER_COLORS.sonnet).toBe(
      'bg-blue-500/20 text-blue-400 border-blue-500/30',
    )
  })
  it('haiku = bg-green-500/20 text-green-400 border-green-500/30', () => {
    expect(MODEL_TIER_COLORS.haiku).toBe(
      'bg-green-500/20 text-green-400 border-green-500/30',
    )
  })
})
