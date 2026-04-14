import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useMissionControl } from '@/store'

/**
 * FLOW-E (v1.0 Milestone Audit, .planning/v1.0-MILESTONE-AUDIT.md lines 19-29):
 *
 * store.fetchProjects() at src/store/index.ts:877 fetches '/api/projects' WITHOUT
 * ?includeArchived=1. The server (src/app/api/projects/route.ts:47) filters
 * status = 'active' when the flag is absent. Result: archiving a project via
 * Settings causes it to drop out of the Zustand projects array on the next refresh.
 *
 * PLANNING DECISION (Phase 7 gap closure, documented in 07-00-PLAN.md objective):
 *   OPTION 2 — ARCHIVED PROJECTS VANISH FROM THE ACTIVE STORE LIST (INTENTIONAL).
 *
 * Rationale:
 *   1. project-manager-modal.tsx:68 is the authoritative archive UI and already
 *      fetches ?includeArchived=1 independently, showing an "Activate" toggle on
 *      archived rows. Admin archive/unarchive already works there.
 *   2. The Zustand projects array is consumed by nav-rail.tsx:755 (quick switcher)
 *      and task-board-panel.tsx (three project-picker sites). Showing archived
 *      projects in those surfaces would clutter navigation and allow creating
 *      tasks against archived projects.
 *   3. Adding the flag to store.fetchProjects would force a 7-call-site redesign.
 *   4. No milestone requirement mandates archived visibility in the active list.
 *
 * These tests codify that intentional behavior so future refactors cannot quietly
 * regress it.
 */

describe('FLOW-E: store.fetchProjects archive-visibility contract (Phase 7 gap closure)', () => {
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ projects: [] }),
    })
    global.fetch = fetchSpy as unknown as typeof fetch
    useMissionControl.setState({ projects: [] })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('fetchProjects() calls GET /api/projects WITHOUT the includeArchived=1 query param (assert exact URL)', async () => {
    await useMissionControl.getState().fetchProjects()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const calledUrl = fetchSpy.mock.calls[0][0]
    expect(calledUrl).toBe('/api/projects')
    expect(String(calledUrl)).not.toContain('includeArchived')
  })

  it('after a PATCH that archives a project, fetchProjects() refresh drops the archived project from state.projects (intentional per FLOW-E decision)', async () => {
    // Simulate the pre-archive state: two projects in the store.
    useMissionControl.setState({
      projects: [
        { id: 1, slug: 'keep-me', name: 'Keep Me', status: 'active' } as never,
        { id: 2, slug: 'archived-one', name: 'Archived One', status: 'archived' } as never,
      ],
    })

    // Simulate the server's active-only response (archived row filtered out per
    // src/app/api/projects/route.ts:47 when ?includeArchived=1 is absent).
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        projects: [{ id: 1, slug: 'keep-me', name: 'Keep Me', status: 'active' }],
      }),
    })

    await useMissionControl.getState().fetchProjects()
    const projects = useMissionControl.getState().projects
    expect(projects).toHaveLength(1)
    expect(projects[0].slug).toBe('keep-me')
    expect(projects.find(p => p.slug === 'archived-one')).toBeUndefined()
  })

  it('active projects remain present in state.projects after fetchProjects() refresh (regression guard)', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        projects: [
          { id: 1, slug: 'alpha', name: 'Alpha', status: 'active' },
          { id: 2, slug: 'beta', name: 'Beta', status: 'active' },
        ],
      }),
    })
    await useMissionControl.getState().fetchProjects()
    const projects = useMissionControl.getState().projects
    expect(projects).toHaveLength(2)
    expect(projects.map(p => p.slug).sort()).toEqual(['alpha', 'beta'])
  })
})
