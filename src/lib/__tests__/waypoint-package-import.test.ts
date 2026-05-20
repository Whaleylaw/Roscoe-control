import { describe, expect, it } from 'vitest'

import { createQuestRegistry, parseQuestManifest } from '@waypoint/core'
import { loadBundledWaypointCatalog, runReferralPackageBuilder } from '@waypoint/folder-host'

describe('pinned Waypoint package imports', () => {
  it('exposes core and folder-host APIs required by Mission Control host runtime', () => {
    expect(typeof parseQuestManifest).toBe('function')
    expect(typeof createQuestRegistry).toBe('function')
    expect(typeof loadBundledWaypointCatalog).toBe('function')
    expect(typeof runReferralPackageBuilder).toBe('function')
  })
})
