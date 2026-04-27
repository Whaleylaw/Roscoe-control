import { beforeEach, describe, expect, it, vi } from 'vitest'

const forgejoMocks = vi.hoisted(() => ({
  createPullRequest: vi.fn(),
}))

vi.mock('node:child_process', () => {
  const spawnSync = vi.fn()
  return { default: { spawnSync }, spawnSync }
})
vi.mock('node:fs', () => {
  const existsSync = vi.fn(() => true)
  return { default: { existsSync }, existsSync }
})
vi.mock('@/lib/task-runtime-settings', () => ({
  getProjectRepoMap: () => ({ '38': '/repo/FirmVault' }),
  getReviewPrSettings: () => ({
    provider: 'forgejo',
    remoteName: 'forgejo',
    forgejoBaseUrl: 'http://localhost:3001',
    forgejoToken: 'secret',
    autoCreate: true,
  }),
}))
vi.mock('@/lib/forgejo-client', () => ({
  createForgejoClient: () => ({
    createPullRequest: forgejoMocks.createPullRequest,
  }),
}))

const { spawnSync } = await import('node:child_process')
const { publishApprovedWorktreeForReview } = await import('@/lib/review-prs')

type ReviewPrRow = {
  task_id: number
  workspace_id: number
  provider: string
  remote_name: string
  remote_url: string
  repo_owner: string
  repo_name: string
  base_ref: string
  head_ref: string
  branch_name: string
  pr_number: number
  pr_url: string
  state: string
  metadata_json: string
}

function createDb() {
  const reviewPrs: ReviewPrRow[] = []
  const taskUpdates: unknown[][] = []

  return {
    reviewPrs,
    taskUpdates,
    prepare(sql: string) {
      return {
        get: (taskId: number) => {
          if (sql.includes('FROM task_review_prs')) {
            return reviewPrs
              .filter((row) => row.task_id === taskId && row.provider === 'forgejo' && row.state === 'open')
              .at(-1)
          }
          return undefined
        },
        all: () => [],
        run: (...params: unknown[]) => {
          if (sql.includes('INSERT INTO task_review_prs')) {
            reviewPrs.push({
              task_id: params[0] as number,
              workspace_id: params[1] as number,
              provider: 'forgejo',
              remote_name: params[2] as string,
              remote_url: params[3] as string,
              repo_owner: params[4] as string,
              repo_name: params[5] as string,
              base_ref: params[6] as string,
              head_ref: params[7] as string,
              branch_name: params[8] as string,
              pr_number: params[9] as number,
              pr_url: params[10] as string,
              state: 'open',
              metadata_json: params[14] as string,
            })
          }
          if (sql.includes('UPDATE tasks')) taskUpdates.push(params)
          return { lastInsertRowid: 1 }
        },
      }
    },
  }
}

function mockGit() {
  vi.mocked(spawnSync).mockImplementation((cmd, args) => {
    const joined = [cmd, ...(args as string[])].join(' ')
    if (joined.includes('remote get-url forgejo')) {
      return {
        status: 0,
        stdout: 'ssh://git@localhost:2222/aaron/FirmVault.git\n',
        stderr: '',
      } as ReturnType<typeof spawnSync>
    }
    if (joined.includes('rev-parse --abbrev-ref HEAD')) {
      return { status: 0, stdout: 'mc/task-2112\n', stderr: '' } as ReturnType<typeof spawnSync>
    }
    if (joined.includes('diff --cached --quiet')) {
      return { status: 1, stdout: '', stderr: '' } as ReturnType<typeof spawnSync>
    }
    if (joined.includes('rev-list --count codex/complete-workflow-v2..mc/task-2112')) {
      return { status: 0, stdout: '1\n', stderr: '' } as ReturnType<typeof spawnSync>
    }
    return { status: 0, stdout: '', stderr: '' } as ReturnType<typeof spawnSync>
  })
}

describe('publishApprovedWorktreeForReview', () => {
  beforeEach(() => {
    vi.mocked(spawnSync).mockReset()
    forgejoMocks.createPullRequest.mockReset()
    forgejoMocks.createPullRequest.mockResolvedValue({
      number: 12,
      url: 'http://localhost:3001/aaron/FirmVault/pulls/12',
      state: 'open',
      head: 'mc/task-2112',
      base: 'codex/complete-workflow-v2',
      mergeCommitSha: null,
    })
    mockGit()
  })

  it('commits, pushes, creates a PR, stores it, and mirrors task PR fields', async () => {
    const db = createDb()

    const result = await publishApprovedWorktreeForReview(db as never, {
      id: 2112,
      title: 'Load Document Checklist',
      workspace_id: 1,
      worktree_path: '/worktrees/task-2112',
      workspace_source: JSON.stringify({ project_id: 38, base_ref: 'codex/complete-workflow-v2' }),
    })

    expect(result).toEqual({
      published: true,
      provider: 'forgejo',
      state: 'open',
      pr_number: 12,
      pr_url: 'http://localhost:3001/aaron/FirmVault/pulls/12',
      branch: 'mc/task-2112',
      base_ref: 'codex/complete-workflow-v2',
    })
    expect(forgejoMocks.createPullRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: 'aaron',
        repo: 'FirmVault',
        title: 'Task 2112: Load Document Checklist',
        head: 'mc/task-2112',
        base: 'codex/complete-workflow-v2',
      }),
    )
    expect(db.reviewPrs).toHaveLength(1)
    expect(db.reviewPrs[0]).toMatchObject({
      remote_url: 'ssh://git@localhost:2222/aaron/FirmVault.git',
      repo_owner: 'aaron',
      repo_name: 'FirmVault',
      pr_number: 12,
      pr_url: 'http://localhost:3001/aaron/FirmVault/pulls/12',
    })
    expect(JSON.parse(db.reviewPrs[0].metadata_json)).toEqual({
      head: 'mc/task-2112',
      base: 'codex/complete-workflow-v2',
    })
    expect(db.taskUpdates).toHaveLength(1)
    expect(db.taskUpdates[0].slice(0, 4)).toEqual(['aaron/FirmVault', 'mc/task-2112', 12, expect.any(Number)])
    expect(vi.mocked(spawnSync).mock.calls.some((call) => (call[1] as string[]).includes('push'))).toBe(true)
    expect(vi.mocked(spawnSync).mock.calls.some((call) => (call[1] as string[]).includes('commit'))).toBe(true)
  })

  it('returns not_worktree_task when task has no worktree source', async () => {
    const result = await publishApprovedWorktreeForReview(createDb() as never, {
      id: 2112,
      title: 'Load Document Checklist',
      workspace_id: 1,
      worktree_path: null,
      workspace_source: null,
    })

    expect(result).toEqual({ published: false, reason: 'not_worktree_task' })
    expect(spawnSync).not.toHaveBeenCalled()
    expect(forgejoMocks.createPullRequest).not.toHaveBeenCalled()
  })

  it('reuses an existing open review PR row without creating a duplicate PR', async () => {
    const db = createDb()
    await publishApprovedWorktreeForReview(db as never, {
      id: 2112,
      title: 'Load Document Checklist',
      workspace_id: 1,
      worktree_path: '/worktrees/task-2112',
      workspace_source: JSON.stringify({ project_id: 38, base_ref: 'codex/complete-workflow-v2' }),
    })

    const result = await publishApprovedWorktreeForReview(db as never, {
      id: 2112,
      title: 'Load Document Checklist',
      workspace_id: 1,
      worktree_path: '/worktrees/task-2112',
      workspace_source: JSON.stringify({ project_id: 38, base_ref: 'codex/complete-workflow-v2' }),
    })

    expect(result).toMatchObject({
      published: true,
      pr_number: 12,
      pr_url: 'http://localhost:3001/aaron/FirmVault/pulls/12',
    })
    expect(db.reviewPrs).toHaveLength(1)
    expect(forgejoMocks.createPullRequest).toHaveBeenCalledTimes(1)
  })

  it('returns no_changes when the worktree branch has no commits compared to base', async () => {
    vi.mocked(spawnSync).mockImplementation((cmd, args) => {
      const joined = [cmd, ...(args as string[])].join(' ')
      if (joined.includes('remote get-url forgejo')) {
        return { status: 0, stdout: 'ssh://git@localhost:2222/aaron/FirmVault.git\n', stderr: '' } as ReturnType<typeof spawnSync>
      }
      if (joined.includes('rev-parse --abbrev-ref HEAD')) {
        return { status: 0, stdout: 'mc/task-2112\n', stderr: '' } as ReturnType<typeof spawnSync>
      }
      if (joined.includes('rev-list --count codex/complete-workflow-v2..mc/task-2112')) {
        return { status: 0, stdout: '0\n', stderr: '' } as ReturnType<typeof spawnSync>
      }
      return { status: 0, stdout: '', stderr: '' } as ReturnType<typeof spawnSync>
    })

    const result = await publishApprovedWorktreeForReview(createDb() as never, {
      id: 2112,
      title: 'Load Document Checklist',
      workspace_id: 1,
      worktree_path: '/worktrees/task-2112',
      workspace_source: JSON.stringify({ project_id: 38, base_ref: 'codex/complete-workflow-v2' }),
    })

    expect(result).toEqual({ published: false, reason: 'no_changes' })
    expect(forgejoMocks.createPullRequest).not.toHaveBeenCalled()
    expect(vi.mocked(spawnSync).mock.calls.some((call) => (call[1] as string[]).includes('push'))).toBe(false)
  })
})
