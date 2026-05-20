import { describe, expect, it } from 'vitest'
import { findCoreBoundaryViolations } from '../../../packages/waypoint-core/src/boundaries'

describe('waypoint-core architecture boundaries', () => {
  it('flags host-specific imports in core modules', () => {
    const violations = findCoreBoundaryViolations([
      {
        path: 'packages/waypoint-core/src/bad.ts',
        content: "import { NextResponse } from 'next/server'\n",
      },
    ])

    expect(violations).toEqual([
      {
        path: 'packages/waypoint-core/src/bad.ts',
        importPath: 'next/server',
        rule: 'next/*',
      },
    ])
  })

  it('allows internal and platform-agnostic imports', () => {
    const violations = findCoreBoundaryViolations([
      {
        path: 'packages/waypoint-core/src/good.ts',
        content: "import { WAYPOINT_CORE_PACKAGE } from './index'\n",
      },
    ])

    expect(violations).toEqual([])
  })
})
