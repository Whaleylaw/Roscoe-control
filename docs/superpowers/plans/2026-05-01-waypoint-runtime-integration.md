# Waypoint Runtime Integration Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Integrate Mission Control's existing lifecycle hierarchy with Workflow Engine v1 under the new Waypoint runtime vocabulary without disrupting current FirmVault workflow testing.

**Architecture:** Add a small Waypoint compatibility layer over existing `gsd_*` lifecycle tables and workflow instances. Keep physical schema/API names stable in the first pass, introduce `waypoint_*` subject conventions, and route materialization/status through explicit helper functions and tests.

**Tech Stack:** Next.js 16, TypeScript 5, SQLite/better-sqlite3, Vitest, Workflow Engine YAML definitions.

---

## Context

Anchor design doc: `docs/waypoint-runtime-design.md`.

Existing substrates:

- Lifecycle/hierarchy: `src/lib/gsd-hierarchy.ts`, `docs/agent-gsd-guide.md`, `gsd_workstreams`, `gsd_milestones`, `gsd_phases`, `gsd_plans`.
- Workflow Engine: `src/lib/workflow-engine.ts`, `docs/workflow-engine-v1.md`, `workflow_definitions`, `workflow_instances`, `workflow_node_instances`, `workflow_node_dependencies`, `workflow_events`.
- Current workflow definitions: `workflows/*.yaml`.
- Existing GSD-scoped leaf recipes: `recipes/gsd-*`.

Non-goals for this plan:

- Do not physically rename `gsd_*` database columns.
- Do not replace FirmVault workflows.
- Do not add an unrestricted autonomous loop.
- Do not rely on workflow variable template substitution.
- Do not automate destructive/external side effects without gate policy.

---

## Task 1: Add Waypoint helper tests for subject constants and route keys

**Objective:** Lock the public Waypoint subject vocabulary and route-key format before implementation.

**Files:**

- Create: `src/lib/__tests__/waypoint.test.ts`
- Create later: `src/lib/waypoint.ts`

**Step 1: Write failing tests**

```ts
import { describe, expect, it } from 'vitest'
import {
  WAYPOINT_SUBJECT_TYPES,
  buildWaypointRouteKey,
  isWaypointSubjectType,
} from '../waypoint'

describe('waypoint helpers', () => {
  it('defines stable Waypoint subject types', () => {
    expect(WAYPOINT_SUBJECT_TYPES).toEqual({
      project: 'waypoint_project',
      workstream: 'waypoint_workstream',
      milestone: 'waypoint_milestone',
      phase: 'waypoint_phase',
      plan: 'waypoint_plan',
    })
  })

  it('detects Waypoint and compatibility subject types', () => {
    expect(isWaypointSubjectType('waypoint_plan')).toBe(true)
    expect(isWaypointSubjectType('gsd_plan')).toBe(true)
    expect(isWaypointSubjectType('law_firm_case')).toBe(false)
  })

  it('builds stable route keys', () => {
    expect(
      buildWaypointRouteKey({
        subjectType: 'waypoint_plan',
        subjectId: 88,
        definitionSlug: 'waypoint-plan-execution',
        definitionVersion: 1,
      }),
    ).toBe('waypoint:waypoint_plan:88:waypoint-plan-execution:v1')
  })
})
```

**Step 2: Run test to verify failure**

Run:

```bash
pnpm vitest run src/lib/__tests__/waypoint.test.ts
```

Expected: FAIL because `src/lib/waypoint.ts` does not exist.

---

## Task 2: Implement core Waypoint helper module

**Objective:** Add constants and pure helpers for subject detection and route-key generation.

**Files:**

- Create: `src/lib/waypoint.ts`
- Test: `src/lib/__tests__/waypoint.test.ts`

**Step 1: Add implementation**

```ts
export const WAYPOINT_SUBJECT_TYPES = {
  project: 'waypoint_project',
  workstream: 'waypoint_workstream',
  milestone: 'waypoint_milestone',
  phase: 'waypoint_phase',
  plan: 'waypoint_plan',
} as const

export const WAYPOINT_COMPAT_SUBJECT_TYPES = {
  project: 'gsd_project',
  workstream: 'gsd_workstream',
  milestone: 'gsd_milestone',
  phase: 'gsd_phase',
  plan: 'gsd_plan',
} as const

export type WaypointSubjectType =
  | (typeof WAYPOINT_SUBJECT_TYPES)[keyof typeof WAYPOINT_SUBJECT_TYPES]
  | (typeof WAYPOINT_COMPAT_SUBJECT_TYPES)[keyof typeof WAYPOINT_COMPAT_SUBJECT_TYPES]

export interface BuildWaypointRouteKeyInput {
  subjectType: WaypointSubjectType
  subjectId: string | number
  definitionSlug: string
  definitionVersion: string | number
}

const waypointSubjectTypeValues = new Set<string>([
  ...Object.values(WAYPOINT_SUBJECT_TYPES),
  ...Object.values(WAYPOINT_COMPAT_SUBJECT_TYPES),
])

export function isWaypointSubjectType(value: string): value is WaypointSubjectType {
  return waypointSubjectTypeValues.has(value)
}

export function buildWaypointRouteKey(input: BuildWaypointRouteKeyInput): string {
  return [
    'waypoint',
    input.subjectType,
    String(input.subjectId),
    input.definitionSlug,
    `v${String(input.definitionVersion).replace(/^v/i, '')}`,
  ].join(':')
}
```

**Step 2: Run test to verify pass**

```bash
pnpm vitest run src/lib/__tests__/waypoint.test.ts
```

Expected: PASS.

**Step 3: Commit**

Only commit if the working tree is intentionally scoped for this work:

```bash
git add src/lib/waypoint.ts src/lib/__tests__/waypoint.test.ts
git commit -m "feat: add Waypoint subject helpers"
```

---

## Task 3: Add tests for lifecycle scope normalization

**Objective:** Convert workflow `subject_type` + `subject_id` + vars into a normalized lifecycle scope payload.

**Files:**

- Modify: `src/lib/__tests__/waypoint.test.ts`
- Modify later: `src/lib/waypoint.ts`

**Step 1: Add failing tests**

```ts
import { normalizeWaypointScope } from '../waypoint'

it('normalizes plan scope from route vars', () => {
  expect(
    normalizeWaypointScope({
      subjectType: 'waypoint_plan',
      subjectId: '88',
      vars: {
        project_id: 42,
        workstream_id: 7,
        milestone_id: 9,
        phase_id: 12,
        plan_id: 88,
      },
    }),
  ).toEqual({
    projectId: 42,
    workstreamId: 7,
    milestoneId: 9,
    phaseId: 12,
    planId: 88,
  })
})

it('falls back to subject id for matching subject type', () => {
  expect(
    normalizeWaypointScope({
      subjectType: 'waypoint_milestone',
      subjectId: '9',
      vars: { project_id: 42 },
    }),
  ).toEqual({
    projectId: 42,
    workstreamId: null,
    milestoneId: 9,
    phaseId: null,
    planId: null,
  })
})

it('rejects non-Waypoint subjects', () => {
  expect(() =>
    normalizeWaypointScope({
      subjectType: 'law_firm_case',
      subjectId: 'case-1',
      vars: {},
    }),
  ).toThrow(/Unsupported Waypoint subject type/)
})
```

**Step 2: Run test to verify failure**

```bash
pnpm vitest run src/lib/__tests__/waypoint.test.ts
```

Expected: FAIL because `normalizeWaypointScope` is not implemented.

---

## Task 4: Implement lifecycle scope normalization

**Objective:** Provide a pure helper that route/materialization/status code can share.

**Files:**

- Modify: `src/lib/waypoint.ts`
- Test: `src/lib/__tests__/waypoint.test.ts`

**Step 1: Add implementation**

```ts
export interface NormalizeWaypointScopeInput {
  subjectType: string
  subjectId: string | number
  vars?: Record<string, unknown> | null
}

export interface WaypointScope {
  projectId: number | null
  workstreamId: number | null
  milestoneId: number | null
  phaseId: number | null
  planId: number | null
}

function numeric(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value)
  return null
}

export function normalizeWaypointScope(input: NormalizeWaypointScopeInput): WaypointScope {
  if (!isWaypointSubjectType(input.subjectType)) {
    throw new Error(`Unsupported Waypoint subject type: ${input.subjectType}`)
  }

  const vars = input.vars ?? {}
  const subjectId = numeric(input.subjectId)

  return {
    projectId:
      numeric(vars.project_id) ??
      (input.subjectType === WAYPOINT_SUBJECT_TYPES.project || input.subjectType === WAYPOINT_COMPAT_SUBJECT_TYPES.project
        ? subjectId
        : null),
    workstreamId:
      numeric(vars.workstream_id) ??
      (input.subjectType === WAYPOINT_SUBJECT_TYPES.workstream || input.subjectType === WAYPOINT_COMPAT_SUBJECT_TYPES.workstream
        ? subjectId
        : null),
    milestoneId:
      numeric(vars.milestone_id) ??
      (input.subjectType === WAYPOINT_SUBJECT_TYPES.milestone || input.subjectType === WAYPOINT_COMPAT_SUBJECT_TYPES.milestone
        ? subjectId
        : null),
    phaseId:
      numeric(vars.phase_id) ??
      (input.subjectType === WAYPOINT_SUBJECT_TYPES.phase || input.subjectType === WAYPOINT_COMPAT_SUBJECT_TYPES.phase
        ? subjectId
        : null),
    planId:
      numeric(vars.plan_id) ??
      (input.subjectType === WAYPOINT_SUBJECT_TYPES.plan || input.subjectType === WAYPOINT_COMPAT_SUBJECT_TYPES.plan
        ? subjectId
        : null),
  }
}
```

**Step 2: Run tests**

```bash
pnpm vitest run src/lib/__tests__/waypoint.test.ts
```

Expected: PASS.

---

## Task 5: Add route definition validation test for `waypoint-plan-execution`

**Objective:** Verify the first Waypoint workflow YAML parses with the existing Workflow Engine.

**Files:**

- Create: `workflows/waypoint-plan-execution.yaml`
- Modify: `src/lib/__tests__/workflow-engine.test.ts` or create `src/lib/__tests__/waypoint-workflows.test.ts`

**Step 1: Write failing test**

```ts
import { describe, expect, it } from 'vitest'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { parseWorkflowDefinition } from '../workflow-engine'

describe('Waypoint workflow definitions', () => {
  it('parses waypoint-plan-execution', async () => {
    const raw = await readFile(join(process.cwd(), 'workflows/waypoint-plan-execution.yaml'), 'utf8')
    const definition = parseWorkflowDefinition(raw)

    expect(definition.id).toBe('waypoint-plan-execution')
    expect(definition.subject_type).toBe('waypoint_plan')
    expect(definition.nodes.inspect_context.type).toBe('recipe')
    expect(definition.nodes.implement_plan.recipe).toBe('gsd-coder')
    expect(definition.nodes.review_plan.recipe).toBe('gsd-reviewer')
    expect(definition.nodes.human_acceptance_gate.type).toBe('review')
  })
})
```

**Step 2: Run test to verify failure**

```bash
pnpm vitest run src/lib/__tests__/waypoint-workflows.test.ts
```

Expected: FAIL because the YAML file does not exist.

---

## Task 6: Add first Waypoint workflow definition

**Objective:** Add the initial executable route definition that binds a Waypoint plan to context inspection, implementation, review, and human acceptance.

**Files:**

- Create: `workflows/waypoint-plan-execution.yaml`
- Test: `src/lib/__tests__/waypoint-workflows.test.ts`

**Step 1: Create YAML definition**

```yaml
schema_version: 1
id: waypoint-plan-execution
name: Waypoint Plan Execution
version: 1
subject_type: waypoint_plan

vars:
  project_id:
    required: true
    type: number
  workstream_id:
    required: false
    type: number
  milestone_id:
    required: true
    type: number
  phase_id:
    required: true
    type: number
  plan_id:
    required: true
    type: number
  objective:
    required: true
    type: string
  source_platform:
    required: false
    type: string
  source_chat_id:
    required: false
    type: string
  source_thread_id:
    required: false
    type: string

triggers:
  - type: manual

nodes:
  inspect_context:
    type: recipe
    recipe: gsd-researcher
    description: Inspect project context, lifecycle graph, repo state, acceptance criteria, and prior artifacts.
    config:
      task_goal: Produce a concise context brief for this Waypoint plan.

  implement_plan:
    type: recipe
    recipe: gsd-coder
    description: Implement the smallest safe change satisfying the active Waypoint plan.
    depends_on:
      nodes:
        - inspect_context
    config:
      task_goal: Execute the Waypoint plan with tests and artifacts.

  review_plan:
    type: recipe
    recipe: gsd-reviewer
    description: Review implementation against the plan and acceptance criteria.
    depends_on:
      nodes:
        - implement_plan
    config:
      task_goal: Produce pass/fail review and required fixes.

  human_acceptance_gate:
    type: review
    review:
      mode: human
    depends_on:
      nodes:
        - review_plan
    description: Human/operator acceptance gate before marking the Waypoint plan done.
```

**Step 2: Run test**

```bash
pnpm vitest run src/lib/__tests__/waypoint-workflows.test.ts
```

Expected: PASS.

---

## Task 7: Add task materialization metadata tests

**Objective:** Ensure Waypoint route instances can propagate lifecycle IDs into materialized tasks.

**Files:**

- Modify: `src/lib/__tests__/workflow-engine.test.ts` or create `src/lib/__tests__/waypoint-materialization.test.ts`
- Modify later: `src/lib/workflow-engine.ts` or add wrapper in `src/lib/waypoint.ts`

**Step 1: Write failing integration test**

Use the existing `workflow-engine.test.ts` patterns with `Database(':memory:')` and `runMigrations(db)`.

Test shape:

```ts
it('materializes Waypoint recipe nodes with lifecycle task metadata', () => {
  const db = new Database(':memory:')
  runMigrations(db)

  // Insert minimal project + lifecycle hierarchy rows.
  // Create workflow definition with subject_type waypoint_plan.
  // Start instance with vars_json carrying project_id/workstream_id/milestone_id/phase_id/plan_id.
  // Call materializeReadyWorkflowNodes(db, ...).
  // Assert created task has gsd_workstream_id, gsd_milestone_id, gsd_phase_id, gsd_plan_id.
})
```

Expected failure: materialization does not yet populate all lifecycle IDs.

**Step 2: Run targeted test**

```bash
pnpm vitest run src/lib/__tests__/waypoint-materialization.test.ts
```

Expected: FAIL until Task 8.

---

## Task 8: Implement lifecycle ID propagation during materialization

**Objective:** Teach workflow materialization, or a Waypoint wrapper around it, to derive task lifecycle fields from instance vars and subject binding.

**Files:**

- Modify: `src/lib/workflow-engine.ts` if direct integration is clean
- Or modify/create: `src/lib/waypoint.ts` with a wrapper if lower risk
- Test: `src/lib/__tests__/waypoint-materialization.test.ts`

**Implementation guidance:**

- Prefer a narrow helper so FirmVault behavior remains unaffected.
- Only apply lifecycle metadata when `isWaypointSubjectType(instance.subject_type)` is true.
- Use `normalizeWaypointScope()` to derive IDs.
- Populate existing task columns:
  - `gsd_workstream_id`
  - `gsd_milestone_id`
  - `gsd_phase_id`
  - `gsd_plan_id`
- Do not add new task columns in this task.
- Continue using `workflow_node_instances.task_id` as the workflow linkage unless a later decision adds direct columns.

**Verification:**

```bash
pnpm vitest run src/lib/__tests__/waypoint.test.ts src/lib/__tests__/waypoint-materialization.test.ts src/lib/__tests__/workflow-engine.test.ts
```

Expected: PASS.

---

## Task 9: Add a Waypoint status read-model helper

**Objective:** Aggregate lifecycle scope, active route instances, node states, and tasks into a single read-model object.

**Files:**

- Modify: `src/lib/waypoint.ts`
- Create or modify: `src/lib/__tests__/waypoint-status.test.ts`

**Step 1: Define return shape**

```ts
export interface WaypointStatusReadModel {
  project: { id: number; name: string; waypoint_enabled: boolean }
  lifecycle: {
    workstreams: unknown[]
    milestones: unknown[]
    active_phase: unknown | null
    active_plan: unknown | null
    blocked_gates: unknown[]
  }
  routes: Array<{
    workflow_instance_id: number
    definition_slug: string
    subject_type: string
    subject_id: string
    status: string
    nodes: unknown[]
  }>
  tasks: {
    active: unknown[]
    waiting_on_gate: unknown[]
    failed: unknown[]
  }
  next_actions: string[]
}
```

**Step 2: Test with in-memory database fixture**

- Insert project with `gsd_enabled = 1`.
- Insert one lifecycle row for each level.
- Insert one active workflow instance and nodes.
- Insert one task linked to GSD IDs.
- Assert the read model includes all layers.

**Verification:**

```bash
pnpm vitest run src/lib/__tests__/waypoint-status.test.ts
```

Expected: PASS after helper implementation.

---

## Task 10: Add minimal Waypoint API endpoint

**Objective:** Expose status through a Waypoint-facing route without removing current GSD routes.

**Files:**

- Create: `src/app/api/projects/[id]/waypoint/status/route.ts`
- Create: `src/app/api/projects/[id]/waypoint/__tests__/status-route.test.ts` or equivalent existing API test location
- Reuse: `src/lib/waypoint.ts`

**Step 1: Implement endpoint behavior**

- Require auth using existing route conventions.
- Resolve project id from params.
- Verify project exists and belongs to workspace/tenant per existing project API patterns.
- Call `getWaypointStatus(db, { projectId })`.
- Return JSON read model.

**Step 2: Add route tests**

Test cases:

1. Returns 200 with read model for an enabled project.
2. Returns 404 for missing project.
3. Returns 409 or clear disabled response when lifecycle/Waypoint is not enabled.

**Verification:**

```bash
pnpm vitest run src/app/api/projects/[id]/waypoint/__tests__/status-route.test.ts
```

Expected: PASS.

---

## Task 11: Add route start/reuse helper for plan execution

**Objective:** Start or reuse a Waypoint workflow instance idempotently for a plan execution route.

**Files:**

- Modify: `src/lib/waypoint.ts`
- Test: `src/lib/__tests__/waypoint.test.ts` or `src/lib/__tests__/waypoint-routes.test.ts`

**Behavior:**

`startOrReuseWaypointRoute(db, input)` should:

1. verify `project.gsd_enabled = 1`;
2. verify definition exists for `waypoint-plan-execution` v1;
3. build the route key with `buildWaypointRouteKey()`;
4. check for an existing active/blocked instance with that key if a key column exists, or by subject/definition/status if not;
5. call `startWorkflowInstance()` only when no reusable instance exists;
6. return `{ instanceId, reused }`.

**Verification:**

```bash
pnpm vitest run src/lib/__tests__/waypoint-routes.test.ts
```

Expected: PASS.

---

## Task 12: Add bounded Autopilot skeleton only

**Objective:** Add a safe no-surprises controller skeleton that can materialize/advance but stops on gates/blockers/budget.

**Files:**

- Modify or create: `src/lib/waypoint-autopilot.ts`
- Create: `src/lib/__tests__/waypoint-autopilot.test.ts`

**Behavior:**

`runWaypointAutopilot(db, input)` should initially:

1. load Waypoint status;
2. run due workflow timers;
3. materialize ready nodes for active Waypoint routes;
4. stop immediately if any human gate is pending;
5. stop if no progress occurs;
6. stop when `maxIterations` is reached;
7. return summary with `iterations`, `changed`, `stopReason`, `nextActions`.

**Safety:**

Do not execute destructive/external side-effect actions here. This controller should coordinate existing Workflow Engine functions and return status.

**Verification:**

```bash
pnpm vitest run src/lib/__tests__/waypoint-autopilot.test.ts
```

Expected: PASS.

---

## Final verification

After completing all tasks, run:

```bash
pnpm lint
pnpm typecheck
pnpm vitest run \
  src/lib/__tests__/waypoint.test.ts \
  src/lib/__tests__/waypoint-workflows.test.ts \
  src/lib/__tests__/waypoint-materialization.test.ts \
  src/lib/__tests__/waypoint-status.test.ts \
  src/lib/__tests__/waypoint-routes.test.ts \
  src/lib/__tests__/waypoint-autopilot.test.ts \
  src/lib/__tests__/workflow-engine.test.ts \
  src/lib/__tests__/gsd-hierarchy.test.ts
```

Expected:

- lint passes;
- typecheck passes;
- targeted tests pass;
- existing FirmVault workflow tests still pass.

---

## Commit strategy

Because the current working tree contains many unrelated uncommitted changes, commit only after confirming scope. Recommended logical commits once scoped:

```bash
git add docs/waypoint-runtime-design.md docs/superpowers/plans/2026-05-01-waypoint-runtime-integration.md
git commit -m "docs: define Waypoint runtime integration"

git add src/lib/waypoint.ts src/lib/__tests__/waypoint.test.ts
git commit -m "feat: add Waypoint lifecycle helpers"

git add workflows/waypoint-plan-execution.yaml src/lib/__tests__/waypoint-workflows.test.ts
git commit -m "feat: add Waypoint plan execution workflow"
```

Do not commit unrelated FirmVault, locale, runner, or package changes unless explicitly included in the current work scope.
