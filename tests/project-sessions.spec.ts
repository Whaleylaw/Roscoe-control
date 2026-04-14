import { test } from '@playwright/test'

// Mock/fixture setup (to be implemented in Plan 05-03):
// - Log in as admin via existing auth fixture pattern (see tests/tasks-crud.spec.ts)
// - Seed a project + assign an agent via POST /api/projects and POST /api/projects/<id>/agents
// - Navigate to /project/<slug>/sessions to enter the workspace sessions view

test.describe('Project workspace sessions — E2E', () => {
  test.describe('SESS-01: two-section sessions view', () => {
    test.fixme('sessions tab shows Chat threads header and at least one row for the assigned agent', async () => {})
    test.fixme('sessions tab shows External sessions header (even if empty) when runtime sessions exist elsewhere', async () => {})
    test.fixme('empty state CTA — with no assigned agents, Open Agents tab button navigates to /project/<slug>/agents', async () => {})
  })

  test.describe('SESS-03: click-through to session detail', () => {
    test.fixme('clicking a chat-thread row navigates to /project/<slug>/sessions/thread:<id>:<agent>', async () => {})
    test.fixme('session detail view renders with the embedded SessionDetailsPanel in scope mode (no filters, no page header)', async () => {})
    test.fixme('breadcrumb extends to show Project > Sessions > <agent or ticket-ref> while on detail view', async () => {})
    test.fixme('clicking "Back to sessions" link returns to /project/<slug>/sessions with workspace shell (breadcrumb + tabs) still mounted', async () => {})
    test.fixme('browser back button returns to sessions list (URL-driven state — FOUN-01)', async () => {})
  })

  test.describe('SESS-02: agents tab scoped', () => {
    test.fixme('agents tab lists only agents assigned to or working on this project (union)', async () => {})
    test.fixme('agent card shows Assigned chip when assignment_source is "assigned"', async () => {})
    test.fixme('Add Agent button is not visible in scope mode', async () => {})
  })
})
