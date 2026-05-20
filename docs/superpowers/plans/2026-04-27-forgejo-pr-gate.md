# Forgejo PR Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace direct local worktree promotion with a Forgejo PR gate where workflow tasks remain open until the PR is merged.

**Architecture:** Approved task worktrees are committed, pushed to the configured Forgejo remote, and opened as review PRs. Mission Control stores review PR records, keeps the task in `quality_review` while the PR is open, and advances workflow dependencies only when a reconciliation pass observes the PR has merged.

**Tech Stack:** Next.js route handlers, TypeScript, better-sqlite3 migrations, Git CLI via `spawnSync`, Forgejo/Gitea REST API, Vitest.

---

## File Map

- Create `src/lib/review-prs.ts`: provider-neutral review PR publication and reconciliation helpers.
- Create `src/lib/forgejo-client.ts`: tiny Forgejo/Gitea API wrapper.
- Modify `src/lib/migrations.ts`: add `task_review_prs` table and indexes.
- Modify `src/lib/task-runtime-settings.ts`: expose Forgejo review PR settings.
- Modify `src/app/api/settings/route.ts`: document the new runtime settings.
- Modify `src/app/api/quality-review/route.ts`: publish PR on approval; do not mark done until merge.
- Modify `src/app/api/runner/tasks/[task_id]/review/route.ts`: same behavior for recipe reviewer approvals.
- Create `src/app/api/review-prs/reconcile/route.ts`: operator-triggerable reconciliation endpoint.
- Modify `src/components/panels/task-board-panel.tsx`: link to latest review PR in task detail/card when present.
- Create/modify tests under `src/lib/__tests__/` and `src/app/api/**/__tests__/`.

## Task 1: Add Review PR Persistence

**Files:**
- Modify: `src/lib/migrations.ts`
- Test: `src/lib/__tests__/migrations-review-prs.test.ts`

- [ ] **Step 1: Write the failing migration test**

Create `src/lib/__tests__/migrations-review-prs.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '@/lib/migrations'

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
})
```

- [ ] **Step 2: Run the migration test to verify it fails**

Run:

```bash
pnpm vitest run src/lib/__tests__/migrations-review-prs.test.ts
```

Expected: FAIL because `task_review_prs` does not exist.

- [ ] **Step 3: Add the migration**

Add a new migration after the current workflow migrations in `src/lib/migrations.ts`:

```ts
{
  id: '065_task_review_prs',
  up(db: Database.Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS task_review_prs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id INTEGER NOT NULL,
        workspace_id INTEGER NOT NULL DEFAULT 1,
        provider TEXT NOT NULL,
        remote_name TEXT NOT NULL,
        remote_url TEXT NOT NULL,
        repo_owner TEXT NOT NULL,
        repo_name TEXT NOT NULL,
        base_ref TEXT NOT NULL,
        head_ref TEXT NOT NULL,
        branch_name TEXT NOT NULL,
        pr_number INTEGER NOT NULL,
        pr_url TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'open',
        merge_commit_sha TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
        last_checked_at INTEGER,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_task_review_prs_task
        ON task_review_prs(task_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_task_review_prs_open
        ON task_review_prs(workspace_id, provider, state, last_checked_at);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_task_review_prs_unique_provider_pr
        ON task_review_prs(workspace_id, provider, repo_owner, repo_name, pr_number);
    `)
  },
}
```

- [ ] **Step 4: Run the migration test to verify it passes**

Run:

```bash
pnpm vitest run src/lib/__tests__/migrations-review-prs.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/migrations.ts src/lib/__tests__/migrations-review-prs.test.ts
git commit -m "feat: add task review PR table"
```

## Task 2: Add Forgejo Settings and Client

**Files:**
- Create: `src/lib/forgejo-client.ts`
- Modify: `src/lib/task-runtime-settings.ts`
- Modify: `src/app/api/settings/route.ts`
- Test: `src/lib/__tests__/forgejo-client.test.ts`

- [ ] **Step 1: Write the client test**

Create `src/lib/__tests__/forgejo-client.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createForgejoClient } from '@/lib/forgejo-client'

describe('forgejo client', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('creates a pull request with the Gitea-compatible API', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      number: 7,
      html_url: 'http://localhost:3001/aaron/FirmVault/pulls/7',
      state: 'open',
      head: { ref: 'mc/task-2112' },
      base: { ref: 'codex/complete-workflow-v2' },
    }), { status: 201, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    const client = createForgejoClient({ baseUrl: 'http://localhost:3001', token: 'secret' })
    const pr = await client.createPullRequest({
      owner: 'aaron',
      repo: 'FirmVault',
      title: 'Task 2112',
      body: 'Review task 2112',
      head: 'mc/task-2112',
      base: 'codex/complete-workflow-v2',
    })

    expect(pr).toMatchObject({
      number: 7,
      url: 'http://localhost:3001/aaron/FirmVault/pulls/7',
      state: 'open',
      head: 'mc/task-2112',
      base: 'codex/complete-workflow-v2',
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3001/api/v1/repos/aaron/FirmVault/pulls',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ authorization: 'token secret' }),
      }),
    )
  })

  it('reads merged pull request state', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      number: 7,
      html_url: 'http://localhost:3001/aaron/FirmVault/pulls/7',
      state: 'closed',
      merged: true,
      merge_commit_sha: 'abc123',
      head: { ref: 'mc/task-2112' },
      base: { ref: 'codex/complete-workflow-v2' },
    }), { status: 200, headers: { 'content-type': 'application/json' } })))

    const client = createForgejoClient({ baseUrl: 'http://localhost:3001', token: 'secret' })
    const pr = await client.getPullRequest({ owner: 'aaron', repo: 'FirmVault', number: 7 })

    expect(pr).toMatchObject({ state: 'merged', mergeCommitSha: 'abc123' })
  })
})
```

- [ ] **Step 2: Run the client test to verify it fails**

Run:

```bash
pnpm vitest run src/lib/__tests__/forgejo-client.test.ts
```

Expected: FAIL because `src/lib/forgejo-client.ts` does not exist.

- [ ] **Step 3: Implement the client**

Create `src/lib/forgejo-client.ts`:

```ts
export type ForgejoClientConfig = {
  baseUrl: string
  token: string
}

export type ForgejoPullRequest = {
  number: number
  url: string
  state: 'open' | 'closed' | 'merged'
  head: string
  base: string
  mergeCommitSha: string | null
}

export type CreateForgejoPullRequestInput = {
  owner: string
  repo: string
  title: string
  body: string
  head: string
  base: string
}

export function createForgejoClient(config: ForgejoClientConfig) {
  const baseUrl = config.baseUrl.replace(/\/+$/, '')
  const headers = {
    accept: 'application/json',
    authorization: `token ${config.token}`,
    'content-type': 'application/json',
  }

  async function request(path: string, init: RequestInit): Promise<any> {
    const response = await fetch(`${baseUrl}${path}`, { ...init, headers: { ...headers, ...(init.headers ?? {}) } })
    const text = await response.text()
    const json = text ? JSON.parse(text) : null
    if (!response.ok) {
      throw new Error(`Forgejo API ${response.status}: ${text.slice(0, 1000)}`)
    }
    return json
  }

  return {
    async createPullRequest(input: CreateForgejoPullRequestInput): Promise<ForgejoPullRequest> {
      const json = await request(`/api/v1/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/pulls`, {
        method: 'POST',
        body: JSON.stringify({
          title: input.title,
          body: input.body,
          head: input.head,
          base: input.base,
        }),
      })
      return mapPullRequest(json)
    },

    async getPullRequest(input: { owner: string; repo: string; number: number }): Promise<ForgejoPullRequest> {
      const json = await request(`/api/v1/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/pulls/${input.number}`, {
        method: 'GET',
      })
      return mapPullRequest(json)
    },
  }
}

function mapPullRequest(json: any): ForgejoPullRequest {
  const state: ForgejoPullRequest['state'] = json.merged ? 'merged' : json.state === 'closed' ? 'closed' : 'open'
  return {
    number: Number(json.number ?? json.id),
    url: String(json.html_url ?? json.url ?? ''),
    state,
    head: String(json.head?.ref ?? ''),
    base: String(json.base?.ref ?? ''),
    mergeCommitSha: json.merge_commit_sha ? String(json.merge_commit_sha) : null,
  }
}
```

- [ ] **Step 4: Add settings getters and settings UI definitions**

In `src/lib/task-runtime-settings.ts`, extend `TASK_RUNTIME_SETTING_KEYS`:

```ts
REVIEW_PR_PROVIDER: 'runtime.review_pr_provider',
REVIEW_PR_REMOTE_NAME: 'runtime.review_pr_remote_name',
FORGEJO_BASE_URL: 'runtime.forgejo_base_url',
FORGEJO_TOKEN: 'runtime.forgejo_token',
REVIEW_PR_AUTO_CREATE: 'runtime.review_pr_auto_create',
```

Add:

```ts
export function getReviewPrSettings(): {
  provider: 'forgejo'
  remoteName: string
  forgejoBaseUrl: string
  forgejoToken: string
  autoCreate: boolean
} {
  const provider = readSettingValue(TASK_RUNTIME_SETTING_KEYS.REVIEW_PR_PROVIDER) || 'forgejo'
  if (provider !== 'forgejo') throw new Error(`Unsupported review PR provider: ${provider}`)
  return {
    provider,
    remoteName: readSettingValue(TASK_RUNTIME_SETTING_KEYS.REVIEW_PR_REMOTE_NAME) || 'forgejo',
    forgejoBaseUrl: readSettingValue(TASK_RUNTIME_SETTING_KEYS.FORGEJO_BASE_URL) || '',
    forgejoToken: readSettingValue(TASK_RUNTIME_SETTING_KEYS.FORGEJO_TOKEN) || '',
    autoCreate: (readSettingValue(TASK_RUNTIME_SETTING_KEYS.REVIEW_PR_AUTO_CREATE) || 'true') !== 'false',
  }
}
```

In `src/app/api/settings/route.ts`, add default entries:

```ts
'runtime.review_pr_provider': { category: 'runtime', description: 'Provider for approved task review pull requests.', default: 'forgejo' },
'runtime.review_pr_remote_name': { category: 'runtime', description: 'Git remote used for review pull request branches.', default: 'forgejo' },
'runtime.forgejo_base_url': { category: 'runtime', description: 'Forgejo base URL, for example http://localhost:3001.', default: '' },
'runtime.forgejo_token': { category: 'runtime', description: 'Forgejo API token for creating and checking review pull requests.', default: '' },
'runtime.review_pr_auto_create': { category: 'runtime', description: 'Create review pull requests automatically after quality approval.', default: 'true' },
```

- [ ] **Step 5: Run tests**

Run:

```bash
pnpm vitest run src/lib/__tests__/forgejo-client.test.ts src/lib/__tests__/runtime-settings-phase14.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/forgejo-client.ts src/lib/task-runtime-settings.ts src/app/api/settings/route.ts src/lib/__tests__/forgejo-client.test.ts
git commit -m "feat: add Forgejo review PR client settings"
```

## Task 3: Publish Approved Worktrees as Forgejo PRs

**Files:**
- Create: `src/lib/review-prs.ts`
- Test: `src/lib/__tests__/review-prs.test.ts`

- [ ] **Step 1: Write publication tests**

Create `src/lib/__tests__/review-prs.test.ts` with mocked `spawnSync`, mocked settings, and mocked Forgejo client. The core expectations:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:child_process', () => ({ spawnSync: vi.fn() }))
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
    createPullRequest: vi.fn(async () => ({
      number: 12,
      url: 'http://localhost:3001/aaron/FirmVault/pulls/12',
      state: 'open',
      head: 'mc/task-2112',
      base: 'codex/complete-workflow-v2',
      mergeCommitSha: null,
    })),
  }),
}))

const { spawnSync } = await import('node:child_process')
const { publishApprovedWorktreeForReview } = await import('@/lib/review-prs')

describe('publishApprovedWorktreeForReview', () => {
  beforeEach(() => {
    vi.mocked(spawnSync).mockReset()
    vi.mocked(spawnSync).mockImplementation((cmd: any, args: any[]) => {
      const joined = [cmd, ...args].join(' ')
      if (joined.includes('remote get-url forgejo')) return { status: 0, stdout: 'ssh://git@localhost:2222/aaron/FirmVault.git\n', stderr: '' } as any
      if (joined.includes('rev-parse --abbrev-ref HEAD')) return { status: 0, stdout: 'mc/task-2112\n', stderr: '' } as any
      if (joined.includes('diff --cached --quiet')) return { status: 1, stdout: '', stderr: '' } as any
      return { status: 0, stdout: '', stderr: '' } as any
    })
  })

  it('commits, pushes, creates a PR, stores it, and leaves task open', async () => {
    const inserts: any[] = []
    const updates: any[] = []
    const db: any = {
      prepare(sql: string) {
        return {
          get: () => undefined,
          all: () => [],
          run: (...params: any[]) => {
            if (sql.includes('INSERT INTO task_review_prs')) inserts.push(params)
            if (sql.includes('UPDATE tasks')) updates.push(params)
            return { lastInsertRowid: 1 }
          },
        }
      },
    }

    const result = await publishApprovedWorktreeForReview(db, {
      id: 2112,
      title: 'Load Document Checklist',
      workspace_id: 1,
      worktree_path: '/worktrees/task-2112',
      workspace_source: JSON.stringify({ project_id: 38, base_ref: 'codex/complete-workflow-v2' }),
    })

    expect(result).toMatchObject({ published: true, state: 'open', pr_number: 12 })
    expect(inserts.length).toBe(1)
    expect(updates.length).toBe(1)
    expect(vi.mocked(spawnSync).mock.calls.some((call) => String(call[1]).includes('push'))).toBe(true)
  })
})
```

- [ ] **Step 2: Run the publication test to verify it fails**

Run:

```bash
pnpm vitest run src/lib/__tests__/review-prs.test.ts
```

Expected: FAIL because `src/lib/review-prs.ts` does not exist.

- [ ] **Step 3: Implement publication helper**

Create `src/lib/review-prs.ts`:

```ts
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import type Database from 'better-sqlite3'
import { createForgejoClient } from './forgejo-client'
import { getProjectRepoMap, getReviewPrSettings } from './task-runtime-settings'
import { taskBranchName } from './worktree-promotion'

export type ReviewPrTask = {
  id: number
  title: string
  workspace_id: number
  worktree_path: string | null
  workspace_source: string | null
}

export type ReviewPrPublicationResult =
  | { published: false; reason: 'not_worktree_task' | 'no_changes' }
  | { published: true; provider: 'forgejo'; state: 'open'; pr_number: number; pr_url: string; branch: string; base_ref: string }

export async function publishApprovedWorktreeForReview(db: Database.Database, task: ReviewPrTask): Promise<ReviewPrPublicationResult> {
  if (!task.worktree_path || !task.workspace_source) return { published: false, reason: 'not_worktree_task' }
  const workspaceSource = parseWorkspaceSource(task.workspace_source)
  if (!workspaceSource) return { published: false, reason: 'not_worktree_task' }
  if (!existsSync(task.worktree_path)) throw new Error(`worktree path does not exist: ${task.worktree_path}`)

  const settings = getReviewPrSettings()
  if (!settings.autoCreate) throw new Error('runtime.review_pr_auto_create is false')
  if (!settings.forgejoBaseUrl) throw new Error('runtime.forgejo_base_url is not configured')
  if (!settings.forgejoToken) throw new Error('runtime.forgejo_token is not configured')

  const repoPath = getProjectRepoMap()[String(workspaceSource.project_id)]
  if (!repoPath) throw new Error(`runtime.project_repo_map missing entry for project_id=${workspaceSource.project_id}`)

  const remoteUrl = gitOutput(repoPath, ['remote', 'get-url', settings.remoteName])
  if (!remoteUrl) throw new Error(`git remote '${settings.remoteName}' is not configured for project repo`)
  const repo = parseRepoFromRemote(remoteUrl)

  const branch = currentBranch(task.worktree_path) || taskBranchName(task.id)
  commitWorktreeChanges(task.worktree_path, task)
  if (!hasBranchChanges(repoPath, branch, workspaceSource.base_ref)) return { published: false, reason: 'no_changes' }

  runGit(task.worktree_path, ['push', settings.remoteName, `${branch}:${branch}`])

  const existing = db.prepare(`
    SELECT * FROM task_review_prs
    WHERE task_id = ? AND provider = 'forgejo' AND state = 'open'
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `).get(task.id) as any
  if (existing) {
    return {
      published: true,
      provider: 'forgejo',
      state: 'open',
      pr_number: existing.pr_number,
      pr_url: existing.pr_url,
      branch,
      base_ref: workspaceSource.base_ref,
    }
  }

  const client = createForgejoClient({ baseUrl: settings.forgejoBaseUrl, token: settings.forgejoToken })
  const pr = await client.createPullRequest({
    owner: repo.owner,
    repo: repo.name,
    title: `Task ${task.id}: ${task.title}`,
    body: `Mission Control task ${task.id} review PR.\n\nTask: ${task.title}`,
    head: branch,
    base: workspaceSource.base_ref,
  }))

  const now = Math.floor(Date.now() / 1000)
  db.prepare(`
    INSERT INTO task_review_prs (
      task_id, workspace_id, provider, remote_name, remote_url, repo_owner, repo_name,
      base_ref, head_ref, branch_name, pr_number, pr_url, state,
      merge_commit_sha, created_at, updated_at, last_checked_at, metadata_json
    ) VALUES (?, ?, 'forgejo', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', NULL, ?, ?, ?, ?)
  `).run(
    task.id,
    task.workspace_id,
    settings.remoteName,
    remoteUrl,
    repo.owner,
    repo.name,
    workspaceSource.base_ref,
    branch,
    branch,
    pr.number,
    pr.url,
    now,
    now,
    now,
    JSON.stringify({ head: pr.head, base: pr.base }),
  )
  db.prepare(`
    UPDATE tasks
    SET github_repo = ?, github_branch = ?, github_pr_number = ?, github_pr_state = 'open', updated_at = ?
    WHERE id = ?
  `).run(`${repo.owner}/${repo.name}`, branch, pr.number, now, task.id)

  return { published: true, provider: 'forgejo', state: 'open', pr_number: pr.number, pr_url: pr.url, branch, base_ref: workspaceSource.base_ref }
}
```

- [ ] **Step 4: Finish helper internals**

Add these helper functions in `src/lib/review-prs.ts`:

```ts
function parseWorkspaceSource(raw: string): { project_id: number; base_ref: string } | null {
  try {
    const parsed = JSON.parse(raw) as { project_id?: unknown; base_ref?: unknown }
    const projectId = typeof parsed.project_id === 'number' ? parsed.project_id : null
    const baseRef = typeof parsed.base_ref === 'string' && parsed.base_ref ? parsed.base_ref : 'main'
    return projectId ? { project_id: projectId, base_ref: baseRef } : null
  } catch {
    return null
  }
}

function parseRepoFromRemote(remoteUrl: string): { owner: string; name: string } {
  const match = remoteUrl.match(/[:/]([^/:]+)\/([^/]+?)(?:\.git)?$/)
  if (!match) throw new Error(`Could not parse Forgejo owner/repo from remote URL: ${remoteUrl}`)
  return { owner: match[1], name: match[2].replace(/\.git$/, '') }
}

function commitWorktreeChanges(worktreePath: string, task: ReviewPrTask): void {
  runGit(worktreePath, ['add', '-A'])
  const diff = spawnSync('git', ['-C', worktreePath, 'diff', '--cached', '--quiet'], { stdio: 'ignore' })
  if (diff.status === 0) return
  runGit(worktreePath, [
    '-c',
    'user.name=Mission Control Runner',
    '-c',
    'user.email=runner@mission-control.local',
    'commit',
    '-m',
    `task ${task.id}: ${task.title.slice(0, 120)}`,
  ])
}

function hasBranchChanges(repoPath: string, branch: string, baseRef: string): boolean {
  const count = gitOutput(repoPath, ['rev-list', '--count', `${baseRef}..${branch}`])
  return Number.parseInt(count || '0', 10) > 0
}

function currentBranch(worktreePath: string): string | null {
  return gitOutput(worktreePath, ['rev-parse', '--abbrev-ref', 'HEAD'])
}

function gitOutput(cwd: string, args: string[]): string {
  const result = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' })
  if (result.status !== 0) return ''
  return result.stdout.trim()
}

function runGit(cwd: string, args: string[]): void {
  const result = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${(result.stderr || result.stdout || '').slice(-4000)}`)
  }
}
```

- [ ] **Step 5: Run tests**

Run:

```bash
pnpm vitest run src/lib/__tests__/review-prs.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/review-prs.ts src/lib/__tests__/review-prs.test.ts
git commit -m "feat: publish approved worktrees as review PRs"
```

## Task 4: Wire Approval Routes to PR Publication

**Files:**
- Modify: `src/app/api/quality-review/route.ts`
- Modify: `src/app/api/runner/tasks/[task_id]/review/route.ts`
- Modify: `src/app/api/quality-review/__tests__/route.workflow-advancement.test.ts`
- Create: `src/app/api/runner/tasks/[task_id]/review/__tests__/route-pr-gate.test.ts`

- [ ] **Step 1: Update quality-review route tests**

Change the existing mock in `src/app/api/quality-review/__tests__/route.workflow-advancement.test.ts` from `promoteApprovedWorktree` to `publishApprovedWorktreeForReview`.

Add test:

```ts
it('approval publishes a review PR but does not mark done or advance workflow while PR is open', async () => {
  vi.mocked(publishApprovedWorktreeForReview).mockResolvedValueOnce({
    published: true,
    provider: 'forgejo',
    state: 'open',
    pr_number: 12,
    pr_url: 'http://localhost:3001/aaron/FirmVault/pulls/12',
    branch: 'mc/task-1',
    base_ref: 'main',
  })
  // Seed first workflow task in quality_review exactly like the existing test.
  // POST approved quality review.
  // Expect response.workflow_advancement to be null.
  // Expect task status remains quality_review.
  // Expect first workflow node remains running.
  // Expect no second_step task exists.
})
```

- [ ] **Step 2: Run the quality-review route test to verify it fails**

Run:

```bash
pnpm vitest run src/app/api/quality-review/__tests__/route.workflow-advancement.test.ts
```

Expected: FAIL because the route still marks done and advances immediately.

- [ ] **Step 3: Update quality-review route**

In `src/app/api/quality-review/route.ts`:

- Replace `promoteApprovedWorktree` import with `publishApprovedWorktreeForReview`.
- Make approval path `await publishApprovedWorktreeForReview(db, task)`.
- If result is `published: true`, insert approved review/comment, keep task `quality_review`, set PR fields, return `{ success: true, review_pr: result, workflow_advancement: null }`.
- If result is `published: false` with `no_changes`, allow direct done + workflow advancement because there are no repo changes to review.
- If publication throws, keep the existing blocked behavior with message changed from “promotion” to “review PR publication”.

Core route behavior:

```ts
const reviewPr = await publishApprovedWorktreeForReview(db, task)
if (reviewPr.published) {
  db.prepare(`
    INSERT INTO comments (task_id, author, content, created_at, workspace_id)
    VALUES (?, ?, ?, unixepoch(), ?)
  `).run(taskId, reviewer, `Review PR opened: ${reviewPr.pr_url}`, workspaceId)
  db.prepare(`
    UPDATE tasks SET status = 'quality_review', error_message = NULL, updated_at = unixepoch()
    WHERE id = ? AND workspace_id = ?
  `).run(taskId, workspaceId)
  return NextResponse.json({ success: true, id: reviewId, review_pr: reviewPr, workflow_advancement: null })
}
```

- [ ] **Step 4: Update runner review route**

In `src/app/api/runner/tasks/[task_id]/review/route.ts`, apply the same behavior for recipe-reviewer approval:

- Publish PR.
- Keep task in `quality_review` when PR is open.
- Revoke runner token.
- Broadcast `task.status_changed` with `reason: 'review_pr_opened'`.
- Do not call `advanceWorkflowAfterTaskApproval` until reconciliation.

- [ ] **Step 5: Run route tests**

Run:

```bash
pnpm vitest run src/app/api/quality-review/__tests__/route.workflow-advancement.test.ts
```

Expected: PASS after updating assertions.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/quality-review/route.ts 'src/app/api/runner/tasks/[task_id]/review/route.ts' src/app/api/quality-review/__tests__/route.workflow-advancement.test.ts
git commit -m "feat: gate quality approval on review PRs"
```

## Task 5: Add Merge Reconciliation

**Files:**
- Modify: `src/lib/review-prs.ts`
- Create: `src/app/api/review-prs/reconcile/route.ts`
- Test: `src/lib/__tests__/review-prs-reconcile.test.ts`
- Test: `src/app/api/review-prs/reconcile/__tests__/route.test.ts`

- [ ] **Step 1: Write reconciliation test**

Create `src/lib/__tests__/review-prs-reconcile.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '@/lib/migrations'
import { createWorkflowDefinition, materializeReadyWorkflowNodes, startWorkflowInstance } from '@/lib/workflow-engine'

vi.mock('@/lib/task-runtime-settings', () => ({
  getReviewPrSettings: () => ({ provider: 'forgejo', remoteName: 'forgejo', forgejoBaseUrl: 'http://localhost:3001', forgejoToken: 'secret', autoCreate: true }),
}))
vi.mock('@/lib/forgejo-client', () => ({
  createForgejoClient: () => ({
    getPullRequest: vi.fn(async () => ({
      number: 12,
      url: 'http://localhost:3001/aaron/FirmVault/pulls/12',
      state: 'merged',
      head: 'mc/task-1',
      base: 'main',
      mergeCommitSha: 'abc123',
    })),
  }),
}))

const { reconcileOpenReviewPrs } = await import('@/lib/review-prs')

describe('reconcileOpenReviewPrs', () => {
  it('marks merged PR task done and advances workflow', async () => {
    const db = new Database(':memory:')
    try {
      runMigrations(db)
      const project = db.prepare(`SELECT id FROM projects WHERE workspace_id = 1 AND slug = 'general'`).get() as { id: number }
      const definitionId = createWorkflowDefinition(db, `
schema_version: 1
id: reconcile-review-pr
name: Reconcile Review PR
subject_type: law_firm_case
nodes:
  first_step:
    type: recipe
    recipe: hello-world
  second_step:
    type: recipe
    recipe: hello-world
    depends_on:
      - first_step
`, 'tester', 1, 1)
      const instance = startWorkflowInstance(db, { definitionId, subjectType: 'law_firm_case', subjectId: 'test', actor: 'tester', workspaceId: 1, tenantId: 1, now: 100 })
      const materialized = materializeReadyWorkflowNodes(db, { workflowInstanceId: instance.instance_id, projectId: project.id, workspaceId: 1, actor: 'tester', now: 101 })
      const taskId = materialized.created[0].task_id
      db.prepare(`UPDATE tasks SET status = 'quality_review' WHERE id = ?`).run(taskId)
      db.prepare(`
        INSERT INTO task_review_prs (
          task_id, workspace_id, provider, remote_name, remote_url, repo_owner, repo_name,
          base_ref, head_ref, branch_name, pr_number, pr_url, state
        ) VALUES (?, 1, 'forgejo', 'forgejo', 'ssh://git@localhost:2222/aaron/FirmVault.git',
          'aaron', 'FirmVault', 'main', 'mc/task-1', 'mc/task-1', 12,
          'http://localhost:3001/aaron/FirmVault/pulls/12', 'open')
      `).run(taskId)

      const result = await reconcileOpenReviewPrs(db, { actor: 'test-reconciler', now: 200 })

      expect(result.merged).toContain(taskId)
      expect(db.prepare(`SELECT status FROM tasks WHERE id = ?`).get(taskId)).toMatchObject({ status: 'done' })
      expect(db.prepare(`SELECT state, merge_commit_sha FROM task_review_prs WHERE task_id = ?`).get(taskId)).toMatchObject({ state: 'merged', merge_commit_sha: 'abc123' })
      expect(db.prepare(`SELECT COUNT(*) AS count FROM tasks WHERE metadata LIKE '%"node_key":"second_step"%'`).get()).toMatchObject({ count: 1 })
    } finally {
      db.close()
    }
  })
})
```

- [ ] **Step 2: Run reconciliation test to verify it fails**

Run:

```bash
pnpm vitest run src/lib/__tests__/review-prs-reconcile.test.ts
```

Expected: FAIL because `reconcileOpenReviewPrs` does not exist.

- [ ] **Step 3: Implement reconciliation helper**

Add to `src/lib/review-prs.ts`:

```ts
export async function reconcileOpenReviewPrs(
  db: Database.Database,
  input: { actor: string; now?: number; limit?: number },
): Promise<{ checked: number; merged: number[]; closed: number[]; errors: Array<{ task_id: number; error: string }> }> {
  const now = input.now ?? Math.floor(Date.now() / 1000)
  const rows = db.prepare(`
    SELECT * FROM task_review_prs
    WHERE provider = 'forgejo' AND state = 'open'
    ORDER BY COALESCE(last_checked_at, 0) ASC, id ASC
    LIMIT ?
  `).all(input.limit ?? 25) as any[]
  const settings = getReviewPrSettings()
  const client = createForgejoClient({ baseUrl: settings.forgejoBaseUrl, token: settings.forgejoToken })
  const merged: number[] = []
  const closed: number[] = []
  const errors: Array<{ task_id: number; error: string }> = []

  for (const row of rows) {
    try {
      const pr = await client.getPullRequest({ owner: row.repo_owner, repo: row.repo_name, number: row.pr_number })
      if (pr.state === 'merged') {
        db.prepare(`
          UPDATE task_review_prs
          SET state = 'merged', merge_commit_sha = ?, updated_at = ?, last_checked_at = ?
          WHERE id = ?
        `).run(pr.mergeCommitSha, now, now, row.id)
        db.prepare(`
          UPDATE tasks
          SET status = 'done', github_pr_state = 'merged', completed_at = COALESCE(completed_at, ?), updated_at = ?, error_message = NULL
          WHERE id = ?
        `).run(now, now, row.task_id)
        advanceWorkflowAfterTaskApproval(db, {
          taskId: row.task_id,
          actor: input.actor,
          payload: { source: 'review_pr_merged', review_pr_id: row.id, pr_number: row.pr_number, merge_commit_sha: pr.mergeCommitSha },
          now,
          status: 'inbox',
        })
        merged.push(row.task_id)
      } else if (pr.state === 'closed') {
        db.prepare(`
          UPDATE task_review_prs
          SET state = 'closed', updated_at = ?, last_checked_at = ?
          WHERE id = ?
        `).run(now, now, row.id)
        db.prepare(`
          INSERT INTO comments (task_id, author, content, created_at, workspace_id)
          VALUES (?, ?, ?, ?, ?)
        `).run(row.task_id, input.actor, `Review PR closed without merge: ${row.pr_url}`, now, row.workspace_id)
        closed.push(row.task_id)
      } else {
        db.prepare(`UPDATE task_review_prs SET last_checked_at = ?, updated_at = ? WHERE id = ?`).run(now, now, row.id)
      }
    } catch (err) {
      errors.push({ task_id: row.task_id, error: err instanceof Error ? err.message : String(err) })
    }
  }
  return { checked: rows.length, merged, closed, errors }
}
```

Also import `advanceWorkflowAfterTaskApproval` at the top of `src/lib/review-prs.ts`.

- [ ] **Step 4: Add reconcile API route**

Create `src/app/api/review-prs/reconcile/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { reconcileOpenReviewPrs } from '@/lib/review-prs'
import { logger } from '@/lib/logger'

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck
  try {
    const db = getDatabase()
    const result = await reconcileOpenReviewPrs(db, { actor: auth.user.username || 'operator' })
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    logger.error({ err: error }, 'POST /api/review-prs/reconcile error')
    return NextResponse.json({ error: 'Failed to reconcile review PRs' }, { status: 500 })
  }
}
```

- [ ] **Step 5: Run reconciliation tests**

Run:

```bash
pnpm vitest run src/lib/__tests__/review-prs-reconcile.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/review-prs.ts src/lib/__tests__/review-prs-reconcile.test.ts src/app/api/review-prs/reconcile/route.ts
git commit -m "feat: reconcile merged review PRs"
```

## Task 6: Surface Review PRs in the Task UI

**Files:**
- Modify: `src/app/api/tasks/route.ts`
- Modify: `src/app/api/tasks/[id]/route.ts`
- Modify: `src/components/panels/task-board-panel.tsx`

- [ ] **Step 1: Extend task API rows with latest review PR**

In task list/detail SQL mapping, add a subquery for latest `task_review_prs`:

```sql
(SELECT json_object(
  'provider', provider,
  'pr_number', pr_number,
  'pr_url', pr_url,
  'state', state
) FROM task_review_prs
 WHERE task_review_prs.task_id = tasks.id
 ORDER BY created_at DESC, id DESC
 LIMIT 1) AS review_pr
```

Parse it in the task row mapper:

```ts
review_pr: task.review_pr ? JSON.parse(task.review_pr) : null
```

- [ ] **Step 2: Add minimal UI display**

In `src/components/panels/task-board-panel.tsx`, wherever GitHub PR is rendered, add:

```tsx
{task.review_pr && (
  <a
    href={task.review_pr.pr_url}
    target="_blank"
    rel="noreferrer"
    className="inline-flex items-center rounded border border-indigo-500/25 bg-indigo-500/10 px-2 py-1 text-xs text-indigo-300"
    title={`Review PR #${task.review_pr.pr_number} (${task.review_pr.state})`}
  >
    Review PR #{task.review_pr.pr_number}
  </a>
)}
```

Add `review_pr?: { provider: string; pr_number: number; pr_url: string; state: string } | null` to the task type.

- [ ] **Step 3: Run targeted UI/type checks**

Run:

```bash
pnpm vitest run src/components/panels/__tests__/task-board-panel.test.tsx
pnpm tsc --noEmit
```

Expected: PASS or only pre-existing unrelated type errors. Any new type error from `review_pr` must be fixed.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/tasks/route.ts src/app/api/tasks/[id]/route.ts src/components/panels/task-board-panel.tsx
git commit -m "feat: show task review PR links"
```

## Task 7: Live Forgejo End-to-End Verification

**Files:**
- No required source changes unless verification exposes a bug.

- [ ] **Step 1: Configure settings**

Set these settings through the existing settings API or direct local DB update:

```sql
INSERT INTO settings (key, value, category, description, updated_at)
VALUES
  ('runtime.review_pr_provider', 'forgejo', 'runtime', 'Review PR provider', unixepoch()),
  ('runtime.review_pr_remote_name', 'forgejo', 'runtime', 'Review PR remote', unixepoch()),
  ('runtime.forgejo_base_url', 'http://localhost:3001', 'runtime', 'Forgejo base URL', unixepoch()),
  ('runtime.forgejo_token', 'paste-local-forgejo-token-here', 'runtime', 'Forgejo token', unixepoch()),
  ('runtime.review_pr_auto_create', 'true', 'runtime', 'Auto create review PRs', unixepoch())
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = unixepoch();
```

- [ ] **Step 2: Run automated test suite**

Run:

```bash
pnpm vitest run src/lib/__tests__/migrations-review-prs.test.ts src/lib/__tests__/forgejo-client.test.ts src/lib/__tests__/review-prs.test.ts src/lib/__tests__/review-prs-reconcile.test.ts src/app/api/quality-review/__tests__/route.workflow-advancement.test.ts src/lib/__tests__/workflow-engine.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run live workflow**

Use the existing test ladder workflow:

1. Materialize case setup.
2. Assign/run task.
3. Approve quality review.
4. Confirm Forgejo PR created and task remains `quality_review`.
5. Merge PR in Forgejo.
6. POST `/api/review-prs/reconcile`.
7. Confirm task becomes `done`.
8. Confirm next workflow task materializes only after merge.

- [ ] **Step 4: Commit final fixes**

If live verification required fixes, stage the exact files changed during verification. For example, if reconciliation needed a route fix:

```bash
git add src/app/api/review-prs/reconcile/route.ts src/lib/review-prs.ts
git commit -m "fix: complete Forgejo PR gate verification"
```

If no fixes were required, do not create an empty commit.

## Self-Review

- Spec coverage: The plan covers persistence, settings, Forgejo client, worktree publication, approval route behavior, merge reconciliation, UI visibility, and live verification.
- Placeholder scan: No `TODO` or `TBD` placeholders are intentionally left. The live verification section uses `http://localhost:3001` as the example local Forgejo URL and `paste-local-forgejo-token-here` as the explicit operator-supplied secret value.
- Type consistency: The plan uses `task_review_prs`, `publishApprovedWorktreeForReview`, and `reconcileOpenReviewPrs` consistently across tasks.
