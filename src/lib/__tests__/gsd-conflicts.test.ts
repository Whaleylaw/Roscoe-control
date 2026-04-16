import { describe, expect, it } from 'vitest'
import {
  detectWaveConflictsFromRows,
  extractTaskResourceHints,
  findOverlappingHints,
} from '@/lib/gsd-conflicts'

describe('gsd conflict helpers', () => {
  it('extracts normalized resource hints from task metadata', () => {
    const hints = extractTaskResourceHints({
      metadata: JSON.stringify({
        implementation_repo: 'builderz-labs/mission-control',
        code_location: './src/app/api',
        touched_files: ['src/app/api/projects/route.ts', 'src/app/api/tasks/route.ts'],
      }),
    })

    expect(hints).toEqual([
      { repo: 'builderz-labs/mission-control', path: 'src/app/api' },
      { repo: 'builderz-labs/mission-control', path: 'src/app/api/projects/route.ts' },
      { repo: 'builderz-labs/mission-control', path: 'src/app/api/tasks/route.ts' },
    ])
  })

  it('detects overlapping resource hints by shared path prefix', () => {
    const overlaps = findOverlappingHints(
      [{ repo: 'builderz-labs/mission-control', path: 'src/app/api' }],
      [{ repo: 'builderz-labs/mission-control', path: 'src/app/api/projects/route.ts' }],
    )

    expect(overlaps).toEqual(['src/app/api'])
  })

  it('finds active same-wave conflicts from plan/task rows', () => {
    const conflicts = detectWaveConflictsFromRows([
      {
        plan_id: 1,
        phase_id: 10,
        wave: 1,
        status: 'in_progress',
        metadata: JSON.stringify({
          implementation_repo: 'builderz-labs/mission-control',
          code_location: 'src/components/project/lifecycle',
        }),
      },
      {
        plan_id: 2,
        phase_id: 10,
        wave: 1,
        status: 'review',
        metadata: JSON.stringify({
          implementation_repo: 'builderz-labs/mission-control',
          touched_files: ['src/components/project/lifecycle/lifecycle-view.tsx'],
        }),
      },
      {
        plan_id: 3,
        phase_id: 10,
        wave: 1,
        status: 'todo',
        metadata: JSON.stringify({
          implementation_repo: 'builderz-labs/mission-control',
          code_location: 'src/lib',
        }),
      },
    ])

    expect(conflicts).toEqual([
      {
        phase_id: 10,
        wave: 1,
        plan_ids: [1, 2],
        paths: ['src/components/project/lifecycle'],
      },
    ])
  })
})
