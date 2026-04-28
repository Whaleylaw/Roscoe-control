# Mission Control — Project & Task System E2E UI Test Plan

**Target:** `http://127.0.0.1:3000`
**Auth:** `AUTH_USER=aaron` / `AUTH_PASS=missioncontrol` (form login) OR `x-api-key: b08586d4d75a22456fcacbfab326da3dd355e360251c9e17ce77950b8db088b8` (API)
**Test persona:** Admin. Tests assume full role.
**Browser:** Any Chromium-based is fine; take screenshots on every failure.

## How to report results

For each test case, post back to the Claude session:

```
TC-<id>: PASS | FAIL | BLOCKED
Observed: <what you saw>
Expected: <what the spec says>
Evidence: <screenshot path / DOM snippet / console error / API response>
```

Group related failures. Prioritize BLOCKED (dependencies broken) ahead of FAIL (individual regression). Before declaring PASS, confirm the assertion actually renders — a missing element ≠ hidden element.

## Preflight

- **PF-01 — Server reachable.** `GET /api/status` → 200 JSON. FAIL → stop; something is wrong with the stack itself.
- **PF-02 — Auth works.** `POST /api/auth/login` with form creds → 200 + session cookie. Or `GET /api/diagnostics` with `x-api-key` → 200. BLOCKED on tests below otherwise.
- **PF-03 — Runner status baseline.** `GET /api/runtime/runner-status` (with API key) → JSON with `online`, `last_heartbeat_at`, `tasks_waiting`. Record the initial state; every test below interprets "🟢 vs 🔴 banner" relative to this baseline.
- **PF-04 — Clean artifact directory.** Create screenshots under `/tmp/mc-e2e-<timestamp>/`. Always include the URL bar in screenshots.

---

## Suite 1 — Global shell & navigation

### TC-1.1 — Login page renders
Visit `/login`. Expect a username+password form, no console errors, no 404s on assets. Submit with correct creds → redirect to `/` (or last visited panel).

### TC-1.2 — Shell layout
After login, confirm: nav rail on left, header bar on top, main content area, live feed sidebar (may be collapsed). Resize to 1280×800 and 1920×1080 — no overflow, no cut-off controls.

### TC-1.3 — Nav rail items
Clicking each nav rail item changes the URL path and renders its panel without full page reload (check SPA behavior — no flash of empty page). Tabs expected (varies by install): Tasks, Projects, Agents, Sessions, Cost Tracker, Recipes, Settings. Any item that 404s or throws is a FAIL.

### TC-1.4 — Theme toggle
Toggle light/dark. Verify background + text color flip and state persists across reload.

### TC-1.5 — Active panel highlighting
URL path → active nav item is highlighted. Deep-link directly to `/tasks` in a fresh tab → Tasks tab highlighted on first render (no flash to Home).

---

## Suite 2 — Projects list & entry

### TC-2.1 — Projects panel lists all projects
Navigate to `/projects`. Each project row shows: name, description (or placeholder), status pill, task count, created-at. Compare count to `GET /api/projects` length.

### TC-2.2 — Create project
Click "New Project" → modal with name, description, status fields. Submit with unique name `e2e-project-<ts>`. Project appears in list without reload. `GET /api/projects` now includes it.

### TC-2.3 — Validation
Submit empty name → inline error, form NOT submitted. Submit 300-char name → either rejected with error OR accepted+truncated in list (whichever is the contract). Document what happens.

### TC-2.4 — Click-through to workspace
Click a project card → URL becomes `/projects/<id>` (or `/projects/<id>/dashboard`). Breadcrumb shows `Projects > <name>`.

### TC-2.5 — Back to projects
Click breadcrumb "Projects" → returns to list. Browser back button also returns.

---

## Suite 3 — Project workspace dashboard

Use the e2e project from TC-2.2 for the rest of Suite 3.

### TC-3.1 — Dashboard default view
`/projects/<id>` renders: status overview card, activity feed, project brief (or placeholder). No console errors.

### TC-3.2 — Scoped tabs
Tabs visible inside the project: Dashboard, Tasks, Sessions, Agents, Settings (and Lifecycle if gsd_enabled). Each tab URL is `/projects/<id>/<tab>`. Switching tabs does not lose breadcrumb context.

### TC-3.3 — Activity feed
Make a change (rename project, add a task) → activity entry appears in feed within 5s (SSE). Entry has timestamp, actor, action text.

### TC-3.4 — Edit project
Settings tab → rename the project. Header + breadcrumb + projects list all reflect the new name within 5s. Reload — name persists.

### TC-3.5 — Delete project (do this LAST)
Defer until end of suite. Delete the e2e project. It disappears from the list. Navigating to its old URL → 404 or "project not found" panel (not a crash).

---

## Suite 4 — Task board

Create a second scratch project `e2e-tasks-<ts>` for Suite 4 so deletion of Suite 3's project doesn't wipe these tasks.

### TC-4.1 — Kanban columns render
Tasks tab shows columns for: `inbox`, `assigned`, `in_progress`, `review`, `done`. Optional: `awaiting_owner`, `failed`. Each column has a count badge and is empty initially (or shows only tasks from this project).

### TC-4.2 — Runner status banner
Above the Kanban: `RunnerStatusBanner`. Confirm one of:
- 🟢 `Runner online` (green pill) — runner heartbeat fresh
- 🔴 `Runner offline — tasks waiting: N` (red pill)
- Muted "Runner status unavailable"
- (Nothing, during initial fetch — acceptable for <1s)

Match to `GET /api/runtime/runner-status`. If endpoint says `online: true` but banner shows 🔴, that's a FAIL.

### TC-4.3 — Create task (no recipe)
Click "New Task" → form with title, description, status=inbox (default), project=<current>, assignee. Submit. Card appears in `inbox` column without reload. No RecipeBadge on the card.

### TC-4.4 — Create task (with recipe)
Click "New Task" → open Advanced. Type in Recipe field. Combobox opens, autocomplete suggestions load within ~500ms (300ms debounce + RTT). Select a recipe (e.g., `hello-world` if present). Submit. Card appears with RecipeBadge showing friendly name + tier-colored pill.

### TC-4.5 — Recipe badge tier colors
For each available recipe, verify the RecipeBadge tier color matches the recipe's `model.primary`:
- `opus` → purple
- `sonnet` → blue
- `haiku` → green
- other/unknown → muted gray

### TC-4.6 — Drag & drop between columns
Drag a task from `inbox` → `assigned`. Card moves, status field updates, `GET /api/tasks/<id>` shows `status: "assigned"`. Activity feed shows the transition.

### TC-4.7 — Invalid drag
Try to drag a `done` task back to `inbox`. Either: drop is rejected with a toast/inline error, OR drop succeeds (document which). A silent no-op (card snaps back with no feedback) is a FAIL.

### TC-4.8 — Task detail modal
Click a task card → modal opens showing tabs: Overview/Description, Progress, Comments, (optional: Diff, Files). Modal is keyboard-dismissable (Esc) and click-outside-closable.

### TC-4.9 — Progress tab (non-recipe task)
Open Progress tab on a task with no recipe and no checkpoints. Expect empty-state message, not a spinner-that-never-resolves.

### TC-4.10 — Progress tab (recipe task with checkpoints)
Inject checkpoints via API:
```
POST /api/tasks/<id>/checkpoints
Authorization: Bearer <runner-secret-or-api-key>
{"step":"init","status":"in_progress","summary":"starting"}
{"step":"work","status":"in_progress","summary":"doing work","artifacts":[{"type":"file","path":"/tmp/foo"}]}
{"step":"complete","status":"done","summary":"all done"}
```
Progress tab updates live (no reload). Entries are attempt-grouped, newest first. Artifacts render with type emoji.

### TC-4.11 — Blocker flow
POST a checkpoint with `status:"blocked"` and `blocker_reason:"need API key"`. Expect:
- Task status flips to `awaiting_owner` on the Kanban
- A system comment appears on the task with the blocker_reason verbatim
- Progress tab shows a red blocker badge

### TC-4.12 — Comments
Comments tab: add a comment. Appears immediately. Reload — persists. Mention syntax `@agentname` renders as a highlighted mention if agent exists.

### TC-4.13 — Advanced section: mounts
Create a task → expand Advanced → add a `read_only_mounts` row with a source OUTSIDE the allowlist. Submit → 400 with Zod-shaped error, error rendered inline on the offending row (not a global banner).

### TC-4.14 — Advanced section: extra_skills
Add extra_skills beyond the cap (`runtime.extra_skills_cap`). Submit → error with the cap value surfaced. Add one under the cap → accepts.

### TC-4.15 — RECIPE_LOCKED gate
Open a task in `in_progress` status via the edit form. Verify: Recipe combobox is disabled, Advanced section editors are read-only, lockedHint text renders. Attempting PATCH `/api/tasks/<id>` with a different `recipe_slug` ignores the change (reloads with original value).

### TC-4.16 — Filter by project
Go to global `/tasks`. If filter-by-project exists, select the e2e project. Only its tasks render. Disable filter → all tasks again.

### TC-4.17 — Search
Type a task title keyword in the search box. Only matching tasks render. Clear → all back.

### TC-4.18 — Real-time updates
Open two browser windows on the same Kanban. Create a task in window A. Within 5s, it appears in window B (SSE). Drag it in B; A updates.

### TC-4.19 — Task delete
Delete a task. Disappears from board, `GET /api/tasks/<id>` → 404. Activity feed logs the delete.

---

## Suite 5 — Recipes panel

### TC-5.1 — Recipes list
Navigate to Recipes. Every recipe under `recipes/<slug>/` renders as a row with name, description, model (tier-colored chip), tags, timeout, concurrency, status.

### TC-5.2 — Error-row rendering
If any recipe's `recipe.yaml` has a schema violation, its row renders red-accented with `error_message` visible. (If none, skip.)

### TC-5.3 — View SOUL.md
Click "View" on a recipe row → inline expansion renders `SOUL.md` as Markdown. Re-click → collapses.

### TC-5.4 — Resync (admin)
Click "Resync". Inline feedback banner shows `Scanned N, inserted A, updated B, deleted C`. Auto-clears after ~6s. Banner appears below the button, NOT as a toast.

### TC-5.5 — Live indexer updates
Add a file to an existing recipe directory (or `touch recipes/<slug>/recipe.yaml`). Within seconds, the row updates without a page reload (SSE).

---

## Suite 6 — Runner & runtime integration

These run even if Docker/runner are offline — the UI should degrade gracefully.

### TC-6.1 — Runner offline banner
With runner daemon stopped: Kanban banner = 🔴 `Runner offline — tasks waiting: N`. Create a recipe-tagged task → `tasks_waiting` increments within 10s (poll) or ~1s (SSE).

### TC-6.2 — Runner online banner
Start runner daemon. Within 10s the banner flips to 🟢. `last_heartbeat_at` updates every ~10s.

### TC-6.3 — Full dispatch flow (if Docker is healthy)
Create a task with a valid recipe + assignee. It transitions `inbox → assigned → in_progress` as the runner claims it. Progress tab populates with checkpoints from the container. Final transition is `in_progress → review` (NOT straight to `done`). Aegis review then flips `review → done`. Any deviation (e.g., agent submit flips straight to `done`) is a FAIL.

### TC-6.4 — Container-started SSE
During dispatch, watch the Kanban card. It should visually update when `task.container_started` fires (status changes + any indicator). RunnerStatusBanner debounce-refreshes within 1s.

### TC-6.5 — Crash-resume
Kill the running container mid-task (`docker kill <id>`). Task should flip to a retry state within the runner's retry window, or to `failed` if `max_attempts` exhausted. `.mc/progress.md` in the worktree retains append-only history.

---

## Suite 7 — GSD integration (if project is gsd_enabled)

Enable GSD on the e2e project (Settings → gsd_enabled = true, or API).

### TC-7.1 — Lifecycle tab appears
On a gsd_enabled project, a `Lifecycle` tab appears. Non-gsd projects do NOT have it.

### TC-7.2 — Lifecycle phase progression
Walk the project through: Discuss → Plan → Execute → Verify → Done via the Lifecycle tab controls. Each transition requires proper state (e.g., can't skip from Discuss → Execute).

### TC-7.3 — Gate approvals
On a task with `gate_required: true`, confirm the gate status shows as a chip on the card. Admin-approve → gate flips to `approved`. Only then does the task continue.

### TC-7.4 — Multi-workstream
Create two workstreams in the same project. Assign different tasks to each. Workstream switcher on Lifecycle tab filters the phase/plan view to the active workstream.

### TC-7.5 — Project-scoped queue
Open two recipe-tagged tasks: one in project A, one in project B. Confirm runner claims them independently — project A's cap doesn't block project B's work. (If runner capacity allows only 1 concurrent container, this test is N/A; record that.)

---

## Suite 8 — Error/edge cases

### TC-8.1 — Server restart mid-interaction
While a task modal is open, restart MC. The modal should show a reconnection indicator or error rather than freezing. SSE reconnects automatically within ~30s.

### TC-8.2 — Expired session
Delete the session cookie in devtools → navigate. Expect redirect to `/login` (NOT a silent 401 in the background with broken UI).

### TC-8.3 — CSRF/authorization on API
From devtools console, `fetch('/api/tasks', {method:'POST', body: JSON.stringify({title:'x'})})` WITHOUT session cookie or API key → 401. With cookie → works.

### TC-8.4 — Long strings
Create a task with 10,000-char description. It renders scrollable in the modal without breaking layout.

### TC-8.5 — Unicode + XSS
Create a task titled `<img src=x onerror=alert(1)>🔥中文`. It renders as literal text (no alert, HTML escaped). Emoji + CJK render correctly.

### TC-8.6 — 404 on unknown project
Navigate to `/projects/999999999`. Expect a friendly "not found" state, not a crash or blank page.

### TC-8.7 — Browser back/forward
Chain: Projects → Project A → Tasks → Task detail → back → back → back. Every back step restores prior state (URL + UI) correctly.

---

## Suite 9 — Accessibility smoke

### TC-9.1 — Tab navigation
From the Kanban, Tab through interactive elements. Focus ring is visible, order is logical (top-to-bottom, left-to-right).

### TC-9.2 — ARIA on banner + progress
RunnerStatusBanner has `role="status"` and `aria-live="polite"`. State transitions announce to a screen reader without stealing focus.

### TC-9.3 — Keyboard task creation
Open "New Task" with keyboard only (Tab to button, Enter). Fill form entirely with keyboard. Submit with Enter. No pointer events required.

---

## Data cleanup

At end of the run, delete the e2e scratch projects + any test tasks created. Verify via `GET /api/projects` that none with `e2e-` prefix remain.

---

## Aggregate report format

At the end, post a summary:

```
SUITE 1 (shell):   X/Y pass
SUITE 2 (projects): X/Y pass
SUITE 3 (workspace): X/Y pass
SUITE 4 (tasks):   X/Y pass
SUITE 5 (recipes): X/Y pass
SUITE 6 (runtime): X/Y pass
SUITE 7 (GSD):     X/Y pass
SUITE 8 (edge):    X/Y pass
SUITE 9 (a11y):    X/Y pass

Critical failures (BLOCKED / regressions on shipped features):
- TC-x.y: <one-line summary>

Known-issue failures (matches existing bug):
- TC-x.y: <one-line summary>

New bugs discovered:
- TC-x.y: <one-line summary>
```

Include screenshot paths alongside each failure so Claude can `Read` them.
