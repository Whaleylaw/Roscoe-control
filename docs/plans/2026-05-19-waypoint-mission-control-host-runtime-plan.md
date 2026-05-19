# Waypoint Mission Control Host Runtime Integration Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Wire Mission Control directly to pinned Waypoint packages so Mission Control can start, supervise, resume, gate, and execute real Waypoint Quests, beginning with `referral-package`, while preserving Mission Control as the database-backed host/control plane.

**Architecture:** Waypoint standalone is the canonical Quest/Recipe/Wizard/FirmVault/referral-package runtime. Mission Control consumes pinned Waypoint packages from ForgeJo, adapts them to Mission Control auth/project/task/event/session infrastructure, and uses Mission Control's existing workflow engine as the route/task/event substrate. Mission Control must not shell out to the Waypoint CLI as the primary runtime; CLI invocation is allowed only for smoke tests or explicitly documented escape hatches.

**Tech Stack:** Next.js 16, React 19, TypeScript 5, SQLite/better-sqlite3, pnpm, Vitest, Mission Control Workflow Engine, pinned private ForgeJo Waypoint packages (`@waypoint/core`, `@waypoint/folder-host`, optionally `@waypoint/cli` for smoke/dev only).

---

## Product decisions already approved

1. **Integration model:** Option A — Mission Control consumes Waypoint as a package/runtime dependency, not by copying code and not by shelling out to the CLI as the main path.
2. **Dependency source:** Use a pinned ForgeJo dependency from the start.
3. **First Quest scope:** Start with `referral-package`, then generalize to full Quest integration.
4. **Execution scope:** Mission Control should invoke local Waypoint package functionality for safe deterministic runtime work, not merely verify externally-created artifacts.
5. **Ad hoc Quest generation:** Later full Quest integration should include a dedicated orchestrator agent that drafts Quests/Recipes/Handoffs under Mission Control review/gates.
6. **State ownership:** Mission Control owns host records, review state, route/task visibility, and audit events. Waypoint owns portable Quest/Recipe/Wizard/FirmVault/referral-package semantics.
7. **Chronology rule:** The referral-package chronology path is staged data first (`date-of-service-ledger.json` → `visit-content.json` → deterministic renderer), never agent-authored final HTML as source truth.

## Definition of done for this integration track

This plan is complete only when Mission Control can prove this end-to-end journey from a clean test fixture:

1. Install/import pinned Waypoint packages without local-path hacks.
2. Bind an MC project to a trusted case/source root with source-readonly defaults.
3. Load the package-backed `referral-package` Quest and resolve its Recipes/artifact metadata.
4. Start or reuse a route using existing MC workflow instance/task/event tables.
5. Invoke deterministic local Waypoint package functions for safe runtime work.
6. Dispatch agent tasks only for structured data drafting/review work.
7. Block on missing required artifacts with auditable blocker payloads.
8. Resume from the blocked task after operator/package resolution without starting a duplicate route.
9. Reach an attorney-handoff gate that cannot complete without human approval.
10. Pass targeted route/runtime tests, typecheck, lint, build, and an end-to-end fixture smoke.

---

## Ground-truth starting state

Verified before writing this plan on 2026-05-19.

### Mission Control repo

Path: `/Users/aaronwhaley/Github/mission-control`

Current branch and recent history:

```text
## feat/waypoint-runtime-slice
5585a59 feat(waypoint): add agent authorship + loop prevention to discussion messages (W1)
0781784 feat(waypoint-core): add discussion auto-response contract types (W0.1)
ffea94b docs(waypoint): add discussion auto-response wiring plan
```

Unrelated dirty files already existed before this plan:

```text
 M src/app/[[...panel]]/page.tsx
 M src/app/api/status/route.ts
 M src/lib/hermes-sessions.ts
 M src/lib/provider-subscriptions.ts
```

Mission Control already has an older embedded Waypoint extraction/adaptor seam:

- `packages/waypoint-core/src/**`
- `src/lib/waypoint.ts`
- `src/lib/waypoint-command.ts`
- `src/lib/waypoint-autopilot.ts`
- `src/lib/waypoint-task-discussion.ts`
- `src/lib/waypoint-adapter/*`
- `src/app/api/projects/[id]/waypoint/**`
- `src/app/api/tasks/[id]/discussion/**`
- `docs/plans/waypoint-modularization-plan.md`

That embedded core is useful as historical migration context but must not become the new source of truth for current standalone Waypoint features.

Additional schema facts verified while completing this plan:

- `projects.metadata` exists via migration `027_enhanced_projects`; use it first for project Waypoint host bindings rather than adding a table in P3 unless tests prove a query/integrity need.
- `tasks.metadata` exists in the base schema; use it for task-level Waypoint execution metadata, artifact checks, and blocker payloads.
- Workflow Engine tables exist via migration `063_workflow_engine_v1`: `workflow_definitions`, `workflow_instances`, `workflow_node_instances`, and `workflow_events`.
- `workflow_instances.vars_json` exists via migration `066_workflow_instance_vars`; use it for route-level binding/package/Quest inputs.
- UI copy must go through `messages/*.json`; exact current message files include `messages/en.json` plus translated locale files.
- Mission Control package scripts include `pnpm test`, `pnpm typecheck`, `pnpm lint`, and `pnpm build`; per-slice gates below reference those exact scripts.

### Standalone Waypoint repo

Path: `/Users/aaronwhaley/Github/active projects/waypoint`

Current branch and recent history:

```text
## main...origin/main
c1c423d feat(referral): stage chronology generation contract
9c86eb9 fix(referral-package): block non-template chronologies
793aba2 feat(referral): add local package builder resume flow
```

Unrelated dirty/untracked files already existed before this plan:

```text
?? AGENTS.md
?? graphify-out/
```

Package facts verified from `package.json` files:

- root package name: `@waypoint/core`
- root version: `0.1.0`
- root `private: true`
- root exports point at built output: `./dist/src/index.js`, `./dist/src/index.d.ts`
- `@waypoint/folder-host` version: `0.1.0`, `private: true`, exports `./dist/index.js`
- `@waypoint/cli` version: `0.1.0`, `private: true`, bin `waypoint: ./dist/bin.js`
- workspace file exists: `pnpm-workspace.yaml` includes `.` and `packages/*`
- install-readiness smoke exists: `scripts/local-install-smoke.mjs`

Important standalone exports already available from `@waypoint/folder-host`:

- `loadBundledWaypointCatalog`
- `installQuestCatalog`
- `startQuestRoute`
- `materializeQuestTasks`
- `runWaypointAutopilot`
- `resolveWaypointRouteBlocker`
- `runReferralPackageBuilder`
- `initFirmVaultCaseState`
- `setFirmVaultCaseFact`
- `checkFirmVaultEvidencePath`
- `FIRMVAULT_FACT_DEFINITIONS`
- Wizard organization/shadow/fact helpers via `@waypoint/core`

---

## Non-negotiable integration rules

1. **Mission Control is a Waypoint host, not the Waypoint product source.** Current product/runtime behavior comes from the standalone Waypoint package pin.
2. **Do not use the Waypoint CLI as the primary runtime boundary.** Mission Control calls package APIs/adapters in-process. CLI can be used for smoke tests only.
3. **Do not replace Mission Control's workflow engine.** Use existing MC workflow definitions, workflow instances, node instances, events, materialized tasks, discussions, and gates as the host substrate.
4. **Do not hand-edit FirmVault legal state YAML.** Legal state mutation must go through safe Waypoint/FirmVault package APIs such as `setFirmVaultCaseFact` and evidence validation.
5. **Do not treat artifact existence as legal truth.** Required artifacts unblock tasks; FirmVault facts/landmarks require explicit safe state APIs and evidence rules.
6. **Source folders are read-only by default.** Generated artifacts go into Waypoint-owned output/build paths.
7. **Agents fill structured data, not final HTML.** For chronology, agents may produce/complete `date-of-service-ledger.json` and `visit-content.json`; deterministic package/template renderers produce final HTML/PDF/binder outputs.
8. **Human gate before attorney handoff.** Referral package handoff-ready state requires Mission Control gate approval.
9. **Block/resume, do not restart.** Missing artifacts or unresolved blockers should persist blocker metadata and allow the route to resume once the operator resolves the specific blocker.
10. **Pinned dependency only at merge.** Temporary local path may be used for spike/debug if absolutely necessary, but implementation is not merge-ready until Mission Control consumes pinned ForgeJo packages.

---

## Target architecture

```text
Pinned ForgeJo Waypoint packages
  ├── @waypoint/core
  │     ├── Quest/Recipe/Handoff parsers and registries
  │     ├── Wizard organization/shadow/fact helpers
  │     ├── command/envelope/metadata/contracts
  │     └── authoring helpers for future ad hoc Quest generation
  └── @waypoint/folder-host
        ├── bundled catalog loader
        ├── folder/case/project primitives
        ├── referral package builder/runtime
        ├── FirmVault safe state APIs
        ├── artifact/blocker helpers
        └── local deterministic runtime helpers

Mission Control host runtime
  ├── pinned package import/version registry
  ├── trusted case/project binding
  ├── catalog bridge
  ├── workflow-definition/route/task materializer
  ├── local package runtime adapter
  ├── agent/orchestrator dispatch adapter
  ├── artifact evidence/blocker/resume service
  ├── human review gate service/UI
  └── existing MC API/UI/event/session surfaces
```

Mission Control stores host truth in SQLite:

- projects
- tasks
- workflow definitions/instances/node instances/events
- comments/discussion sessions/messages
- Waypoint route state
- artifact check evidence
- gate decisions

Waypoint packages supply portable domain/runtime behavior.

---

## Data model additions to plan for

Prefer metadata-first unless a query or integrity requirement justifies a table.

### Project Waypoint binding

A Mission Control project needs a durable binding to a trusted local case/source root and selected Quest.

Candidate JSON metadata shape:

```json
{
  "waypoint": {
    "host_runtime": {
      "enabled": true,
      "package_source": "forgejo",
      "package_pin": "waypoint-v0.1.0-mc.0",
      "core_version": "0.1.0",
      "folder_host_version": "0.1.0"
    },
    "trusted_roots": {
      "case_root_key": "ben-wyman-referrals",
      "case_root": "/trusted/cases/root",
      "source_root": "/trusted/source/root",
      "source_readonly": true
    },
    "quest": {
      "slug": "referral-package",
      "version": 1
    }
  }
}
```

Implementation default: store this binding in `projects.metadata.waypoint.host_runtime` and access it through a narrow service (`src/lib/waypoint-project-binding.ts`). Do **not** add a `waypoint_project_bindings` table in the first pass. Add a table only if P3/P10 tests prove metadata cannot support required uniqueness/query semantics.

### Task metadata

Materialized MC tasks should preserve Waypoint task intent:

```json
{
  "waypoint": {
    "quest_slug": "referral-package",
    "route_id": "...",
    "plan_ref": "medical-chronology-update",
    "recipe": {
      "slug": "firmvault-medical-chronology-update"
    },
    "execution": {
      "kind": "local_package|agent|gate|checkpoint",
      "package_function": "runReferralPackageBuilder"
    },
    "required_artifacts": [
      {
        "path": "03-medical/medical-chronology-output/reports/date-of-service-ledger.json",
        "required_when": "before_complete"
      }
    ],
    "blocker": {
      "status": "blocked|resolved|null",
      "missing_artifacts": [],
      "resolution_input": null
    }
  }
}
```

### Workflow events

Record route/task transitions with payloads sufficient for audit:

- selected package pin/version
- Quest slug/version
- started route id / MC workflow instance id
- package function invoked
- artifacts checked
- missing artifacts
- blocker resolution input
- human gate decision

---

## Referral-package target flow in Mission Control

```text
1. Operator binds MC project to trusted case/source roots.
2. Operator selects/start Quest: referral-package.
3. MC loads Quest/Recipes from pinned Waypoint package.
4. MC materializes route/tasks/events in SQLite.
5. MC invokes deterministic local Waypoint package functions where safe.
6. MC dispatches agent tasks only for structured judgment/fill-in work.
7. MC checks required artifacts for each task.
8. Missing required artifacts block the task/route with actionable evidence.
9. Operator or package runtime resolves blocker and resumes the route.
10. Package QC runs.
11. Attorney-facing handoff remains blocked until human gate approval.
```

Expected referral-package tasks/checkpoints include:

- source intake / document review
- document organization / filename-placement review
- medical chronology staged generation
- chronology adversarial QC
- START_HERE attorney dashboard builder
- package QC
- attorney handoff gate

Chronology staged artifact contract:

```text
03-medical/medical-chronology-output/reports/date-of-service-ledger.json
03-medical/medical-chronology-output/reports/visit-content.json
03-medical/medical-chronology-output/reports/rendered-template-check.json
03-medical/medical-chronology-output/medical-chronology.html
03-medical/medical-chronology-output/medical-chronology-timeline.pdf
03-medical/medical-chronology-output/medical-chronology-master-binder.pdf
03-medical/medical-chronology-output/extracted-visit-pdfs/
```

## Runtime adapter contracts

### Package catalog adapter

Create `src/lib/waypoint-catalog.ts` as the only MC service that imports package catalog APIs directly. Other MC services should depend on its MC-friendly methods so package-version changes are isolated.

Required methods:

```ts
type MissionControlWaypointCatalog = {
  getQuest(slug: string): unknown
  listQuests(): unknown[]
  listQuestPlans(slug: string): Array<{
    plan_ref: string
    kind: 'recipe' | 'discussion' | 'gate' | 'checkpoint' | 'agent' | string
    recipe_slug?: string
    required_artifacts?: Array<{ path: string; required_when: string }>
    metadata?: Record<string, unknown>
  }>
  resolveQuestRecipes(slug: string): { ok: true } | { ok: false; errors: string[] }
  getRequiredArtifacts(slug: string): Array<{ plan_ref: string; path: string; required_when: string }>
}
```

### Local package runtime adapter

Create `src/lib/waypoint-local-package-runtime.ts` for deterministic functions only. Its input should be task/route metadata plus trusted project binding; its output should be serializable into `workflow_events.payload_json` and `tasks.metadata`.

Allowed first mappings:

- `runReferralPackageBuilder`
- `checkFirmVaultEvidencePath`
- `setFirmVaultCaseFact` only behind an explicit approved task/gate rule
- artifact existence/hash checks under trusted roots

Explicitly forbidden in this adapter:

- shelling out to `waypoint` CLI as the normal runtime path;
- arbitrary local command execution;
- email/fax/filing/payment/call/API side effects;
- direct writes to `.waypoint/firmvault/*.yaml`;
- marking FirmVault landmarks directly.

### Agent/orchestrator adapter

Agent-backed tasks should remain MC-managed task/session work, not package side effects. The agent contract is structured output only:

- draft or complete JSON inputs (`date-of-service-ledger.json`, `visit-content.json`, QC findings, dashboard summary data);
- ask/answer one question at a time where ambiguity blocks progress;
- write reviewable artifacts under Waypoint-owned output paths;
- never perform attorney/client/provider/insurer-facing external actions.

### Blocker/resume contract

A blocked package-backed route must persist enough evidence to resume without restarting:

```json
{
  "status": "blocked",
  "reason": "missing_required_artifacts",
  "task_id": 123,
  "route_id": 456,
  "plan_ref": "medical-chronology-update",
  "missing_artifacts": [
    "03-medical/medical-chronology-output/reports/date-of-service-ledger.json"
  ],
  "resolution": {
    "mode": "recheck_required_artifacts",
    "operator_note": null,
    "resolved_at": null
  }
}
```

Resuming means re-checking the existing task/route blocker and advancing from the blocked node. It must not create a duplicate route unless the operator explicitly starts a new route/version.

### Human gate contract

Handoff/attorney-facing completion requires a human gate event:

- approve/reject/revise decision;
- reviewer identity;
- timestamp;
- note;
- exact route/task/node ids;
- package pin and Quest slug/version.

No package or agent task may infer handoff approval from artifact existence alone.

---

## Phase Plan

## Phase P0 — Plan, dependency decision, and branch hygiene

### Task P0.1: Commit this plan without touching existing dirty work

**Objective:** Record the approved integration direction in Mission Control before coding.

**Files:**
- Create: `docs/plans/2026-05-19-waypoint-mission-control-host-runtime-plan.md`

**Steps:**
1. Write this plan.
2. Run `git diff --check`.
3. Verify only this doc was added by this slice; preserve pre-existing dirty files.
4. Commit only this doc if requested/approved for the planning slice.

**Verification:**

```bash
git status --short --branch
git diff --check
git log --oneline -3
```

**Commit:**

```bash
git add docs/plans/2026-05-19-waypoint-mission-control-host-runtime-plan.md
git commit -m "docs(waypoint): plan mission control host runtime integration"
```

### Task P0.2: Verify ForgeJo package consumption mode

**Objective:** Determine and prove the exact pinned dependency format Mission Control will use before implementation imports are merged.

**Files:**
- Create: `docs/plans/2026-05-19-waypoint-forgejo-dependency-notes.md` if registry/tag testing produces evidence too detailed for this plan.
- Modify later: `package.json`, `.npmrc`, `pnpm-lock.yaml` only after verification.

**Decision order:**

1. **Preferred — ForgeJo private npm package registry**
   - package names: `@waypoint/core`, `@waypoint/folder-host`;
   - dependency spec: exact version only, e.g. `"@waypoint/core": "0.1.0-mc.0"`;
   - `.npmrc` may define registry routing, but tokens must come from environment/user-level config and must not be committed.
2. **Fallback — pinned Git tag/commit dependency**
   - allowed only if private package registry is not available yet;
   - pin tag or commit, never branch;
   - prove pnpm can resolve the standalone workspace packages cleanly from a clean Mission Control install.
3. **Spike-only — local path**
   - allowed only to debug TypeScript/API shape while package publishing is being prepared;
   - not merge-ready and must be removed before P1.2 is accepted.

**Required verification commands:**

```bash
pnpm install --frozen-lockfile
pnpm exec vitest run src/lib/__tests__/waypoint-package-import.test.ts
pnpm typecheck
```

**Acceptance:**
- Dependency source/version/pin is written down.
- Clean install resolves `@waypoint/core` and `@waypoint/folder-host` types.
- No credentials committed.
- Lockfile records an exact source/version, not a floating branch.

---

## Phase P1 — Package import smoke in Mission Control

### Task P1.1: Add RED import smoke for pinned Waypoint package APIs

**Objective:** Prove Mission Control cannot yet import the current standalone package pin or required exports.

**Files:**
- Create: `src/lib/__tests__/waypoint-package-import.test.ts`

**Test outline:**

```ts
import { describe, expect, it } from 'vitest'

import { parseQuestManifest, createQuestRegistry } from '@waypoint/core'
import {
  loadBundledWaypointCatalog,
  runReferralPackageBuilder,
} from '@waypoint/folder-host'

describe('pinned Waypoint package imports', () => {
  it('exposes core and folder-host APIs required by Mission Control host runtime', async () => {
    expect(typeof parseQuestManifest).toBe('function')
    expect(typeof createQuestRegistry).toBe('function')
    expect(typeof loadBundledWaypointCatalog).toBe('function')
    expect(typeof runReferralPackageBuilder).toBe('function')
  })
})
```

**Run RED:**

```bash
pnpm exec vitest run src/lib/__tests__/waypoint-package-import.test.ts
```

Expected initial failure: `@waypoint/folder-host` cannot be resolved or package dependency is not installed.

### Task P1.2: Add pinned ForgeJo dependencies

**Objective:** Install pinned Waypoint packages in Mission Control.

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Possibly create/modify: `.npmrc` if ForgeJo package registry is used.

**Implementation notes:**
- Prefer exact ForgeJo package registry versions.
- If using Git dependency fallback, pin tag/commit, not branch.
- Do not commit tokens. `.npmrc` must reference env vars or a user-level config, not plaintext secrets.

**Run GREEN:**

```bash
pnpm install
pnpm exec vitest run src/lib/__tests__/waypoint-package-import.test.ts
pnpm typecheck
```

**Acceptance:**
- Import smoke passes.
- TypeScript sees the installed package types.
- Lockfile pins the exact package source/version.

---

## Phase P2 — Catalog bridge for `referral-package`

### Task P2.1: Add catalog service RED test

**Objective:** Define Mission Control's package-backed Quest catalog bridge.

**Files:**
- Create: `src/lib/__tests__/waypoint-catalog.test.ts`
- Later create: `src/lib/waypoint-catalog.ts`

**Expected behavior:**
- Load pinned package bundled catalog.
- Find Quest `referral-package`.
- Resolve required Recipes.
- Expose phase/plan/artifact metadata for MC materialization.
- Fail loudly on unresolved recipe references.

**Test outline:**

```ts
import { describe, expect, it } from 'vitest'
import { loadMissionControlWaypointCatalog } from '../waypoint-catalog'

describe('Mission Control Waypoint catalog bridge', () => {
  it('loads referral-package Quest and required Recipe/artifact metadata', async () => {
    const catalog = await loadMissionControlWaypointCatalog()
    const referral = catalog.getQuest('referral-package')

    expect(referral.id).toBe('referral-package')
    expect(catalog.resolveQuestRecipes('referral-package').ok).toBe(true)

    const plans = catalog.listQuestPlans('referral-package')
    expect(plans.map((plan) => plan.plan_ref)).toContain('medical-chronology-update')
    expect(JSON.stringify(plans)).toContain('date-of-service-ledger.json')
    expect(JSON.stringify(plans)).toContain('visit-content.json')
    expect(JSON.stringify(plans)).toContain('rendered-template-check.json')
  })
})
```

**Run RED:**

```bash
pnpm exec vitest run src/lib/__tests__/waypoint-catalog.test.ts
```

Expected failure: `src/lib/waypoint-catalog.ts` missing.

### Task P2.2: Implement package-backed catalog bridge

**Objective:** Create a thin Mission Control service over pinned Waypoint catalog APIs.

**Files:**
- Create: `src/lib/waypoint-catalog.ts`

**Implementation direction:**
- Call `loadBundledWaypointCatalog()` from `@waypoint/folder-host`.
- Wrap package result into MC-friendly methods:
  - `getQuest(slug)`
  - `listQuests()`
  - `listQuestPlans(slug)`
  - `resolveQuestRecipes(slug)`
  - `getRequiredArtifacts(slug)`
- Do not copy manifests into Mission Control.

**Run GREEN:**

```bash
pnpm exec vitest run src/lib/__tests__/waypoint-catalog.test.ts
pnpm typecheck
```

---

## Phase P3 — Trusted project/case binding

### Task P3.1: Inspect current project metadata/schema and write RED test

**Objective:** Decide where Mission Control stores Waypoint host bindings.

**Files:**
- Read first: `src/lib/schema.sql`, `src/lib/migrations.ts`, project APIs/tests.
- Create: `src/lib/__tests__/waypoint-project-binding.test.ts`
- Later create: `src/lib/waypoint-project-binding.ts`

**Behavior to test:**
- accepts trusted registered case root/source root;
- rejects absolute paths outside trusted roots;
- rejects traversal and unsafe slugs;
- source is read-only by default;
- binding alone does not mutate the filesystem or FirmVault state.

**Run RED:**

```bash
pnpm exec vitest run src/lib/__tests__/waypoint-project-binding.test.ts
```

### Task P3.2: Implement binding service

**Objective:** Add the smallest host binding layer needed for referral-package route start.

**Files:**
- Create: `src/lib/waypoint-project-binding.ts`
- Modify schema/migrations only if metadata is insufficient.

**Implementation direction:**
- Use explicit trusted root keys.
- Avoid natural-language path resolution.
- Store package pin/version with binding.
- Provide `getWaypointProjectBinding(projectId, workspaceId)` for route start.

**Verification:**

```bash
pnpm exec vitest run src/lib/__tests__/waypoint-project-binding.test.ts
pnpm typecheck
```

---

## Phase P4 — Start `referral-package` Quest as a Mission Control route

### Task P4.1: Add RED materialization test

**Objective:** Define how `referral-package` becomes MC workflow/task/event state.

**Files:**
- Create: `src/lib/__tests__/waypoint-referral-route-start.test.ts`
- Later create/modify: `src/lib/waypoint-referral-runtime.ts` or `src/lib/waypoint-quest-runtime.ts`
- Later modify: `src/lib/waypoint.ts` only through narrow adapter calls.

**Expected behavior:**
- Given a project with trusted binding and Quest `referral-package`, start/reuse a route.
- Materialize MC tasks from Quest scaffold/plans.
- Preserve plan refs, recipe slugs, required artifacts, execution kind, and gate metadata in task metadata.
- Emit MC workflow events.

**Assertions:**
- one active route exists;
- tasks include chronology update and chronology QC;
- chronology update task metadata includes:
  - `firmvault-medical-chronology-update`
  - `date-of-service-ledger.json`
  - `visit-content.json`
  - `rendered-template-check.json`
- handoff task/gate remains human-gated.

**Run RED:**

```bash
pnpm exec vitest run src/lib/__tests__/waypoint-referral-route-start.test.ts
```

### Task P4.2: Implement route start/materialization adapter

**Objective:** Create the package-to-MC route/task materialization path.

**Files:**
- Create: `src/lib/waypoint-quest-runtime.ts`
- Possibly modify: `src/lib/waypoint.ts`
- Possibly modify: MC Waypoint API route start endpoint after internal service is tested.

**Implementation direction:**
- Use package catalog bridge to load Quest.
- Map Quest scaffold/plans into existing MC lifecycle/task rows.
- Use MC `workflow_instances` / `workflow_node_instances` where possible.
- Keep existing MC Workflow Engine route APIs as the observable surface.
- Do not implement local execution yet; only start/materialize.

**Verification:**

```bash
pnpm exec vitest run src/lib/__tests__/waypoint-referral-route-start.test.ts src/lib/__tests__/waypoint-routes.test.ts
pnpm typecheck
```

---

## Phase P5 — Local Waypoint package runtime adapter

### Task P5.1: Add RED runtime adapter tests

**Objective:** Define how Mission Control invokes safe local Waypoint package functions.

**Files:**
- Create: `src/lib/__tests__/waypoint-local-package-runtime.test.ts`
- Later create: `src/lib/waypoint-local-package-runtime.ts`

**Execution kinds:**

```ts
type MissionControlWaypointExecutionKind =
  | 'local_package'
  | 'agent'
  | 'gate'
  | 'checkpoint'
```

**Expected behavior:**
- local package task invokes mapped package function;
- result artifacts/errors are captured in task metadata/events;
- missing required artifacts returns blocked result, not success;
- agent/gate tasks are not accidentally executed by local package runtime.

**Run RED:**

```bash
pnpm exec vitest run src/lib/__tests__/waypoint-local-package-runtime.test.ts
```

### Task P5.2: Implement deterministic local runtime adapter

**Objective:** Call installed Waypoint package functions for safe work.

**Files:**
- Create: `src/lib/waypoint-local-package-runtime.ts`

**Initial mappings:**
- referral package builder/checker: `runReferralPackageBuilder`
- artifact checks: package or MC helper around filesystem existence under trusted root
- FirmVault evidence checks: `checkFirmVaultEvidencePath`
- FirmVault fact mutation: `setFirmVaultCaseFact` only when explicitly approved by task/gate rules

**Do not include yet:**
- arbitrary shell command execution;
- external email/fax/filing/payment/call/API side effects;
- direct edits to `.waypoint/firmvault/*.yaml`.

**Verification:**

```bash
pnpm exec vitest run src/lib/__tests__/waypoint-local-package-runtime.test.ts
pnpm typecheck
```

---

## Phase P6 — Artifact blocker/resume semantics

### Task P6.1: Add RED blocker/resume test

**Objective:** Ensure missing required artifacts block a route/task and can be resumed without restarting.

**Files:**
- Create: `src/lib/__tests__/waypoint-artifact-blocker.test.ts`
- Later create: `src/lib/waypoint-artifacts.ts`

**Expected behavior:**
- Missing `date-of-service-ledger.json` blocks chronology task.
- Blocker payload lists missing artifact paths.
- Operator resolution input can mark the blocker resolved or trigger re-check.
- Existing route resumes from the blocked task; it does not start a duplicate route.

**Run RED:**

```bash
pnpm exec vitest run src/lib/__tests__/waypoint-artifact-blocker.test.ts
```

### Task P6.2: Implement artifact check + blocker resolution service

**Objective:** Add explicit evidence-based blocker/resume behavior.

**Files:**
- Create: `src/lib/waypoint-artifacts.ts`
- Possibly modify: `src/lib/waypoint-autopilot.ts`
- Possibly modify: `src/app/api/projects/[id]/waypoint/routes/[routeId]/state/route.ts`

**Implementation direction:**
- Resolve artifact paths relative to trusted case/build root only.
- Reject traversal/absolute untrusted artifact paths.
- Store artifact check evidence in task metadata and workflow events.
- Support `resolveWaypointRouteBlocker`-style package behavior where appropriate.

**Verification:**

```bash
pnpm exec vitest run src/lib/__tests__/waypoint-artifact-blocker.test.ts src/lib/__tests__/waypoint-autopilot.test.ts
pnpm typecheck
```

---

## Phase P7 — Staged chronology runtime in MC

### Task P7.1: Add RED chronology contract test

**Objective:** Lock the staged chronology model into Mission Control runtime behavior.

**Files:**
- Create: `src/lib/__tests__/waypoint-referral-chronology-runtime.test.ts`

**Expected behavior:**
- chronology task requires `date-of-service-ledger.json` first;
- DOS ledger can be populated from bills/records extraction task output;
- visit content is structured JSON, not HTML;
- deterministic renderer/package output creates final HTML/PDF artifacts;
- `rendered-template-check.json` is required before chronology task completes;
- adversarial QC is a separate task.

**Run RED:**

```bash
pnpm exec vitest run src/lib/__tests__/waypoint-referral-chronology-runtime.test.ts
```

### Task P7.2: Implement staged chronology adapter hooks

**Objective:** Wire chronology-specific runtime constraints into the generic artifact/runtime services.

**Files:**
- Modify: `src/lib/waypoint-local-package-runtime.ts`
- Modify: `src/lib/waypoint-artifacts.ts`
- Possibly create: `src/lib/waypoint-referral-chronology.ts`

**Implementation direction:**
- Keep the task generic where possible; chronology-specific requirements come from Quest metadata.
- If package lacks a renderer entrypoint, block with clear missing package function evidence instead of silently allowing agent HTML.
- Agents may fill `visit-content.json`; deterministic renderer creates HTML.

**Verification:**

```bash
pnpm exec vitest run src/lib/__tests__/waypoint-referral-chronology-runtime.test.ts
pnpm typecheck
```

---

## Phase P8 — API surface for starting/managing package-backed Quests

### Task P8.1: Add RED API test for start/referral-package

**Objective:** Expose the new runtime through Mission Control's existing Waypoint API shape.

**Files:**
- Create/modify: `src/app/api/projects/[id]/waypoint/routes/__tests__/route.test.ts`
- Modify later: `src/app/api/projects/[id]/waypoint/routes/route.ts`

**Expected behavior:**
- `POST /api/projects/:id/waypoint/routes` can start Quest `referral-package` from pinned package catalog.
- Response includes route id, task summary, package pin, and first blockers/next actions.
- Standard Waypoint error envelope applies.

**Run RED:**

```bash
pnpm exec vitest run src/app/api/projects/[id]/waypoint/routes/__tests__/route.test.ts
```

### Task P8.2: Implement API adapter

**Objective:** Route API calls through the package-backed runtime service.

**Files:**
- Modify: `src/app/api/projects/[id]/waypoint/routes/route.ts`
- Modify: `src/lib/waypoint-api.ts` only if envelope helpers need parity updates.

**Verification:**

```bash
pnpm exec vitest run src/app/api/projects/[id]/waypoint/routes/__tests__/route.test.ts src/lib/__tests__/waypoint-routes.test.ts
pnpm typecheck
```

---

## Phase P9 — UI/operator review surface

### Task P9.1: Add route detail data contract for artifact/gate display

**Objective:** Make MC able to show what matters for Quest management.

**Files:**
- Create/modify tests near project/waypoint route read surfaces.
- Modify: route detail API/read model.

**Expected UI-facing fields:**
- Quest slug/name/package pin;
- current phase/task;
- missing artifacts/blockers;
- artifact check history;
- chronology staged artifact status;
- QC status;
- human gate decision state.

### Task P9.2: Add or update UI panel

**Objective:** Expose referral-package progress and gate actions in Mission Control.

**Files:**
- Modify: existing project/Waypoint panel components under `src/app/[[...panel]]` / `src/components/**` after inspecting current routing.
- Modify i18n message files; all user-facing strings go through next-intl.

**Verification:**

```bash
pnpm exec vitest run <targeted UI/API tests>
pnpm typecheck
pnpm lint
```

---

## Phase P10 — End-to-end referral-package MC smoke

### Task P10.1: Add fixture-backed integration smoke

**Objective:** Prove the first useful MC host runtime journey end-to-end.

**Files:**
- Create: `src/lib/__tests__/waypoint-referral-package-host-smoke.test.ts` or script under `scripts/` if DB/filesystem setup is easier.

**Smoke journey:**

```text
1. Create temp trusted case/source root.
2. Create MC project.
3. Save Waypoint binding for referral-package.
4. Start package-backed Quest route.
5. Materialize tasks/events.
6. Invoke deterministic local package runtime where fixture supports it.
7. Block on missing chronology artifacts.
8. Add/resolve required artifact evidence.
9. Resume route.
10. Reach attorney handoff gate.
11. Confirm route cannot complete handoff without human approval.
12. Approve gate and record event.
```

**Acceptance:**
- no source mutation;
- no external side effects;
- MC events prove route/task/gate lifecycle;
- required artifacts prove blocker/resume;
- human gate is mandatory.

**Verification:**

```bash
pnpm exec vitest run src/lib/__tests__/waypoint-referral-package-host-smoke.test.ts
pnpm typecheck
```

---

## Phase P11 — General Quest integration

Only begin after referral-package is green end-to-end.

### Task P11.1: Generalize catalog/start surfaces beyond referral-package

**Objective:** Support `firmvault` and other bundled Quests using the same runtime path.

**Acceptance:**
- no referral-package-specific assumptions in generic Quest start/materialization;
- Quest metadata drives task type, recipes, gates, required artifacts, and execution kind.

### Task P11.2: Add full Quest catalog UI/API

**Objective:** Let operators inspect/select available Quests in MC.

**Acceptance:**
- list bundled Quests;
- inspect phases/plans/recipes/handoffs;
- show package pin/version;
- start supported Quests only when binding requirements are satisfied.

---

## Phase P12 — Dedicated ad hoc Quest orchestrator agent

### Task P12.1: Design orchestrator agent contract

**Objective:** Keep ad hoc Quest generation out of route handlers and inside a managed agent workflow.

**Responsibilities:**
- take operator objective;
- ask one question at a time when needed;
- draft Quest/Recipe/Handoff manifests;
- run manifest validators;
- create reviewable draft artifacts;
- require human approval before installing/starting;
- never perform external side effects.

**Likely files:**
- new Mission Control agent/operator config or recipe runtime mapping;
- `src/lib/waypoint-authoring-orchestrator.ts`;
- tests around draft/review/install gating.

### Task P12.2: Install approved generated Quests

**Objective:** Add a safe path from reviewed manifest drafts to an MC-available Quest catalog overlay.

**Acceptance:**
- generated Quest is versioned;
- source/provenance recorded;
- human approval required;
- validation failures block installation;
- route start uses same generic P11 path.

---

## Verification packs

### Per-slice baseline

```bash
git status --short --branch
git diff --check
pnpm exec vitest run <targeted tests>
pnpm typecheck
```

### Waypoint/route regression pack

```bash
pnpm exec vitest run \
  src/lib/__tests__/waypoint*.test.ts \
  src/lib/waypoint-adapter/__tests__/*.test.ts \
  src/app/api/projects/[id]/waypoint/**/__tests__/route.test.ts \
  src/app/api/tasks/[id]/discussion/**/__tests__/route.test.ts
```

### Major milestone gate

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

If full lint/build is too slow for every small slice, run targeted tests/typecheck per slice and full gates at P1/P4/P8/P10 completion.

---

## Rollback strategy

1. Package-level rollback: pin Mission Control back to previous ForgeJo Waypoint package version/tag.
2. Runtime toggle: keep package-backed Quest runtime behind an env/config flag until P10 is green.
3. Quest-level rollback: disable `referral-package` start in MC catalog bridge without removing existing route history.
4. Route-level rollback: blocked/failed routes remain auditable in MC; do not delete route/task/event evidence.
5. No source-folder rollback should be needed because source roots are read-only by default.

## Execution ledger

Use this as the small-slice checklist. Check boxes only in commits that include source-of-truth verification for the slice.

- [x] P0.1 — Initial host-runtime plan committed (`e24a11b docs(waypoint): plan mission control host runtime integration`).
- [ ] P0.2 — ForgeJo dependency mode verified and written down.
- [ ] P1 — Pinned package import smoke + installed dependencies.
- [ ] P2 — Package-backed `referral-package` catalog bridge.
- [ ] P3 — Trusted project/case binding stored in `projects.metadata`.
- [ ] P4 — `referral-package` route/task/event materialization in MC.
- [ ] P5 — deterministic local package runtime adapter.
- [ ] P6 — artifact blocker/resume service.
- [ ] P7 — staged chronology runtime constraints.
- [ ] P8 — API route start/manage surface.
- [ ] P9 — UI/operator review surface.
- [ ] P10 — end-to-end referral-package MC smoke.
- [ ] P11 — general Quest catalog/start support.
- [ ] P12 — ad hoc Quest orchestrator and reviewed Quest install path.

**Next executable task:** P0.2. Do not start P1 until dependency mode is proven without committing credentials.

---

## Implementation order summary

1. Commit this plan.
2. Verify ForgeJo package consumption mode.
3. Add package import smoke and install pinned dependencies.
4. Add Mission Control catalog bridge for `referral-package`.
5. Add trusted project/case binding.
6. Start/materialize referral-package route in MC.
7. Add local Waypoint package runtime adapter.
8. Add artifact blocker/resume semantics.
9. Wire staged chronology constraints.
10. Expose route start/manage via MC APIs.
11. Add UI/operator review surface.
12. Add end-to-end MC referral-package smoke.
13. Generalize to all Quests.
14. Add dedicated ad hoc Quest orchestrator agent.

---

## How future sessions should answer “what is next?”

Do not improvise from nearby code. Use this plan as the controlling roadmap:

1. Check git state and package pins.
2. Find the first incomplete phase/task above.
3. Run the task's RED test first if it changes production behavior.
4. Implement only that slice.
5. Verify with the task-specific gate.
6. Commit with a concise conventional commit.
7. Report real evidence from the current turn.

