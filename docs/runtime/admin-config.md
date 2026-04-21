# Admin Configuration

**Source of truth:** [`src/app/api/settings/route.ts`](../../src/app/api/settings/route.ts) (settingDefinitions, lines 60-99), [`src/lib/task-runtime-settings.ts`](../../src/lib/task-runtime-settings.ts), [`src/lib/auth.ts`](../../src/lib/auth.ts), [`src/lib/runner-secret.ts`](../../src/lib/runner-secret.ts), [`src/app/api/runner/config/route.ts`](../../src/app/api/runner/config/route.ts)
**Who reads this:** Admins configuring the runner before first use or adjusting caps, limits, and allowlists in production
**Prerequisites:** Admin-tier auth (session cookie for an `admin`-role user, or `$API_KEY` bearer)

This is the definitive reference for Mission Control's admin-configurable runtime surface. Everything an operator needs to touch to make the runner daemon behave correctly lives here: the eight `runtime.*` keys, mount allowlist rules, the project→repo map, concurrency and resource caps, the secrets store, auth tiers, the `.data/` layout, standalone-mode requirements, and the runner-config endpoint.

| Section | Anchor |
|---|---|
| The 8 runtime.* settings | [#the-8-runtime-settings](#the-8-runtime-settings) |
| Mount allowlist rules | [#mount-allowlist-rules) |
| Project repo map | [#project-repo-map](#project-repo-map) |
| Concurrency and resource caps | [#concurrency-and-resource-caps](#concurrency-and-resource-caps) |
| Secrets store | [#secrets-store](#secrets-store) |
| Auth tiers and secrets | [#auth-tiers-and-secrets](#auth-tiers-and-secrets) |
| Data directory layout | [#data-directory-layout](#data-directory-layout) |
| Standalone-mode requirements | [#standalone-mode-requirements](#standalone-mode-requirements) |
| Runner-config endpoint | [#runner-config-endpoint](#runner-config-endpoint) |
| Related docs | [#related-docs](#related-docs) |

## The 8 runtime.* settings

All eight keys are defined in [`src/app/api/settings/route.ts`](../../src/app/api/settings/route.ts) `settingDefinitions` at lines 60-99. They persist in the `settings` table (admin-writable) and are read at request time by the accessor functions in [`src/lib/task-runtime-settings.ts`](../../src/lib/task-runtime-settings.ts).

| Key | Type | Default | Source |
|---|---|---|---|
| `runtime.mount_allowlist` | JSON `string[]` (absolute path prefixes) | `[]` | [`src/app/api/settings/route.ts:60-64`](../../src/app/api/settings/route.ts#L60-L64) |
| `runtime.read_only_mounts_cap` | int | `10` | [`src/app/api/settings/route.ts:65-69`](../../src/app/api/settings/route.ts#L65-L69) |
| `runtime.extra_skills_cap` | int | `20` | [`src/app/api/settings/route.ts:70-74`](../../src/app/api/settings/route.ts#L70-L74) |
| `runtime.max_concurrent_containers` | int | `4` | [`src/app/api/settings/route.ts:75-79`](../../src/app/api/settings/route.ts#L75-L79) |
| `runtime.project_repo_map` | JSON object `{project_id: abs_path}` | `{}` | [`src/app/api/settings/route.ts:80-84`](../../src/app/api/settings/route.ts#L80-L84) |
| `runtime.max_memory_per_container` | string (docker `--memory` format) | `8g` | [`src/app/api/settings/route.ts:85-89`](../../src/app/api/settings/route.ts#L85-L89) |
| `runtime.max_cpu_per_container` | number (docker `--cpus` format) | `4.0` | [`src/app/api/settings/route.ts:90-94`](../../src/app/api/settings/route.ts#L90-L94) |
| `runtime.failed_gc_window_days` | int | `7` | [`src/app/api/settings/route.ts:95-99`](../../src/app/api/settings/route.ts#L95-L99) |

All eight keys are settable from the CLI via `pnpm mc settings set <key> '<value>'`. Values must be JSON-encoded strings on the wire:

```bash
# Configure a single allowed mount prefix.
pnpm mc settings set runtime.mount_allowlist '["/Users/me/repos"]'

# Raise the per-task read_only_mounts cap.
pnpm mc settings set runtime.read_only_mounts_cap '20'

# Raise the per-task extra_skills cap.
pnpm mc settings set runtime.extra_skills_cap '40'

# Cap concurrent containers at 2 (overrides default 4).
pnpm mc settings set runtime.max_concurrent_containers '2'

# Map project id=1 to an absolute local git repo path.
pnpm mc settings set runtime.project_repo_map '{"1":"/Users/me/repos/myapp"}'

# Ceiling for per-container memory (docker --memory format).
pnpm mc settings set runtime.max_memory_per_container '"2g"'

# Ceiling for per-container CPUs (docker --cpus format).
pnpm mc settings set runtime.max_cpu_per_container '1.0'

# Retain failed-task worktrees + logs for 3 days instead of 7.
pnpm mc settings set runtime.failed_gc_window_days '3'
```

Operator notes on each key:

- `runtime.mount_allowlist` — host path prefixes the runner is permitted to expose as read-only refs (`read_only_mounts[*].source`) or extra skills (`extra_skills[*].path`). Evaluated after `fs.realpath`, so symlinks are resolved before the prefix check. An empty array rejects ALL mounts. See the next section for rules.
- `runtime.read_only_mounts_cap` — hard cap on the count of `read_only_mounts` entries per task; tasks exceeding this fail validation at creation.
- `runtime.extra_skills_cap` — same, for `extra_skills`.
- `runtime.max_concurrent_containers` — global runner concurrency cap. Over-cap claims return `409 CAP_EXCEEDED`. Placeholder `container_id='pending:<task_id>:<attempt>'` rows count toward the cap so a double-claim race at cap-minus-one cannot squeeze two containers past the limit (Phase 14-05 locked decision).
- `runtime.project_repo_map` — see the [dedicated section](#project-repo-map) below; this is the exclusive project→repo resolution path.
- `runtime.max_memory_per_container` — docker `--memory` format (e.g. `"8g"`, `"2g"`, `"512m"`). Claim-time rejection if a future recipe `memory_limit` exceeds this ceiling.
- `runtime.max_cpu_per_container` — docker `--cpus` decimal format (e.g. `1.0`, `0.5`, `4.0`).
- `runtime.failed_gc_window_days` — preserve worktree + logs for `failed` tasks this many days before the 10-minute GC tick destroys them. `done` and `cancelled` are destroyed immediately.

## Mount allowlist rules

`runtime.mount_allowlist` is a JSON array of absolute path prefixes the runner is permitted to mount as read-only refs or skills into containers. Any `read_only_mounts[*].source` or `extra_skills[*].path` that is not a PREFIX of at least one allowlist entry (after `fs.realpath`) is rejected at task creation with a `TASK_RUNTIME_ERROR_CODE` of `OUT_OF_ALLOWLIST`.

The validator walks parent directories on `ENOENT` (re-attaches unresolved tail to the realpath of the nearest existing ancestor), so not-yet-existing paths like future worktree targets validate while preserving symlink semantics. Allowlist entries that themselves fail to realpath are silently skipped — a misconfigured entry must not bypass checks and must not spam logs. See `validateHostPathAgainstAllowlist` in [`src/lib/task-runtime-settings.ts`](../../src/lib/task-runtime-settings.ts).

Example:

```bash
pnpm mc settings set runtime.mount_allowlist '["/Users/me/Github", "/opt/skills"]'
```

After this setting:

- `/Users/me/Github/myapp` — allowed (prefix of entry 1).
- `/Users/me/Github/other/repo` — allowed.
- `/opt/skills/gsd` — allowed.
- `/tmp/something` — rejected (no matching prefix).

## Project repo map

> **Warning — `runtime.project_repo_map` is the EXCLUSIVE resolution path.**
>
> The runner resolves `workspace_source.project_id` to a local git repo path EXCLUSIVELY via the `runtime.project_repo_map` admin setting. There is **NO env-var fallback** — no `RUNNER_PROJECT_REPO_MAP`, no auto-discovery from `tasks.project_id`, no file-based alternative. A misconfigured map fails loud at boot — the daemon exits 1 on an unreachable `/api/runner/config`, and a claim for a project with no entry in the map rejects with `MISSING_PROJECT_REPO` rather than silently shipping the wrong repo path (Phase 14-08b locked decision — see [`.planning/STATE.md`](../../.planning/STATE.md) Accumulated Context).

Set the map via:

```bash
pnpm mc settings set runtime.project_repo_map '{"1":"/abs/path/to/repo-for-project-1","2":"/abs/path/to/repo-for-project-2"}'
```

Keys are stringified `project_id` integers; values are absolute paths to local git repositories. After updating the map, the daemon must re-fetch its config for the change to take effect. Send `SIGHUP` to reload without a full restart:

```bash
# macOS LaunchAgent
launchctl kickstart "gui/$(id -u)/com.missioncontrol.runner"

# Foreground daemon (replace PID with your runner's PID from `ps | grep mc-runner`)
kill -HUP <PID>
```

See [`scripts/README.runner.md#project-repo-mapping`](../../scripts/README.runner.md#project-repo-mapping) and [`scripts/mc-runner.mjs:1163-1170`](../../scripts/mc-runner.mjs#L1163-L1170) for the SIGHUP semantics, and [`src/app/api/runner/config/route.ts`](../../src/app/api/runner/config/route.ts) for the config-endpoint contract.

## Concurrency and resource caps

Three settings interact to define the ceiling on container resource consumption:

- `runtime.max_concurrent_containers` — the global cap on simultaneously-live containers across ALL recipes. Claims rejected over-cap return `409 CAP_EXCEEDED`.
- `runtime.max_memory_per_container` — the admin-imposed ceiling on container memory.
- `runtime.max_cpu_per_container` — the admin-imposed ceiling on container CPUs.

Per-recipe `max_concurrent` (in `recipe.yaml`) is BOUNDED by `runtime.max_concurrent_containers` — the lower value wins. Similarly, per-task (future) resource limits will be BOUNDED by the admin ceilings at claim time via `resolveResourceLimits` in [`src/lib/runner-claim.ts`](../../src/lib/runner-claim.ts). `parseMemoryBytes` is called on both sides before comparing so `"2g"` is always compared against `"8g"` correctly (Phase 14-05 locked decision).

v1.2 recipes have no `memory_limit` / `cpu_limit` fields yet; the runner always applies the admin defaults (`2g` / `1.0`) at claim time. The helper is forward-compat for a later phase that adds recipe-declared overrides without changing claim-route code.

## Secrets store

The runner's per-secret store is `.data/runner/secrets/<NAME>`. Each file is one secret value. The runner reads these files at claim time and injects them via `docker run --env-file`. Missing secret files log a warning and are omitted from the env-file — intentional graceful degradation per Phase 14-08b.

> **Warning — `recipe.secrets` is a list of ENV VAR NAMES, not values.**
>
> Recipes declare secret names in `recipe.yaml` (`secrets: [ANTHROPIC_API_KEY, OPENAI_API_KEY]`). The Mission Control server NEVER sees the values. The runner reads `.data/runner/secrets/<NAME>` at claim time for each declared name, merges them into a `0600`-perms env-file at `.data/runner/env/task-<id>-a<attempt>.env`, and passes that file to docker via `--env-file`. See [`scripts/mc-runner.mjs:1057-1068`](../../scripts/mc-runner.mjs#L1057-L1068).
>
> Install a secret via:
>
> ```bash
> install -m 0600 /dev/stdin .data/runner/secrets/ANTHROPIC_API_KEY <<<'sk-...'
> ```
>
> Missing secret files log a warning and are silently omitted from the env-file rather than blocking the claim — graceful degradation per the Phase 14-08b locked decision.

> **Warning — CONTAINER-01 invariant: never pass secrets on `docker run` argv.**
>
> The CONTAINER-01 invariant forbids any `docker run -e SECRET=value` argv pattern. All secrets — including `MC_API_TOKEN` and recipe-declared `recipe.secrets` values — flow via `docker run --env-file`, never via `--env` or `-e` flags. Argv is visible to any local user via `ps`; env-files are `0600` under `.data/runner/env/` and are deleted after container exit.
>
> The invariant is enforced by a unit test at [`src/lib/__tests__/runner-docker-args.test.ts`](../../src/lib/__tests__/runner-docker-args.test.ts) that scans every element of the composed argv for a `MC_API_TOKEN=` substring and asserts it is absent.
>
> Also linked from [`docs/runtime/runner-daemon.md#configuration-and-secrets`](./runner-daemon.md#configuration-and-secrets).

## Auth tiers and secrets

Mission Control distinguishes six authenticated principals:

| Principal | How authenticated | What it can reach |
|---|---|---|
| `admin` session cookie | Signed-in admin user (via `/login` or `/setup`) | All routes |
| `operator` session cookie | Signed-in operator | Non-admin mutating routes + all read routes |
| `viewer` session cookie | Signed-in viewer | Read-only + own-data routes |
| `API_KEY` bearer | `Authorization: Bearer $API_KEY` | Admin-scoped API routes (NOT `/api/runner/*`) |
| `runner` principal (id `-1000`) | `.data/runner.secret` bearer | `/api/runner/*` only |
| `runner-token` principal (id `-2000`) | Per-task, per-attempt bearer issued by claim | 7-entry allowlist — see [`docs/runtime/agent-contract.md`](./agent-contract.md) for enumeration |

The `runner` principal uses a negative sentinel id (`-1000`) well outside both the positive user-id range and the negative agent-id range (agent API keys use `-agent_id`); see [`src/lib/auth.ts:488-509`](../../src/lib/auth.ts#L488-L509). The `url.pathname.startsWith('/api/runner/')` gate at [`src/lib/auth.ts:472`](../../src/lib/auth.ts#L472) is the ONLY check that ever compares a bearer against the runner secret — requests to `/api/tasks/` carrying the runner secret as a bearer fall through to the session / API-key branches and are rejected there (they match nothing).

The runner-token principal (id `-2000`) is distinct: it is a per-task, per-attempt, time-expiring, revocable bearer issued atomically at claim time and scoped to a 7-entry method+path allowlist in `RUNNER_TOKEN_ALLOWLIST` at [`src/lib/runner-tokens.ts`](../../src/lib/runner-tokens.ts). Strict `<=` expiry rejection in `verifyRunnerToken` guards against clock-skew at the exact expiry moment (Phase 11-04 locked decision). Atomic revocation on terminal task transitions is wrapped in the same `db.transaction` as the status UPDATE — a crash rolls BOTH back. See [`docs/runtime/agent-contract.md`](./agent-contract.md) for the full 7-endpoint enumeration.

**Auto-generated secrets.** `AUTH_SECRET` (session signing key), `API_KEY` (admin bearer), and `.data/runner.secret` (runner principal bearer) all auto-generate on first boot when unset. They persist to `.data/.auto-generated` so re-boots use stable values. Delete that file to regenerate — this invalidates all existing sessions and bearers.

- `AUTH_SECRET` and `API_KEY` are generated by [`src/lib/auto-credentials.ts`](../../src/lib/auto-credentials.ts).
- `.data/runner.secret` is generated and read by [`src/lib/runner-secret.ts`](../../src/lib/runner-secret.ts) at `MIN_SECRET_BYTES = 32` (`randomBytes(32).toString('base64url')`). An operator who truncates the file is treated as "no secret" rather than "weak secret" (see [`src/lib/runner-secret.ts:26-30`](../../src/lib/runner-secret.ts#L26-L30)).

`AUTH_USER` / `AUTH_PASS` / `AUTH_PASS_B64` env vars seed an admin account headlessly on first boot (useful for CI or container deploys where the `/setup` flow is inconvenient). Quote `AUTH_PASS` if it contains `#` or shell metacharacters, or use `AUTH_PASS_B64` (base64-encoded) — see [`CLAUDE.md`](../../CLAUDE.md).

## Data directory layout

All runtime state lives under `MISSION_CONTROL_DATA_DIR` (default `<cwd>/.data`):

```
.data/
├── mission-control.db          # SQLite database (WAL mode)
├── mission-control.db-shm      # SQLite shared-memory file (WAL mode)
├── mission-control.db-wal      # SQLite write-ahead log (WAL mode)
├── .auto-generated             # persisted auto-generated AUTH_SECRET + API_KEY
├── runner.secret               # runner principal bearer (0600 perms, 32+ bytes entropy)
└── runner/
    ├── daemon.log              # LaunchAgent stdout (log level lines)
    ├── daemon.err              # LaunchAgent stderr (panic/exit messages)
    ├── secrets/                # per-secret files, one env var per file
    │   ├── ANTHROPIC_API_KEY   # (0600 perms, single value)
    │   └── OPENAI_API_KEY
    ├── env/                    # per-claim env-files (0600 perms, deleted after exit)
    │   └── task-<id>-a<attempt>.env
    ├── recipe-stage/           # per-attempt recipe staging tree (deep-copied from recipes/)
    │   └── task-<id>/attempt-<n>/
    ├── worktrees/              # per-task git worktrees
    │   └── task-<id>/          # destroyed on `done`/`cancelled`, retained on `failed` per runtime.failed_gc_window_days
    └── logs/                   # per-attempt container stdout/stderr + meta
        └── task-<id>/
            ├── attempt-<n>/
            │   ├── stdout.log
            │   ├── stderr.log
            │   └── meta.json   # { started_at, runner_id, container_id, exited_at?, exit_code?, reason? }
            └── latest          # relative symlink → attempt-<n>
```

Move `.data/` elsewhere by setting `MISSION_CONTROL_DATA_DIR` to any absolute path. A volume-mounted data directory is the recommended pattern for Docker deployments.

The database path can be further customized via `MISSION_CONTROL_DB_PATH` (defaults to `<MISSION_CONTROL_DATA_DIR>/mission-control.db`).

## Standalone-mode requirements

> **Warning — Standalone mode REQUIRES `MISSION_CONTROL_RECIPES_DIR`.**
>
> `pnpm build && node .next/standalone/server.js` runs with `process.cwd()` set to `.next/standalone/`, which does NOT contain your authored `recipes/` tree. The recipe indexer defaults `getRecipesRoot()` to `<cwd>/recipes` (see [`scripts/mc-runner.mjs:1047-1048`](../../scripts/mc-runner.mjs#L1047-L1048) for the parallel default in the runner) and will find no recipe entries. Phase 14-10's smoke harness hard-fails on this misconfiguration with a remediation message rather than continuing to a confusing task-create error.
>
> Always set `MISSION_CONTROL_RECIPES_DIR` to an absolute path that points at your recipes tree before launching standalone:
>
> ```bash
> MISSION_CONTROL_RECIPES_DIR=/abs/path/to/your/recipes \
> MISSION_CONTROL_DATA_DIR=/abs/path/to/your/.data \
>   node .next/standalone/server.js
> ```
>
> The same env var must be set on the runner daemon's environment if the runner is launched separately — runner and server both resolve the recipes root via the same env var / default pair.

Additional standalone considerations:

- Use `node .next/standalone/server.js`, not `pnpm start`. `pnpm start` requires a full `node_modules` tree; the standalone build only ships what Next.js bundled.
- `better-sqlite3` and `node-pty` are native addons. If you switch Node versions after `pnpm install`, run `pnpm rebuild better-sqlite3` before booting.
- `NEXT_PUBLIC_GATEWAY_OPTIONAL=true` runs MC without gateway connectivity (local-mode only). Useful for standalone deployments where only the SQLite local mode is needed.

## Runner-config endpoint

The runner daemon fetches its runtime config from `GET /api/runner/config` at boot (step 3 of the 7-step boot sequence) and on `SIGHUP`. The response shape is:

```json
{
  "project_repo_map":            { "1": "/abs/path/..." },
  "max_concurrent_containers":   4,
  "max_memory_per_container":    "8g",
  "max_cpu_per_container":       4.0,
  "failed_gc_window_days":       7
}
```

The endpoint is authenticated via the `runner` principal (`.data/runner.secret` bearer). Any other authenticated principal (session, API key, runner-token) is rejected with `403 "runner-secret principal required"` — see [`src/app/api/runner/config/route.ts:34-36`](../../src/app/api/runner/config/route.ts#L34-L36). The endpoint has no rate limit (read-only, polled only on SIGHUP).

Spot-check the endpoint:

```bash
curl -s -H "Authorization: Bearer $(cat .data/runner.secret)" \
  http://127.0.0.1:3000/api/runner/config | jq .
```

Note the container-side networking: inside a running container, MC is at `http://host.docker.internal:${PORT:-3000}`, NOT `localhost`. The runner passes `--add-host host.docker.internal:host-gateway` so the container can reach it. See [`docs/runtime/agent-contract.md`](./agent-contract.md) for the full container env var reference.

## Related docs

- [`docs/runtime/runner-daemon.md`](./runner-daemon.md) — operator intro to the runner, env vars, boot sequence, exit codes
- [`docs/runtime/recipes.md`](./recipes.md) — `recipe.yaml` schema, indexer behavior, model registry, admin resync
- [`docs/runtime/agent-contract.md`](./agent-contract.md) — what a recipe image MUST do once launched (container env vars, progress/checkpoint append rules, submit flow)
- [`docs/runtime/task-board-surfaces.md`](./task-board-surfaces.md) — operator UI surfaces: RunnerStatusBanner, RecipeBadge, Progress tab
- [`docs/runtime/getting-started.md`](./getting-started.md) — end-to-end tutorial for provisioning + running a recipe agent
- [`scripts/README.runner.md`](../../scripts/README.runner.md) — authoritative deep reference for the runner daemon
