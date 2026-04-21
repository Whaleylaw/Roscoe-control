# Mission Control CLI for Agent-Complete Operations (v2)

This repository includes a first-party CLI at:

- scripts/mc-cli.cjs

Designed for autonomous/headless usage first:
- API key auth support
- Profile persistence (~/.mission-control/profiles/*.json)
- Stable JSON mode (`--json`) with NDJSON for streaming
- Deterministic exit code categories
- SSE streaming for real-time event watching
- Compound subcommands for memory, soul, comments

## Quick start

1) Ensure Mission Control API is running.
2) Set environment variables or use profile flags:

- MC_URL=http://127.0.0.1:3000
- MC_API_KEY=your-key

3) Run commands:

```bash
node scripts/mc-cli.cjs agents list --json
node scripts/mc-cli.cjs tasks queue --agent Aegis --max-capacity 2 --json
node scripts/mc-cli.cjs sessions control --id <session-id> --action terminate
```

## Command groups

### auth
- login --username --password
- logout
- whoami

### agents
- list
- get --id
- create --name --role [--body '{}']
- update --id [--body '{}']
- delete --id
- wake --id
- diagnostics --id
- heartbeat --id
- attribution --id [--hours 24] [--section identity,cost] [--privileged]
- memory get --id
- memory set --id --content "..." [--append]
- memory set --id --file ./memory.md
- memory clear --id
- soul get --id
- soul set --id --content "..."
- soul set --id --file ./soul.md
- soul set --id --template operator
- soul templates --id [--template name]

### projects
- create --name <name> [--prefix <ticket_prefix>] [--slug <slug>] [--description <text>] [--gsd] [--track <ops|product|marketing|legal|firmvault|custom>] [--gate-mode <manual_approval|auto_internal>] [--gsd-project-id <id>] [--body '{}']
- list [--include-archived]
- get --id
- bootstrap --id
- transition --id --to <discuss|plan|execute|verify|done> [--waive --reason "..."]
- lifecycle-graph --id
- workstreams list --id
- workstreams create --id --key <key> --name <name> [--status <active|paused|complete>]
- workstreams update --id --ws-id <id> [--key <key>] [--name <name>] [--status <active|paused|complete>] [--expected-updated-at <iso>]
- workstreams complete --id --ws-id <id> [--expected-updated-at <iso>]
- milestones list --id
- milestones create --id --version <label> --title <title> [--workstream-id <id>] [--status <planned|active|complete|archived>] [--started-at <iso>] [--completed-at <iso>]
- milestones update --id --milestone-id <id> [--version <label>] [--title <title>] [--workstream-id <id>] [--status <planned|active|complete|archived>] [--started-at <iso>] [--completed-at <iso>] [--expected-updated-at <iso>]
- milestones complete --id --milestone-id <id> [--expected-updated-at <iso>]

### gsd
- phases list --milestone-id <id>
- phases create --milestone-id <id> --key <phase_key> --slug <phase_slug> --order <number> [--lifecycle <discuss|plan|execute|verify|done>] [--status <planned|active|complete|deferred>] [--depends-on 1,2]
- phases update --phase-id <id> [--key <phase_key>] [--slug <phase_slug>] [--order <number>] [--lifecycle <discuss|plan|execute|verify|done>] [--status <planned|active|complete|deferred>] [--depends-on 1,2] [--expected-updated-at <iso>]
- phases transition --phase-id <id> --to <discuss|plan|execute|verify|done> [--expected-updated-at <iso>]
- plans list --phase-id <id>
- plans create --phase-id <id> --ref <plan_ref> --title <title> [--wave <string>] [--status <todo|in_progress|review|done|failed>] [--depends-on 1,2]
- plans update --plan-id <id> [--ref <plan_ref>] [--title <title>] [--wave <string>] [--status <todo|in_progress|review|done|failed>] [--depends-on 1,2] [--expected-updated-at <iso>]
- plans transition --plan-id <id> --to <todo|in_progress|review|done|failed> [--expected-updated-at <iso>]

### tasks
- list [--project <id>] [--phase <discuss|plan|execute|verify>] [--gate-required]
- get --id
- create --title [--body '{}']
- update --id [--body '{}']
- delete --id
- queue --agent <name> [--max-capacity 2]
- broadcast --id --message "..."
- comments list --id
- comments add --id --content "..." [--parent-id 5]
- gate --id --approve [--note "..."]
- gate --id --reject [--note "..."]

### sessions
- list
- control --id --action monitor|pause|terminate
- continue --kind claude-code|codex-cli --id --prompt "..."
- transcript --kind claude-code|codex-cli|hermes --id [--limit 40] [--source]

### connect
- register --tool-name --agent-name [--body '{}']
- list
- disconnect --connection-id

### tokens
- list [--timeframe hour|day|week|month|all]
- stats [--timeframe]
- by-agent [--days 30]
- agent-costs [--timeframe]
- task-costs [--timeframe]
- trends [--timeframe]
- export [--format json|csv] [--timeframe] [--limit]
- rotate (shows current key info)
- rotate --confirm (generates new key -- admin only)

### skills
- list
- content --source --name
- check --source --name
- upsert --source --name --file ./skill.md
- delete --source --name

### cron
- list
- create/update/pause/resume/remove/run [--body '{}']

### events
- watch [--types agent,task] [--timeout-ms 3600000]

  Streams SSE events to stdout. In `--json` mode, outputs NDJSON (one JSON object per line). Press Ctrl+C to stop.

### status
- health (no auth required)
- overview
- dashboard
- gateway
- models
- capabilities

### export (admin)
- audit [--format json|csv] [--since <unix>] [--until <unix>] [--limit]
- tasks [--format json|csv] [--since] [--until] [--limit]
- activities [--format json|csv] [--since] [--until] [--limit]
- pipelines [--format json|csv] [--since] [--until] [--limit]

### raw
- raw --method GET --path /api/... [--body '{}']

  Phase 10 example:

```bash
node scripts/mc-cli.cjs raw \
  --method GET \
  --path /api/projects/42/gsd/lifecycle-graph
```

```bash
node scripts/mc-cli.cjs raw \
  --method POST \
  --path /api/projects/42/gsd/workstreams \
  --body '{"key":"core-platform","name":"Core Platform","status":"active"}'
```

## Exit code contract

- 0 success
- 2 usage error
- 3 auth error (401)
- 4 permission error (403)
- 5 network/timeout
- 6 server error (5xx)

Phase 10 note:
- plan transitions can return `409` with `code: "WAVE_CONFLICT_BLOCKED"` when same-wave active plans point at overlapping task resource hints; the payload includes `blocking_plan_ids` and `conflicting_paths`

## API contract parity gate

To detect drift between Next.js route handlers and openapi.json, use:

```bash
node scripts/check-api-contract-parity.mjs \
  --root . \
  --openapi openapi.json \
  --ignore-file scripts/api-contract-parity.ignore
```

Machine output:

```bash
node scripts/check-api-contract-parity.mjs --json
```

The checker scans `src/app/api/**/route.ts(x)`, derives operations (METHOD + /api/path), compares against OpenAPI operations, and exits non-zero on mismatch.

Baseline policy in this repo:
- `scripts/api-contract-parity.ignore` currently stores a temporary baseline of known drift.
- CI enforces no regressions beyond baseline.
- When you fix a mismatch, remove its line from ignore file in the same PR.
- Goal is monotonic burn-down to an empty ignore file.

### See also — Runtime documentation

For operators running the **v1.2 recipe-based ephemeral agent runtime** (recipe-tagged tasks, `scripts/mc-runner.mjs`, per-task containers), see the `docs/runtime/` documentation set. The CLI configures runtime admin settings via `pnpm mc settings set runtime.*` — the full catalog of settings keys and their defaults lives in the admin-config reference below.

- [Runtime overview](./runtime/INDEX.md) — entry point for the v1.2 ephemeral agent runtime docs (architecture + cross-links)
- [Getting started (recipes)](./runtime/getting-started.md) — end-to-end tutorial from a fresh install to a first recipe agent completing
- [Admin config](./runtime/admin-config.md) — `runtime.*` settings catalog (`runtime.mount_allowlist`, `runtime.project_repo_map`, `runtime.max_concurrent_containers`, etc.) + secrets store + auth tiers
- [Runner daemon](./runtime/runner-daemon.md) — operator guide for `scripts/mc-runner.mjs` (boot, LaunchAgent, exit codes, logs)
- [Agent contract](./runtime/agent-contract.md) — what a recipe container image must do (env vars, mounts, preamble, submit endpoint)

## Next steps

- Promote script to package.json bin entry (`mc`).
- Add retry/backoff for transient failures.
- Add richer pagination/filter flags for list commands.
