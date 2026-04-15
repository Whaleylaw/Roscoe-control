import { describe, it } from 'vitest'

// Wave 1 fills these in. Covers: GSD-02, GSD-06.
// Migration 052_gsd_native_integration adds:
//   projects: gsd_enabled, gsd_track, gsd_phase, gsd_gate_mode,
//             gsd_project_id, gsd_updated_at
//   tasks:    gsd_phase, gate_required, gate_status, gate_approved_by,
//             gate_approved_at, depends_on_task_ids
// Indexes: idx_projects_gsd_phase, idx_tasks_gsd_phase,
//          idx_tasks_gate_status, idx_tasks_project_gsd_phase

describe('migration 052_gsd_native_integration (GSD-02, GSD-06)', () => {
  it.todo('adds gsd_enabled/gsd_track/gsd_phase/gsd_gate_mode/gsd_project_id/gsd_updated_at columns to projects (GSD-02)')
  it.todo('adds gsd_phase/gate_required/gate_status/gate_approved_by/gate_approved_at/depends_on_task_ids columns to tasks')
  it.todo('creates idx_projects_gsd_phase, idx_tasks_gsd_phase, idx_tasks_gate_status, idx_tasks_project_gsd_phase indexes')
  it.todo('is additive — pre-052 DB rows retain existing columns; gsd_phase defaults to "discuss" (GSD-06)')
  it.todo('gate_status defaults to "not_required"; gsd_enabled and gate_required default to 0')
  it.todo('re-running migration is a no-op (PRAGMA guard skips existing columns)')
})
