import { existsSync } from 'node:fs'
import { join } from 'node:path'

import {
  loadBundledWaypointCatalog,
  type BundledWaypointCatalog,
  type WaypointCatalogEntry,
} from '@waypoint/folder-host'

export const REFERRAL_PACKAGE_QUEST_SLUG = 'referral-package' as const

export const REFERRAL_PACKAGE_REQUIRED_RECIPE_SLUGS = [
  'referral-package-document-reviewer',
  'referral-package-packet-segmenter',
  'referral-package-filename-placement-reviewer',
  'firmvault-medical-chronology-update',
  'firmvault-medical-chronology-adversarial-qc',
  'referral-package-start-here-builder',
  'referral-package-package-qc',
] as const

type CatalogQuestManifest = ReturnType<BundledWaypointCatalog['quests']['list']>[number]
type CatalogRecipeManifest = ReturnType<BundledWaypointCatalog['recipes']['list']>[number]

export interface MissionControlReferralPackageCatalog {
  readonly quest: CatalogQuestManifest
  readonly questEntry: WaypointCatalogEntry<CatalogQuestManifest>
  readonly recipes: readonly CatalogRecipeManifest[]
  readonly recipeEntries: readonly WaypointCatalogEntry<CatalogRecipeManifest>[]
  readonly missingRequiredRecipeSlugs: readonly string[]
}

export interface MissionControlWaypointCatalog {
  readonly bundled: BundledWaypointCatalog
  readonly referralPackage: MissionControlReferralPackageCatalog
}

function findLocalWaypointCoreCatalogRoot(): string | undefined {
  const candidates = [
    process.env.MISSION_CONTROL_WAYPOINT_CATALOG_ROOT,
    join(process.cwd(), 'node_modules', '@waypoint', 'core'),
    join(process.cwd(), '.next', 'standalone', 'node_modules', '@waypoint', 'core'),
  ].filter((candidate): candidate is string => Boolean(candidate))

  return candidates.find((candidate) => (
    existsSync(join(candidate, 'quests')) && existsSync(join(candidate, 'recipes'))
  ))
}

export async function loadMissionControlWaypointCatalog(): Promise<MissionControlWaypointCatalog> {
  const root = findLocalWaypointCoreCatalogRoot()
  const bundled = await loadBundledWaypointCatalog(root ? { root } : {})
  const resolved = bundled.resolveQuestRecipes(REFERRAL_PACKAGE_QUEST_SLUG)

  if (!resolved.ok) {
    const message = 'message' in resolved ? resolved.message : 'unknown catalog resolution failure'
    throw new Error(`Mission Control Waypoint catalog is missing ${REFERRAL_PACKAGE_QUEST_SLUG}: ${message}`)
  }

  const recipeSlugs = new Set(resolved.recipes.map((recipe) => recipe.slug))
  const missingRequiredRecipeSlugs = REFERRAL_PACKAGE_REQUIRED_RECIPE_SLUGS.filter((slug) => !recipeSlugs.has(slug))

  return {
    bundled,
    referralPackage: {
      quest: resolved.quest,
      questEntry: resolved.questEntry,
      recipes: resolved.recipes,
      recipeEntries: resolved.recipeEntries,
      missingRequiredRecipeSlugs,
    },
  }
}
