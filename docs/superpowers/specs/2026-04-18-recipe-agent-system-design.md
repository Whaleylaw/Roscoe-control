# Recipe-Based Ephemeral Agent System

**Status:** Design
**Date:** 2026-04-18
**Author:** Aaron Whaley (brainstormed with Claude)

## Summary

Build a Kanban-driven workflow system in which tasks are executed by **ephemeral containerized agents** configured from **recipe cards** — markdown + YAML bundles that describe an agent's persona, tools, skills, container image, and model. When a task is claimed, the runner spins up a container from the recipe, executes the task inside a task-specific git worktree, and tears down the container on exit. Work state is preserved in the worktree across crashes so a second attempt can resume without redoing work.

The Hermes agent (at `/Users/aaronwhaley/Github/Roscoe-hermes`) is the primary author of tasks; it uses an MC-hosted recipe search endpoint to pick a recipe, and creates new recipes on the fly when none fit. Humans can override recipe selection and all runtime context from the task form.

## Goals

1. Agents pick up assigned work autonomously and move it through the Kanban (`inbox → assigned → in_progress → review → quality_review → done`).
2. Agents are configured from reusable recipes — not hardcoded — and recipes can be created on demand.
3. Containers are ephemeral: one task, one container, no shared mutable state between tasks.
4. Long-running work survives container crashes and resumes without losing progress.
5. Mission Control remains agnostic to agent runtimes (Hermes, Claude Code, custom) — the recipe declares what image to launch.

## Non-goals (V1)

- Embedding-based recipe search (SQL matching is adequate at the expected recipe count)
- Automated recipe synthesis by MC itself (Hermes generates recipes externally and POSTs them)
- Container image builds or a recipe-image registry (images must already exist in the local Docker daemon)
- Kubernetes, multi-runner, multi-host orchestration
- Read-only overlay workspace mode
- Fallback-model runtime handling inside the container
- Recipe versioning beyond a content hash

## Architecture

Three processes, cleanly separated:

```
┌─────────────────┐    creates tasks with recipe_slug    ┌──────────────────┐
│  Hermes / user  │ ──────────────────────────────────→  │ Mission Control  │
│  (task author)  │   (search recipes via API)           │  (web + API)     │
└─────────────────┘                                      └────────┬─────────┘
                                                                  │ SSE event:
                                                                  │ task.runner_requested
                                                                  ▼
┌─────────────────────┐  docker run --rm -v <worktree>  ┌────────────────────┐
│ Ephemeral container │ ←──────────────────────────────  │   MC Runner       │
│  (image per recipe) │                                  │  (new daemon)     │
│  SOUL.md + tools    │                                  │  • subscribes     │
│  + skills mounted   │                                  │  • mints tokens   │
│                     │  MC API calls (Bearer token,     │  • launches       │
│                     │  task-scoped)                    │  • watches exit   │
│                     │ ──────────────────────────────→  │                   │
└─────────────────────┘                                  └────────────────────┘
```

**Invariants:**

- MC web never talks to Docker. Only the runner does.
- Containers are stateless and ephemeral; one per task attempt.
- Tokens are per-task, revoked automatically on terminal state.
- The runner has no task logic: it claims, launches, monitors, tears down.

## Recipes

### Filesystem layout

Recipes live at `recipes/<slug>/` in the Mission Control repo (option A):

```
recipes/
  code-reviewer/
    recipe.yaml
    SOUL.md
    tools/
      allowed.json      # optional: MC MCP tool names the agent may call
    skills/             # optional: bundled skill files
      review-checklist.md
    README.md           # optional: human docs
```

### `recipe.yaml` schema

```yaml
name: code-reviewer
description: Reviews a PR or diff against project conventions; posts findings as comments.
when_to_use: |
  Tasks involving code review, PR review, diff analysis, or style/convention checks.
  Prefer over `linter` when the review should reason about design, not just formatting.

image: mc-hermes-agent:latest    # container image (must already exist in local Docker)
workspace: worktree              # one of: none | worktree | ro-overlay
                                 # V1 supports: none, worktree
timeout_seconds: 1800            # hard kill at 30m
max_concurrent: 3                # at most N of this recipe running at once

model:
  primary: claude-opus-4-7       # required: model identifier; validated at index time
  fallback: claude-sonnet-4-6    # optional; used on rate-limit (container-side, V2)
  provider: anthropic            # optional: anthropic | openai | local; default anthropic
  params:                        # optional; container honors what it supports
    max_output_tokens: 16000
    reasoning_effort: high
    temperature: 0.2

env:                             # non-secret env passed to container
  LOG_LEVEL: info

secrets:                         # secret keys the runner injects from its secret store
  - ANTHROPIC_API_KEY

tags: [review, code-quality]     # UI filtering
version: 1                       # bumped by author; triggers re-index
```

**Required fields:** `name`, `description`, `image`, `workspace`, `model.primary`.
**Defaults:** `timeout_seconds: 1800`, `max_concurrent: 3`, `provider: anthropic`, `version: 1`.

### Indexing

On MC startup and on `recipes/` file changes (chokidar watch), a new `src/lib/recipe-indexer.ts` module syncs recipes into a `recipes` table. Each row stores metadata + `dir_sha` (content hash). Rows are dropped if their directory disappears.

`model.primary` is validated against a known-model registry (`src/lib/model-registry.ts`), a new module that exports a typed map of model identifiers → `{ provider, context_window, output_tokens_max, supports_tools, supports_thinking }`. Unknown models cause the recipe to fail to index, with an error surfaced in the UI. The registry seeds with Anthropic's current published models (Opus 4.7, Sonnet 4.6, Haiku 4.5) and is extended in code as new models are added.

### Task-level runtime context

A recipe is the reusable template; a task supplies the runtime specifics:

```typescript
interface Task {
  // ... existing fields ...
  recipe_slug: string | null

  workspace_source: {               // required when recipe.workspace === 'worktree'
    project_id: number              // which project's repo to worktree from
    base_ref: string                // branch/sha; defaults to project default branch
  } | null

  read_only_mounts: Array<{
    host_path: string               // must match runner's mount_allowlist
    container_path: string          // inside-container path, e.g., /refs/style-guide
    label: string                   // human label for UI
  }>

  extra_skills: string[]            // host paths mounted at /skills/<name>
  model_override?: string           // overrides recipe.model.primary; task-specific bump
}
```

**Mount allowlist:** runner reads `.data/runner-config.json` on startup:

```json
{
  "mount_allowlist": [
    "/Users/aaronwhaley/Github",
    "/Users/aaronwhaley/Documents/references",
    "/Users/aaronwhaley/.claude/skills"
  ]
}
```

Any `host_path` outside these roots rejects at both task-creation time (early error) and runner-claim time (defense in depth). Runner resolves `realpath` and refuses if the resolved path escapes the allowlist; symlinks are disallowed by default.

**What the container sees:**

```
/workspace               ← git worktree, rw (only when workspace: worktree)
/recipe/                 ← recipe directory, ro (SOUL.md, tools/, skills/)
/refs/<label-slug>/      ← each read_only_mount, ro
/skills/<name>.md        ← each extra_skills entry, ro
```

## Data model

### New table: `recipes`

```sql
CREATE TABLE recipes (
  slug              TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  description       TEXT NOT NULL,
  when_to_use       TEXT,
  image             TEXT NOT NULL,
  workspace_mode    TEXT NOT NULL,            -- 'none' | 'worktree' | 'ro-overlay'
  timeout_seconds   INTEGER NOT NULL DEFAULT 1800,
  max_concurrent    INTEGER NOT NULL DEFAULT 3,
  env_json          TEXT NOT NULL DEFAULT '{}',
  secrets_json      TEXT NOT NULL DEFAULT '[]',
  tags_json         TEXT NOT NULL DEFAULT '[]',
  model_json        TEXT NOT NULL DEFAULT '{}',
  version           INTEGER NOT NULL DEFAULT 1,
  dir_sha           TEXT NOT NULL,
  embedding         BLOB,                      -- nullable; V2
  created_at        INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at        INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_recipes_tags ON recipes(tags_json);
```

### Changes to `tasks`

All additive, nullable or defaulted:

```sql
ALTER TABLE tasks ADD COLUMN recipe_slug TEXT
  REFERENCES recipes(slug) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN workspace_source_json TEXT;
ALTER TABLE tasks ADD COLUMN read_only_mounts_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE tasks ADD COLUMN extra_skills_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE tasks ADD COLUMN model_override TEXT;

-- Runner execution state:
ALTER TABLE tasks ADD COLUMN container_id TEXT;
ALTER TABLE tasks ADD COLUMN runner_started_at INTEGER;
ALTER TABLE tasks ADD COLUMN runner_exit_code INTEGER;
ALTER TABLE tasks ADD COLUMN worktree_path TEXT;
ALTER TABLE tasks ADD COLUMN runner_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN runner_max_attempts INTEGER NOT NULL DEFAULT 3;
ALTER TABLE tasks ADD COLUMN runner_last_failure_reason TEXT;
```

### New table: `task_runner_tokens`

```sql
CREATE TABLE task_runner_tokens (
  token_hash    TEXT PRIMARY KEY,          -- sha256; raw token never stored
  task_id       INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  issued_at     INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at    INTEGER NOT NULL,
  revoked_at    INTEGER
);
CREATE INDEX idx_task_runner_tokens_task ON task_runner_tokens(task_id);
```

Tokens authenticate as a synthetic principal `{ kind: 'runner_token', task_id, expires_at }`. They may be rotated on retry (old revoked, new minted).

### New table: `task_checkpoints`

```sql
CREATE TABLE task_checkpoints (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id     INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  attempt     INTEGER NOT NULL,
  step        TEXT NOT NULL,
  summary     TEXT NOT NULL,
  status      TEXT NOT NULL,              -- 'completed' | 'in_progress' | 'blocked'
  artifacts   TEXT NOT NULL DEFAULT '[]',
  next_step   TEXT,
  blocker_reason TEXT,
  tokens_used INTEGER,
  duration_ms INTEGER,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_task_checkpoints_task ON task_checkpoints(task_id);
```

## Checkpoint structure

### Wire format (API request body)

```typescript
interface CheckpointRequest {
  step: string                     // kebab-case label: "analyzed-diff", "wrote-tests"
  summary: string                  // human-readable paragraph
  status: 'completed' | 'in_progress' | 'blocked'
  artifacts?: Artifact[]
  next_step?: string
  blocker_reason?: string          // required if status === 'blocked'
  tokens_used?: number
  duration_ms?: number
}

interface Artifact {
  kind: 'file' | 'url' | 'diff' | 'test_result' | 'comment' | 'other'
  path?: string                    // relative to worktree
  url?: string
  ref?: string                     // e.g., "comment:123"
  summary?: string
}
```

### Storage

Each checkpoint is:
1. Inserted into `task_checkpoints` as a DB row.
2. Appended as one JSON line to `<worktree>/.mc/checkpoints.jsonl`.

Same field names in both. A resuming agent can `tail .mc/checkpoints.jsonl` and know exactly where the prior attempt left off.

### Checkpoint guidance (in the agent preamble)

| Situation | Emit checkpoint? |
|---|---|
| Bounded unit of work complete (file analyzed, test written, command run) | Yes — `status: completed` |
| Starting a step > 5 minutes or > 20k tokens | Yes — `status: in_progress` |
| Blocker / missing info / needs human | Yes — `status: blocked` |
| Trivial intermediate reasoning / single tool call | No |

### `status: blocked` handling

When the runner observes a `blocked` checkpoint:

1. Record the row as normal.
2. Transition task `in_progress → awaiting_owner`.
3. Post an automatic comment with `blocker_reason`.
4. Gracefully stop the container (worktree preserved).
5. When the blocker is resolved (human posts comment or transitions task back), runner relaunches with the resume flow.

## Crash recovery

### Worktree lifecycle

- **Created once** by the runner on first launch, at `.data/runner/worktrees/task-<id>/`.
- **Preserved** across container crashes and retries.
- **Destroyed** only when task reaches a terminal state (`done`, `failed`, `cancelled`) — and on failed tasks, not until N days later (GC job).
- `tasks.worktree_path` stores the absolute path.

### `.mc/` directory convention

Runner seeds inside every worktree:

```
.mc/
  task.json         ← task snapshot + is_resuming flag + prior_attempts
  progress.md       ← freeform agent notes; preserved across attempts
  checkpoints.jsonl ← structured checkpoint log; preserved across attempts
  .gitignore        ← ignores .mc/ so commits stay clean
```

`.mc/task.json` example:

```json
{
  "task_id": 42,
  "recipe_slug": "code-reviewer",
  "attempt": 2,
  "is_resuming": true,
  "prior_attempts": [
    {"attempt": 1, "started_at": 1761230000, "exit_code": 137, "failure_reason": "oom"}
  ]
}
```

### Agent preamble (runner injects above recipe's SOUL.md)

**First attempt:**

> Write to `.mc/progress.md` as you work so a future agent can resume if you crash.

**Resume attempt (attempt > 1):**

> You are resuming a task a previous agent started. Before doing anything:
> 1. Read `.mc/progress.md` for notes from your predecessor.
> 2. Read `.mc/checkpoints.jsonl` for structured progress.
> 3. Inspect the worktree for in-progress changes (`git status`, `git diff`).
> 4. Continue from where they left off. Do not redo completed work.
> 5. Update `.mc/progress.md` as you go.

### Retry policy

- `runner_attempts` increments on each claim (container launch).
- When `runner_attempts >= runner_max_attempts`, task → `failed`, worktree preserved for inspection.
- Recipe's `max_attempts` (if set) overrides task default.

### Staleness handling

- Runner writes `tasks.updated_at` as a heartbeat while container runs.
- `requeueStaleTasks()` scheduler path is extended: if task has `recipe_slug`, it checks runner heartbeat and `container_id` liveness, not just `assigned_to`.
- Both paths increment `runner_attempts`.

## The runner service

### Binary

`scripts/mc-runner.mjs` — a standalone Node process. Ships with a LaunchAgent template at `scripts/com.mission-control.runner.plist.template`.

### Startup

1. Read `.data/runner-config.json` (mount_allowlist, image defaults, secret map).
2. Read or generate `.data/runner.secret` (long-lived runner auth; same pattern as `API_KEY`).
3. `POST /api/runner/register` → receive `runner_id`.
4. `GET /api/runner/pending-containers` → reconcile any orphaned containers against DB (runner may have crashed with live containers).
5. Subscribe to SSE `/api/events?types=task.runner_requested`.
6. Start 15s poll fallback (`GET /api/runner/ready-tasks?limit=10`).
7. Start 10s heartbeat (`POST /api/runner/heartbeat`).

### Per-task flow

1. Receive event or poll hit.
2. `POST /api/runner/claim/:task_id` — atomic claim. On 409, drop.
3. Validate mounts against allowlist (defense in depth).
4. Ensure/create worktree; seed `.mc/`.
5. Pull image if missing (V1: assume present; fail with clear error if not).
6. `docker run --rm -d` with mounts, env, token.
7. `POST /api/runner/container-started/:task_id` with container_id.
8. Stream logs to `.data/runner/logs/task-<id>/attempt-<n>/{stdout,stderr}.log`.
9. Wait for exit.
10. `POST /api/runner/runner-exit/:task_id` with exit code and stderr tail.
11. If task now terminal → destroy worktree, verify token revoked.

### Docker run template

```
docker run --rm -d \
  --name mc-task-<id>-attempt-<n> \
  --network=host \
  --cpus=2 --memory=4g \
  -v <worktree>:/workspace:rw \
  -v <recipe-dir>:/recipe:ro \
  -v <each read_only_mount>:<container_path>:ro \
  -v <each skill>:/skills/<name>:ro \
  -e MC_API_URL=http://localhost:3000 \
  -e MC_TASK_ID=<id> \
  -e MC_API_TOKEN=<minted> \
  -e MC_WORKSPACE=/workspace \
  -e MC_RECIPE_PATH=/recipe \
  -e MC_MODEL_PRIMARY=<effective> \
  -e MC_MODEL_FALLBACK=<if any> \
  -e MC_MODEL_PROVIDER=<anthropic|openai|local> \
  -e MC_MODEL_PARAMS_JSON='...' \
  -e ANTHROPIC_API_KEY=<from runner secrets if recipe declares> \
  <recipe.image>
```

`--cpus` and `--memory` are runner-config defaults; recipe may override via `resources:` block (V2).

### Exit handling

| Container exit observed | Task state | Runner action |
|---|---|---|
| 0, status already `review`/`done`/`failed` | terminal | revoke token, destroy worktree |
| 0, status still `in_progress` | non-terminal | report runner_exit; MC marks `failed` (exited without submitting) |
| 137 (OOM) or >0 | `in_progress` | report runner_exit; MC decides retry vs fail |
| Hard kill at timeout | `in_progress` | report runner_exit with reason='timeout' |
| `blocked` checkpoint received before exit | moved to `awaiting_owner` | graceful stop; preserve worktree |

### Concurrency

- Global: `MAX_CONCURRENT_CONTAINERS` env (default 4).
- Per-recipe: `recipe.max_concurrent` enforced by MC in the `/claim` endpoint (`SELECT COUNT(*)` on in-flight tasks with same `recipe_slug`).
- When either limit is hit, claim returns 409; task stays `assigned` for next cycle.

### What the runner is *not*

- Not an orchestrator — never picks recipes, never scores agents, never transitions status beyond runtime state.
- Not an agent — doesn't call Claude.
- Not a queue — MC owns task state; the runner only owns execution.

## API surface

### Recipe management

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/api/recipes` | operator+ | List recipes (filters: tag, image) |
| `GET` | `/api/recipes/:slug` | operator+ | Fetch one recipe (metadata + SOUL.md body) |
| `GET` | `/api/recipes/search?q=...` | operator+ | Rank recipes; V1 uses SQL LIKE |
| `POST` | `/api/recipes` | operator+ | Create recipe (writes files, indexes). Body: `{ slug, recipe_yaml, soul_md, tools?, skills?, readme? }` |
| `PUT` | `/api/recipes/:slug` | operator+ | Update recipe |
| `POST` | `/api/recipes/resync` | admin | Force re-scan `recipes/` |

### Task lifecycle (runner-token scoped)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/tasks/:id/checkpoints` | runner-token | Agent emits checkpoint |
| `GET` | `/api/tasks/:id/checkpoints` | viewer+ | Read timeline |
| `POST` | `/api/tasks/:id/submit` | runner-token | Agent submits resolution → `review` |
| `POST` | `/api/tasks/:id/fail` | runner-token | Agent marks failure |
| `PUT` | `/api/tasks/:id/status` | runner-token / operator+ | Scoped transitions only |

### Runner protocol

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/runner/register` | runner-secret | Startup; returns runner_id |
| `POST` | `/api/runner/heartbeat` | runner-secret | Liveness every 10s |
| `GET` | `/api/runner/ready-tasks` | runner-secret | Poll fallback |
| `POST` | `/api/runner/claim/:task_id` | runner-secret | Atomic claim + token mint |
| `POST` | `/api/runner/container-started/:task_id` | runner-secret | Report container_id |
| `POST` | `/api/runner/runner-exit/:task_id` | runner-secret | Report exit; triggers retry/fail |
| `GET` | `/api/runner/pending-containers` | runner-secret | On-restart reconcile |

### Auth principals

Two new principals added to `src/lib/auth.ts`:

- **`runner`** — the daemon. One per MC install. Long-lived secret in `.data/runner.secret`. Scoped to `/api/runner/*`.
- **`runner-token`** — per-task ephemeral bearer. Scoped to the task identified by the token; handlers cross-check path param vs token's `task_id`. Expires at `runner_started_at + recipe.timeout_seconds + 60s`.

`requireRole` gains a new call form: `requireRunnerToken(request, taskId)` returns `{ user: { kind: 'runner_token', task_id }, workspace_id, ... }` or an error. `runner-token` is **not** a rank-ordered tier; it is a scoped principal that handlers explicitly opt into.

## Integration with existing systems

### Scheduler (`src/lib/scheduler.ts`)

- `autoRouteInboxTasks()` — unchanged for legacy tasks. For `recipe_slug`-tagged tasks, move `inbox → assigned` without agent-affinity scoring (the recipe already identifies the executor).
- `dispatchAssignedTasks()` — bypass for `recipe_slug`-tagged tasks. Legacy code paths remain for today's agent-based tasks.
- `requeueStaleTasks()` — extended: for `recipe_slug` tasks, check `runner_started_at`, container liveness, and runner heartbeat.
- **New: `reconcileRunnerHeartbeat()`** — 30s interval. No heartbeat in 60s → mark `in_progress` recipe-tasks stale; runner reconciles on reconnect.

### Event bus (`src/lib/event-bus.ts`)

New event types:

- `task.runner_requested` — recipe-task ready for runner
- `task.container_started` / `task.container_exited`
- `task.checkpoint_added`
- `recipe.indexed` / `recipe.removed`

**Emission points for `task.runner_requested`:**

- `autoRouteInboxTasks()` in `src/lib/scheduler.ts` — when a `recipe_slug`-tagged task moves `inbox → assigned`.
- `POST /api/tasks` handler — when a task is created directly with status `assigned` and `recipe_slug` set (the Hermes path).
- `runner-exit` retry path — when a retry bumps an `in_progress` task back to `assigned`.

### Kanban UI

- Recipe badge on task card (name + model tier color)
- Runner status banner on task board (`🟢 Runner online` / `🔴 Runner offline`)
- Task detail **Progress tab** with live checkpoint timeline (per-attempt grouping via SSE)
- Task create/edit form — Recipe dropdown (autocomplete via `/api/recipes/search`) + collapsible Advanced section for mounts, skills, model override
- No agent-initiated status transitions in the UI; those only come from runner-token API calls

### Filesystem watcher

- `src/lib/recipe-indexer.ts` — chokidar watch on `recipes/`
- Hash-based dedup via `dir_sha`; only re-index on real changes
- Emits `recipe.indexed` / `recipe.removed`

## V1 scope

**In V1:**

- `recipes` table + filesystem indexer
- Full `tasks` additions and new `task_runner_tokens`, `task_checkpoints` tables
- `scripts/mc-runner.mjs` daemon + LaunchAgent template
- Event + poll dispatch, claim, container launch, heartbeat, exit handling
- Worktree lifecycle, `.mc/` convention, crash-resume
- Mount allowlist (enforced twice: task creation, runner claim)
- Recipe CRUD + SQL-LIKE search
- Task lifecycle endpoints for runner-token
- Runner protocol endpoints
- `runner` and `runner-token` auth principals
- Model identifier validation (`model-registry.ts`)
- UI: recipe badge, runner banner, Progress tab, recipe dropdown, advanced mounts/skills editor
- One reference image (`mc-hello-world-agent`) that demonstrates the full checkpoint → submit cycle

**Deferred to V2+:**

- Embedding-based recipe search
- Auto-create-recipe by MC (Hermes does it today via `POST /api/recipes`)
- Runtime model fallback inside containers
- `ro-overlay` workspace mode
- Docker compose / multi-runner / K8s
- Container image build pipeline
- WIP limits, aging alerts, column SLAs
- Cost dashboard for agent runs
- Recipe versioning with history and rollback

## Risks

1. **Mount escape** — Malicious task uses symlinks to escape allowed roots. *Mitigation:* runner resolves `realpath`, refuses symlinks, rejects paths that escape allowlist after resolution.
2. **Worktree disk growth** — Failed tasks hold worktrees until GC. *Mitigation:* nightly scheduler job prunes worktrees for tasks terminal > 7 days.
3. **Token leak** — Image logs env vars → `MC_API_TOKEN` in logs. *Mitigation:* tokens are task-scoped and short-lived, revoked on terminal state; document risk for recipe authors.
4. **Runner crash with live containers** — Orphaned containers must be reconciled on restart. *Mitigation:* `docker ps -f name=mc-task-*` scan + DB reconcile via `/api/runner/pending-containers`.
5. **SQLite write contention** — Frequent checkpoint writes compete with other MC writes. *Mitigation:* WAL mode already on; measure and batch only if contention observed.
6. **Container network exposure** — `--network=host` gives container access to anything on localhost. *Mitigation:* document; evaluate user-defined bridge network with only MC host exposed in V2.

## Open questions

- Should recipes be able to declare `resources:` (cpu, memory) in V1, or rely on runner defaults? **V1 default: runner-global defaults; recipe override in V2.**
- Do we need a `recipes` UI panel for manual authoring, or is filesystem + Hermes-via-API enough? **V1: minimal list view with "resync" button; authoring stays filesystem-first.**
- What happens to tasks with `recipe_slug` pointing to a deleted recipe? **V1: task fails at claim time with clear error; `ON DELETE SET NULL` preserves task record.**

## Testing strategy

- **Unit:** recipe indexer parsing, mount-allowlist resolution, token mint/revoke, checkpoint validation.
- **Integration:** full flow with the bundled `mc-hello-world-agent` image — create task, runner claims, container emits checkpoints, submits, moves to review, Aegis approves.
- **Crash recovery:** deliberately kill a running container mid-task; verify retry picks up `.mc/progress.md` and completes.
- **E2E (Playwright):** task board renders recipe badges; Progress tab updates live on checkpoint events.

## References

- Existing task lifecycle: `src/lib/task-dispatch.ts`, `src/lib/scheduler.ts`
- Existing polling queue: `src/app/api/tasks/queue/route.ts`
- Aegis review loop: `runAegisReviews()` in `src/lib/task-dispatch.ts`
- Hermes reference: `/Users/aaronwhaley/Github/Roscoe-hermes` (SOUL.md format, Dockerfile)
- Claude Code skills pattern: `~/.claude/plugins/.../skills` (frontmatter + markdown body)
