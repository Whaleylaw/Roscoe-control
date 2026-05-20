# /waypoint Command API Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Add a minimal, safe `/waypoint` command surface for Mission Control so Hermes/Telegram/Slack/UI clients can query status, start/reuse Waypoint routes, and run bounded Autopilot against Waypoint-enabled projects.

**Architecture:** Keep the implementation API-first. Add a small command parser/executor in `src/lib/waypoint-command.ts`, expose it through `POST /api/projects/[id]/waypoint/command`, and add focused convenience endpoints for route start and Autopilot. Reuse the existing Waypoint library (`src/lib/waypoint.ts`), Autopilot skeleton (`src/lib/waypoint-autopilot.ts`), Workflow Engine functions, auth/workspace/rate-limit patterns, and the current `GET /api/projects/[id]/waypoint/status` endpoint.

**Tech Stack:** Next.js 16 App Router route handlers, TypeScript 5, SQLite/better-sqlite3, zod, Vitest, existing Mission Control auth/workspace utilities.

---

## Context

Anchor design doc: `docs/waypoint-runtime-design.md`.

Already implemented:

- `src/lib/waypoint.ts`
  - Waypoint subject constants and GSD compatibility aliases.
  - `normalizeWaypointScope()`.
  - `startOrReuseWaypointRoute()`.
  - `getWaypointStatus()`.
- `src/lib/waypoint-autopilot.ts`
  - `runWaypointAutopilot()` bounded loop.
- `src/app/api/projects/[id]/waypoint/status/route.ts`
  - Current read-only project Waypoint status endpoint.
- `workflows/waypoint-plan-execution.yaml`
  - First executable Waypoint route.

Non-goals for this plan:

- Do not physically rename `gsd_*` database columns/routes.
- Do not implement an unrestricted autonomous loop.
- Do not build Telegram/Slack gateway parsing inside Mission Control yet; provide an API adapter Hermes can call first.
- Do not auto-create milestones/phases/plans from free text in this slice.
- Do not implement task-scoped discussion sessions in this first command slice; see `docs/superpowers/plans/2026-05-02-waypoint-task-discussion-sessions.md` for the follow-on `/waypoint discuss` implementation.
- Do not bypass existing gates, reviews, auth, tenant/workspace checks, or mutation rate limits.

---

## Proposed API surface

### Existing

```http
GET /api/projects/:id/waypoint/status
```

### Add in this plan

```http
POST /api/projects/:id/waypoint/command
POST /api/projects/:id/waypoint/routes
POST /api/projects/:id/waypoint/autopilot
```

`/command` is the Hermes-friendly adapter. `/routes` and `/autopilot` are typed convenience endpoints that UI/CLI clients can use without command-string parsing.

### Command examples

```json
{ "command": "/waypoint status" }
{ "command": "/waypoint start plan --plan-id 88 --definition waypoint-plan-execution" }
{ "command": "/waypoint auto --max-iterations 3" }
```

### Initial command grammar

- `/waypoint status`
- `/waypoint start plan --plan-id <id> [--definition waypoint-plan-execution] [--version 1]`
- `/waypoint auto [--max-iterations N]`
- `/waypoint help`

Aliases accepted:

- `waypoint status`
- `/wp status`
- `wp status`

---

## Task 1: Add pure command parser tests

**Objective:** Lock the initial `/waypoint` command grammar before wiring it to database side effects.

**Files:**

- Create: `src/lib/__tests__/waypoint-command.test.ts`
- Create later: `src/lib/waypoint-command.ts`

**Step 1: Write failing tests**

```ts
import { describe, expect, it } from 'vitest'
import { parseWaypointCommand } from '../waypoint-command'

describe('parseWaypointCommand', () => {
  it('parses status commands and aliases', () => {
    expect(parseWaypointCommand('/waypoint status')).toEqual({ action: 'status' })
    expect(parseWaypointCommand('wp status')).toEqual({ action: 'status' })
  })

  it('parses plan route start command', () => {
    expect(
      parseWaypointCommand('/waypoint start plan --plan-id 88 --definition waypoint-plan-execution --version 1'),
    ).toEqual({
      action: 'start_route',
      subject: 'plan',
      planId: 88,
      definitionSlug: 'waypoint-plan-execution',
      definitionVersion: 1,
    })
  })

  it('defaults plan execution definition and version', () => {
    expect(parseWaypointCommand('/waypoint start plan --plan-id 88')).toEqual({
      action: 'start_route',
      subject: 'plan',
      planId: 88,
      definitionSlug: 'waypoint-plan-execution',
      definitionVersion: 1,
    })
  })

  it('parses bounded autopilot command', () => {
    expect(parseWaypointCommand('/waypoint auto --max-iterations 3')).toEqual({
      action: 'autopilot',
      maxIterations: 3,
    })
  })

  it('clamps autopilot iteration count at parse boundary', () => {
    expect(parseWaypointCommand('/waypoint auto --max-iterations 500')).toEqual({
      action: 'autopilot',
      maxIterations: 25,
    })
  })

  it('returns help for help command', () => {
    expect(parseWaypointCommand('/waypoint help')).toEqual({ action: 'help' })
  })

  it('returns parse errors for unknown or unsafe commands', () => {
    expect(parseWaypointCommand('/waypoint rm -rf /')).toEqual({
      action: 'error',
      error: 'Unknown Waypoint command. Try /waypoint help.',
    })
  })
})
```

**Step 2: Run test to verify failure**

```bash
pnpm vitest run src/lib/__tests__/waypoint-command.test.ts
```

Expected: FAIL because `src/lib/waypoint-command.ts` does not exist.

---

## Task 2: Implement pure command parser

**Objective:** Add a minimal parser that accepts only the initial safe command grammar.

**Files:**

- Create: `src/lib/waypoint-command.ts`
- Test: `src/lib/__tests__/waypoint-command.test.ts`

**Step 1: Add implementation**

```ts
export type ParsedWaypointCommand =
  | { action: 'status' }
  | { action: 'help' }
  | {
      action: 'start_route'
      subject: 'plan'
      planId: number
      definitionSlug: string
      definitionVersion: number
    }
  | { action: 'autopilot'; maxIterations: number }
  | { action: 'error'; error: string }

const DEFAULT_PLAN_DEFINITION = 'waypoint-plan-execution'
const DEFAULT_DEFINITION_VERSION = 1
const MAX_AUTOPILOT_ITERATIONS = 25

function tokenize(input: string): string[] {
  return input.trim().split(/\s+/).filter(Boolean)
}

function positiveInt(value: string | undefined): number | null {
  if (!value || !/^\d+$/.test(value)) return null
  const parsed = Number(value)
  return parsed > 0 ? parsed : null
}

function option(tokens: string[], name: string): string | undefined {
  const idx = tokens.indexOf(name)
  if (idx === -1) return undefined
  return tokens[idx + 1]
}

export function parseWaypointCommand(input: string): ParsedWaypointCommand {
  const tokens = tokenize(input)
  const root = tokens.shift()?.toLowerCase()
  if (!root || !['/waypoint', 'waypoint', '/wp', 'wp'].includes(root)) {
    return { action: 'error', error: 'Unknown Waypoint command. Try /waypoint help.' }
  }

  const verb = tokens.shift()?.toLowerCase() ?? 'help'
  if (verb === 'help') return { action: 'help' }
  if (verb === 'status') return { action: 'status' }

  if (verb === 'auto' || verb === 'autopilot') {
    const requested = positiveInt(option(tokens, '--max-iterations')) ?? 1
    return { action: 'autopilot', maxIterations: Math.min(requested, MAX_AUTOPILOT_ITERATIONS) }
  }

  if (verb === 'start') {
    const subject = tokens.shift()?.toLowerCase()
    if (subject !== 'plan') {
      return { action: 'error', error: 'Only /waypoint start plan is supported in this slice.' }
    }
    const planId = positiveInt(option(tokens, '--plan-id'))
    if (!planId) return { action: 'error', error: 'Missing required --plan-id <id>.' }
    const definitionSlug = option(tokens, '--definition') ?? DEFAULT_PLAN_DEFINITION
    const definitionVersion = positiveInt(option(tokens, '--version')) ?? DEFAULT_DEFINITION_VERSION
    return { action: 'start_route', subject: 'plan', planId, definitionSlug, definitionVersion }
  }

  return { action: 'error', error: 'Unknown Waypoint command. Try /waypoint help.' }
}

export const WAYPOINT_HELP_TEXT = [
  '/waypoint status',
  '/waypoint start plan --plan-id <id> [--definition waypoint-plan-execution] [--version 1]',
  '/waypoint auto [--max-iterations N]',
  '/waypoint help',
].join('\n')
```

**Step 2: Run parser tests**

```bash
pnpm vitest run src/lib/__tests__/waypoint-command.test.ts
```

Expected: PASS.

---

## Task 3: Add plan-scope resolver tests

**Objective:** Resolve a `plan_id` into the full Waypoint route scope required by `startOrReuseWaypointRoute()`.

**Files:**

- Modify: `src/lib/__tests__/waypoint-command.test.ts`
- Modify: `src/lib/waypoint-command.ts`

**Step 1: Add failing test**

```ts
import Database from 'better-sqlite3'
import { runMigrations } from '../migrations'
import { resolveWaypointPlanRouteScope } from '../waypoint-command'

it('resolves plan route scope from an existing plan', () => {
  const db = new Database(':memory:')
  try {
    runMigrations(db)
    const project = db.prepare(`SELECT id FROM projects WHERE slug = 'general' LIMIT 1`).get() as { id: number }
    db.prepare(`UPDATE projects SET gsd_enabled = 1 WHERE id = ?`).run(project.id)
    const workstreamId = Number(db.prepare(`
      INSERT INTO gsd_workstreams (project_id, key, name, status, created_at, updated_at)
      VALUES (?, 'main', 'Main', 'active', unixepoch(), unixepoch())
    `).run(project.id).lastInsertRowid)
    const milestoneId = Number(db.prepare(`
      INSERT INTO gsd_milestones (project_id, workstream_id, version_label, title, status, created_at, updated_at)
      VALUES (?, ?, 'M1', 'Milestone 1', 'active', unixepoch(), unixepoch())
    `).run(project.id, workstreamId).lastInsertRowid)
    const phaseId = Number(db.prepare(`
      INSERT INTO gsd_phases (milestone_id, slug, title, status, ordering_numeric, created_at, updated_at)
      VALUES (?, 'execute', 'Execute', 'active', 1, unixepoch(), unixepoch())
    `).run(milestoneId).lastInsertRowid)
    const planId = Number(db.prepare(`
      INSERT INTO gsd_plans (phase_id, title, body, status, wave, created_at, updated_at)
      VALUES (?, 'Implement plan', 'Do the work', 'todo', 1, unixepoch(), unixepoch())
    `).run(phaseId).lastInsertRowid)

    expect(resolveWaypointPlanRouteScope(db, { workspaceId: 1, projectId: project.id, planId })).toEqual({
      projectId: project.id,
      workstreamId,
      milestoneId,
      phaseId,
      planId,
      objective: 'Implement plan',
    })
  } finally {
    db.close()
  }
})
```

**Step 2: Run test to verify failure**

```bash
pnpm vitest run src/lib/__tests__/waypoint-command.test.ts
```

Expected: FAIL because `resolveWaypointPlanRouteScope()` is not implemented.

---

## Task 4: Implement plan-scope resolver

**Objective:** Add DB helper that validates workspace/project ownership and extracts the lifecycle IDs for route start.

**Files:**

- Modify: `src/lib/waypoint-command.ts`
- Test: `src/lib/__tests__/waypoint-command.test.ts`

**Step 1: Add implementation**

```ts
import type Database from 'better-sqlite3'

export interface ResolveWaypointPlanRouteScopeInput {
  workspaceId: number
  projectId: number
  planId: number
}

export interface ResolvedWaypointPlanRouteScope {
  projectId: number
  workstreamId: number | null
  milestoneId: number
  phaseId: number
  planId: number
  objective: string
}

export function resolveWaypointPlanRouteScope(
  db: Database.Database,
  input: ResolveWaypointPlanRouteScopeInput,
): ResolvedWaypointPlanRouteScope {
  const row = db.prepare(`
    SELECT
      pl.id AS plan_id,
      pl.title AS plan_title,
      ph.id AS phase_id,
      m.id AS milestone_id,
      m.workstream_id AS workstream_id,
      m.project_id AS project_id
    FROM gsd_plans pl
    JOIN gsd_phases ph ON ph.id = pl.phase_id
    JOIN gsd_milestones m ON m.id = ph.milestone_id
    JOIN projects p ON p.id = m.project_id
    WHERE pl.id = ? AND m.project_id = ? AND p.workspace_id = ? AND p.status = 'active'
    LIMIT 1
  `).get(input.planId, input.projectId, input.workspaceId) as
    | {
        plan_id: number
        plan_title: string
        phase_id: number
        milestone_id: number
        workstream_id: number | null
        project_id: number
      }
    | undefined

  if (!row) {
    throw new Error(`Waypoint plan ${input.planId} not found for project ${input.projectId}`)
  }

  return {
    projectId: row.project_id,
    workstreamId: row.workstream_id,
    milestoneId: row.milestone_id,
    phaseId: row.phase_id,
    planId: row.plan_id,
    objective: row.plan_title,
  }
}
```

**Step 2: Run command tests**

```bash
pnpm vitest run src/lib/__tests__/waypoint-command.test.ts
```

Expected: PASS.

---

## Task 5: Add command executor tests

**Objective:** Verify parsed commands call the correct Waypoint helpers and return Hermes-friendly response payloads.

**Files:**

- Modify: `src/lib/__tests__/waypoint-command.test.ts`
- Modify: `src/lib/waypoint-command.ts`

**Step 1: Add tests with dependency injection**

```ts
import { executeWaypointCommand } from '../waypoint-command'

it('executes status command through injected dependency', () => {
  const result = executeWaypointCommand({} as never, {
    projectId: 42,
    workspaceId: 1,
    tenantId: 1,
    actor: 'tester',
    parsed: { action: 'status' },
    deps: {
      getStatus: () => ({ project: { id: 42, waypoint_enabled: true }, next_actions: [] }),
    },
  })

  expect(result).toMatchObject({ ok: true, action: 'status' })
})

it('executes autopilot command through injected dependency', () => {
  const result = executeWaypointCommand({} as never, {
    projectId: 42,
    workspaceId: 1,
    tenantId: 1,
    actor: 'tester',
    parsed: { action: 'autopilot', maxIterations: 3 },
    deps: {
      runAutopilot: (_db, input) => ({
        iterations: input.maxIterations,
        changed: false,
        stopReason: 'no_progress',
        nextActions: ['Start a route.'],
      }),
    },
  })

  expect(result).toEqual({
    ok: true,
    action: 'autopilot',
    result: {
      iterations: 3,
      changed: false,
      stopReason: 'no_progress',
      nextActions: ['Start a route.'],
    },
    message: 'Waypoint Autopilot stopped: no_progress',
  })
})

it('executes plan route start through injected dependencies', () => {
  const result = executeWaypointCommand({} as never, {
    projectId: 42,
    workspaceId: 1,
    tenantId: 1,
    actor: 'tester',
    parsed: {
      action: 'start_route',
      subject: 'plan',
      planId: 88,
      definitionSlug: 'waypoint-plan-execution',
      definitionVersion: 1,
    },
    deps: {
      resolvePlanScope: () => ({
        projectId: 42,
        workstreamId: 7,
        milestoneId: 9,
        phaseId: 12,
        planId: 88,
        objective: 'Plan 88',
      }),
      startOrReuseRoute: () => ({ instanceId: 7001, reused: false }),
    },
  })

  expect(result).toEqual({
    ok: true,
    action: 'start_route',
    workflowInstanceId: 7001,
    reused: false,
    message: 'Started Waypoint route waypoint-plan-execution for plan 88.',
  })
})
```

**Step 2: Run test to verify failure**

```bash
pnpm vitest run src/lib/__tests__/waypoint-command.test.ts
```

Expected: FAIL because `executeWaypointCommand()` is not implemented.

---

## Task 6: Implement command executor

**Objective:** Execute parsed commands against existing Waypoint helpers with explicit dependency injection for testability.

**Files:**

- Modify: `src/lib/waypoint-command.ts`
- Test: `src/lib/__tests__/waypoint-command.test.ts`

**Step 1: Add imports**

```ts
import { runWaypointAutopilot } from './waypoint-autopilot'
import {
  WAYPOINT_SUBJECT_TYPES,
  getWaypointStatus,
  startOrReuseWaypointRoute,
} from './waypoint'
```

**Step 2: Add executor types and implementation**

```ts
export interface ExecuteWaypointCommandInput {
  projectId: number
  workspaceId: number
  tenantId?: number
  actor: string
  parsed: ParsedWaypointCommand
  deps?: Partial<ExecuteWaypointCommandDeps>
}

export interface ExecuteWaypointCommandDeps {
  getStatus: typeof getWaypointStatus
  runAutopilot: typeof runWaypointAutopilot
  resolvePlanScope: typeof resolveWaypointPlanRouteScope
  startOrReuseRoute: typeof startOrReuseWaypointRoute
}

export type ExecuteWaypointCommandResult =
  | { ok: true; action: 'status'; status: unknown; message: string }
  | { ok: true; action: 'help'; help: string; message: string }
  | { ok: true; action: 'autopilot'; result: unknown; message: string }
  | { ok: true; action: 'start_route'; workflowInstanceId: number; reused: boolean; message: string }
  | { ok: false; action: 'error'; error: string; message: string }

const defaultDeps: ExecuteWaypointCommandDeps = {
  getStatus: getWaypointStatus,
  runAutopilot: runWaypointAutopilot,
  resolvePlanScope: resolveWaypointPlanRouteScope,
  startOrReuseRoute: startOrReuseWaypointRoute,
}

export function executeWaypointCommand(
  db: Database.Database,
  input: ExecuteWaypointCommandInput,
): ExecuteWaypointCommandResult {
  const deps = { ...defaultDeps, ...(input.deps ?? {}) }
  const parsed = input.parsed

  if (parsed.action === 'error') {
    return { ok: false, action: 'error', error: parsed.error, message: parsed.error }
  }

  if (parsed.action === 'help') {
    return { ok: true, action: 'help', help: WAYPOINT_HELP_TEXT, message: WAYPOINT_HELP_TEXT }
  }

  if (parsed.action === 'status') {
    const status = deps.getStatus(db, { projectId: input.projectId, workspaceId: input.workspaceId })
    return { ok: true, action: 'status', status, message: 'Waypoint status loaded.' }
  }

  if (parsed.action === 'autopilot') {
    const result = deps.runAutopilot(db, {
      projectId: input.projectId,
      workspaceId: input.workspaceId,
      actor: input.actor,
      maxIterations: parsed.maxIterations,
    })
    return {
      ok: true,
      action: 'autopilot',
      result,
      message: `Waypoint Autopilot stopped: ${result.stopReason}`,
    }
  }

  const scope = deps.resolvePlanScope(db, {
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    planId: parsed.planId,
  })
  const route = deps.startOrReuseRoute(db, {
    workspaceId: input.workspaceId,
    tenantId: input.tenantId,
    actor: input.actor,
    projectId: input.projectId,
    subjectType: WAYPOINT_SUBJECT_TYPES.plan,
    subjectId: parsed.planId,
    definitionSlug: parsed.definitionSlug,
    definitionVersion: parsed.definitionVersion,
    vars: {
      project_id: scope.projectId,
      workstream_id: scope.workstreamId,
      milestone_id: scope.milestoneId,
      phase_id: scope.phaseId,
      plan_id: scope.planId,
      objective: scope.objective,
    },
  })

  return {
    ok: true,
    action: 'start_route',
    workflowInstanceId: route.instanceId,
    reused: route.reused,
    message: `${route.reused ? 'Reused' : 'Started'} Waypoint route ${parsed.definitionSlug} for plan ${parsed.planId}.`,
  }
}
```

**Step 3: Run command tests**

```bash
pnpm vitest run src/lib/__tests__/waypoint-command.test.ts
```

Expected: PASS.

---

## Task 7: Add `/api/projects/[id]/waypoint/command` route tests

**Objective:** Expose the command executor as a secured, rate-limited project API endpoint.

**Files:**

- Create: `src/app/api/projects/[id]/waypoint/command/__tests__/route.test.ts`
- Create later: `src/app/api/projects/[id]/waypoint/command/route.ts`

**Step 1: Write failing route tests**

Use the pattern from `src/app/api/projects/[id]/waypoint/status/__tests__/route.test.ts`.

Test cases:

1. Requires operator role.
2. Returns 400 for invalid project id.
3. Returns 400 when request body lacks a string `command`.
4. Returns 409 when the project does not have Waypoint/GSD enabled.
5. Executes `/waypoint help` and returns `{ ok: true, action: 'help' }`.
6. Executes `/waypoint status` and returns `{ ok: true, action: 'status' }`.

**Step 2: Use these body helpers**

```ts
function req(projectId: number | string, body: unknown) {
  return new NextRequest(`http://localhost/api/projects/${projectId}/waypoint/command`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}
```

**Step 3: Run tests to verify failure**

```bash
pnpm vitest run src/app/api/projects/[id]/waypoint/command/__tests__/route.test.ts
```

Expected: FAIL because route does not exist.

---

## Task 8: Implement `/api/projects/[id]/waypoint/command`

**Objective:** Add the Hermes-facing command endpoint.

**Files:**

- Create: `src/app/api/projects/[id]/waypoint/command/route.ts`
- Test: `src/app/api/projects/[id]/waypoint/command/__tests__/route.test.ts`

**Step 1: Implement route**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { parseStrictId, getScopedProject } from '@/lib/gsd-hierarchy'
import { logger } from '@/lib/logger'
import { mutationLimiter } from '@/lib/rate-limit'
import { executeWaypointCommand, parseWaypointCommand } from '@/lib/waypoint-command'
import { ensureTenantWorkspaceAccess, ForbiddenError } from '@/lib/workspaces'

const Body = z.object({
  command: z.string().min(1).max(500),
})

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const body = await request.json().catch(() => ({}))
    const parsedBody = Body.safeParse(body)
    if (!parsedBody.success) {
      return NextResponse.json({ error: 'Invalid request body', details: parsedBody.error.issues }, { status: 400 })
    }

    const { id } = await params
    const projectId = parseStrictId(id)
    if (projectId == null) return NextResponse.json({ error: 'Invalid project ID' }, { status: 400 })

    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const tenantId = auth.user.tenant_id ?? 1
    const forwardedFor = (request.headers.get('x-forwarded-for') || '').split(',')[0]?.trim() || null
    ensureTenantWorkspaceAccess(db, tenantId, workspaceId, {
      actor: auth.user.username,
      actorId: auth.user.id,
      route: '/api/projects/[id]/waypoint/command',
      ipAddress: forwardedFor,
      userAgent: request.headers.get('user-agent'),
    })

    const project = getScopedProject(db, projectId, workspaceId)
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

    const lifecycleState = db.prepare(`
      SELECT COALESCE(gsd_enabled, 0) AS gsd_enabled
      FROM projects
      WHERE id = ? AND workspace_id = ?
      LIMIT 1
    `).get(projectId, workspaceId) as { gsd_enabled: number } | undefined
    if (!lifecycleState?.gsd_enabled) {
      return NextResponse.json({ error: 'Waypoint lifecycle is not enabled for this project' }, { status: 409 })
    }

    const actor = auth.user.display_name || auth.user.username || 'system'
    const parsed = parseWaypointCommand(parsedBody.data.command)
    const result = executeWaypointCommand(db, {
      projectId,
      workspaceId,
      tenantId,
      actor,
      parsed,
    })

    return NextResponse.json(result, { status: result.ok ? 200 : 400 })
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    logger.error({ err: error }, 'POST /api/projects/[id]/waypoint/command error')
    const message = error instanceof Error ? error.message : 'Failed to execute Waypoint command'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
```

**Step 2: Run route tests**

```bash
pnpm vitest run src/app/api/projects/[id]/waypoint/command/__tests__/route.test.ts
```

Expected: PASS.

---

## Task 9: Add `/api/projects/[id]/waypoint/routes` endpoint tests

**Objective:** Provide typed route-start API without command parsing.

**Files:**

- Create: `src/app/api/projects/[id]/waypoint/routes/__tests__/route.test.ts`
- Create later: `src/app/api/projects/[id]/waypoint/routes/route.ts`

**Step 1: Write tests**

Test cases:

1. Requires operator role.
2. Requires Waypoint/GSD enabled project.
3. `POST { "subject": "plan", "plan_id": 88 }` starts/reuses `waypoint-plan-execution` and returns `workflow_instance_id` plus `reused`.
4. Invalid subject returns 400.
5. Missing `plan_id` returns 400.

**Step 2: Run tests to verify failure**

```bash
pnpm vitest run src/app/api/projects/[id]/waypoint/routes/__tests__/route.test.ts
```

Expected: FAIL because route does not exist.

---

## Task 10: Implement `/api/projects/[id]/waypoint/routes`

**Objective:** Add typed plan route start endpoint for UI/CLI callers.

**Files:**

- Create: `src/app/api/projects/[id]/waypoint/routes/route.ts`
- Test: `src/app/api/projects/[id]/waypoint/routes/__tests__/route.test.ts`

**Implementation notes:**

- Role: `operator`.
- Rate-limit: `mutationLimiter(request)`.
- Workspace access: same as status/command routes.
- Body schema:

```ts
const Body = z.object({
  subject: z.literal('plan'),
  plan_id: z.number().int().positive(),
  definition_slug: z.string().min(1).max(100).default('waypoint-plan-execution'),
  definition_version: z.number().int().positive().default(1),
})
```

- Reuse `resolveWaypointPlanRouteScope()` and `startOrReuseWaypointRoute()`.
- Return:

```json
{
  "workflow_instance_id": 7001,
  "reused": false,
  "subject_type": "waypoint_plan",
  "subject_id": "88",
  "definition_slug": "waypoint-plan-execution",
  "definition_version": 1
}
```

**Step 2: Run route tests**

```bash
pnpm vitest run src/app/api/projects/[id]/waypoint/routes/__tests__/route.test.ts
```

Expected: PASS.

---

## Task 11: Add `/api/projects/[id]/waypoint/autopilot` endpoint tests

**Objective:** Expose bounded Autopilot through a safe project API endpoint.

**Files:**

- Create: `src/app/api/projects/[id]/waypoint/autopilot/__tests__/route.test.ts`
- Create later: `src/app/api/projects/[id]/waypoint/autopilot/route.ts`

**Step 1: Write tests**

Test cases:

1. Requires operator role.
2. Requires Waypoint/GSD enabled project.
3. Defaults `max_iterations` to 1.
4. Clamps `max_iterations` to 25 at endpoint boundary.
5. Returns Autopilot result payload with `iterations`, `changed`, `stopReason`, `nextActions`.

**Step 2: Run tests to verify failure**

```bash
pnpm vitest run src/app/api/projects/[id]/waypoint/autopilot/__tests__/route.test.ts
```

Expected: FAIL because route does not exist.

---

## Task 12: Implement `/api/projects/[id]/waypoint/autopilot`

**Objective:** Add safe bounded Autopilot endpoint.

**Files:**

- Create: `src/app/api/projects/[id]/waypoint/autopilot/route.ts`
- Test: `src/app/api/projects/[id]/waypoint/autopilot/__tests__/route.test.ts`

**Implementation notes:**

- Role: `operator`.
- Rate-limit: `mutationLimiter(request)`.
- Workspace access: same as status/command routes.
- Body schema:

```ts
const Body = z.object({
  max_iterations: z.number().int().positive().max(25).default(1),
})
```

- Call:

```ts
runWaypointAutopilot(db, {
  projectId,
  workspaceId,
  actor,
  maxIterations: parsed.data.max_iterations,
})
```

- Return:

```json
{
  "iterations": 1,
  "changed": false,
  "stopReason": "no_progress",
  "nextActions": []
}
```

**Step 2: Run route tests**

```bash
pnpm vitest run src/app/api/projects/[id]/waypoint/autopilot/__tests__/route.test.ts
```

Expected: PASS.

---

## Task 13: Update OpenAPI/index docs for new endpoints

**Objective:** Make the new `/waypoint` surface discoverable to API clients.

**Files:**

- Modify: `openapi.json` if it is manually maintained in this repo.
- Modify: `docs/waypoint-runtime-design.md` command/API section.
- Optionally modify: `docs/agent-gsd-guide.md` only if it already documents command surfaces.

**Step 1: Update docs**

Add:

```markdown
### Waypoint command/API endpoints

- `GET /api/projects/:id/waypoint/status` — read lifecycle + route + task status.
- `POST /api/projects/:id/waypoint/command` — execute a safe parsed `/waypoint` command.
- `POST /api/projects/:id/waypoint/routes` — start/reuse a typed route, initially plan routes.
- `POST /api/projects/:id/waypoint/autopilot` — run bounded Autopilot for up to 25 iterations.
```

**Step 2: Verify docs references**

```bash
pnpm typecheck
```

Expected: PASS.

---

## Task 14: Add minimal Hermes adapter note

**Objective:** Document how Hermes should call this API from Telegram/Slack after the Mission Control route exists, and point deliberate discussion/chat work at the follow-on task-scoped discussion plan.

**Files:**

- Modify: `docs/waypoint-runtime-design.md`
- Optionally create: `docs/waypoint-command-adapter.md`

**Content:**

```markdown
## Hermes gateway adapter convention

For a Telegram/Slack message in a project context:

1. Resolve the Mission Control project id from the channel/case/session metadata.
2. POST the raw text to `/api/projects/:id/waypoint/command` as `{ "command": "..." }`.
3. Render `message` in chat.
4. For `status`, optionally include compact counts from `status.lifecycle`, `status.routes`, and `status.tasks`.
5. Never call Autopilot with more than the endpoint maximum and never bypass pending gates.
```

**Step 2: Verify no code impact**

No code verification needed beyond docs spelling/format review.

---

## Task 15: Run targeted verification

**Objective:** Prove the new command API did not regress the existing Waypoint slice.

**Files:**

- All touched files.

**Step 1: Run targeted tests**

```bash
pnpm vitest run \
  src/lib/__tests__/waypoint.test.ts \
  src/lib/__tests__/waypoint-command.test.ts \
  src/lib/__tests__/waypoint-routes.test.ts \
  src/lib/__tests__/waypoint-autopilot.test.ts \
  src/app/api/projects/[id]/waypoint/status/__tests__/route.test.ts \
  src/app/api/projects/[id]/waypoint/command/__tests__/route.test.ts \
  src/app/api/projects/[id]/waypoint/routes/__tests__/route.test.ts \
  src/app/api/projects/[id]/waypoint/autopilot/__tests__/route.test.ts
```

Expected: all tests PASS.

**Step 2: Run typecheck**

```bash
pnpm typecheck
```

Expected: PASS.

**Step 3: Run lint**

```bash
pnpm lint
```

Expected: PASS with no errors. Existing warnings are acceptable only if unchanged.

---

## Task 16: Manual smoke test against dev server

**Objective:** Verify the endpoint behavior in a running Mission Control instance.

**Files:**

- No file changes.

**Step 1: Start dev server if not already running**

```bash
pnpm dev
```

**Step 2: Use authenticated client or API key according to local setup**

Smoke commands, substituting project id and auth header/cookie as appropriate:

```bash
curl -sS http://localhost:3000/api/projects/1/waypoint/status

curl -sS -X POST http://localhost:3000/api/projects/1/waypoint/command \
  -H 'content-type: application/json' \
  -d '{"command":"/waypoint help"}'

curl -sS -X POST http://localhost:3000/api/projects/1/waypoint/command \
  -H 'content-type: application/json' \
  -d '{"command":"/waypoint auto --max-iterations 1"}'
```

Expected:

- Status endpoint returns the current Waypoint read model or a clear 409 if lifecycle is disabled.
- Help command returns `ok: true`, `action: help`.
- Autopilot returns bounded stop reason and next actions.

---

## Implementation order summary

1. Parser tests.
2. Parser implementation.
3. Plan-scope resolver tests.
4. Plan-scope resolver implementation.
5. Command executor tests.
6. Command executor implementation.
7. `/command` route tests.
8. `/command` route implementation.
9. `/routes` route tests.
10. `/routes` route implementation.
11. `/autopilot` route tests.
12. `/autopilot` route implementation.
13. Docs/OpenAPI update.
14. Hermes adapter note.
15. Targeted verification.
16. Manual smoke test.

---

## Future follow-up after this plan

After the initial `/waypoint` API works, make separate plans for:

1. UI panel for Waypoint status/routes/autopilot.
2. Hermes-side Telegram/Slack command adapter with project/case context resolution.
3. Additional route definitions:
   - `waypoint-milestone-planning`
   - `waypoint-slice-verification`
   - `waypoint-doctor`
   - `waypoint-forensics`
4. Lifecycle transition binding from workflow completion back to phase/plan/milestone transitions.
5. Route event streaming and compact chat summaries.
