import { describe, it } from 'vitest'

describe('Project workspace indexes (FOUN-02, D-10)', () => {
  it.todo('migration 050_project_workspace_indexes exists in migrations array')
  it.todo('idx_tasks_project_status index exists after migration')
  it.todo('EXPLAIN QUERY PLAN for tasks by project+status uses idx_tasks_project_status')
  it.todo('idx_sessions_project_active index exists after migration')
  it.todo('EXPLAIN QUERY PLAN for sessions by project+active uses idx_sessions_project_active')
})
