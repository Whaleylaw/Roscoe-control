# Task-Board Runtime Surfaces

**Source of truth:**
- [`src/components/panels/task-card/recipe-badge.tsx`](../../src/components/panels/task-card/recipe-badge.tsx)
- [`src/components/panels/runner-status-banner.tsx`](../../src/components/panels/runner-status-banner.tsx)
- [`src/components/panels/task-detail/progress-tab.tsx`](../../src/components/panels/task-detail/progress-tab.tsx)
- [`src/components/panels/task-form/recipe-combobox.tsx`](../../src/components/panels/task-form/recipe-combobox.tsx)
- [`src/components/panels/recipes-panel.tsx`](../../src/components/panels/recipes-panel.tsx)
- [`src/app/api/runtime/runner-status/route.ts`](../../src/app/api/runtime/runner-status/route.ts)
- [`src/lib/model-tier-colors.ts`](../../src/lib/model-tier-colors.ts)

**Who reads this:** Operators who need to understand what each v1.2 runtime UI element on the task board means, what data backs it, and what its visible states are telling them.

**Prerequisites:**
- Mission Control running (see [`docs/quickstart.md`](../quickstart.md)).
- Viewer-tier auth is sufficient for every surface on this page EXCEPT the Recipes panel's "Resync" action, which requires admin tier (see [`docs/runtime/admin-config.md`](./admin-config.md)).
- A running runner daemon is NOT required to inspect these surfaces, but the RunnerStatusBanner and the Progress tab will only show live activity once one is present (see [`scripts/README.runner.md`](../../scripts/README.runner.md)).

**Map:**

| Section | Anchor |
|---|---|
| RecipeBadge | [#recipebadge](#recipebadge) |
| RunnerStatusBanner | [#runnerstatusbanner](#runnerstatusbanner) |
| Progress tab | [#progress-tab](#progress-tab) |
| RecipeCombobox | [#recipecombobox](#recipecombobox) |
| Advanced section (mounts + skills + model override) | [#advanced-section-mounts--skills--model-override](#advanced-section-mounts--skills--model-override) |
| Recipes panel | [#recipes-panel](#recipes-panel) |
| Blocker-flow UX | [#blocker-flow-ux](#blocker-flow-ux) |
| RECIPE_LOCKED client-side gate | [#recipe_locked-client-side-gate](#recipe_locked-client-side-gate) |
| Event wiring | [#event-wiring](#event-wiring) |
| Related docs | [#related-docs](#related-docs) |

Each surface subsection below follows the same four-part layout: **What it is / Visible states / Data source / Operator signals.**

---

## RecipeBadge

**What it is.** A compact chip rendered on every Kanban task card whenever `task.recipe_slug` is set. It is also shown in the task-detail modal header. The chip identifies which recipe will run (or did run) for the task and uses color to signal the recipe's primary model tier. When `recipe_slug` is null, the badge does not render and the task card is visually identical to the pre-Phase-16 layout (no flex-row shift).

**Visible states.**

| State | Appearance | Meaning |
|---|---|---|
| Rendered — cache hit | Friendly recipe name (e.g., `Hello World Agent`) + colored pill tone keyed to tier | Recipes cache populated; tier resolved from `recipe.model.primary` |
| Rendered — cache miss | Raw slug literal (e.g., `hello-world`) + neutral muted pill | Recipes cache not yet hydrated, or SSE reconnect in flight. Returns to the friendly-name branch on the next render after `refreshRecipes()` completes |
| Not rendered | — | `task.recipe_slug` is `null` / `undefined` — this is a non-recipe task |

The model-tier colors come from [`src/lib/model-tier-colors.ts`](../../src/lib/model-tier-colors.ts) via `modelTierClassName(tier)`:

| Tier | Palette (Tailwind classes) |
|---|---|
| `opus` | `bg-purple-500/20 text-purple-400 border-purple-500/30` |
| `sonnet` | `bg-blue-500/20 text-blue-400 border-blue-500/30` |
| `haiku` | `bg-green-500/20 text-green-400 border-green-500/30` |
| `unknown` | `bg-muted/20 text-muted-foreground border-muted/30` |

Tier is inferred via case-insensitive substring match on the recipe's `model.primary` value (`modelToTier()`): anything containing `opus`/`sonnet`/`haiku` maps to that tier; everything else maps to `unknown` and renders with the neutral muted palette.

**Data source.**
- The recipe name comes from the Zustand `recipes` slice (seeded on boot; refreshed via `mc:recipe-indexed` / `mc:recipe-removed` `CustomEvent`s relayed by [`src/lib/use-server-events.ts`](../../src/lib/use-server-events.ts)).
- The tier color derives from `recipe.model.primary` via `modelToTier(...)` and `modelTierClassName(...)` in [`src/lib/model-tier-colors.ts`](../../src/lib/model-tier-colors.ts).
- The chip is a read-only consumer — it does not fetch, and it does not own the refresh lifecycle.

**Operator signals.**
- If you see the raw slug on a task that should have a friendly name, the recipes cache has not hydrated yet — wait one SSE cycle or reload.
- If the tier dot is muted on a recipe you know uses Opus/Sonnet/Haiku, double-check that `recipe.model.primary` in `recipe.yaml` actually contains the family name; see [`docs/runtime/recipes.md`](./recipes.md).
- `data-testid="recipe-badge"` — added in Phase 18-02 (commit `96c57d9`) so Playwright can target the badge without depending on recipe name text. E2E tests use the `locator('[data-testid="recipe-badge"]').or(locator('text=/…/i'))` pattern: testid first, text fallback second.

Cite: [`src/components/panels/task-card/recipe-badge.tsx`](../../src/components/panels/task-card/recipe-badge.tsx), [`src/lib/model-tier-colors.ts`](../../src/lib/model-tier-colors.ts).

---

## RunnerStatusBanner

**What it is.** A sticky ambient banner that renders inside the task-board panel — between the panel header and the Kanban columns. It tells operators at a glance whether a runner daemon is currently reachable and, when it is not, how many recipe-tagged tasks are waiting to be claimed. The banner is scoped to the task board only; it is NOT mounted in the global header or global layout (a Phase 16-03 LOCKED decision — ambient UI lives where it's relevant).

It is mounted from [`src/components/panels/task-board-panel.tsx`](../../src/components/panels/task-board-panel.tsx) at roughly line 1001, between the error region and the Kanban grid.

**Visible states (three render branches).**

| State | Appearance | Meaning |
|---|---|---|
| Loading | null-render (nothing painted) | First fetch in flight; avoids visible flicker on every mount |
| OK — online | `🟢 Runner online` (green pill) | A heartbeat row has been updated in the last `STALE_WINDOW_SECS` seconds |
| OK — offline | `🔴 Runner offline — tasks waiting: N` (red pill) | No fresh heartbeat, AND `N` recipe-tagged tasks are queued in the caller's workspace |
| Error | Muted "Runner status unavailable" pill | `/api/runtime/runner-status` returned 500 or the network failed. The banner never throws and never blocks the board |

**How "online" is computed.** The endpoint [`src/app/api/runtime/runner-status/route.ts`](../../src/app/api/runtime/runner-status/route.ts) returns `online: true` if any row in `runner_heartbeats` has `last_heartbeat_at >= now - STALE_WINDOW_SECS`. The constant is set to `90` — **90 seconds** — matching the stale window used by `task-dispatch.ts`, `/api/runner/inventory`, and `runner-reconcile.ts` per the Phase 15-06 LOCKED decision (three reconcile ticks at 30s each).

> **⚠️ PITFALL — `🟢 Runner online` does NOT mean Docker is reachable.**
>
> The banner reports heartbeat freshness within 90 seconds, not end-to-end runner health. A runner that exits with code 2 (Docker daemon unreachable — see [`scripts/README.runner.md#troubleshooting`](../../scripts/README.runner.md#troubleshooting)) and is respawned by LaunchAgent every 30 seconds will still `UPSERT` a heartbeat row on each boot. During the 90-second stale window the banner will continue to show `🟢 Runner online` even though no task can actually dispatch — the runner never gets far enough past boot to `docker run` a container.
>
> **If recipe-tagged tasks appear stuck in `assigned` status despite a green banner:**
> 1. Tail `.data/runner/daemon.err` — look for Docker-unreachable errors and exit code 2.
> 2. Cross-reference [`scripts/README.runner.md#troubleshooting`](../../scripts/README.runner.md#troubleshooting).
> 3. Confirm `docker info` succeeds in the same shell the runner runs under.
>
> The banner is a liveness probe, not a health check. Treat a green dot as "a runner process wrote a heartbeat recently," not as "Docker works right now."

**Data source.**
- Endpoint: `GET /api/runtime/runner-status` (viewer-tier auth; session cookie, API key, or proxy auth).
- Poll cadence: `POLL_INTERVAL_MS = 10_000` (10 seconds).
- SSE-driven nudge: three runtime CustomEvents relayed by [`src/lib/use-server-events.ts`](../../src/lib/use-server-events.ts) trigger a debounced re-fetch with `REFRESH_DEBOUNCE_MS = 1_000` (1 second) — `mc:task-container-started`, `mc:task-container-exited`, and `mc:task-runner-requested`. That coalesces bursts of SSE events into a single follow-up fetch.
- Response shape: `{ online: boolean, last_heartbeat_at: number | null, tasks_waiting: number }`.
- `tasks_waiting` is workspace-scoped via `auth.user.workspace_id`. Multi-workspace installs see per-workspace counts; the heartbeat itself is global (any fresh heartbeat anywhere → online from every workspace's perspective).

**Operator signals.**
- `🟢` with `tasks_waiting = 0` — runtime is idle. Nothing actionable.
- `🔴` with a nonzero `tasks_waiting` — the runner is (or is treated as) offline and work is queued. Start the runner, or see [`scripts/README.runner.md`](../../scripts/README.runner.md).
- Muted "Runner status unavailable" — check the Mission Control logs; the endpoint returned 500. The board stays usable.
- Accessibility: `role="status"` + `aria-live="polite"` on the wrapper. State transitions announce to screen readers without stealing focus.

Cite: [`src/app/api/runtime/runner-status/route.ts`](../../src/app/api/runtime/runner-status/route.ts) (`STALE_WINDOW_SECS`, fresh-heartbeat query, workspace-scoped waiting count) and [`src/components/panels/runner-status-banner.tsx`](../../src/components/panels/runner-status-banner.tsx) (the three render branches + SSE debounce + polling interval).

---

## Progress tab

**What it is.** A new tab added by Phase 16 to the task-detail modal. It renders a live, attempt-grouped checkpoint timeline for the task — newest checkpoint first, newest attempt first. Every time an agent posts a checkpoint to `POST /api/tasks/:id/checkpoints` the tab updates in place; no reload is required.

The tab label is sourced from `progressT('tabLabel')` against the `taskBoard.progressTab.tabLabel` i18n namespace — seeded across 10 locales in Phase 16-01.

**Visible states.**

| State | Appearance | Meaning |
|---|---|---|
| Loading | Spinner + `taskBoard.progressTab.empty` message while the initial fetch is in flight | First `GET /api/tasks/:id/checkpoints` in progress |
| Empty | `taskBoard.progressTab.empty` message | Fetch returned zero checkpoints |
| Populated | Attempt groups, newest attempt expanded by default, older attempts collapsed with count | Checkpoints present |
| Error | `taskBoard.progressTab.loadError` | Fetch failed. Retry by closing and reopening the tab |

Within each attempt group, each checkpoint row shows:
- `step` (short slug)
- `status` — one of `in_progress | blocked | done`
- `summary`
- `artifacts[]` — typed as `file | url | diff | test_result | comment | other` (CP-05). Each artifact renders with a type-specific emoji marker and an optional path / url / ref / summary
- `tokens_used`
- `duration_ms`

Blocker checkpoints (`status: 'blocked'`) render with a prominent red badge and surface `blocker_reason` verbatim. See [#blocker-flow-ux](#blocker-flow-ux) below.

**Data source.**
- Initial fetch: `GET /api/tasks/:id/checkpoints` on mount.
- Live updates: `mc:task-checkpoint-added` CustomEvent (relayed from the SSE dispatcher in [`src/lib/use-server-events.ts`](../../src/lib/use-server-events.ts), filtered by `event.detail.task_id`).
- De-dupe: a `Map<number, Checkpoint>` keyed by checkpoint `id` handles SSE-replays + fetch-after-mount overlap without sort-on-every-push. Subscribe-before-fetch via `useEffect` declaration order guarantees events that fire during the initial GET are queued rather than dropped (Pitfall 6 LOCK).
- Auto-scroll: smooth-scrolls the list to the top whenever `checkpoints.size` increases UNLESS `userScrolledUpRef.current` is `true` (the user has scrolled >16 px from the top). Returns to anchored-top automatically once the user scrolls back up. This is the LOCKED anchored-unless-user-scrolled behavior from Phase 16-04.

**Operator signals.**
- An attempt that ends with a `status: 'done'` checkpoint has handed off to the submit endpoint. **The task does NOT flip straight to `done`** — see the cross-reference below.
- A red blocker badge means the agent could not complete the task and the operator must intervene — see [#blocker-flow-ux](#blocker-flow-ux).
- Repeated attempts visible in older groups typically mean the runner retried after a non-zero exit (up to `recipe.max_attempts`, filesystem-only — see [`docs/runtime/recipes.md`](./recipes.md)).

**Cross-reference — submit → review is a two-hop transition.**
When the Progress tab shows an attempt that ended in "submit," the task lifecycle is:

```
agent POSTs /api/runner/tasks/:task_id/submit  {"status":"done"}
  → route flips task.status: in_progress → review   (Phase 17-01 / RTEST-02, commit e9e5fc1)
  → runAegisReviews() in src/lib/task-dispatch.ts:414 approves
  → task.status: review → done
```

The Progress tab does **not** render the `review → done` flip itself — that shows up as a `task.status_changed` SSE event reflected on the Kanban card's status column. The body the agent POSTs is always `{"status":"done"}` (the agent's declaration of intent); the route translates intent to the `review` status, and an Aegis pass drives the final flip to `done`. If you see an agent POST submit and the Kanban card sits in `review` for more than a heartbeat or two, look at Aegis — not at the agent. See [`docs/runtime/agent-contract.md`](./agent-contract.md#submit-http-endpoint) for the full contract.

Cite: [`src/components/panels/task-detail/progress-tab.tsx`](../../src/components/panels/task-detail/progress-tab.tsx).

---

## RecipeCombobox

**What it is.** The "Recipe" dropdown in the Create-Task form and the Edit-Task modal. Operators type to search; the combobox calls `GET /api/recipes/search?q=...` for autocomplete results and falls back to the Zustand `recipes` slice for the selected-slug → friendly-name lookup.

**Visible states.**

| State | Appearance | Meaning |
|---|---|---|
| Empty / not yet typed | Placeholder input | No selection |
| Typing — debouncing | Input has content; listbox not yet updated | Within the 300 ms debounce window |
| Typing — results | `role="listbox"` opens with ranked matches | `/api/recipes/search` returned |
| Selected | Input shows recipe friendly name (or raw slug fallback on cache miss) | Selection committed via Enter, click, or keyboard navigation |
| Disabled (RECIPE_LOCKED) | Input is read-only; clear button hidden; `lockedHint` renders beneath the input | See [#recipe_locked-client-side-gate](#recipe_locked-client-side-gate) |

**Data source.**
- Autocomplete: `GET /api/recipes/search?q=<query>` with a **300 ms debounce** on the input.
- `AbortController` cleanup on unmount and on re-fire: rapid typing aborts in-flight requests.
- **No client-side result cache.** Per the Phase 16-05 anti-pattern rule, every debounced search is a fresh fetch — this keeps the list in sync with recipe-indexer updates without needing extra invalidation plumbing.
- Friendly-name backfill: the combobox is a read-only consumer of the Zustand `recipes` slice (owned by Plan 16-02). Uses a defensive selector — `(s as { recipes?: Recipe[] }).recipes` — with an empty-array fallback during pre-hydration so it never branches on `undefined`.
- Keyboard: `↑` / `↓` cycle, `Enter` selects the active option, `Escape` closes, `Tab` closes without selection. Mirrors the `MentionTextarea` pattern.
- Accessibility: `role="combobox"` + `aria-expanded` + `aria-autocomplete` on the input; `role="listbox"` on the dropdown; `role="option"` + `aria-selected` on rows; `aria-activedescendant` wires the active option to the input.

**Operator signals.**
- If searching shows no results for a slug you just authored, the recipe-indexer may not have picked up the new recipe yet. Click "Resync" in the Recipes panel (admin-tier), or restart Mission Control to force a full re-index. See [`docs/runtime/recipes.md`](./recipes.md).

Cite: [`src/components/panels/task-form/recipe-combobox.tsx`](../../src/components/panels/task-form/recipe-combobox.tsx).

---

## Advanced section (mounts + skills + model override)

**What it is.** A collapsible section — collapsed by default — inside the Create-Task form and the Edit-Task modal. Expanding it reveals three editors that override or extend the recipe's defaults for this one task.

**Visible states.**

| Field | Editor |
|---|---|
| `read_only_mounts` | Row editor; each row is `{ source, mount_as, label }` |
| `extra_skills` | Simple name list |
| `model_override` | Registry-backed dropdown (optional) |

**Field semantics.**

- **`read_only_mounts`** — Each row declares a host directory to mount read-only into the container at claim time.
  - `source` must be a prefix-match of an entry in `runtime.mount_allowlist` (the admin-configured allowlist — see [`docs/runtime/admin-config.md`](./admin-config.md)). The server rejects mounts that escape the allowlist with a 400.
  - `mount_as` is the path inside the container (e.g., `/refs/my-repo`).
  - `label` is a human-readable name.
  - Per-row error mapping: 400 responses include a Zod `issues[]` array; the editor maps each issue via the regex `^read_only_mounts\.(\d+)\.` into `MountsEditor`'s `errors` prop so the operator sees the error on the specific row that caused it, not as a global banner.
- **`extra_skills`** — A plain list of skill names, bounded by `runtime.extra_skills_cap` (default 20). Each skill gets mounted read-only inside the container at `/skills/<name>/`.
- **`model_override`** — Registry-backed dropdown; if set, overrides the `recipe.model.primary` value at claim time. Useful for experimenting with a different tier without editing the recipe.

**RECIPE_LOCKED behavior.** All three editors are disabled when the RECIPE_LOCKED gate is active — see [#recipe_locked-client-side-gate](#recipe_locked-client-side-gate) below.

**Operator signals.**
- A red inline error on a `read_only_mounts` row almost always means the `source` path is outside `runtime.mount_allowlist`. Edit the allowlist or the row — don't try to quote around it.
- An `extra_skills` cap error (`"extra_skills exceeds cap"`) means the admin-configured `runtime.extra_skills_cap` is set lower than the count you entered. Ask the admin to raise the cap, or trim the list.
- `model_override` leaves `recipe.model.primary` untouched at rest — it only affects the specific task. The RecipeBadge on the Kanban card continues to show the recipe's native tier color; the override is applied by the runner at claim time.

Cite: Editors live under [`src/components/panels/task-form/`](../../src/components/panels/task-form/) — the Advanced section is rendered inside the task-form tree.

---

## Recipes panel

**What it is.** A full-mode inspection surface accessible from the main nav under "Recipes." It shows every indexed recipe with its name, description, model, tags, concurrency + timeout settings, and status (valid / error). Authoring stays filesystem-first — **no create / edit / delete UI ships here** (roadmap SC 5 LOCK).

Nav priority is `false` and `essential` is `false` — the Recipes panel is not part of Essential Mode; it's a full-mode operator tool.

**Visible states.**

| State | Appearance | Meaning |
|---|---|---|
| Loading | Spinner | First `GET /api/recipes` in flight |
| Populated — valid row | One row per recipe: name, description, model (tier-colored chip), tags, timeout, concurrency | Indexer accepted the recipe |
| Populated — error row | Red-accented row surfacing `error_message` | The indexer rejected the recipe (bad YAML, unknown model, schema violation). The recipe is NOT claimable |
| Populated — expanded | Inline soul_md preview rendered via the shared `MarkdownRenderer` | Operator clicked the per-row "View" toggle |
| Feedback banner | Inline pill below the Resync button (pattern copied from `github-sync-panel.tsx`, NOT a toast library) | Resync result — insert/update/delete counts + any per-row errors. Auto-clears after ~6 s |

The `error_message` column is the recipe row's rejection reason surfaced straight from the indexer. (This column was named differently in earlier design-era text; the shipped column is `error_message`.)

**Data source.**
- Initial fetch: `GET /api/recipes` on mount.
- Live refresh: `mc:recipe-indexed` and `mc:recipe-removed` CustomEvents relayed by the Plan 16-01 SSE dispatcher trigger a re-fetch. Filesystem edits under `recipes/` land live in the panel without a reload.
- Per-row View toggle: expands `soul_md` inline via the shared `MarkdownRenderer` — no modal, no extra route, no new endpoint.
- Admin action — Resync: `POST /api/recipes/resync`. Returns a report of `{ scanned, inserted, updated, deleted, errors[] }`. The panel surfaces this via the inline feedback banner, not a toast.

**Operator signals.**
- A red "error" row means the recipe is in the filesystem but cannot be claimed. Read `error_message` to see the rejection reason; fix the recipe on disk; the watcher will re-index automatically (or click Resync for an immediate full scan).
- "Scanned N, inserted A, updated B, deleted C" on the feedback banner is the authoritative Resync outcome — if a recipe you expected to appear was not inserted or updated, check the errors array.
- Per-row "View" expands `soul_md` verbatim — this is what the agent sees. If the prose looks stale, edit `recipes/<slug>/SOUL.md` and the indexer will pick up the change.

Cite: [`src/components/panels/recipes-panel.tsx`](../../src/components/panels/recipes-panel.tsx), [`src/app/api/recipes/resync/route.ts`](../../src/app/api/recipes/resync/route.ts).

---

## Blocker-flow UX

When an agent cannot complete a task — a missing secret, a dependency not available in the container, an operator question it can't answer — it posts a checkpoint with `status: 'blocked'` and a populated `blocker_reason`. The UI responds with three coordinated changes:

1. **Kanban card status.** The task moves to `awaiting_owner`. This is a distinct state — NOT `in_progress`, NOT `review`. It signals "an operator must act."
2. **System comment.** A system-authored comment is posted on the task containing `blocker_reason` verbatim. The comment appears in the task-detail comments tab and drives the activity feed.
3. **Progress tab emphasis.** The last checkpoint renders with a red blocker badge; `blocker_reason` is rendered prominently (not truncated).

**Resolve path.**
1. Operator reads `blocker_reason` in the system comment or on the red blocker checkpoint.
2. Operator fixes the underlying dependency — adds a missing secret to `.data/runner/secrets/<NAME>`, commits a missing file, updates `runtime.*` settings, etc.
3. Operator moves the task back to `assigned` (manually via the Kanban, or via a future dedicated "Resolve" action).
4. The runner's SSE handler sees the `assigned` re-entry and launches attempt `N+1` with `is_resuming = true`.
5. The runner writes a resume marker to `.mc/progress.md` before the agent starts — the format is LOCKED by Phase 17-05 (`expect(jsonlAfterResume.slice(0, jsonlAfterKill.length)).toBe(jsonlAfterKill)` byte-asserts append-only). The agent sees its prior attempts' context and picks up.

**Operator signals.**
- A task in `awaiting_owner` will not self-dispatch — it needs you.
- If the runner is offline and you resolve a blocker, nothing happens until the runner is back; the `assigned` re-entry only launches the next attempt when a live runner claims it.
- Blocker checkpoints are append-only along with every other checkpoint — history is preserved, and attempts after a resume build on top, they do not overwrite (`.mc/progress.md` and `.mc/checkpoints.jsonl` are append-only per WORK-04 / WORK-05).

Cite: [`src/app/api/tasks/[id]/checkpoints/route.ts`](../../src/app/api/tasks/[id]/checkpoints/route.ts) (CP-03 blocker branch), [`src/lib/task-dispatch.ts`](../../src/lib/task-dispatch.ts) (resume routing).

---

## RECIPE_LOCKED client-side gate

**Formula.**

```ts
const isDispatched = task.status !== 'inbox' && task.status !== 'assigned'
```

**Effect.** When `isDispatched` is `true`, the EditTaskModal:

- Disables the `RecipeCombobox` (the "Recipe" field becomes read-only).
- Disables the Advanced section's three editors — `read_only_mounts`, `extra_skills`, `model_override`.
- Skips the runtime-field delta on the `PATCH /api/tasks/:id` payload so even a malformed client cannot round-trip stale values.
- Renders a `lockedHint` beneath the combobox explaining why the field is read-only.

**Which statuses fall under `isDispatched = true`?** Every status EXCEPT `inbox` and `assigned`:
- `in_progress`
- `review`
- `done`
- `failed`
- `awaiting_owner`

In practice: once the runner has (or is about to) claim the task, its recipe / mounts / skills / model_override are frozen.

**Rationale.** These four fields drive container composition at claim time (image, mounts, env, model selection). Changing any of them after the container has launched — or after the claim row has been written — would leak misaligned state between the task row, the runner-token principal, and the in-flight or finished container. The gate is deliberately client-side-AND-server-side: the client disables the UI affordance, and the PATCH route skips the runtime-field delta so stale values cannot round-trip.

If you need to change the recipe for a task that has moved past `assigned`, the correct operator flow is: cancel the task, create a new task with the revised recipe, and let the runner pick up the new task.

Cite: Phase 16-05 LOCK — see also [`src/components/panels/task-form/recipe-combobox.tsx`](../../src/components/panels/task-form/recipe-combobox.tsx) for the `disabled` prop wiring.

---

## Event wiring

The banner, Progress tab, and Recipes panel all consume the same SSE-relay mechanism: server-side events are dispatched by [`src/lib/event-bus.ts`](../../src/lib/event-bus.ts) → emitted on `/api/events` → relayed into the browser window as DOM `CustomEvent`s by [`src/lib/use-server-events.ts`](../../src/lib/use-server-events.ts). Each UI surface attaches the listeners it cares about.

| CustomEvent name | Emitted by (server) | Consumed by (browser) |
|---|---|---|
| `mc:recipe-indexed` | Recipe indexer ([`src/lib/recipe-indexer.ts`](../../src/lib/recipe-indexer.ts)) | Zustand `recipes` slice refresh; Recipes panel live update |
| `mc:recipe-removed` | Recipe indexer on delete | Zustand `recipes` slice delete; Recipes panel live update |
| `mc:task-checkpoint-added` | `POST /api/tasks/:id/checkpoints` route (CP-01) | ProgressTab `Map<number, Checkpoint>` merge; RunnerStatusBanner debounced re-fetch |
| `mc:task-container-started` | `POST /api/runner/tasks/:task_id/container-started` route | RunnerStatusBanner debounced re-fetch |
| `mc:task-container-exited` | `POST /api/runner/tasks/:task_id/runner-exit` route | RunnerStatusBanner debounced re-fetch |
| `mc:task-runner-requested` | `autoRouteInbox` + `POST /api/tasks` + runner-exit retry branch | RunnerStatusBanner debounced re-fetch |

**Only-broadcast-on-committed-swap invariant (Phase 15-06 LOCK).** The `task.container_started` / `task.container_exited` events are only broadcast on the committed placeholder-swap branch. Idempotent retries that return 204 and 409 conflicts stay silent — UI surfaces never see phantom start / exit pairs from a retry storm.

Cite: [`src/lib/use-server-events.ts`](../../src/lib/use-server-events.ts) (the chat.message precedent pattern at ~lines 152–158 extended to the runtime event set), plus the STATE.md Phase 16-01 locked decisions.

---

## Related docs

- **Recipes** — authoring, indexing, admin Resync: [`docs/runtime/recipes.md`](./recipes.md)
- **Agent contract** — what the container-side code MUST do, including the submit endpoint referenced from the Progress tab section: [`docs/runtime/agent-contract.md`](./agent-contract.md)
- **Runner daemon** — CLI, LaunchAgent install, env vars, exit codes, Docker-unreachable troubleshooting: [`docs/runtime/runner-daemon.md`](./runner-daemon.md) (operator-level); deep reference at [`scripts/README.runner.md`](../../scripts/README.runner.md)
- **Admin config** — `runtime.*` settings, `mount_allowlist`, `project_repo_map`, secrets store: [`docs/runtime/admin-config.md`](./admin-config.md)
- **Getting started** — end-to-end "first recipe agent" walkthrough: [`docs/runtime/getting-started.md`](./getting-started.md)
- **Top-level index** — architecture overview + sub-doc map: [`docs/runtime/INDEX.md`](./INDEX.md)
