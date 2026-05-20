import { describe, expect, it } from 'vitest'

import { loadMissionControlWaypointCatalog, REFERRAL_PACKAGE_QUEST_SLUG } from '../waypoint-catalog'

describe('Mission Control Waypoint catalog bridge', () => {
  it('loads the package-backed referral-package Quest and its required recipes', async () => {
    const catalog = await loadMissionControlWaypointCatalog()

    expect(REFERRAL_PACKAGE_QUEST_SLUG).toBe('referral-package')
    expect(catalog.referralPackage.quest.slug).toBe('referral-package')
    expect(catalog.referralPackage.quest.workflow).toBe('referral-package')
    expect(catalog.referralPackage.questEntry.relativePath).toBe('referral-package.yaml')
    expect(catalog.referralPackage.recipes.map((recipe) => recipe.slug)).toEqual([
      'referral-package-document-reviewer',
      'referral-package-packet-segmenter',
      'referral-package-filename-placement-reviewer',
      'firmvault-medical-chronology-update',
      'firmvault-medical-chronology-adversarial-qc',
      'referral-package-start-here-builder',
      'referral-package-package-qc',
    ])
    expect(catalog.referralPackage.missingRequiredRecipeSlugs).toEqual([])
    expect(catalog.referralPackage.recipeEntries.every((entry) => entry.relativePath.endsWith('.yaml'))).toBe(true)
  })
})
