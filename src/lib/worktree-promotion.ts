import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { getProjectRepoMap } from '@/lib/task-runtime-settings'

type PromotionTask = {
  id: number
  title: string
  worktree_path: string | null
  workspace_source: string | null
}

export type WorktreePromotionResult =
  | { promoted: false; reason: 'not_worktree_task' | 'no_changes' }
  | { promoted: true; branch: string; base_ref: string; merge_commit: string | null }

export function taskBranchName(taskId: number): string {
  return `mc/task-${taskId}`
}

export function promoteApprovedWorktree(task: PromotionTask): WorktreePromotionResult {
  if (!task.worktree_path || !task.workspace_source) {
    return { promoted: false, reason: 'not_worktree_task' }
  }

  const workspaceSource = parseWorkspaceSource(task.workspace_source)
  if (!workspaceSource) return { promoted: false, reason: 'not_worktree_task' }

  const repoPath = getProjectRepoMap()[String(workspaceSource.project_id)]
  if (!repoPath) {
    throw new Error(`runtime.project_repo_map missing entry for project_id=${workspaceSource.project_id}`)
  }
  if (!existsSync(task.worktree_path)) {
    throw new Error(`worktree path does not exist: ${task.worktree_path}`)
  }

  const branch = currentBranch(task.worktree_path) || taskBranchName(task.id)
  commitWorktreeChanges(task.worktree_path, task)

  const changed = hasBranchChanges(repoPath, branch, workspaceSource.base_ref)
  if (!changed) return { promoted: false, reason: 'no_changes' }

  assertCleanTargetRepo(repoPath)
  runGit(repoPath, ['checkout', workspaceSource.base_ref])
  runGit(repoPath, ['merge', '--no-ff', branch, '-m', `Merge ${branch}: ${task.title.slice(0, 120)}`])
  const mergeCommit = gitOutput(repoPath, ['rev-parse', 'HEAD']) || null
  return { promoted: true, branch, base_ref: workspaceSource.base_ref, merge_commit: mergeCommit }
}

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

function commitWorktreeChanges(worktreePath: string, task: PromotionTask): void {
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

function assertCleanTargetRepo(repoPath: string): void {
  const status = gitOutput(repoPath, ['status', '--porcelain'])
  if (status) {
    throw new Error(`target repo has uncommitted changes; refusing to merge approved worktree\n${status}`)
  }
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
