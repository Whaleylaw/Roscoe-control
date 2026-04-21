# Phase 13: Task Runtime Context - Context

**Gathered:** 2026-04-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Task create/update API accepts new runtime-context fields — `recipe_slug`, `workspace_source`, `read_only_mounts`, `extra_skills`, `model_override` — and validates them at write time:

- `recipe_slug` must reference an indexed recipe row
- `workspace_source` ({ project_id, base_ref }) is required when the referenced recipe declares `workspace: worktree`
- Every user-supplied `host_path` (read-only mounts and extra skills) is checked against the runner's `mount_allowlist` after symlink resolution
- `model_override` must exist in the model registry

No UI work in this phase — task form changes ship in Phase 16. No runner behavior in this phase — that ships in Phase 14.

</domain>

<decisions>
## Implementation Decisions

### Validation error shape
- **Aggregated errors** in a single `400 Bad Request` response. Body: `{ errors: [{ field, code, message, hint }] }`. All validation failures collected and returned together so callers can fix everything in one retry.
- **HTTP 400** across the board (matches existing `validateBody` pattern in MC API routes; do not introduce 422).
- **Actionable hint on every error** (e.g., `"host_path '/foo' not in allowlist. Allowed prefixes: ['/Users/x/repos', '/opt/refs']"`).
- **Echo offending host_path in full** in allowlist errors. Single-tenant authenticated callers — debugging value outweighs leakage risk.
- Error code vocabulary and exact field path strings are planner-discretion.

### Mount allowlist source & timing
- **Source of truth: settings table in DB.** Admin-mutable at runtime; survives restarts; both API validation and (Phase 14) runner re-validation read from the same place.
- **Empty allowlist → reject all mounted-anything.** Tasks without any mounts/skills still succeed. Tasks with mounts return a distinct error (`code: ALLOWLIST_EMPTY` or similar) hinting the admin to configure allowlist in settings. No "tolerant" bypass mode.
- **Symlink resolution at task creation AND at runner claim.** API runs `fs.realpath` on each host_path and validates the resolved path against the allowlist; Phase 14's runner re-validates as defense-in-depth.
- **Existence check NOT enforced at task creation.** API validates allowlist membership only. Path may not yet exist at write time (e.g., a worktree target). Runner is the canonical existence check at claim time.
- The shape and admin auth model of the settings endpoint that mutates `mount_allowlist` is planner-discretion.

### Field shape: read_only_mounts / extra_skills / workspace_source
- **`read_only_mounts`**: every entry is `{ host_path, container_path, label }` with all three required. `label` must be unique per task. Used by Phase 14 runner to mount at `/refs/<label>/` (per existing recipe spec).
- **`extra_skills`**: list of host paths only. Each path must be a directory; mounted at `/skills/<basename>` in the container. (Single-file skills not supported; users wrap in a directory.) Basename collisions across multiple `extra_skills` on the same task are rejected at creation as duplicate.
- **`workspace_source.base_ref`**: accepts any git-ref-resolvable string — branch name, tag, SHA, or `HEAD`. API does light syntactic validation only (non-empty, no whitespace, no `..`). The runner resolves the ref against the actual repo at claim.
- **Per-task hard caps** with sane defaults, configurable via the same settings table that holds `mount_allowlist`. Defaults: planner-discretion, but in the ballpark of `read_only_mounts ≤ 10`, `extra_skills ≤ 20`. Exceeding cap returns a validation error in the aggregated payload.

### Recipe binding mutability
- **`recipe_slug` is mutable via PATCH while the task is pre-dispatch** (i.e., before status enters `assigned` or any later state). Once assigned/claimed/in-flight, `recipe_slug` is immutable; PATCH attempts return a clear error.
- **PATCH that creates a workspace_source gap is rejected.** If the new `recipe_slug` points at a `workspace: worktree` recipe and the task has no `workspace_source` (and the PATCH doesn't supply one), reject with `{ field: 'workspace_source', code: 'REQUIRED_BY_RECIPE', message: '...', hint: 'Supply workspace_source in the same PATCH.' }`. Atomic edits required — no partial/blocked intermediate state.
- **Existing `model_override` / `read_only_mounts` / `extra_skills` are preserved across recipe changes** and re-validated against the new context (model registry unchanged, allowlist unchanged). If anything is now invalid, the PATCH fails with the standard aggregated error payload — no auto-clearing, no silent dropping.
- **Recipe row is read on every task create/update** to gate `workspace_source` requirement. Single SELECT by slug; cost is negligible. No snapshot of `recipe_workspace_mode` on the task — always read live so a recipe-mode change is reflected immediately.

### Claude's Discretion
- Exact Zod schemas, error code enum vocabulary, and field path strings in error payloads
- Default cap values for `read_only_mounts` and `extra_skills`
- Settings endpoint shape for editing `mount_allowlist` and caps (admin auth model deferred to existing role machinery in `src/lib/auth.ts`)
- Whether path-prefix matching uses exact-match-with-trailing-slash or subtree-of semantics — pick the standard library convention
- Whether case sensitivity matters on macOS — default to filesystem-default behavior

</decisions>

<specifics>
## Specific Ideas

- Aggregated-error pattern in the task API should mirror what `validateBody` already returns elsewhere in `src/app/api/` — keep consumers uniform.
- `mount_allowlist` settings entry should be the same source consulted by Phase 14's runner re-validation, so the API can reuse a shared helper module.
- `extra_skills` directory mount convention (`/skills/<basename>`) intentionally mirrors the Claude Code skill convention — directory with `SKILL.md` inside.

</specifics>

<deferred>
## Deferred Ideas

- **Settings UI for editing `mount_allowlist` and per-task caps** — Phase 16 (UI surfaces) or later. This phase only needs the settings storage + API surface.
- **Per-recipe model-override allow-list** (e.g., recipe restricts which model_overrides are valid for it) — not in scope; current decision is "any model in registry is acceptable as override."
- **Container-path collision detection across mounts vs recipe-declared mounts** — runner concern (Phase 14), not validated at task creation.
- **Audit trail for mount_allowlist edits** — settings/audit feature, not part of this phase.

</deferred>

---

*Phase: 13-task-runtime-context-v1-2*
*Context gathered: 2026-04-19*
