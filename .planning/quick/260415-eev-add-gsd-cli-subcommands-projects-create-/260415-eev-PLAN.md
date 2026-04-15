---
phase: quick/260415-eev-add-gsd-cli-subcommands
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - scripts/mc-cli.cjs
  - docs/cli-agent-control.md
  - docs/agent-gsd-guide.md
autonomous: true
requirements:
  - CLI-GSD-01  # projects group: create/list/get/bootstrap/transition
  - CLI-GSD-02  # tasks gate subcommand
  - CLI-GSD-03  # tasks list filters: --project / --phase / --gate-required
  - CLI-GSD-04  # help text + docs updated, raw examples replaced
must_haves:
  truths:
    - "Agents can create a GSD project via `mc projects create --gsd --track product` (no --body flag needed)."
    - "Agents can bootstrap the default task pack via `mc projects bootstrap --id <N>` without typing a raw HTTP call."
    - "Agents can advance a project via `mc projects transition --id <N> --to plan` and waive with `--waive --reason '...'`."
    - "Agents can approve/reject a task gate via `mc tasks gate --id <N> --approve` or `--reject --note '...'`."
    - "`mc tasks list --project <N>` returns only tasks scoped to that project (server-side)."
    - "`mc tasks list --phase plan --gate-required` filters the list client-side when the server does not support those params, and is documented as such."
    - "`mc --help` lists the new `projects` group and the new `tasks gate` subcommand."
    - "All new commands honor `--json` (single JSON result, NOT NDJSON — these are one-shot requests) and the existing 0/2/3/4/5/6 exit-code contract."
    - "docs/cli-agent-control.md reference lists the new subcommands with flag signatures."
    - "docs/agent-gsd-guide.md prefers the named CLI commands; `raw` examples for GSD endpoints are replaced."
  artifacts:
    - path: "scripts/mc-cli.cjs"
      provides: "Extended commands map with `projects` group and `tasks.gate` handler; updated usage() help text."
      contains: "commands.projects"
    - path: "docs/cli-agent-control.md"
      provides: "Command reference entries for `projects` group + `tasks gate`."
      contains: "### projects"
    - path: "docs/agent-gsd-guide.md"
      provides: "Named-CLI examples replace `raw` examples for bootstrap/transition/gate."
      contains: "pnpm mc projects bootstrap"
  key_links:
    - from: "scripts/mc-cli.cjs commands.projects.create"
      to: "POST /api/projects"
      via: "httpRequest in main dispatcher"
      pattern: "route: '/api/projects'"
    - from: "scripts/mc-cli.cjs commands.projects.bootstrap"
      to: "POST /api/projects/:id/gsd/bootstrap"
      via: "httpRequest body {}"
      pattern: "/gsd/bootstrap"
    - from: "scripts/mc-cli.cjs commands.projects.transition"
      to: "POST /api/projects/:id/gsd/transition"
      via: "httpRequest body {to_phase, waive_remaining?, reason?}"
      pattern: "/gsd/transition"
    - from: "scripts/mc-cli.cjs commands.tasks.gate"
      to: "PATCH /api/tasks/:id/gate"
      via: "httpRequest body {gate_status, note?}"
      pattern: "/gate"
---

<objective>
Give GSD-aware agents named CLI wrappers for the five GSD REST endpoints so they
stop relying on `mc raw --method ... --path ...`. Extend `tasks list` with
project/phase/gate filters. Update the two agent-facing docs to prefer the
named commands.

Purpose: the `raw` escape hatch is documented in docs/agent-gsd-guide.md as the
current fallback for bootstrap/transition/gate. That is a papercut every GSD
agent trips over. Named subcommands make the CLI self-describing in `--help`
and safer (flag validation, not hand-typed JSON).

Output:
  - scripts/mc-cli.cjs — new `projects` group (create/list/get/bootstrap/
    transition), new `tasks gate` action, extended `tasks list` filters,
    updated usage() help text.
  - docs/cli-agent-control.md — reference entries for the new surface.
  - docs/agent-gsd-guide.md — replace `raw` examples with named commands;
    point at the new `mc projects …` workflow.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@CLAUDE.md
@scripts/mc-cli.cjs
@docs/cli-agent-control.md
@docs/agent-gsd-guide.md
@src/app/api/projects/route.ts
@src/app/api/projects/[id]/route.ts
@src/app/api/projects/[id]/gsd/bootstrap/route.ts
@src/app/api/projects/[id]/gsd/transition/route.ts
@src/app/api/tasks/[id]/gate/route.ts
@src/app/api/tasks/route.ts
@src/lib/validation.ts

<interfaces>
<!-- Pre-extracted so the executor does not re-explore the codebase. -->

### mc-cli.cjs handler shape (from scripts/mc-cli.cjs)

Handlers return `{ method, route, body? }` OR handle the HTTP request inline
and return a `{ ok, status, data, url, method }` result. The main dispatcher
(run()) then prints + exits. Keep the `{method, route, body}` form whenever
possible — it inherits all auth / cookie / timeout / exit-code plumbing for free.

Helpers available:
- `required(flags, key)` — throws if flag missing/blank; throw maps to exit 2.
- `optional(flags, key, fallback)` — returns string or fallback.
- `bodyFromFlags(flags)` — parses `--body '{...}'` into an object, else undefined.

Subcommand injection for compound dispatch (see `agents memory`, `tasks comments`):
when a third positional arg is present, the dispatcher sets `parsed.flags._sub = sub`
before calling the group handler. Use the same `_sub` pattern for the new
`projects` group so `mc projects create / list / get / bootstrap / transition`
all dispatch through a single `commands.projects = (flags) => { ... }` function.

Exit codes (EXIT object, already defined):
- 0 OK, 2 USAGE, 3 AUTH (401), 4 FORBIDDEN (403), 5 NETWORK, 6 SERVER (5xx).

### REST endpoint contracts (confirmed)

POST /api/projects  (operator)
  body: { name, ticket_prefix?, slug?, description?, github_repo?, deadline?, color?,
          gsd_enabled?: bool, gsd_track?: one of ['ops','product','marketing','legal','firmvault','custom'],
          gsd_gate_mode?: 'manual_approval'|'auto_internal' (default 'manual_approval'),
          gsd_project_id?: string }
  errors: 400 'Invalid gsd_track', 400 'Invalid gsd_gate_mode', 400 'Project name is required',
          409 'Project slug or ticket prefix already exists'

GET /api/projects  (viewer)  → { projects: [...] }  (optional ?includeArchived=1)
GET /api/projects/:id  (viewer)  → { project: {...} }

POST /api/projects/:id/gsd/bootstrap  (operator)
  body: {}  (empty object OK — bootstrapSchema = z.object({}).passthrough())
  → { created, skipped, tasks: [...] }

POST /api/projects/:id/gsd/transition  (operator)
  body: { to_phase: 'discuss'|'plan'|'execute'|'verify'|'done',
          waive_remaining?: bool,
          reason?: string (REQUIRED when waive_remaining=true, server 400 via Zod .refine otherwise) }
  errors: 404 PROJECT_NOT_FOUND, 409 ILLEGAL_TRANSITION,
          409 DISCUSS_REQUIRES_ONE_DONE, 409 PLAN_REQUIRES_APPROVED_PACKAGE,
          409 EXECUTE_TASKS_INCOMPLETE, 409 VERIFY_REQUIRES_ONE_DONE
  → { ok, from_phase, to_phase, project }

PATCH /api/tasks/:id/gate  (operator)
  body: { gate_status: 'approved'|'rejected', note?: string }
  errors: 400 NO_GATE (task has no gate), 404 TASK_NOT_FOUND
  → { task: {...} }

GET /api/tasks  (viewer)
  Supported query params: status, assigned_to, priority, project_id, limit, offset
  NOT SUPPORTED server-side: phase, gate_required, gate_status
  Task rows include `gsd_phase`, `gate_required`, `gate_status` (SELECT t.*).

### Enum reference (from src/lib/validation.ts)

GSD_PHASES = ['discuss','plan','execute','verify','done']
GSD_TRACKS = ['ops','product','marketing','legal','firmvault','custom']
GSD_GATE_MODES = ['manual_approval','auto_internal']
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Extend scripts/mc-cli.cjs with `projects` group, `tasks gate`, and `tasks list` filters</name>
  <files>scripts/mc-cli.cjs</files>
  <action>
Add a new `commands.projects` group and a new `commands.tasks.gate` action, and extend `commands.tasks.list` to accept client-side filters. Match the file's existing style exactly — two-space indent, no trailing semicolons on arrow-returning handlers (see the surrounding code), use `required()` / `optional()` / `bodyFromFlags()` helpers, throw `new Error(...)` for usage errors (the dispatcher maps to EXIT 2 + `--json` failure envelope).

1) Add `commands.projects` as a SINGLE function-style handler that dispatches on `flags._sub`, mirroring the `commands.agents.memory` and `commands.tasks.comments` precedent. Signatures:

   - `mc projects create --name <name> [--prefix <ticket_prefix>] [--slug <slug>] [--description <text>] [--gsd] [--track <track>] [--gate-mode <mode>] [--gsd-project-id <id>] [--body '{...}']`
     - If `--body` is present, use it verbatim (bodyFromFlags). Otherwise assemble body from flags:
       ```js
       const body = { name: required(flags, 'name') };
       if (flags.prefix)          body.ticket_prefix   = String(flags.prefix);
       if (flags.slug)            body.slug            = String(flags.slug);
       if (flags.description)     body.description     = String(flags.description);
       if (flags.gsd)             body.gsd_enabled     = true;
       if (flags.track)           body.gsd_track       = String(flags.track);
       if (flags['gate-mode'])    body.gsd_gate_mode   = String(flags['gate-mode']);
       if (flags['gsd-project-id']) body.gsd_project_id = String(flags['gsd-project-id']);
       ```
     - Return `{ method: 'POST', route: '/api/projects', body }`.
     - Do NOT client-validate `--track` / `--gate-mode` against the enums; the server returns 400 with a clear message (and the CLI already maps 400→exit 2). This keeps the wrapper thin — same pattern as every other create in the file.

   - `mc projects list [--include-archived]`
     - `let qs = flags['include-archived'] ? '?includeArchived=1' : '';`
     - Return `{ method: 'GET', route: '/api/projects' + qs }`.

   - `mc projects get --id <id>` → `{ method: 'GET', route: '/api/projects/' + required(flags, 'id') }`

   - `mc projects bootstrap --id <id>` → `{ method: 'POST', route: '/api/projects/' + required(flags, 'id') + '/gsd/bootstrap', body: {} }` (empty body passes bootstrapSchema).

   - `mc projects transition --id <id> --to <phase> [--waive --reason <text>]`
     ```js
     const body = { to_phase: required(flags, 'to') };
     if (flags.waive) body.waive_remaining = true;
     if (flags.reason) body.reason = String(flags.reason);
     return { method: 'POST', route: `/api/projects/${required(flags, 'id')}/gsd/transition`, body };
     ```
     Do NOT enforce `--reason` when `--waive` is set; the server's Zod .refine returns a 400 with `path: ['reason']` and the CLI surfaces it. (Matches the "thin wrapper" convention.)

   Unknown `_sub` throws `new Error(\`Unknown projects subcommand: ${sub}. Use create|list|get|bootstrap|transition\`)`.

2) Add `commands.tasks.gate`:
   ```js
   gate: (flags) => {
     const id = required(flags, 'id');
     const approve = Boolean(flags.approve);
     const reject  = Boolean(flags.reject);
     if (approve === reject) {
       throw new Error('tasks gate requires exactly one of --approve or --reject');
     }
     const body = { gate_status: approve ? 'approved' : 'rejected' };
     if (flags.note) body.note = String(flags.note);
     return { method: 'PATCH', route: `/api/tasks/${id}/gate`, body };
   },
   ```

3) Extend `commands.tasks.list` to accept `--project`, `--phase`, `--gate-required`. The GET /api/tasks handler only supports `project_id` server-side (confirmed — see context). So:
   - `--project <N>`: append `?project_id=<N>` (server-side filter). Use `encodeURIComponent`.
   - `--phase <phase>` and `--gate-required`: client-side post-filter on the returned `tasks` array before printing. Implement by converting `list` from a pure `{method,route}` returner into an inline handler (pattern: see `commands.auth.login`) that calls `httpRequest(...)` and filters before returning the result:
     ```js
     list: async (flags, ctx) => {
       let qs = '';
       if (flags.project) qs = `?project_id=${encodeURIComponent(String(flags.project))}`;
       const result = await httpRequest({
         baseUrl: ctx.baseUrl, apiKey: ctx.apiKey, cookie: ctx.profile.cookie,
         method: 'GET', route: `/api/tasks${qs}`, timeoutMs: ctx.timeoutMs,
       });
       if (result.ok && Array.isArray(result.data?.tasks)) {
         let tasks = result.data.tasks;
         if (flags.phase) tasks = tasks.filter(t => t.gsd_phase === String(flags.phase));
         if (flags['gate-required']) tasks = tasks.filter(t => Number(t.gate_required) === 1);
         result.data = { ...result.data, tasks };
       }
       return result;
     },
     ```
   The dispatcher already handles an async handler that returns a result object (see the `'ok' in result_or_config` branch). Import note: `httpRequest` is already defined in the same file — no new imports needed.

4) Update `usage()` (the heredoc printed on `--help` or no args). In the "Groups:" block add one line for `projects`, and in "Examples:" add:
   ```
     mc projects create --name "Q2 Pricing" --gsd --track product --json
     mc projects bootstrap --id 42 --json
     mc projects transition --id 42 --to plan --json
     mc tasks gate --id 105 --approve --note "Plan reviewed"
     mc tasks list --project 42 --phase execute --gate-required --json
   ```
   Also add the `tasks gate` line to the `tasks` sub-block description:
   ```
                comments list|add / broadcast / gate
   ```

5) Sanity: do NOT add any top-level `require()` or `import` — the file is stdlib + `fetch` only per constraints. No changes to `EXIT`, `httpRequest`, `sseStream`, or `run()` beyond the fact that the dispatcher already supports both the `{method,route,body}` shape and a returned result envelope.

Convention reminders: conventional commit messages (`feat(cli): add projects group + tasks gate subcommand`), no AI attribution trailers, no icon libraries, no emoji in code.
  </action>
  <verify>
    <automated>
pnpm typecheck &amp;&amp; \
node -c scripts/mc-cli.cjs &amp;&amp; \
node scripts/mc-cli.cjs --help | grep -E '^\s+projects\s' &amp;&amp; \
node scripts/mc-cli.cjs --help | grep 'projects bootstrap --id' &amp;&amp; \
node scripts/mc-cli.cjs --help | grep 'tasks gate' &amp;&amp; \
node scripts/mc-cli.cjs projects 2>&amp;1 | grep -Ei 'Unknown projects subcommand|create\|list\|get\|bootstrap\|transition' &amp;&amp; \
node scripts/mc-cli.cjs tasks gate --json; test $? -eq 2 &amp;&amp; \
node scripts/mc-cli.cjs projects transition --id 1 --to plan --json 2>&amp;1 | head -20
    </automated>
  </verify>
  <done>
- `commands.projects` exists and dispatches create/list/get/bootstrap/transition via `_sub`.
- `commands.tasks.gate` exists and enforces exactly-one-of `--approve`/`--reject`.
- `commands.tasks.list` accepts `--project` (server-side `project_id`) and `--phase` / `--gate-required` (client-side post-filter).
- `usage()` lists `projects` in Groups, adds `gate` to the tasks sub-line, and includes the five new Examples.
- `node -c scripts/mc-cli.cjs` passes (syntax).
- `pnpm typecheck` passes (no regressions — CLI is pure .cjs so this only guards the rest of the repo).
- `mc projects` with no subcommand exits 2 and prints the "Unknown projects subcommand: …" error listing valid subcommands.
- `mc tasks gate --id 1` without `--approve`/`--reject` exits 2.
- `mc projects transition --id 1 --to plan` produces a network/4xx result (no server running in CI is fine — we're verifying the wiring compiled, not the server response).
- No new dependencies in package.json. No new `require()` lines in scripts/mc-cli.cjs.
  </done>
</task>

<task type="auto">
  <name>Task 2: Update docs/cli-agent-control.md and docs/agent-gsd-guide.md to prefer named commands</name>
  <files>docs/cli-agent-control.md, docs/agent-gsd-guide.md</files>
  <action>
1) `docs/cli-agent-control.md` — add a new **### projects** section in the "Command groups" block, placed immediately after **### agents** (before **### tasks** so the reading order mirrors the GSD workflow: create project → tasks). Entries:

```
### projects
- create --name <name> [--prefix <ticket_prefix>] [--slug <slug>] [--description <text>] [--gsd] [--track <ops|product|marketing|legal|firmvault|custom>] [--gate-mode <manual_approval|auto_internal>] [--gsd-project-id <id>] [--body '{}']
- list [--include-archived]
- get --id
- bootstrap --id
- transition --id --to <discuss|plan|execute|verify|done> [--waive --reason "..."]
```

Inside the **### tasks** section, append three new bullets:

```
- gate --id --approve [--note "..."]
- gate --id --reject [--note "..."]
- list [--project <id>] [--phase <discuss|plan|execute|verify>] [--gate-required]
```

(If a `list` bullet already exists, replace it with the filtered form above; don't duplicate.)

2) `docs/agent-gsd-guide.md` — replace the `raw` workflow with named-command equivalents. Specifically:

   - In **§2 Surface B — CLI**, replace the line
     ```
     pnpm mc raw --method POST --path /api/projects/42/gsd/bootstrap --body '{}'
     ```
     with
     ```
     pnpm mc projects bootstrap --id 42 --json
     pnpm mc projects transition --id 42 --to plan --json
     pnpm mc tasks gate --id 105 --approve --note "Plan reviewed"
     ```
     and update the sentence above from "The `raw` subcommand is your escape hatch for any endpoint the CLI doesn't wrap." to:
     "Named wrappers exist for every GSD endpoint. The `raw` subcommand remains available as an escape hatch for anything the CLI doesn't yet wrap."

   - In **§2**, update the **Surface A — MCP Server** paragraph that reads
     "GSD-specific endpoints (project create with GSD fields, bootstrap, transition, gate approval) **are not yet wrapped as dedicated MCP tools**. For those, use one of:" — KEEP the MCP-is-not-wrapped statement (still true) but change the fallback list to list the CLI named commands FIRST:
     ```
     - The CLI (Surface B) — named wrappers: `mc projects create|bootstrap|transition`, `mc tasks gate`
     - The REST API directly (see Surface C)
     - The `mc_raw` tool if your MCP client exposes it
     ```

   - In **§3 Step 1**, after the `curl -X POST "$MC_URL/api/projects"` block, add a `# CLI equivalent:` line followed by:
     ```
     pnpm mc projects create --name "Q2 Pricing Migration" --prefix PRI --gsd --track product --gate-mode manual_approval --json
     ```

   - In **§3 Step 2**, after the bootstrap curl block add:
     ```
     # CLI equivalent:
     pnpm mc projects bootstrap --id 42 --json
     ```

   - In **§3 Step 4** (transition to plan), after the curl block add:
     ```
     # CLI equivalent:
     pnpm mc projects transition --id 42 --to plan --json
     ```

   - In **§3 Step 5** (gate approval), after the PATCH curl block add:
     ```
     # CLI equivalent:
     pnpm mc tasks gate --id 105 --approve --note "Plan reviewed by Aegis"
     # Reject:
     pnpm mc tasks gate --id 105 --reject --note "Scope unclear"
     ```

   - In **§3 Step 7** (waiver transition), after the waiver curl block add:
     ```
     # CLI equivalent:
     pnpm mc projects transition --id 42 --to verify --waive --reason "Remaining tasks moved to follow-up project" --json
     ```

Do not add an icon library, emoji, or rewrite unrelated prose. Keep all remaining `curl` examples intact — the goal is ADDITIONS that show the named CLI as the preferred path, not deletions of the REST reference material.
  </action>
  <verify>
    <automated>
grep -q '^### projects$' docs/cli-agent-control.md &amp;&amp; \
grep -q 'transition --id --to' docs/cli-agent-control.md &amp;&amp; \
grep -q 'gate --id --approve' docs/cli-agent-control.md &amp;&amp; \
grep -q '\-\-phase <discuss|plan|execute|verify>' docs/cli-agent-control.md &amp;&amp; \
grep -q 'pnpm mc projects bootstrap --id 42' docs/agent-gsd-guide.md &amp;&amp; \
grep -q 'pnpm mc projects transition --id 42 --to plan' docs/agent-gsd-guide.md &amp;&amp; \
grep -q 'pnpm mc tasks gate --id 105 --approve' docs/agent-gsd-guide.md &amp;&amp; \
grep -q 'pnpm mc projects create --name' docs/agent-gsd-guide.md &amp;&amp; \
grep -q 'waive --reason' docs/agent-gsd-guide.md
    </automated>
  </verify>
  <done>
- docs/cli-agent-control.md has a `### projects` section with create/list/get/bootstrap/transition bullets.
- docs/cli-agent-control.md tasks section lists `gate --id --approve|--reject` and the extended `list` filters.
- docs/agent-gsd-guide.md §2 Surface B no longer positions `raw` as the only GSD path; named commands are listed first.
- docs/agent-gsd-guide.md §3 Steps 1, 2, 4, 5, 7 each have a `# CLI equivalent:` block below the curl block showing the named command.
- All original curl examples and error-code tables remain intact.
- No new emoji, no icon library references.
  </done>
</task>

</tasks>

<verification>
Top-level phase checks:

1. Build integrity:
   ```
   pnpm typecheck
   node -c scripts/mc-cli.cjs
   ```

2. CLI surface smoke test (no server required — verifies wiring and help text):
   ```
   node scripts/mc-cli.cjs --help | grep -E 'projects|gate'
   node scripts/mc-cli.cjs projects                # exits 2, lists subcommands
   node scripts/mc-cli.cjs tasks gate --id 1       # exits 2 (needs --approve/--reject)
   node scripts/mc-cli.cjs projects transition --id 1 --to plan --json  # network/4xx result printed as JSON
   ```

3. Docs integrity:
   ```
   grep -q '^### projects$' docs/cli-agent-control.md
   grep -q 'pnpm mc projects bootstrap' docs/agent-gsd-guide.md
   ```

4. No new dependencies:
   ```
   git diff --stat package.json pnpm-lock.yaml   # expect empty
   ```

5. No server-side changes:
   ```
   git diff --stat src/app/api/ src/lib/          # expect empty
   ```
</verification>

<success_criteria>
- `mc --help` lists the `projects` group and shows `tasks gate` examples.
- `mc projects create --name X --gsd --track product` maps to `POST /api/projects` with `{name, gsd_enabled:true, gsd_track:'product', gsd_gate_mode:'manual_approval'}` (last defaulted server-side).
- `mc projects bootstrap --id N` maps to `POST /api/projects/N/gsd/bootstrap` with body `{}`.
- `mc projects transition --id N --to plan` maps to `POST /api/projects/N/gsd/transition` with `{to_phase:'plan'}`.
- `mc projects transition --id N --to verify --waive --reason "..."` includes `waive_remaining:true` and `reason`.
- `mc tasks gate --id N --approve --note "ok"` maps to `PATCH /api/tasks/N/gate` with `{gate_status:'approved', note:'ok'}`.
- `mc tasks gate --id N` without `--approve` or `--reject` exits 2 with a clear usage error.
- `mc tasks list --project 42` appends `?project_id=42`. `--phase plan` and `--gate-required` filter the returned `tasks` array client-side (server doesn't support them — documented in the action).
- All new commands honor `--json` (single JSON object, not NDJSON — these aren't streams).
- Exit codes follow the 0/2/3/4/5/6 contract from the existing dispatcher — handlers throw for usage errors and let the dispatcher map HTTP status codes.
- docs/cli-agent-control.md and docs/agent-gsd-guide.md cross-reference the new commands and keep the REST reference intact.
- No new dependencies. No server-side route changes.
</success_criteria>

<output>
After completion, create `.planning/quick/260415-eev-add-gsd-cli-subcommands-projects-create-/260415-eev-SUMMARY.md` summarizing:
- New CLI surface (projects + tasks gate + tasks list filters)
- Exact endpoint mapping per subcommand
- Any server-side surprises (expected: none)
- Which `raw` examples in docs/agent-gsd-guide.md were replaced with named-CLI equivalents
</output>
