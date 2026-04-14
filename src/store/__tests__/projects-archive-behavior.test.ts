import { describe, it } from 'vitest'

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
  // Wave 1 will implement:
  //   - Import useMissionControl from @/store
  //   - Spy on global.fetch, assert the URL called equals '/api/projects' (no ?includeArchived)
  //   - Seed projects[] with one active + one archived mock, call fetchProjects(),
  //     assert the archived project is not in state.projects after the refresh.
  //   - NO production-code change required in store/index.ts — these tests assert
  //     the current (intentional) behavior. A clarifying code comment will be
  //     added in Wave 1 alongside these test bodies.
  it.todo('fetchProjects() calls GET /api/projects WITHOUT the includeArchived=1 query param (assert exact URL)')
  it.todo('after a PATCH that archives a project, fetchProjects() refresh drops the archived project from state.projects (intentional per FLOW-E decision)')
  it.todo('active projects remain present in state.projects after fetchProjects() refresh (regression guard)')
})
