import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '@/lib/migrations'

function taskReviewPrUniqueIndexColumns(db: Database.Database) {
  const cols = db.prepare(`PRAGMA index_info(idx_task_review_prs_unique_provider_pr)`).all() as Array<{ name: string }>
  return cols.map((col) => col.name)
}

describe('task_review_prs migration', () => {
  it('creates task_review_prs with audit fields and indexes', () => {
    const db = new Database(':memory:')
    try {
      runMigrations(db)
      const cols = db.prepare(`PRAGMA table_info(task_review_prs)`).all() as Array<{ name: string }>
      const names = cols.map((c) => c.name)
      expect(names).toEqual(expect.arrayContaining([
        'id',
        'task_id',
        'workspace_id',
        'provider',
        'remote_name',
        'remote_url',
        'repo_owner',
        'repo_name',
        'base_ref',
        'head_ref',
        'branch_name',
        'pr_number',
        'pr_url',
        'state',
        'merge_commit_sha',
        'created_at',
        'updated_at',
        'last_checked_at',
        'metadata_json',
      ]))
      expect(taskReviewPrUniqueIndexColumns(db)).toEqual([
        'workspace_id',
        'provider',
        'remote_url',
        'repo_owner',
        'repo_name',
        'pr_number',
      ])
      db.prepare(`INSERT INTO tasks (id, title) VALUES (1, 'Review PR task')`).run()
      db.prepare(`
        INSERT INTO task_review_prs (
          task_id, workspace_id, provider, remote_name, remote_url,
          repo_owner, repo_name, base_ref, head_ref, branch_name,
          pr_number, pr_url, state
        ) VALUES (1, 1, 'forgejo', 'forgejo', 'ssh://git@localhost:2222/aaron/FirmVault.git',
          'aaron', 'FirmVault', 'main', 'mc/task-1', 'mc/task-1', 5,
          'http://localhost:3001/aaron/FirmVault/pulls/5', 'open')
      `).run()
      const row = db.prepare(`SELECT state, pr_number FROM task_review_prs WHERE task_id = 1`).get() as { state: string; pr_number: number }
      expect(row).toEqual({ state: 'open', pr_number: 5 })
    } finally {
      db.close()
    }
  })

  it('repairs the pre-067 unique index shape when rerun', () => {
    const db = new Database(':memory:')
    try {
      runMigrations(db)
      db.exec(`
        DROP INDEX IF EXISTS idx_task_review_prs_unique_provider_pr;
        CREATE UNIQUE INDEX idx_task_review_prs_unique_provider_pr
          ON task_review_prs(workspace_id, provider, repo_owner, repo_name, pr_number);
        DELETE FROM schema_migrations WHERE id = '067_task_review_prs';
      `)

      runMigrations(db)

      expect(taskReviewPrUniqueIndexColumns(db)).toEqual([
        'workspace_id',
        'provider',
        'remote_url',
        'repo_owner',
        'repo_name',
        'pr_number',
      ])
    } finally {
      db.close()
    }
  })
})
