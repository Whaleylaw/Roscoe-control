# Phase 11: Runtime Foundation - Context

**Gathered:** 2026-04-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 11 delivers the **substrate** that every later v1.2 phase depends on. No runtime code, no UI, no behavior changes for existing users.

In scope:
- DB migrations: new tables `recipes`, `task_runner_tokens`, `task_checkpoints`; additive columns on `tasks` (`recipe_slug`, workspace/mounts/skills JSON, `model_override`, `container_id`, `runner_started_at`, `runner_exit_code`, `worktree_path`, `runner_attempts`, `runner_max_attempts`, `runner_last_failure_reason`)
- Typed model registry module at `src/lib/model-registry.ts` seeded with Opus 4.7, Sonnet 4.6, Haiku 4.5
- Two new auth principals: `runner` (via `.data/runner.secret`, `/api/runner/*` only) and `runner-token` (per-task, per-attempt, SHA-256 hashed at rest)
- Validation: reject task creation when `model_override` is not in the registry
- Revocation: terminal task status flips `revoked_at` on the token row

Out of scope (other phases):
- Recipe watcher / indexer / API (Phase 12)
- Task runtime context validation and mount allowlist (Phase 13)
- Runner daemon / container execution (Phase 14)
- Checkpoint writer and scheduler integration (Phase 15)
- Any UI surfaces (Phase 16)

</domain>

<decisions>
## Implementation Decisions

### Runner Secret Lifecycle
- **Bootstrap:** Auto-generate on boot when `.data/runner.secret` is missing. Match the existing AUTH_SECRET / API_KEY pattern in `src/lib/auth.ts` — 32+ random bytes, persist with 0600 perms, zero-config for operators and Docker.
- **Rotation:** Delete-and-regenerate on restart. Document it; do not build dual-secret/versioning tooling in this phase.
- **Scope:** Strictly `/api/runner/*`. The `runner` principal authenticates nothing else — enforce via a hard path-prefix check in the auth resolver. A request presenting `runner.secret` against any other path MUST reject.
- **Audit logging:** Log `{principal: 'runner', path, method, ts}` on successful auth. Never log the secret value or any fingerprint/hash prefix. Match existing auth logging posture.

### Model Registry
- **Source:** Code-seeded, immutable at runtime. `src/lib/model-registry.ts` exports a typed const map. Adding a model is a PR. No config-file override, no JSON merge file.
- **Aliases:** None in v1.2. Exact identifiers only — callers (recipes, task_override) must pin specific versions like `claude-opus-4-7`, `claude-sonnet-4-6`, `claude-haiku-4-5-20251001`. Reconsider only if real user friction appears.
- **Lookup API:** `getModel(id): Model | null`. Caller produces its own contextual error. No throwing, no Result<T, E> pattern.
- **Metadata fields per entry (exactly these, nothing more):** `{provider, context_window, output_tokens_max, supports_tools, supports_thinking}`. Do NOT add pricing, display_name, or doc_url yet — defer to the phase that actually needs them.

### Runner-Token Semantics
- **In-flight behavior on revocation:** Check `revoked_at` at request arrival (in auth middleware). Requests that authenticate successfully proceed to completion. Requests arriving after `revoked_at` is set reject with 401/403. No ActiveController cancellation, no grace window.
- **Revocation trigger:** Atomic. Wherever the code transitions a task to a terminal status (`done`, `failed`, `cancelled`, etc.), the same transaction MUST set `revoked_at = now()` on the matching `task_runner_tokens` row. No background sweeper, no lazy-on-reuse.
- **RAUTH-06 allowlist (enforced in `auth.ts`):** When presenting a `runner-token`, only these endpoints are reachable; middleware rejects anything else with 403:
  - `POST /api/runner/tasks/:id/checkpoints`
  - `POST /api/runner/tasks/:id/submit`
  - `POST /api/runner/tasks/:id/fail`
  - `GET /api/runner/tasks/:id/status` (scoped)
  - `GET /api/runner/tasks/:id` (read own task)
  - `GET /api/runner/tasks/:id/comments` (read own task comments)
  - Path `:id` MUST match the token's embedded `task_id` — cross-task access blocked.
- **Token wire format:** Opaque random bearer. Generate ≥32 random bytes, base64url-encode, present via `Authorization: Bearer <token>`. The DB row stores SHA-256(token) → `{task_id, attempt, expires_at, revoked_at}`. No JWT, no prefixed/parseable format.
- **Expiry:** `runner_started_at + recipe.timeout_seconds + 60s` (per RAUTH-02).

### Migrations
- **Trigger:** Auto-run on boot, same as existing `src/lib/migrations.ts` pattern. All changes are additive (new tables, new nullable columns) so risk is low. No `MC_RUN_V12_MIGRATIONS` flag.
- **Granularity:** One migration per logical group. Expected groupings:
  - `recipes` table (+ its indexes)
  - `task_runner_tokens` table (+ its indexes)
  - `task_checkpoints` table (+ its indexes)
  - Additive columns on `tasks` grouped by concern: recipe/workspace (`recipe_slug`, workspace/mounts/skills JSON, `model_override`); runner execution state (`container_id`, `runner_started_at`, `runner_exit_code`, `worktree_path`); runner attempt tracking (`runner_attempts`, `runner_max_attempts`, `runner_last_failure_reason`)
  - Planner may adjust grouping to match existing migration style, but no single monolithic migration and no file-per-column.
- **Backfill:** None. Every new column is nullable or has a sensible default. Existing tasks predate the runner concept and stay with NULL for runner fields. Downstream code must treat NULL as "never ran under runner."
- **Rollback:** Migration runner takes a `.bak` of the SQLite file before applying (match existing practice). No paired `down` scripts. If an upgrade fails, restore the `.bak` and forward-fix the migration.

### Claude's Discretion
- Exact column types and index choices within SQLite (better-sqlite3 conventions).
- Internal shape of the `Model` TypeScript type and naming within `src/lib/model-registry.ts`.
- File layout for token-related helpers (e.g., whether `runner-token` lives in `src/lib/auth.ts` or a new `src/lib/runner-auth.ts`).
- Test structure and coverage strategy (Vitest, matching current `src/lib/__tests__/` conventions).
- Precise error message copy for `model_override` rejection, as long as it references the registry and is unambiguous (next-intl wrapping only if a user-facing surface actually renders it — this phase has no UI).
- `.data/runner.secret` file permissions and on-disk encoding (hex/base64/raw), as long as 0600 and >=32 bytes entropy.

</decisions>

<specifics>
## Specific Ideas

- Stay consistent with the current `AUTH_SECRET` / `API_KEY` auto-generation UX. Operators should not need to create files manually; Docker zero-config must keep working.
- All three Claude models seeded in the registry MUST use the exact identifiers matching the current fleet: `claude-opus-4-7`, `claude-sonnet-4-6`, `claude-haiku-4-5-20251001`.
- The `runner-token` endpoint allowlist is a locked, short list (the six endpoints above). Any proposed addition is out of scope for Phase 11 — route it to the phase that needs it (14/15).
- Migration file naming should follow whatever convention already exists in `src/lib/migrations.ts`; do not introduce a new scheme.

</specifics>

<deferred>
## Deferred Ideas

- **Registry override file** — `.data/model-registry.override.json` merge behavior. Revisit when a concrete use case (e.g., private model deployment) appears.
- **Friendly model aliases** — `opus` → latest Opus, etc. Revisit if operators complain about pinning specific versions.
- **Pricing / display_name / doc_url on registry entries** — fold into the phase that renders or bills (cost tracker or Phase 16 UI).
- **Dual-secret rotation window** — implement only if runner-secret rotation becomes a recurring operational need.
- **Active cancellation of in-flight runner-token requests** — add if/when the runner daemon (Phase 14) shows real need to preempt work.
- **Explicit up/down migration pairs** — revisit if we ever have a destructive migration; additive-only doesn't need them.

</deferred>

---

*Phase: 11-runtime-foundation-v1-2*
*Context gathered: 2026-04-18*
