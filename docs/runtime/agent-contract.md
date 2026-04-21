# Agent Contract

**Source of truth:**

- [`docker/hello-world-agent/`](../../docker/hello-world-agent/) — canonical worked example (reference image, 7-step walkthrough)
- [`src/lib/runner-preamble.ts`](../../src/lib/runner-preamble.ts) — runner-authored `/recipe/PREAMBLE.md` generator (first-attempt + resume variants)
- [`src/lib/runner-docker.ts`](../../src/lib/runner-docker.ts) — `docker run` argv composer + mount layout + env-file writer
- [`src/lib/runner-claim.ts`](../../src/lib/runner-claim.ts) — `composeEnvMap` (the `MC_*` env vars inside the container)
- [`src/lib/runner-tokens.ts`](../../src/lib/runner-tokens.ts) — 7-entry `RUNNER_TOKEN_ALLOWLIST`
- [`src/app/api/runner/tasks/[task_id]/submit/route.ts`](../../src/app/api/runner/tasks/%5Btask_id%5D/submit/route.ts) — submit endpoint that flips `in_progress → review`
- [`src/app/api/tasks/[id]/checkpoints/route.ts`](../../src/app/api/tasks/%5Bid%5D/checkpoints/route.ts) — Phase 15 CP-01 agent-authored checkpoint endpoint
- [`src/lib/task-dispatch.ts`](../../src/lib/task-dispatch.ts) — `runAegisReviews()` (the reviewer that flips `review → done`)

**Who reads this:** Authors of new recipe images — any agent framework, any runtime. This contract is **tool-agnostic**: no specific agent SDK is assumed.

**Prerequisites:** Familiarity with Docker, HTTP, filesystem I/O. That is all. No SDK, no model provider, no framework is required by the contract itself.

## Map

| Section | Anchor |
|---|---|
| The 7-step contract (overview) | [#the-7-step-contract-overview](#the-7-step-contract-overview) |
| Container env vars | [#container-env-vars](#container-env-vars) |
| Mount layout | [#mount-layout](#mount-layout) |
| Reading order (preamble → soul → .mc) | [#reading-order-preamble--soul--mc](#reading-order-preamble--soul--mc) |
| Progress + checkpoints (append-only) | [#progress--checkpoints-append-only](#progress--checkpoints-append-only) |
| Checkpoint HTTP endpoint (Phase 15 CP-01) | [#checkpoint-http-endpoint-phase-15-cp-01](#checkpoint-http-endpoint-phase-15-cp-01) |
| Submit HTTP endpoint (the two-hop lifecycle) | [#submit-http-endpoint-the-two-hop-lifecycle](#submit-http-endpoint-the-two-hop-lifecycle) |
| Runner-token allowlist (all 7 entries) | [#runner-token-allowlist-all-7-entries](#runner-token-allowlist-all-7-entries) |
| Runner-token lifetime | [#runner-token-lifetime](#runner-token-lifetime) |
| Exit codes | [#exit-codes](#exit-codes) |
| Resume behavior | [#resume-behavior](#resume-behavior) |
| Blocker flow | [#blocker-flow](#blocker-flow) |
| Drift-guards for agent authors | [#drift-guards-for-agent-authors](#drift-guards-for-agent-authors) |
| Reference image | [#reference-image](#reference-image) |
| Related docs | [#related-docs](#related-docs) |

## The 7-step contract (overview)

This is what the canonical reference image (`mc-hello-world-agent`) does on launch. Your recipe image is free to do more inside each step — call a real model, iterate until done, fan out subtasks — but the **skeleton** below must be preserved. This contract is substrate-level: it describes how the runtime, the container, and the Mission Control HTTP surface interact. It makes no assumption about which agent framework you use inside step 5.

Source: [`docker/hello-world-agent/README.md:15–25`](../../docker/hello-world-agent/README.md#L15-L25).

1. **[Env snapshot](#container-env-vars)** — log the `MC_*` env vars (never the token value).
2. **[Read preamble + SOUL.md](#reading-order-preamble--soul--mc)** — `$MC_PREAMBLE_PATH` first, then `$MC_RECIPE_PATH/SOUL.md`.
3. **[Append to progress.md](#progress--checkpoints-append-only)** — one line per meaningful step, to `/workspace/.mc/progress.md`.
4. **(Optional) [POST checkpoint via HTTP](#checkpoint-http-endpoint-phase-15-cp-01)** — report live status to the server (Phase 15 CP-01).
5. **Do the task's real work in `/workspace`** — this is where your agent does whatever the recipe demands (edit code, run tests, call a model, commit changes).
6. **[POST submit](#submit-http-endpoint-the-two-hop-lifecycle)** — declare completion with `{"status":"done"}`.
7. **Exit 0 on success** — non-zero on failure. The runner's `runner-exit` handler classifies the outcome.

## Container env vars

The runner composes these via [`composeEnvMap` in `src/lib/runner-claim.ts:89–105`](../../src/lib/runner-claim.ts#L89-L105) (called at `POST /api/runner/claim/:task_id`) and passes them into the container via `docker run --env-file <path>` — **never on the `docker run` argv** (CONTAINER-01 invariant, see below).

Exact env-var block the reference image documents (source: [`docker/hello-world-agent/README.md:27–40`](../../docker/hello-world-agent/README.md#L27-L40)):

```
MC_API_URL       — http://host.docker.internal:<port>  (NOT localhost)
MC_TASK_ID       — string (integer id, stringified)
MC_API_TOKEN     — per-task runner-token (principal id -2000)
                   expires at runner_started_at + recipe.timeout_seconds + 60s
MC_WORKSPACE     — /workspace
MC_RECIPE_PATH   — /recipe
MC_PREAMBLE_PATH — /recipe/PREAMBLE.md
MC_MODEL_PRIMARY, MC_MODEL_PROVIDER, MC_MODEL_PARAMS_JSON  — resolved at claim time
MC_MODEL_FALLBACK — optional
```

Reference table with source-of-truth links:

| Name | Type | Source | Notes |
|---|---|---|---|
| `MC_API_URL` | URL | [`runner-claim.ts:91`](../../src/lib/runner-claim.ts#L91) | `http://host.docker.internal:<PORT>` — **NOT** `localhost`. Phase 14-05 LOCKED. |
| `MC_TASK_ID` | string | [`runner-claim.ts:92`](../../src/lib/runner-claim.ts#L92) | Integer id, stringified. |
| `MC_API_TOKEN` | bearer | [`runner-claim.ts:93`](../../src/lib/runner-claim.ts#L93) | Per-task runner-token (principal `-2000`). Expiry = `runner_started_at + recipe.timeout_seconds + 60s` ([`runner-tokens.ts:48`](../../src/lib/runner-tokens.ts#L48)). |
| `MC_WORKSPACE` | abs path | [`runner-claim.ts` composeEnvMap](../../src/lib/runner-claim.ts#L89-L105) | `/workspace` (see [mount layout](#mount-layout)). |
| `MC_RECIPE_PATH` | abs path | [`runner-claim.ts` composeEnvMap](../../src/lib/runner-claim.ts#L89-L105) | `/recipe`. |
| `MC_PREAMBLE_PATH` | abs path | [`runner-claim.ts` composeEnvMap](../../src/lib/runner-claim.ts#L89-L105) | `/recipe/PREAMBLE.md`. |
| `MC_MODEL_PRIMARY` | string | [`runner-claim.ts:97`](../../src/lib/runner-claim.ts#L97) | Effective model identifier (`task.model_override ?? recipe.model.primary`). |
| `MC_MODEL_PROVIDER` | string | [`runner-claim.ts:98`](../../src/lib/runner-claim.ts#L98) | e.g. `anthropic`. Informational only — the agent chooses whether to consult it. |
| `MC_MODEL_PARAMS_JSON` | json | [`runner-claim.ts:99`](../../src/lib/runner-claim.ts#L99) | Serialized `model.params` (always present, defaults to `{}`). |
| `MC_MODEL_FALLBACK` | string | [`runner-claim.ts:103`](../../src/lib/runner-claim.ts#L103) | Optional. Omitted (not emitted as empty string) when unset. |

> ⚠️ **Pitfall #5 — Inside the container, `$MC_API_URL` is `http://host.docker.internal:<port>`, NOT `localhost`.**
>
> Containers **cannot** reach the host's `localhost`. The runner passes `--add-host host.docker.internal:host-gateway` ([`runner-docker.ts:131–133`](../../src/lib/runner-docker.ts#L131-L133)) so `host.docker.internal` resolves to the host IP. Every `curl` / `fetch` / HTTP client inside the container **must** use `$MC_API_URL` (or `host.docker.internal` directly). Using `http://localhost:3000` or `http://127.0.0.1:3000` will hang or 404.
>
> Locked in `.planning/STATE.md` at Phase 14-05: `"MC_API_URL in composed env uses http://host.docker.internal:${PORT || 3000} — the URL the container will use (not the browser's localhost URL)"`.

> ⚠️ **Pitfall #6 — CONTAINER-01: Secrets never flow on the `docker run` argv.**
>
> The runner passes secrets via `docker run --env-file <path>` only. No `-e SECRET=value` is ever placed on argv. The env-file is created on disk with mode `0600` (see [`writeEnvFile` in `runner-docker.ts:192–207`](../../src/lib/runner-docker.ts#L192-L207)) and cleaned up after the container exits. A unit test in `src/lib/__tests__/runner-docker-args.test.ts` scans every argv element for `MC_API_TOKEN=` as a substring and asserts zero hits.
>
> Agent authors do NOT need to do anything special — the runner handles this. The contract you need to honor on your side is simpler: **never echo `$MC_API_TOKEN` into a shell command line, a log, or an outbound HTTP body that is not the `Authorization: Bearer …` header.**

## Mount layout

```
/workspace           ← git worktree, rw (when workspace_mode: worktree)
/recipe/             ← recipe directory, ro
   ├── recipe.yaml
   ├── SOUL.md
   ├── PREAMBLE.md   ← authored by runner at claim time (overrides any recipe-authored PREAMBLE.md)
   └── (tools/, skills/, README.md if recipe-authored)
/refs/<label-slug>/  ← each read_only_mount declared by the task, ro
/skills/<name>/      ← each extra_skill declared by the task, ro
```

Source: [`runner-docker.ts:90–149`](../../src/lib/runner-docker.ts#L90-L149) (`buildDockerRunArgs`) + [`runner-docker.ts:165–170`](../../src/lib/runner-docker.ts#L165-L170) (`stageRecipe`).

Notes:

- When `workspace_mode: readonly`, `/workspace` is also `ro`.
- When `workspace_mode: none`, `/workspace` is not mounted at all.
- The runner **deep-copies** the recipe directory into a stage area and writes `PREAMBLE.md` **after** the copy, so the runner-authored preamble always wins over any recipe-authored `PREAMBLE.md`. See `.planning/STATE.md` Phase 14-07 LOCKED: `"stageRecipe writes PREAMBLE.md AFTER deep-copy so runner owns /recipe/PREAMBLE.md"`.
- `read_only_mounts[].label` is slugified to `/refs/<slug>/` ([`slugify` in `runner-docker.ts:69–74`](../../src/lib/runner-docker.ts#L69-L74)). `My Ref #01` → `/refs/my-ref-01/`.
- `extra_skills` mount under `/skills/<basename>/` — basename only, no slugify.

## Reading order (preamble → soul → .mc)

The runner authors `/recipe/PREAMBLE.md` at claim time. It is the **first** thing your agent should read. The recipe-authored `SOUL.md` sits beside it describing the agent's domain-specific steps. After the preamble and SOUL, your agent reads any prior-attempt context from `/workspace/.mc/progress.md` and `/workspace/.mc/checkpoints.jsonl` (on resume attempts, these contain history from prior attempts — see [resume behavior](#resume-behavior)).

Source: [`runner-preamble.ts`](../../src/lib/runner-preamble.ts) (generator) + Phase 14-07 LOCK in `.planning/STATE.md`.

The preamble ends with the checkpoint + submit HTTP skeleton, reproduced verbatim from the generator ([`runner-preamble.ts:69–94`](../../src/lib/runner-preamble.ts#L69-L94)):

```text
POST $MC_API_URL/api/runner/checkpoint
Authorization: Bearer $MC_API_TOKEN
Content-Type: application/json

{ "task_id": $MC_TASK_ID, "step": "short-slug", "status": "in_progress", "summary": "what you just did" }
```

```text
POST $MC_API_URL/api/runner/tasks/$MC_TASK_ID/submit
Authorization: Bearer $MC_API_TOKEN
Content-Type: application/json

{ "status": "done" }
```

Notes on the skeleton:

- The `/api/runner/checkpoint` URL is a forward-reference kept stable across the Phase 14 / Phase 15 boundary. Phase 14 shipped file-only checkpoints (no HTTP endpoint). Phase 15 CP-01 added [`POST /api/tasks/:id/checkpoints`](#checkpoint-http-endpoint-phase-15-cp-01) — see below. The preamble text still references the checkpoint endpoint for agents that want to POST; your agent can safely target either `POST /api/tasks/$MC_TASK_ID/checkpoints` (preferred; this is on the allowlist) or leave HTTP checkpoints out entirely.
- The submit URL is the **correct** path (`/api/runner/tasks/:id/submit`). Do **not** attempt `PUT /api/tasks/:id` — it is not on the runner-token allowlist and will 401 at the auth guard. See Phase 14-07 LOCK: `"Preamble HTTP skeleton forward-references POST {apiBase}/api/runner/tasks/$MC_TASK_ID/submit (RAUTH-06 allowlist-safe), NOT PUT /api/tasks/:id"`.

## Progress + checkpoints (append-only)

> ⚠️ **Pitfall #10 — `/workspace/.mc/progress.md` and `/workspace/.mc/checkpoints.jsonl` are APPEND-ONLY across attempts.**
>
> When your agent runs on attempt 2+, `progress.md` and `checkpoints.jsonl` still contain attempt-1's history. Your agent **must** use `fs.appendFileSync` — **never** `fs.writeFileSync` on these two files. The runner's `seedMcDir` preserves both files on resume and only rewrites `task.json`. Phase 17-05 byte-asserts this with `expect(jsonlAfterResume.slice(0, jsonlAfterKill.length)).toBe(jsonlAfterKill)` — any overwrite breaks the integration test.
>
> Locked in `.planning/STATE.md`:
> - Phase 14-07: `"seedMcDir preserves existing progress.md + checkpoints.jsonl on resume (is_resuming=true) but ALWAYS rewrites task.json with new attempt counter + prior_attempts"`
> - Phase 17-05: `"Byte-window append-only assertion on .mc/checkpoints.jsonl — expect(jsonlAfterResume.slice(0, jsonlAfterKill.length)).toBe(jsonlAfterKill) + strictly-more-lines check. Proves the file is append-only across BOTH the seedMcDir boundary AND the attempt boundary."`

Correct and wrong patterns — take from the canonical reference agent at [`docker/hello-world-agent/agent.mjs:49–66`](../../docker/hello-world-agent/agent.mjs#L49-L66):

```javascript
// Correct — append keeps prior-attempt history
import fs from 'node:fs'
import path from 'node:path'

const progressPath = path.join(process.env.MC_WORKSPACE, '.mc', 'progress.md')
const progressLine = `${new Date().toISOString()} | step: hello\n`
fs.appendFileSync(progressPath, progressLine)

const checkpointsPath = path.join(process.env.MC_WORKSPACE, '.mc', 'checkpoints.jsonl')
const checkpoint = { step: 'parse-recipe', status: 'completed', summary: '...', ts: new Date().toISOString() }
fs.appendFileSync(checkpointsPath, JSON.stringify(checkpoint) + '\n')
```

```javascript
// WRONG — overwrites attempt-1 history on resume; breaks the Phase 17-05 byte assertion
fs.writeFileSync('/workspace/.mc/progress.md', 'fresh\n')          // never do this
fs.writeFileSync('/workspace/.mc/checkpoints.jsonl', 'fresh\n')    // never do this
```

Rules:

- Use `fs.appendFileSync` (or your language's equivalent `O_APPEND` / append-mode writer) for every write to `progress.md` and `checkpoints.jsonl`.
- `HELLO.md`-style brand-new files inside `/workspace` itself can use `writeFileSync` — the append-only rule is scoped to `.mc/progress.md` and `.mc/checkpoints.jsonl`.
- `.mc/task.json` is runner-owned. Your agent reads it; the runner rewrites it on every claim. Do not edit it.

## Checkpoint HTTP endpoint (Phase 15 CP-01)

Phase 15 added `POST /api/tasks/:id/checkpoints` so your agent can report live status to the server while still running — this drives the Task Board Progress tab and the SSE `task.checkpoint_added` broadcast.

Source: [`src/app/api/tasks/[id]/checkpoints/route.ts:47–103`](../../src/app/api/tasks/%5Bid%5D/checkpoints/route.ts#L47-L103) (runner-token-auth POST handler) + allowlist entry 7 added in [`runner-tokens.ts:26`](../../src/lib/runner-tokens.ts#L26).

**Request body schema** (enforced by `CheckpointBodySchema` in `src/lib/task-checkpoints.ts`):

| Field | Type | Required | Notes |
|---|---|---|---|
| `step` | string | yes | Short slug, e.g. `parse-recipe`, `run-tests`. |
| `status` | enum | yes | One of `completed \| in_progress \| blocked`. |
| `summary` | string | no | Human-readable description of what just happened. |
| `artifacts` | array | no | Optional list of artifact objects (e.g. file paths, URLs). |
| `next_step` | string | no | Optional short slug for what you're about to do. |
| `blocker_reason` | string | **when status='blocked'** | Non-empty; required by Zod `refine` when `status === 'blocked'`. |
| `tokens_used` | integer | no | Informational. |
| `duration_ms` | integer | no | Informational. |

**Example** (cite: anchored on the header shape in [`runner-preamble.ts:75–80`](../../src/lib/runner-preamble.ts#L75-L80)):

```bash
curl -X POST "$MC_API_URL/api/tasks/$MC_TASK_ID/checkpoints" \
  -H "Authorization: Bearer $MC_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"step":"parse-recipe","status":"in_progress","summary":"identified 3 target files"}'
```

Behavior:

- On success, returns `201` with `{ id, attempt, ts }`. Persists a row to the `task_checkpoints` DB table AND appends a JSON line to `/workspace/.mc/checkpoints.jsonl` atomically (transactional: a DB error truncates the JSONL back to its pre-call byte count).
- If `task.status !== 'in_progress'`, returns `409` (idempotency guard).
- If the bearer's embedded `task_id` does not match the path `:id`, returns `403` (defense-in-depth; the auth layer already catches this).

**Special case: `status: 'blocked'` + `blocker_reason: '...'`** (Phase 15 CP-03):

The server atomically:

1. Persists the checkpoint row + appends to JSONL as usual.
2. Flips `task.status` from `in_progress` → `awaiting_owner`.
3. Inserts a `system`-authored comment on the task referencing the `blocker_reason`.
4. Broadcasts `task.status_changed` + `task.checkpoint_added` (in that order).

Your agent SHOULD exit `0` immediately after POSTing a blocker — the runner handles the graceful docker stop. See [blocker flow](#blocker-flow) for the full lifecycle.

Source: [`src/app/api/tasks/[id]/checkpoints/route.ts:150–256`](../../src/app/api/tasks/%5Bid%5D/checkpoints/route.ts#L150-L256) + Phase 15-05 LOCK in `.planning/STATE.md`.

## Submit HTTP endpoint (the two-hop lifecycle)

> ⚠️ **Pitfall #1 — `submit` flips the task to `review`, NOT `done`.**
>
> When your agent POSTs `{"status":"done"}` to `/api/runner/tasks/:id/submit`, the server flips `task.status` from `in_progress` to **`review`**, NOT to `done`. A separate Aegis review pass (`runAegisReviews()` in `src/lib/task-dispatch.ts`) later flips `review → done` (on approval) or `review → assigned` (on rejection with review comments). The body literal `{"status":"done"}` is the **agent's declaration of intent**; the server translates it.
>
> This is Phase 17-01 RTEST-02 LOCKED (commit `e9e5fc1`). Docs that describe submit as "marking the task done" are wrong.
>
> Source: [`src/app/api/runner/tasks/[task_id]/submit/route.ts:112–119`](../../src/app/api/runner/tasks/%5Btask_id%5D/submit/route.ts#L112-L119) (the flipper) + [`src/lib/task-dispatch.ts:414`](../../src/lib/task-dispatch.ts#L414) (`runAegisReviews`, the reviewer).

**Request** (source: [`docker/hello-world-agent/agent.mjs:81–94`](../../docker/hello-world-agent/agent.mjs#L81-L94)):

```bash
curl -X POST "$MC_API_URL/api/runner/tasks/$MC_TASK_ID/submit" \
  -H "Authorization: Bearer $MC_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"done"}'
```

**Response:**

- `204 No Content` on success (the flip committed; `task.status` is now `review`).
- `409` if `task.status` is already in `review`, `done`, `failed`, or `cancelled` (idempotent retry). Source: `ALREADY_SETTLED` set at [`submit/route.ts:39`](../../src/app/api/runner/tasks/%5Btask_id%5D/submit/route.ts#L39).
- `403` if the bearer's embedded `task_id` does not match the path `:id` (cross-task forbidden).

**Two-hop transition diagram:**

```
agent POST /api/runner/tasks/:id/submit {"status":"done"}
   → server: task.status = 'in_progress' → 'review'   (commit e9e5fc1 — src/app/api/runner/tasks/[task_id]/submit/route.ts)
   → runAegisReviews() (scheduled; src/lib/task-dispatch.ts:414)
        → on approve:  task.status = 'review' → 'done'
        → on reject:   task.status = 'review' → 'assigned' (retry with review comments)
```

Notes:

- `container_id` is cleared as part of the submit transaction.
- Runner-tokens for the task are atomically revoked at submit time (the runner's attempt is done; a revision/retry mints a new token per Phase 11-04's token-per-attempt model).
- `completed_at` is **not** set at submit — `review` is not a terminal status. Aegis owns the final `done` transition.
- `task.status_changed` SSE broadcast fires **after** the DB transaction commits with `{ status: 'review', previous_status: 'in_progress' }`.

Locked decisions recorded in `.planning/STATE.md`:

- Phase 17-01: `"completed_at NOT set on review-flip — Aegis owns the final done transition via runAegisReviews()"`
- Phase 17-01: `"Runner-token revoked atomically at review-flip (not deferred to Aegis-done)"`
- Phase 17-01: `"ALREADY_SETTLED set extends former TERMINAL_STATUSES with 'review' so network-retries after successful 204 submit return 409 without double-broadcasting or double-revoking"`

## Runner-token allowlist (all 7 entries)

> ⚠️ **Pitfall #2 — The runner-token allowlist has SEVEN entries, not six.**
>
> The original comment in `src/lib/runner-tokens.ts` (Phase 11) said `"DO NOT add entries"` — that lock was explicitly revoked for exactly one addition: Phase 15 CP-01 added `POST /api/tasks/:id/checkpoints` as entry #7 so agents could post checkpoints at the literal roadmap path. Subsequent additions would require a specific phase-level CONTEXT.md decision.

All 7 entries, verbatim from [`src/lib/runner-tokens.ts:18–27`](../../src/lib/runner-tokens.ts#L18-L27):

```typescript
export const RUNNER_TOKEN_ALLOWLIST: ReadonlyArray<{ method: string; pathPattern: RegExp }> = [
  { method: 'POST', pathPattern: /^\/api\/runner\/tasks\/(\d+)\/checkpoints\/?$/ },
  { method: 'POST', pathPattern: /^\/api\/runner\/tasks\/(\d+)\/submit\/?$/ },
  { method: 'POST', pathPattern: /^\/api\/runner\/tasks\/(\d+)\/fail\/?$/ },
  { method: 'GET',  pathPattern: /^\/api\/runner\/tasks\/(\d+)\/status\/?$/ },
  { method: 'GET',  pathPattern: /^\/api\/runner\/tasks\/(\d+)\/?$/ },
  { method: 'GET',  pathPattern: /^\/api\/runner\/tasks\/(\d+)\/comments\/?$/ },
  // Phase 15 CP-01: literal roadmap path for agent-authored checkpoints.
  { method: 'POST', pathPattern: /^\/api\/tasks\/(\d+)\/checkpoints\/?$/ },
]
```

Rendered as a 7-row table:

| # | Method | Path | Added in | Purpose |
|---|---|---|---|---|
| 1 | POST | `/api/runner/tasks/:id/checkpoints` | Phase 14 | Runner-scoped checkpoint write (DB + JSONL). |
| 2 | POST | `/api/runner/tasks/:id/submit` | Phase 14 | Agent declares completion; flips `in_progress → review`. |
| 3 | POST | `/api/runner/tasks/:id/fail` | Phase 14 | Agent declares unrecoverable failure. |
| 4 | GET  | `/api/runner/tasks/:id/status` | Phase 14 | Agent polls its own task's status. |
| 5 | GET  | `/api/runner/tasks/:id` | Phase 14 | Agent reads its own task (title, description, metadata). |
| 6 | GET  | `/api/runner/tasks/:id/comments` | Phase 14 | Agent reads its own task's comments. |
| 7 | POST | `/api/tasks/:id/checkpoints` | Phase 15 CP-01 | Literal roadmap path for agent-authored checkpoints (with blocker support). |

> **Anything not on this list will 401** at the auth-layer allowlist guard. In particular:
>
> - `PUT /api/tasks/:id` — NOT on the allowlist. Do not use it.
> - `POST /api/tasks` — NOT on the allowlist. Agents cannot create new tasks.
> - `GET /api/tasks/:id` (without the `/runner/` prefix, other than the checkpoints endpoint above) — NOT on the allowlist. Use `GET /api/runner/tasks/:id` instead.

Also: the auth layer constrains each runner-token to its own task. If the bearer's embedded `task_id` does not match the numeric group in the path (`:id` or `:task_id`), the request returns `403` — you cannot cross-task-write with a runner-token. See [`verifyRunnerToken` in `runner-tokens.ts:76–93`](../../src/lib/runner-tokens.ts#L76-L93).

## Runner-token lifetime

Source: [`issueRunnerToken` in `runner-tokens.ts:38–54`](../../src/lib/runner-tokens.ts#L38-L54).

- **Expiry:** `expires_at = runner_started_at + recipe.timeout_seconds + 60s`.
- **Scope:** One token per attempt (Phase 11-04 token-per-attempt model).
- **Revocation on submit:** The submit route atomically revokes all live tokens for the task inside the same DB transaction as the status flip.
- **Revocation on timeout:** If the container is still running at `expires_at`, the runner SIGKILLs it and the tokens are revoked.
- **Revocation on retry:** A revision request (Aegis `review → assigned` with comments) mints a **new** token for the new attempt; the old attempt's tokens were already revoked at the prior submit.

If your agent sees a `401` on a runner-token-authenticated endpoint that should be on the allowlist, the most likely cause is:

1. You exceeded `recipe.timeout_seconds + 60s` from the moment the container started.
2. The task already transitioned to a terminal state (submit already succeeded; a second submit will 409 not 401 — but any other call will fail the task-status precondition).

## Exit codes

The reference agent uses this exit-code contract. Your agent SHOULD adopt the same codes so the runner's `runner-exit` classifier categorizes failures uniformly.

| Exit code | Meaning |
|---|---|
| `0` | Success. Process completed cleanly after a successful `POST submit`. |
| `1` | `main()` threw (unhandled error). |
| `3` | `POST submit` returned non-2xx (allowlist reject, Zod validation failure, already-settled 409, etc.). |
| `4` | `POST submit` fetch itself threw (network error — `host.docker.internal` unreachable, TCP RST, DNS failure). |

Source: [`docker/hello-world-agent/agent.mjs:91–108`](../../docker/hello-world-agent/agent.mjs#L91-L108) + Phase 14-09 LOCK in `.planning/STATE.md`: `"Agent exit codes classify failure surface — 1=main() throw, 3=POST submit non-2xx response, 4=POST submit fetch threw (network). Runner's runner-exit handler (Plan 14-06) classifies via reason='exit' + exit_code"`.

The runner classifies your exit via [`POST /api/runner/tasks/:id/runner-exit`](../../src/app/api/runner/tasks/%5Btask_id%5D/runner-exit/route.ts) with `reason='exit'` and `exit_code=N`, recording the attempt row. Successful exits (`exit_code=0 && reason='exit'`) do NOT flip `task.status` — the status flip already happened inside your submit POST.

## Resume behavior

On attempts > 1, the runner sets `.mc/task.json.is_resuming = true` and populates `prior_attempts = [{ started_at, exit_code, failure_reason }, …]`. Your agent SHOULD read these fields and read `.mc/progress.md` + `.mc/checkpoints.jsonl` to avoid redoing completed work.

Source: [`runner-preamble.ts:144–183`](../../src/lib/runner-preamble.ts#L144-L183) (resume preamble variant — 6 mandatory first steps + reconciliation rules) + Phase 14-07 LOCK: `"seedMcDir preserves progress.md + checkpoints.jsonl on resume (is_resuming=true); ALWAYS rewrites task.json with new attempt counter + prior_attempts"`.

The runner-authored resume preamble instructs your agent to:

1. Read `.mc/task.json` — attempt counter and `prior_attempts` summary.
2. Read `.mc/progress.md` — append-only work log from prior attempts.
3. Read `.mc/checkpoints.jsonl` — one JSON line per checkpoint.
4. Run `git -C /workspace status` to see uncommitted changes.
5. Run `git -C /workspace log --oneline` to see what was committed previously.
6. Re-read `/recipe/SOUL.md` for the task-specific instructions.

Reconciliation rules from the preamble:

- Trust `git` over `progress.md` when they conflict.
- If a prior attempt committed the deliverable but did not submit, submit now and exit.
- Append new notes under an `## attempt N` header in `progress.md`.

Defensive fallback: if an operator wiped the worktree, `seedMcDir` creates empty placeholder files so your agent's `appendFileSync` call doesn't fail with `ENOENT`.

## Blocker flow

If your agent hits an unrecoverable external dependency (missing credential, service down, human decision required), POST a checkpoint with `status: 'blocked'` and a non-empty `blocker_reason`:

```bash
curl -X POST "$MC_API_URL/api/tasks/$MC_TASK_ID/checkpoints" \
  -H "Authorization: Bearer $MC_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"step":"oauth-redirect","status":"blocked","blocker_reason":"Stripe OAuth consent required from human operator"}'
```

The server atomically transitions the task `in_progress → awaiting_owner`, posts a `system`-authored comment on the task, and broadcasts `task.status_changed` + `task.checkpoint_added`. Your agent should then exit `0` (the attempt succeeded at detecting the blocker — the runner handles the graceful docker stop).

When the human operator resolves the blocker and moves the task back to `assigned`, the runner relaunches your image with `is_resuming = true` and writes a resume marker line inline in `.mc/progress.md`:

```
<iso-timestamp> | <<< RESUMED AFTER BLOCKER: <reason> >>>
```

Source: [`src/app/api/tasks/[id]/checkpoints/route.ts:150–199`](../../src/app/api/tasks/%5Bid%5D/checkpoints/route.ts#L150-L199) + Phase 15-03/15-05/15-07 LOCKS in `.planning/STATE.md`.

The resume marker format is LOCKED (Phase 17-05): any drift breaks the Phase 16 Progress-tab consumer. Agents do NOT write this marker themselves — the runner does it between attempts. Your agent's job on resume is to read the marker and adjust its plan accordingly.

## Drift-guards for agent authors

Quick checklist of "do NOT":

- ❌ Do not use `http://localhost` or `http://127.0.0.1` inside the container. Use `$MC_API_URL` (which resolves to `host.docker.internal`). [Pitfall #5](#container-env-vars)
- ❌ Do not use `fs.writeFileSync` on `/workspace/.mc/progress.md` or `/workspace/.mc/checkpoints.jsonl`. Use `fs.appendFileSync` (or the language equivalent with `O_APPEND`). [Pitfall #10](#progress--checkpoints-append-only)
- ❌ Do not call `PUT /api/tasks/:id`. It is NOT on the runner-token allowlist. Use `POST /api/runner/tasks/:id/submit`. [Allowlist](#runner-token-allowlist-all-7-entries)
- ❌ Do not pass secrets on `docker run` argv. Your container never needs to — the runner composes the env-file for you. [CONTAINER-01](#container-env-vars)
- ❌ Do not assume `submit` finalizes the task. It flips `in_progress → review`. Aegis approves. [Submit lifecycle](#submit-http-endpoint-the-two-hop-lifecycle)
- ❌ Do not hard-code your agent to any specific SDK or framework. The contract is tool-agnostic: HTTP + filesystem + env vars.
- ❌ Do not edit `/workspace/.mc/task.json`. It is runner-owned and rewritten on every claim.
- ❌ Do not overwrite `/recipe/PREAMBLE.md` from inside the container. It is read-only (the `/recipe` mount is `ro`).
- ❌ Do not log `$MC_API_TOKEN` or echo it into a shell command line.
- ❌ Do not rely on the 6-entry version of the allowlist. The shipped list has **seven** entries.

## Reference image

The canonical worked example is [`docker/hello-world-agent/`](../../docker/hello-world-agent/). It exercises every step of this contract — env snapshot, preamble read, progress/checkpoint append, git commit, submit POST, exit 0 — without calling any external model provider. Pure substrate verification.

Build:

```bash
pnpm mc:build-hello-world
# OR
bash docker/hello-world-agent/build.sh
```

Either command runs `docker build -t mc-hello-world-agent:latest .` locally. No registry push.

The reference image is also what Phase 14-10's smoke harness runs end-to-end against a live Mission Control + runner to prove the full pipeline (claim → docker run → checkpoint → submit → review) stays green.

When in doubt, **copy the reference image's structure and swap out step 5** (the task's real work) for whatever your recipe needs to do. The other six steps are the contract.

## Related docs

- [recipes.md](recipes.md) — how to declare a recipe that uses your image (recipe.yaml schema, indexing, `max_attempts`, secrets list, model registry).
- [runner-daemon.md](runner-daemon.md) — what launches your image: boot sequence, env vars, exit codes, LaunchAgent install, log layout.
- [admin-config.md](admin-config.md) — `runtime.*` settings, `mount_allowlist`, `project_repo_map`, secrets store, auth tiers.
- [task-board-surfaces.md](task-board-surfaces.md) — how your checkpoints and submit events surface in the operator UI (Progress tab, RunnerStatusBanner, RecipeBadge).
- [getting-started.md](getting-started.md) — end-to-end walkthrough from `pnpm install` to a task transitioning to `done`.
- [INDEX.md](INDEX.md) — map of all runtime docs with a pipeline sequence diagram.
