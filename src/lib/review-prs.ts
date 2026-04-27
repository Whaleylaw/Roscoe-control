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

type ReviewPrIdentity = {
  remoteUrl: string
  repo: RemoteRepo
  branch: string
  baseRef: string
}

type OpenForgejoPullRequest = {
  number: number
  url: string
  head: string
  base: string
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

  const identity: ReviewPrIdentity = {
    remoteUrl,
    repo,
    branch,
    baseRef: workspaceSource.base_ref,
  }
  const existing = db
    .prepare(`
      SELECT pr_number, pr_url, repo_owner, repo_name, branch_name, base_ref
      FROM task_review_prs
      WHERE task_id = ?
        AND provider = 'forgejo'
        AND state = 'open'
        AND remote_url = ?
        AND repo_owner = ?
        AND repo_name = ?
        AND branch_name = ?
        AND base_ref = ?
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `)
    .get(
      task.id,
      remoteUrl,
      repo.owner,
      repo.name,
      branch,
      workspaceSource.base_ref,
    ) as ExistingReviewPrRow | undefined

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

  const recoveredPr = await findOpenForgejoPullRequest({
    baseUrl: settings.forgejoBaseUrl,
    token: settings.forgejoToken,
    repo,
    branch,
    baseRef: workspaceSource.base_ref,
  })
  if (recoveredPr) {
    persistReviewPr(db, {
      task,
      remoteName: settings.remoteName,
      identity,
      prNumber: recoveredPr.number,
      prUrl: recoveredPr.url,
      prHead: recoveredPr.head,
      prBase: recoveredPr.base,
    })
    return {
      published: true,
      provider: 'forgejo',
      state: 'open',
      pr_number: recoveredPr.number,
      pr_url: recoveredPr.url,
      branch,
      base_ref: workspaceSource.base_ref,
    }
  }

  const client = createForgejoClient({
    baseUrl: settings.forgejoBaseUrl,
    token: settings.forgejoToken,
  })
  let pr: { number: number; url: string; head: string; base: string }
  try {
    pr = await client.createPullRequest({
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
  } catch (error) {
    const duplicatePr = await findOpenForgejoPullRequest({
      baseUrl: settings.forgejoBaseUrl,
      token: settings.forgejoToken,
      repo,
      branch,
      baseRef: workspaceSource.base_ref,
    })
    if (!duplicatePr) throw error
    pr = duplicatePr
  }

  persistReviewPr(db, {
    task,
    remoteName: settings.remoteName,
    identity,
    prNumber: pr.number,
    prUrl: pr.url,
    prHead: pr.head,
    prBase: pr.base,
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

function persistReviewPr(
  db: Database.Database,
  input: {
    task: ReviewPrTask
    remoteName: string
    identity: ReviewPrIdentity
    prNumber: number
    prUrl: string
    prHead: string
    prBase: string
  },
): void {
  const now = unixNow()
  db.prepare(`
    INSERT INTO task_review_prs (
      task_id, workspace_id, provider, remote_name, remote_url, repo_owner, repo_name,
      base_ref, head_ref, branch_name, pr_number, pr_url, state,
      merge_commit_sha, created_at, updated_at, last_checked_at, metadata_json
    ) VALUES (?, ?, 'forgejo', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', NULL, ?, ?, ?, ?)
  `).run(
    input.task.id,
    input.task.workspace_id,
    input.remoteName,
    input.identity.remoteUrl,
    input.identity.repo.owner,
    input.identity.repo.name,
    input.identity.baseRef,
    input.identity.branch,
    input.identity.branch,
    input.prNumber,
    input.prUrl,
    now,
    now,
    now,
    JSON.stringify({ head: input.prHead || input.identity.branch, base: input.prBase || input.identity.baseRef }),
  )

  updateTaskPrMirror(db, {
    taskId: input.task.id,
    repoOwner: input.identity.repo.owner,
    repoName: input.identity.repo.name,
    branch: input.identity.branch,
    prNumber: input.prNumber,
    now,
  })
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
  const count = gitOutputRequired(worktreePath, ['rev-list', '--count', `${baseRef}..${branch}`])
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

function gitOutputRequired(cwd: string, args: string[]): string {
  const result = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${String(result.stderr || result.stdout || '').slice(-4000)}`)
  }
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

async function findOpenForgejoPullRequest(input: {
  baseUrl: string
  token: string
  repo: RemoteRepo
  branch: string
  baseRef: string
}): Promise<OpenForgejoPullRequest | null> {
  const root = input.baseUrl.replace(/\/+$/, '')
  const url = new URL(
    `${root}/api/v1/repos/${encodeURIComponent(input.repo.owner)}/${encodeURIComponent(input.repo.name)}/pulls`,
  )
  url.searchParams.set('state', 'open')
  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      accept: 'application/json',
      authorization: `token ${input.token}`,
    },
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Forgejo API open PR lookup failed with status ${response.status}: ${text.slice(0, 1000)}`)
  }

  const json = await response.json() as unknown
  if (!Array.isArray(json)) return null
  for (const item of json) {
    const pr = mapListedPullRequest(item)
    if (pr && pr.head === input.branch && pr.base === input.baseRef) return pr
  }
  return null
}

function mapListedPullRequest(value: unknown): OpenForgejoPullRequest | null {
  if (!value || typeof value !== 'object') return null
  const json = value as {
    number?: unknown
    html_url?: unknown
    url?: unknown
    state?: unknown
    head?: { ref?: unknown } | string
    base?: { ref?: unknown } | string
  }
  const number = typeof json.number === 'number' ? json.number : null
  const url =
    typeof json.html_url === 'string'
      ? json.html_url
      : typeof json.url === 'string'
        ? json.url
        : ''
  const head = refName(json.head)
  const base = refName(json.base)
  if (number === null || !url || !head || !base || json.state === 'closed') return null
  return { number, url, head, base }
}

function refName(ref: { ref?: unknown } | string | undefined): string {
  if (typeof ref === 'string') return ref
  return typeof ref?.ref === 'string' ? ref.ref : ''
}
