import { describe, it } from 'vitest'

// Wave 1 fills these in. Covers: GSD-01, GSD-03, GSD-13, GSD-14.
// Extends projects CRUD routes to accept/return the 6 new gsd_* fields,
// validates track/gate_mode on write, and enforces that gsd_phase may
// ONLY be changed via /api/projects/:id/gsd/transition (not PATCH).

describe('projects CRUD — gsd fields (GSD-01, GSD-03, GSD-13, GSD-14)', () => {
  it.todo('POST accepts gsd_enabled:true, gsd_track:"ops" and returns them in response')
  it.todo('POST rejects invalid gsd_track with 400')
  it.todo('POST rejects invalid gsd_gate_mode with 400')
  it.todo('GET /api/projects list returns gsd_enabled, gsd_track, gsd_phase, gsd_gate_mode, gsd_project_id, gsd_updated_at')
  it.todo('GET /api/projects/:id returns the same 6 gsd_* fields')
  it.todo('PATCH accepts partial gsd updates (gsd_enabled, gsd_track, gsd_gate_mode)')
  it.todo('PATCH does NOT accept gsd_phase (must route through /gsd/transition)')
  it.todo('viewer role gets 403 on POST/PATCH; operator succeeds')
})
