---
name: Phase 12 Context
description: User decisions for Recipe System implementation — error surface, search ranking, POST semantics, watcher behavior
phase: 12
status: ready-for-planning
gathered: 2026-04-19
---

# Phase 12: Recipe System — Context

**Gathered:** 2026-04-19
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase delivers the filesystem-authored recipe system:

- Recipe directories under `recipes/<slug>/` containing `recipe.yaml` + `SOUL.md` (plus optional `tools/`, `skills/`, `README.md`) are indexed into the `recipes` SQLite table (created in Phase 11, migration 054).
- A chokidar-based filesystem watcher reacts to add/change/unlink/rename events under `recipes/` and reconciles the DB against the filesystem using `dir_sha` content hashing for dedup.
- REST API exposes list, fetch-by-slug, search, create (POST), and admin resync endpoints.
- `model.primary` in `recipe.yaml` is validated against the code-seeded model registry (Phase 11's `src/lib/model-registry.ts`) at index time; invalid models fail indexing with a visible error.

**Out of scope (future phases):**
- Recipe UI (badges, list panel, dropdown) — Phase 16.
- Task-side `recipe_slug` wiring and mount allowlist — Phase 13.
- Claim-time model resolution from `task.model_override ?? recipe.model.primary` — Phase 14.
- Embedding-based semantic search — deferred past v1.2 (RECIPE-08 explicitly calls for SQL matching only).

</domain>

<decisions>
## Implementation Decisions

### Error visibility & validation failure
- Broken recipes get a **DB row with `error_message` column populated** (other domain columns NULL or defaulted). `recipes` table from Phase 11 migration 054 needs an additive migration in this phase to add the `error_message` column.
- A recipe with invalid YAML, missing required fields, or unknown `model.primary` is **skipped (no full index) but a minimal error row is written**: `slug` + `error_message` + timestamp. `GET /api/recipes/:slug` returns `{ slug, error_message }` for broken recipes.
- **Hard fails that block indexing** (produce error rows):
  - Unparseable `recipe.yaml` (YAML syntax error)
  - Missing required fields: `slug`, `name`, `image`, `workspace_mode`, `model.primary`
  - `model.primary` not in `src/lib/model-registry.ts` (MODEL-02)
- **Soft cases that still index normally**:
  - Missing `SOUL.md` (indexed with empty `soul_md` body)
  - Missing optional `README.md`, `tools/`, `skills/`
- Indexer logs failures at **error level** via pino with `{ recipe_slug, path, reason }` — one line per failure; no stack traces.

### Search ranking (RECIPE-08)
- **SQLite FTS5 virtual table** over `(name, description, when_to_use, tags)` columns, synced with the `recipes` table via triggers or explicit upserts from the indexer.
- Ranking: FTS5's built-in `rank` (BM25 variant). **Tags weighted 2× over description** — use FTS5 column weights in the query to boost tag matches.
- Query input: **single freeform `?q=...` string, auto-tokenized on whitespace** inside the server. Matches how Hermes will pass raw task descriptions.
- **Empty `q` → list all** (equivalent to `GET /api/recipes`). Tokens shorter than 2 chars dropped. No custom stop-word list — FTS5 defaults are acceptable.
- Broken recipes (those with `error_message`) are **excluded from search results** by default; consider adding `?include_broken=true` for admin debugging (Claude's discretion).

### POST /api/recipes semantics
- **Authorization:** admin role required for both `POST /api/recipes` and `POST /api/recipes/resync`. Runner and runner-token principals cannot call these. Tighten from Hermes-or-operator language in success criterion 4 — admin is the safer default for v1.2; Hermes gets its own admin key if/when needed.
- **Slug conflict:** if `recipes/<slug>/` already exists on disk (or an active non-error row exists in DB), respond **`409 Conflict` with no write**. Caller must pick a different slug or explicitly delete the old recipe first (deletion endpoint is not in scope for this phase — filesystem `rm -rf` + watcher is the current story).
- **Atomicity (disk-first, index-second, rollback on index fail):**
  1. Write files into a temporary directory outside `recipes/`.
  2. `rename()` the temp directory to `recipes/<slug>/` (atomic on same filesystem).
  3. Compute `dir_sha`, insert/upsert the DB row.
  4. If index fails: `rm -rf recipes/<slug>/`, return 500 with error.
- The watcher will still catch any straggler state if rollback itself fails — reconciliation is idempotent.
- **Request body:** JSON `{ slug: string, recipe_yaml: string, soul_md: string }`. Server writes files **verbatim** (does not parse + re-serialize). Schema validation runs on the parsed YAML before write; errors return 400 with field-level detail.

### Watcher boot + debounce behavior
- **Eager full-scan on boot before the server accepts traffic.** Scan `recipes/`, reconcile against DB: insert new, update changed by `dir_sha` mismatch, drop rows for missing directories. Blocks `/api/ready` (or equivalent readiness check). Acceptable latency for <100 recipes.
- **Per-recipe debounce of 250ms.** Rapid `change`/`add` events for the same recipe slug collapse to one re-index. Protects against editor save bursts and atomic-rename patterns.
- **Atomic-rename handling:** watch only the known recipe filenames (`recipe.yaml`, `SOUL.md`, `tools/**`, `skills/**`, `README.md`). Ignore temp/swap files (`.swp`, `~`, `.tmp`). 250ms debounce window ensures reads happen after the file is settled. If `chokidar.awaitWriteFinish` is needed as a fallback, use it with `stabilityThreshold: 200ms, pollInterval: 50ms` — planner decides which approach is cleaner in code.
- **`POST /api/recipes/resync` is synchronous.** Returns `{ scanned, inserted, updated, deleted, errors: [{slug, reason}] }` after the scan completes. Document the expectation that this is an admin recovery tool — not for hot paths. No async job infrastructure for v1.2.

### `dir_sha` scope (derived)
- `dir_sha` is computed over `recipe.yaml` + `SOUL.md` + recursive contents of `tools/` and `skills/` + `README.md`. Hash algorithm: SHA-256 of a deterministic concatenation (sorted file paths relative to the recipe root, each followed by its content). Implementation detail — planner decides exact serialization.

### Claude's Discretion
- Exact SQL/migration approach for the `error_message` column and FTS5 virtual table (additive migrations with IDs after 057 — follow the "next sequential block" pattern from Phase 11-03).
- Whether to build FTS5 sync via SQLite triggers or explicit upserts from the indexer.
- Chokidar config internals: `ignoreInitial` vs explicit initial scan loop, `persistent: true`, `ignored` pattern.
- Error-row shape beyond `slug` + `error_message` + timestamp — whether to also null-default or just leave NULL.
- File-level utilities (temp-dir creation, rename helper, rollback helper) — standard Node `fs.promises` patterns.
- Exact pino logger namespace for the indexer.

</decisions>

<specifics>
## Specific Ideas

- **The `recipes` table from Phase 11 migration 054 needs an additive migration in this phase** to add `error_message TEXT` (nullable). Use the next sequential migration ID after `057_tasks_runtime_columns` (so `058_recipes_error_message` or similar). This is a known implementation fact, not a scope change.
- **FTS5 virtual table is a second migration** in this phase — it's the backing store for search, not an optimization. Likely named `recipes_fts` with content rowid tied to `recipes.id` (or slug-keyed — planner decides).
- **Admin-only gate** uses the existing `requireRole('admin')` pattern (see Phase 11 `src/lib/auth.ts`).
- **Model registry validation** imports `isKnownModel` from Phase 11's `src/lib/model-registry.ts` (the runtime contract established in plan 11-01).
- **Recipe schema (`recipe.yaml`)** fields per REQUIREMENTS.md: `slug`, `name`, `description`, `when_to_use`, `image`, `workspace_mode`, `timeout_seconds`, `max_concurrent`, `env` (object), `secrets` (array of names, not values), `tags` (array), `model` (`{primary, fallback?, provider?, params?}`), `version`.
- **Secrets:** `secrets` in `recipe.yaml` is treated as an array of **env var names only** — the recipe declares what secrets it needs; actual values come from process env at claim time (Phase 14). Secrets are NOT stored as values in the DB.

</specifics>

<deferred>
## Deferred Ideas

- Recipe UI (list panel, badges, dropdown) — Phase 16.
- Task-side integration (`recipe_slug` on tasks, mount allowlist, workspace_source validation) — Phase 13.
- Claim-time model resolution and container env wiring (MC_MODEL_*) — Phase 14 / MODEL-04.
- Embedding-based semantic search — deferred past v1.2.
- DELETE /api/recipes/:slug — not in scope; deletion happens via filesystem + watcher for v1.2.
- Per-recipe admin keys for Hermes (instead of the shared admin role) — revisit if/when Hermes is wired up.
- Async resync job with progress streaming — revisit if recipe count grows past ~100 or boot scan becomes slow.
- Recipe versioning via explicit versioned slugs — out of scope; `version` field is metadata only in v1.2.

</deferred>

---

*Phase: 12-recipe-system-v1-2*
*Context gathered: 2026-04-19*
