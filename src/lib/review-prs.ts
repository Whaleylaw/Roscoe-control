import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
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
  | {
      published: true
      provider: 'forgejo'
      state: 'open'
      pr_number: number
      pr_url: string
      branch: string
      base_ref: string
    }

type WorkspaceSource = {
  project_id: number
  base_ref: string
}

type RemoteRepo = {
  owner: string
  name: string
}

type ExistingReviewPrRow = {
  pr_number: number
  pr_url: string
  repo_owner: string
  repo_name: string
  branch_name: string
  base_ref: string
}

export async function publishApprovedWorktreeForReview(
  db: Database.Database,
  task: ReviewPrTask,
): Promise<ReviewPrPublicationResult> {
  if (!task.worktree_path || !task.workspace_source) {
    return { published: false, reason: 'not_worktree_task' }
  }

  const workspaceSource = parseWorkspaceSource(task.workspace_source)
  if (!workspaceSource) return { published: false, reason: 'not_worktree_task' }

  if (!existsSync(task.worktree_path)) {
    throw new Error(`worktree path does not exist: ${task.worktree_path}`)
  }

  const settings = getReviewPrSettings()
  if (!settings.autoCreate) throw new Error('runtime.review_pr_auto_create is disabled')
  if (!settings.forgejoBaseUrl) throw new Error('runtime.forgejo_base_url is not configured')
  if (!settings.forgejoToken) throw new Error('runtime.forgejo_token is not configured')

  const repoPath = getProjectRepoMap()[String(workspaceSource.project_id)]
  if (!repoPath) {
    throw new Error(`runtime.project_repo_map missing entry for project_id=${workspaceSource.project_id}`)
  }

  const remoteUrl = gitOutput(repoPath, ['remote', 'get-url', settings.remoteName])
  if (!remoteUrl) {
    throw new Error(`git remote '${settings.remoteName}' is not configured for project repo`)
  }
  const repo = parseRepoFromRemote(remoteUrl)

  const branch = currentBranch(task.worktree_path) || taskBranchName(task.id)
  commitWorktreeChanges(task.worktree_path, task)

  if (!hasBranchChanges(task.worktree_path, branch, workspaceSource.base_ref)) {
    return { published: false, reason: 'no_changes' }
  }

  runGit(task.worktree_path, ['push', settings.remoteName, `${branch}:${branch}`])

  const existing = db
    .prepare(`
      SELECT pr_number, pr_url, repo_owner, repo_name, branch_name, base_ref
      FROM task_review_prs
      WHERE task_id = ? AND provider = 'forgejo' AND state = 'open'
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `)
    .get(task.id) as ExistingReviewPrRow | undefined

  if (existing) {
    updateTaskPrMirror(db, {
      taskId: task.id,
      repoOwner: existing.repo_owner,
      repoName: existing.repo_name,
      branch: existing.branch_name,
      prNumber: existing.pr_number,
      now: unixNow(),
    })
    return {
      published: true,
      provider: 'forgejo',
      state: 'open',
      pr_number: existing.pr_number,
      pr_url: existing.pr_url,
      branch: existing.branch_name,
      base_ref: existing.base_ref,
    }
  }

  const client = createForgejoClient({
    baseUrl: settings.forgejoBaseUrl,
    token: settings.forgejoToken,
  })
  const pr = await client.createPullRequest({
    owner: repo.owner,
    repo: repo.name,
    title: `Task ${task.id}: ${task.title}`,
    body: [
      `Mission Control task ${task.id} review PR.`,
      '',
      `Task: ${task.title}`,
      `Head: ${branch}`,
      `Base: ${workspaceSource.base_ref}`,
    ].join('\n'),
    head: branch,
    base: workspaceSource.base_ref,
  })

  const now = unixNow()
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
    JSON.stringify({ head: pr.head || branch, base: pr.base || workspaceSource.base_ref }),
  )

  updateTaskPrMirror(db, {
    taskId: task.id,
    repoOwner: repo.owner,
    repoName: repo.name,
    branch,
    prNumber: pr.number,
    now,
  })

  return {
    published: true,
    provider: 'forgejo',
    state: 'open',
    pr_number: pr.number,
    pr_url: pr.url,
    branch,
    base_ref: workspaceSource.base_ref,
  }
}

function parseWorkspaceSource(raw: string): WorkspaceSource | null {
  try {
    const parsed = JSON.parse(raw) as { project_id?: unknown; base_ref?: unknown }
    const projectId = typeof parsed.project_id === 'number' ? parsed.project_id : null
    const baseRef = typeof parsed.base_ref === 'string' && parsed.base_ref ? parsed.base_ref : 'main'
    return projectId ? { project_id: projectId, base_ref: baseRef } : null
  } catch {
    return null
  }
}

function parseRepoFromRemote(remoteUrl: string): RemoteRepo {
  const match = remoteUrl.match(/[:/]([^/:]+)\/([^/]+?)(?:\.git)?$/)
  if (!match) {
    throw new Error(`Could not parse Forgejo owner/repo from remote URL: ${remoteUrl}`)
  }
  return { owner: match[1], name: match[2].replace(/\.git$/, '') }
}

function commitWorktreeChanges(worktreePath: string, task: ReviewPrTask): void {
  runGit(worktreePath, ['add', '-A'])
  const diff = spawnSync('git', ['-C', worktreePath, 'diff', '--cached', '--quiet'], {
    stdio: 'ignore',
  })
  if (diff.status === 0) return
  if (diff.status !== 1) {
    throw new Error(`git diff --cached --quiet failed`)
  }
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

function hasBranchChanges(worktreePath: string, branch: string, baseRef: string): boolean {
  const count = gitOutput(worktreePath, ['rev-list', '--count', `${baseRef}..${branch}`])
  return Number.parseInt(count || '0', 10) > 0
}

function currentBranch(worktreePath: string): string | null {
  const branch = gitOutput(worktreePath, ['rev-parse', '--abbrev-ref', 'HEAD'])
  return branch && branch !== 'HEAD' ? branch : null
}

function updateTaskPrMirror(
  db: Database.Database,
  input: {
    taskId: number
    repoOwner: string
    repoName: string
    branch: string
    prNumber: number
    now: number
  },
): void {
  db.prepare(`
    UPDATE tasks
    SET github_repo = ?, github_branch = ?, github_pr_number = ?, github_pr_state = 'open', updated_at = ?
    WHERE id = ?
  `).run(
    `${input.repoOwner}/${input.repoName}`,
    input.branch,
    input.prNumber,
    input.now,
    input.taskId,
  )
}

function gitOutput(cwd: string, args: string[]): string {
  const result = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' })
  if (result.status !== 0) return ''
  return String(result.stdout ?? '').trim()
}

function runGit(cwd: string, args: string[]): void {
  const result = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${String(result.stderr || result.stdout || '').slice(-4000)}`)
  }
}

function unixNow(): number {
  return Math.floor(Date.now() / 1000)
}
