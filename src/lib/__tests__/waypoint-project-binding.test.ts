import { describe, expect, it } from 'vitest'

import {
  bindWaypointProjectMetadata,
  getWaypointProjectBinding,
  type WaypointTrustedRootRegistry,
} from '../waypoint-project-binding'

const trustedRoots: WaypointTrustedRootRegistry = {
  'ben-wyman-referrals': {
    caseRoot: '/trusted/cases/ben-wyman',
    sourceRoot: '/trusted/source/ben-wyman',
  },
}

describe('Waypoint project binding', () => {
  it('stores a referral-package binding under projects.metadata.waypoint using trusted roots', () => {
    const metadata = bindWaypointProjectMetadata(null, {
      trustedRoots,
      caseRootKey: 'ben-wyman-referrals',
      caseRoot: '/trusted/cases/ben-wyman/referral-package',
      sourceRoot: '/trusted/source/ben-wyman/intake',
      questSlug: 'referral-package',
      packagePin: {
        packageSource: 'forgejo',
        coreVersion: '0.1.2',
        folderHostVersion: '0.1.2',
      },
    })

    const binding = getWaypointProjectBinding({ id: 1, workspace_id: 1, metadata })

    expect(binding).toEqual({
      enabled: true,
      packageSource: 'forgejo',
      packagePin: '@waypoint/core@0.1.2 @waypoint/folder-host@0.1.2',
      coreVersion: '0.1.2',
      folderHostVersion: '0.1.2',
      caseRootKey: 'ben-wyman-referrals',
      caseRoot: '/trusted/cases/ben-wyman/referral-package',
      sourceRoot: '/trusted/source/ben-wyman/intake',
      sourceReadonly: true,
      questSlug: 'referral-package',
      questVersion: 1,
    })
  })

  it('preserves existing non-waypoint metadata while writing the binding', () => {
    const metadata = bindWaypointProjectMetadata({ external: { owner: 'ops' } }, {
      trustedRoots,
      caseRootKey: 'ben-wyman-referrals',
      caseRoot: '/trusted/cases/ben-wyman/referral-package',
      sourceRoot: '/trusted/source/ben-wyman/intake',
      questSlug: 'referral-package',
      packagePin: { packageSource: 'forgejo', coreVersion: '0.1.2', folderHostVersion: '0.1.2' },
    })

    expect(JSON.parse(metadata).external).toEqual({ owner: 'ops' })
  })

  it('rejects unregistered roots, path traversal, and unsafe quest slugs', () => {
    expect(() => bindWaypointProjectMetadata(null, {
      trustedRoots,
      caseRootKey: 'unknown',
      caseRoot: '/trusted/cases/ben-wyman/referral-package',
      sourceRoot: '/trusted/source/ben-wyman/intake',
      questSlug: 'referral-package',
      packagePin: { packageSource: 'forgejo', coreVersion: '0.1.2', folderHostVersion: '0.1.2' },
    })).toThrow(/unknown trusted root/i)

    expect(() => bindWaypointProjectMetadata(null, {
      trustedRoots,
      caseRootKey: 'ben-wyman-referrals',
      caseRoot: '/trusted/cases/ben-wyman/../other-case',
      sourceRoot: '/trusted/source/ben-wyman/intake',
      questSlug: 'referral-package',
      packagePin: { packageSource: 'forgejo', coreVersion: '0.1.2', folderHostVersion: '0.1.2' },
    })).toThrow(/outside trusted case root/i)

    expect(() => bindWaypointProjectMetadata(null, {
      trustedRoots,
      caseRootKey: 'ben-wyman-referrals',
      caseRoot: '/trusted/cases/ben-wyman/referral-package',
      sourceRoot: '/trusted/source/ben-wyman/intake',
      questSlug: '../referral-package',
      packagePin: { packageSource: 'forgejo', coreVersion: '0.1.2', folderHostVersion: '0.1.2' },
    })).toThrow(/unsafe quest slug/i)
  })
})
