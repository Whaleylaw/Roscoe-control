#!/usr/bin/env node
/**
 * Plan 16-01 Task 2 — Atomic seeding of Phase 16 i18n keys across 10 locales.
 *
 * Adds these NEW keys to every messages/<locale>.json:
 *   - nav.recipes
 *   - taskBoard.recipeBadge.*
 *   - taskBoard.runnerBanner.*
 *   - taskBoard.progressTab.*
 *   - taskBoard.recipeField.*
 *   - taskBoard.advancedSection.*
 *   - recipesPanel.*  (new top-level namespace)
 *
 * English copy is the source of truth. Non-en locales receive the same English
 * string values as placeholders (Phase 9 precedent — key PARITY is the gate,
 * not content quality; real translations ship as a separate chore PR).
 *
 * Idempotent: re-running is a no-op because every key is only inserted if absent.
 * Exits non-zero if any existing key would be overwritten, so pre-existing drift
 * is loudly surfaced rather than silently clobbered.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const REPO_ROOT = resolve(__dirname, '../../..')
const LOCALES = ['en', 'es', 'fr', 'de', 'ja', 'ko', 'pt', 'ru', 'zh', 'ar']

// English copy — single source of truth. Plan frontmatter lists these keys.
const NEW_KEYS = {
  // nav.recipes lives under the existing nav namespace
  nav: {
    recipes: 'Recipes',
  },

  // taskBoard sub-objects — append to existing taskBoard namespace
  taskBoard: {
    recipeBadge: {
      ariaLabel: 'Recipe: {slug}',
    },
    runnerBanner: {
      online: '🟢 Runner online',
      offlineCount: '🔴 Runner offline — tasks waiting: {count}',
      statusUnavailable: 'Runner status unavailable',
    },
    progressTab: {
      tabLabel: 'Progress',
      empty: 'Waiting for first checkpoint…',
      attemptLabel: 'Attempt {n}',
      attemptCheckpointCount: '{count} checkpoints',
      blockerPrefix: 'Blocked:',
      artifactKindFile: '📄 File',
      artifactKindUrl: '🔗 URL',
      artifactKindDiff: '📝 Diff',
      artifactKindTestResult: '✅ Test result',
      artifactKindComment: '💬 Comment',
      artifactKindOther: '✨ Artifact',
      tokensLabel: '{tokens} tokens',
      durationLabel: '{ms} ms',
      loadError: 'Failed to load checkpoints',
      collapseAttempt: 'Collapse attempt',
      expandAttempt: 'Expand attempt',
    },
    recipeField: {
      label: 'Recipe',
      placeholder: 'Search recipes…',
      clear: 'Clear recipe',
      noResults: 'No recipes match',
      lockedHint: 'Locked — dispatch started',
      searching: 'Searching…',
    },
    advancedSection: {
      heading: 'Advanced',
      readOnlyMountsLabel: 'Read-only mounts',
      addMount: 'Add mount',
      removeMount: 'Remove mount',
      hostPathPlaceholder: '/host/path',
      containerPathPlaceholder: '/container/path',
      labelPlaceholder: 'Label',
      extraSkillsLabel: 'Extra skills',
      skillPlaceholder: 'Type a skill path and press Enter',
      removeSkill: 'Remove skill',
      modelOverrideLabel: 'Model override',
      modelOverridePlaceholder: 'e.g. anthropic/claude-sonnet-4-6',
      lockedHint: 'Locked — dispatch started',
    },
  },

  // New top-level namespace
  recipesPanel: {
    title: 'Recipes',
    subtitle:
      'Indexed recipes from the filesystem. Edit recipe.yaml files on disk and click Resync.',
    resync: 'Resync',
    resyncing: 'Resyncing…',
    resyncSuccess: 'Indexed {inserted} new, updated {updated}, removed {deleted}',
    resyncError: 'Resync failed',
    emptyHeading: 'No recipes indexed',
    emptyBody:
      'Author recipes under the recipes/ directory and click Resync, or restart the server.',
    viewRecipe: 'View',
    hideRecipe: 'Hide',
    modelLabel: 'Model',
    tagsLabel: 'Tags',
    descriptionLabel: 'Description',
    loadError: 'Failed to load recipes',
  },
}

/**
 * Recursive merge: inserts every key/sub-key from `additions` into `target` if
 * missing. Throws if a leaf already exists (to catch accidental clobbers).
 */
function mergeKeys(target, additions, path = '') {
  for (const [key, value] of Object.entries(additions)) {
    const fullPath = path ? `${path}.${key}` : key
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      if (target[key] === undefined) {
        target[key] = {}
      } else if (
        typeof target[key] !== 'object' ||
        Array.isArray(target[key])
      ) {
        throw new Error(
          `[seed-i18n] key collision at "${fullPath}" — target is not an object`,
        )
      }
      mergeKeys(target[key], value, fullPath)
    } else {
      if (target[key] !== undefined) {
        // Idempotent re-run OK when values match. Drift → hard fail.
        if (target[key] === value) continue
        throw new Error(
          `[seed-i18n] key "${fullPath}" already exists with different value — refusing to clobber`,
        )
      }
      target[key] = value
    }
  }
}

function processLocale(locale) {
  const file = resolve(REPO_ROOT, 'messages', `${locale}.json`)
  const raw = readFileSync(file, 'utf8')
  const json = JSON.parse(raw)

  mergeKeys(json, NEW_KEYS)

  // Detect trailing newline style from the original file and preserve it.
  const hasTrailingNewline = raw.endsWith('\n')
  const serialized = JSON.stringify(json, null, 2) + (hasTrailingNewline ? '\n' : '')
  writeFileSync(file, serialized, 'utf8')
  return { locale, file }
}

let updated = 0
for (const locale of LOCALES) {
  const { locale: loc, file } = processLocale(locale)
  console.log(`  [ok] ${loc.padEnd(2)} → ${file}`)
  updated++
}

// Verification — every new leaf path must exist in every locale.
function walkPaths(obj, prefix = '', out = new Set()) {
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${k}` : k
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      walkPaths(v, p, out)
    } else {
      out.add(p)
    }
  }
  return out
}

const expectedPaths = walkPaths(NEW_KEYS)
let missing = 0
for (const locale of LOCALES) {
  const file = resolve(REPO_ROOT, 'messages', `${locale}.json`)
  const json = JSON.parse(readFileSync(file, 'utf8'))
  const actualPaths = walkPaths(json)
  for (const p of expectedPaths) {
    if (!actualPaths.has(p)) {
      console.error(`  [MISS] ${locale}.json missing ${p}`)
      missing++
    }
  }
}

if (missing > 0) {
  console.error(`[seed-i18n] ${missing} missing keys across locales`)
  process.exit(1)
}

console.log(
  `[seed-i18n] OK — ${expectedPaths.size} new paths × ${LOCALES.length} locales = ${
    expectedPaths.size * LOCALES.length
  } key-insertions across ${updated} files`,
)
