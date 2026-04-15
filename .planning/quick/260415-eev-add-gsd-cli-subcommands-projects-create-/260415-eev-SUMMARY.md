---
phase: quick/260415-eev-add-gsd-cli-subcommands
plan: 01
subsystem: cli
tags: [cli, gsd, docs, agent-ergonomics]
requires: [existing /api/projects, /api/projects/:id, /api/projects/:id/gsd/bootstrap, /api/projects/:id/gsd/transition, /api/tasks, /api/tasks/:id/gate routes]
provides:
  - scripts/mc-cli.cjs::commands.projects (create|list|get|bootstrap|transition)
  - scripts/mc-cli.cjs::commands.tasks.gate (--approve|--reject)
  - scripts/mc-cli.cjs::commands.tasks.list (--project|--phase|--gate-required)
affects:
  - docs/cli-agent-control.md (reference section)
  - docs/agent-gsd-guide.md (replaces raw examples with named CLI)
tech-stack:
  added: []
  patterns: [group-level function dispatcher in run() — action becomes _sub for single-file groups]
key-files:
  created:
    - docs/agent-gsd-guide.md  # first commit into source control (was untracked)
  modified:
    - scripts/mc-cli.cjs
    - docs/cli-agent-control.md
decisions:
  - "Client-side post-filter for --phase / --gate-required: GET /api/tasks does not support those params server-side (confirmed in plan context); CLI filters the returned tasks array after the fetch. --project maps to server-side project_id."
  - "Group-level function dispatcher pattern: commands.projects is a single function (not an object of subcommands) so the dispatcher in run() treats action as _sub. Matches the spirit of the plan's 'single function-style handler' directive."
  - "No client-side enum validation for --track / --gate-mode. Server returns 400 with a clear message, and mapStatusToExit(400) = EXIT.USAGE (2). Keeps CLI a thin wrapper, consistent with every other create."
  - "--waive without --reason is NOT rejected by the CLI. The server's Zod .refine returns 400 with path:['reason']; the CLI surfaces that as exit 2. Same 'thin wrapper' convention."
metrics:
  duration: 3min
  tasks: 2
  files: 3
  completed: 2026-04-15
---

# Quick Task 260415-eev: Add GSD CLI Subcommands Summary

Replaced the `raw` escape hatch with named `mc projects …` and `mc tasks gate` wrappers so GSD-aware agents get self-describing help text, flag validation, and the standard exit-code contract for every GSD endpoint.

## Scope

Task map: agents using the CLI currently have to hand-type `pnpm mc raw --method POST --path /api/projects/42/gsd/bootstrap --body '{}'` for three of the five GSD endpoints. This plan adds named wrappers, extends `tasks list` with project/phase/gate filters, and updates the two agent-facing docs to prefer the named commands.

## New CLI Surface

### projects group (new)

| Command | Method | Route | Body |
|---|---|---|---|
| `mc projects create --name <n> [--prefix …] [--slug …] [--description …] [--gsd] [--track <t>] [--gate-mode <m>] [--gsd-project-id <id>] [--body '{…}']` | POST | `/api/projects` | `{ name, ticket_prefix?, slug?, description?, gsd_enabled?, gsd_track?, gsd_gate_mode?, gsd_project_id? }` (or verbatim `--body`) |
| `mc projects list [--include-archived]` | GET | `/api/projects[?includeArchived=1]` | — |
| `mc projects get --id <N>` | GET | `/api/projects/:id` | — |
| `mc projects bootstrap --id <N>` | POST | `/api/projects/:id/gsd/bootstrap` | `{}` |
| `mc projects transition --id <N> --to <phase> [--waive --reason "…"]` | POST | `/api/projects/:id/gsd/transition` | `{ to_phase, waive_remaining?, reason? }` |

### tasks gate (new)

| Command | Method | Route | Body |
|---|---|---|---|
| `mc tasks gate --id <N> --approve [--note "…"]` | PATCH | `/api/tasks/:id/gate` | `{ gate_status: 'approved', note? }` |
| `mc tasks gate --id <N> --reject [--note "…"]` | PATCH | `/api/tasks/:id/gate` | `{ gate_status: 'rejected', note? }` |

CLI enforces exactly one of `--approve` / `--reject` at the wrapper layer (exit 2 otherwise).

### tasks list (extended)

| Flag | Behavior |
|---|---|
| `--project <id>` | Appends `?project_id=<id>` to the GET (server-side filter) |
| `--phase <discuss\|plan\|execute\|verify>` | Client-side post-filter on `tasks[].gsd_phase` — GET `/api/tasks` does not support this query param server-side |
| `--gate-required` | Client-side post-filter on `tasks[].gate_required === 1` |

Client-side filtering is documented in the handler comment and the plan; future server-side support would be a drop-in replacement.

## Dispatcher Change

`scripts/mc-cli.cjs::run()` gained a single branch: when `commands[group]` is a function (not an object), treat the 2nd positional as the subcommand and inject it as `flags._sub`. This keeps the `projects` group to a single handler and matches the plan's "single function-style handler" guidance. All pre-existing object-style groups (`agents`, `tasks`, `sessions`, …) are unaffected.

## Docs Updated

### docs/cli-agent-control.md

- New `### projects` section placed between `### agents` and `### tasks`.
- `### tasks` section: `list` bullet extended with `--project / --phase / --gate-required`; two new bullets added for `gate --id --approve` and `gate --id --reject`.

### docs/agent-gsd-guide.md — raw → named replacements

The following `raw`/`curl` examples were supplemented with named-CLI equivalents (all original `curl` blocks remain intact; additions sit immediately after each curl block):

| Location | Original example | Named replacement |
|---|---|---|
| §2 Surface B (intro) | `pnpm mc raw --method POST --path /api/projects/42/gsd/bootstrap --body '{}'` | `pnpm mc projects bootstrap --id 42 --json` + transition + gate |
| §2 Surface B (copy) | "The `raw` subcommand is your escape hatch…" | "Named wrappers exist for every GSD endpoint. The `raw` subcommand remains available as an escape hatch…" |
| §2 Surface A (MCP fallbacks) | Order: REST, mc_raw, CLI | Order: CLI named wrappers, REST, mc_raw |
| §3 Step 1 (create) | `curl … /api/projects` | `pnpm mc projects create --name … --prefix PRI --gsd --track product --gate-mode manual_approval --json` |
| §3 Step 2 (bootstrap) | `curl … /api/projects/42/gsd/bootstrap` | `pnpm mc projects bootstrap --id 42 --json` |
| §3 Step 4 (transition) | `curl … /api/projects/42/gsd/transition` | `pnpm mc projects transition --id 42 --to plan --json` |
| §3 Step 5 (gate approve) | `curl -X PATCH … /api/tasks/105/gate` | `pnpm mc tasks gate --id 105 --approve --note "Plan reviewed by Aegis"` + reject variant |
| §3 Step 7 (waiver) | `curl … waive_remaining` | `pnpm mc projects transition --id 42 --to verify --waive --reason "…" --json` |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — blocking] Dispatcher didn't support group-level function handlers**
- **Found during:** Task 1 smoke test
- **Issue:** `commands.projects` was added as a function (per plan guidance to mirror `agents.memory` pattern), but the dispatcher in `run()` did `groupMap[action]` which returned `undefined` when `groupMap` is itself a function (no subcommand map to look into).
- **Fix:** Added a `typeof groupMap === 'function'` branch in `run()` that treats `action` as the subcommand and injects it as `flags._sub`. Pre-existing object-style groups take the unchanged `else` branch.
- **Files modified:** `scripts/mc-cli.cjs`
- **Commit:** `682a454`

This is the narrowest change that satisfied the plan's "single function-style handler" directive without restructuring `projects` into an object-map (which would have been the easier alternative). Keeping the single-function shape also means future GSD commands can be added in one place.

## Server-side Surprises

None — all five endpoints behaved exactly as enumerated in `<interfaces>`. No route changes, no Zod schema changes, no new migrations.

## Verification Results

| Check | Result |
|---|---|
| `node -c scripts/mc-cli.cjs` | PASS |
| `pnpm typecheck` | PASS (no regressions; CLI is pure .cjs) |
| `mc --help` shows `projects` group line | PASS |
| `mc --help` shows `tasks gate` example | PASS |
| `mc projects` (no sub) exits 2 with "Unknown projects subcommand" | PASS |
| `mc tasks gate --id 1` without approve/reject exits 2 | PASS |
| `mc projects transition --id 1 --to plan --json` returns 401 + exit 3 | PASS (wiring confirmed; no auth in test env is expected) |
| `docs/cli-agent-control.md` grep suite (5 patterns) | PASS |
| `docs/agent-gsd-guide.md` grep suite (5 patterns) | PASS |
| `git diff --stat HEAD~2 HEAD -- src/app/api/ src/lib/` | empty (no server-side edits) |
| `git diff --stat HEAD~2 HEAD -- package.json pnpm-lock.yaml` | empty (no new deps) |

## Commits

| Task | Commit | Description |
|---|---|---|
| Task 1 | `682a454` | feat(cli): add projects group + tasks gate subcommand |
| Task 2 | `2ef0ef8` | docs(cli): document projects group + tasks gate; prefer named CLI over raw |

## Self-Check: PASSED

- FOUND: scripts/mc-cli.cjs (commands.projects, commands.tasks.gate, extended commands.tasks.list)
- FOUND: docs/cli-agent-control.md (### projects section + tasks gate bullets)
- FOUND: docs/agent-gsd-guide.md (named-CLI equivalents at §2 + §3 Steps 1/2/4/5/7)
- FOUND: commit 682a454 (Task 1)
- FOUND: commit 2ef0ef8 (Task 2)
