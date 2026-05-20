# Forgejo PR Gate Design

Date: 2026-04-27

## Purpose

Mission Control workflow tasks currently use local Git worktrees to isolate agent changes. That isolation works, but the final approval path still tries to merge approved task branches directly into the local target repository. That is the wrong final boundary for FirmVault because the local vault may have unrelated uncommitted human/importer changes, and direct merging makes review weaker than a real pull request.

The new gate is: approved workflow work is published as a Forgejo pull request, and the Mission Control task remains open until that Forgejo PR is merged. Workflow dependencies advance only after merge, not after PR creation.

## Goals

- Preserve the current per-task worktree model.
- Commit approved task changes on a task branch.
- Push the task branch to the configured Forgejo remote.
- Create a Forgejo PR against the task's configured base branch.
- Store PR audit metadata in Mission Control.
- Keep the task open until the PR is merged.
- Advance workflow nodes only after merge.
- Avoid direct local merges for FirmVault workflow tasks.

## Non-Goals

- Replacing GitHub sync for unrelated Mission Control features.
- Implementing a full Forgejo UI inside Mission Control.
- Solving all dirty working tree cleanup in the local FirmVault repo.
- Moving binary/original firm documents into Git. FirmVault remains the masked markdown shadow.

## Current Context

FirmVault has a local Forgejo remote configured:

```text
forgejo ssh://git@localhost:2222/aaron/FirmVault.git
```

The current promotion function, `promoteApprovedWorktree`, commits task worktree changes and then attempts a local merge into the target repo. That intentionally refuses to run if the target repo is dirty. For the workflow system, this should become a PR publication flow instead of a local merge flow.

## Lifecycle

1. A workflow node materializes a recipe task.
2. The runner creates a Git worktree for the task and mounts it as the agent workspace.
3. The recipe agent performs the work and submits done.
4. The task enters review, then quality review.
5. A human or recipe-specific reviewer approves the work.
6. Mission Control commits any worktree changes to the task branch, normally `mc/task-<task_id>`.
7. Mission Control pushes that branch to the configured Forgejo remote.
8. Mission Control creates a Forgejo PR from the task branch into the task's `workspace_source.base_ref`.
9. Mission Control stores the PR metadata and leaves the task open.
10. A poller or webhook observes PR state.
11. When the Forgejo PR is merged, Mission Control marks the task done.
12. Only then does Mission Control complete the workflow node and materialize downstream eligible nodes.

## Data Model

Add a dedicated `task_review_prs` table rather than relying only on existing GitHub-named task fields. This keeps PR attempts auditable and avoids forcing Forgejo into GitHub terminology.

Required fields:

- `id`
- `task_id`
- `workspace_id`
- `provider` such as `forgejo`
- `remote_name` such as `forgejo`
- `remote_url`
- `repo_owner`
- `repo_name`
- `base_ref`
- `head_ref`
- `branch_name`
- `pr_number`
- `pr_url`
- `state` such as `open`, `merged`, `closed`, `error`
- `merge_commit_sha`
- `created_at`
- `updated_at`
- `last_checked_at`
- `metadata_json`

The latest PR may still be mirrored into the existing task PR fields for UI compatibility, but `task_review_prs` is the source of truth for review PR audit history.

## Settings

Add runtime settings for Forgejo PR publication:

- `runtime.review_pr_provider`: default `forgejo`
- `runtime.review_pr_remote_name`: default `forgejo`
- `runtime.forgejo_base_url`: for example `http://localhost:<port>`
- `runtime.forgejo_token`: stored locally in settings or loaded from a secret file, depending on the existing Mission Control secret pattern
- `runtime.review_pr_auto_create`: default `true` for approved worktree tasks

The target repo path still comes from `runtime.project_repo_map`.

## Forgejo Client

Implement a small Forgejo client against the Gitea-compatible API:

- Create PR: `POST /api/v1/repos/{owner}/{repo}/pulls`
- Get PR: `GET /api/v1/repos/{owner}/{repo}/pulls/{index}`

The client should be provider-shaped so a future GitHub/Gitea implementation can use the same interface.

## Publication Function

Replace workflow approval's local merge call with a PR publication call.

Proposed function:

```ts
publishApprovedWorktreeForReview(task): ReviewPrPublicationResult
```

Responsibilities:

- Validate `worktree_path` and `workspace_source`.
- Resolve target repo from `runtime.project_repo_map`.
- Commit task worktree changes.
- Push the task branch to the configured remote.
- Create or reuse an open Forgejo PR for that task branch.
- Store a `task_review_prs` row.
- Return PR metadata.

If there are no worktree changes, the task can still be marked done without a PR only if the approved task truly has no changes. That case should be explicit in the quality review note and workflow event payload.

## Task State Behavior

On approval:

- If PR publication succeeds:
  - task remains in `quality_review`
  - `task_review_prs.state = open`
  - task gets a comment with the PR URL
  - workflow node remains `running`
  - downstream workflow nodes do not materialize

- If PR publication fails:
  - task remains in `quality_review`
  - a blocked review record/comment is added
  - no workflow advancement occurs

- If PR is later observed as merged:
  - task becomes `done`
  - task review PR state becomes `merged`
  - workflow node completes
  - downstream eligible nodes materialize

- If PR is closed without merge:
  - task remains open or moves back to `review`
  - workflow node remains incomplete
  - a comment explains that the PR closed without merge

## Polling and Webhooks

Start with a poller because the local Docker Forgejo instance may not have webhooks configured yet.

Poller behavior:

- Find open `task_review_prs`.
- Fetch each PR status from Forgejo.
- Update `state`, `merge_commit_sha`, and `last_checked_at`.
- When a PR is merged, call the same workflow advancement path currently used after successful approval.

A webhook route can be added later and should call the same reconciliation function.

## UI

The task card/detail view should show:

- Review PR provider
- PR number
- PR state
- Link to Forgejo PR

Existing GitHub PR display can be reused short term by mirroring latest PR metadata, but the cleaner long-term UI should read from `task_review_prs`.

## Error Handling

- Missing Forgejo settings: block task in quality review with a specific setup error.
- Push failure: block task and preserve worktree.
- PR creation failure: block task and preserve worktree/branch.
- Closed without merge: keep workflow incomplete and require human action.
- Merge detected but workflow advancement fails: leave task in quality review with a clear error and retry-safe PR state.

## Testing

Unit tests:

- Publication commits and pushes the task branch.
- Publication creates a review PR row.
- Approval does not mark task done when PR is merely open.
- Workflow node does not complete when PR is merely open.
- Merge reconciliation marks task done and advances workflow.
- Closed-without-merge does not advance workflow.

Integration/manual test:

- Run case setup task.
- Approve it.
- Confirm Forgejo PR is created.
- Merge PR in Forgejo.
- Run/poll reconciliation.
- Confirm workflow node completes and document collection task materializes from the merged case state.

## Open Decisions

The user has approved the main completion boundary: tasks remain open until the Forgejo PR is merged. The only implementation-specific decision left is where to store the Forgejo token. The implementation should follow the existing Mission Control local-secret/settings pattern and avoid hardcoding secrets.
