# FirmVault Test Ladder Mission Control Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add real synthetic FirmVault test-ladder cases and prove Mission Control can manually start/materialize Phase 0 workflows against those cases through the actual workflow engine.

**Architecture:** FirmVault owns the synthetic case folders under its normal `cases/` tree. Mission Control owns the workflow-engine integration tests that manually start workflow instances for those test case slugs and materialize recipe-backed tasks. Global FirmVault workflow automation stays disabled; tests explicitly target only `test-ladder-*` cases.

**Tech Stack:** FirmVault markdown vault, Mission Control TypeScript/Vitest, SQLite via `better-sqlite3`, existing Mission Control workflow engine APIs.

---

## File Structure

FirmVault repo: `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault`

```text
cases/test-ladder-000-new-intake-upload/test-ladder-000-new-intake-upload.md
cases/test-ladder-000-new-intake-upload/documents/shadows/client/intake-packet.md
cases/test-ladder-000-new-intake-upload/activity/2026-04-01-0855-new-intake-uploaded.md
cases/test-ladder-000-new-intake-upload/workflow-log/2026-04-01-0855-test-ladder-state.md

cases/test-ladder-001-case-created/**
cases/test-ladder-002-document-collection-active/**
cases/test-ladder-003-phase0-complete/**
```

Mission Control repo: `/Users/aaronwhaley/Github/mission-control`

```text
src/lib/__tests__/firmvault-test-ladder-workflows.test.ts
docs/superpowers/plans/2026-04-26-firmvault-test-ladder-mission-control-integration.md
```

Responsibilities:

- FirmVault `cases/test-ladder-*`: normal case folders containing synthetic state that Mission Control can read as real cases.
- Mission Control test: creates in-memory workflow definitions, manually starts workflows for synthetic slugs, materializes ready recipe nodes, and asserts no non-test subject is touched.

## Task 1: Add Synthetic Test-Ladder Cases To FirmVault

**Files in FirmVault repo:**
- Create: `cases/test-ladder-000-new-intake-upload/**`
- Create: `cases/test-ladder-001-case-created/**`
- Create: `cases/test-ladder-002-document-collection-active/**`
- Create: `cases/test-ladder-003-phase0-complete/**`

- [ ] **Step 1: Create case folders from fixture ladder**

Copy the existing Phase 0 fixture content into normal case folders:

```bash
cd /Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault

mkdir -p cases/test-ladder-000-new-intake-upload/documents/shadows/client
mkdir -p cases/test-ladder-000-new-intake-upload/activity
mkdir -p cases/test-ladder-000-new-intake-upload/workflow-log

cp skills.tools.workflows/runtime/test-fixtures/case-ladder/000-new-intake-upload/input/parsed-intake-shadow.md \
  cases/test-ladder-000-new-intake-upload/documents/shadows/client/intake-packet.md

cp -R skills.tools.workflows/runtime/test-fixtures/case-ladder/001-case-created/expected/cases/test-client-one/. \
  cases/test-ladder-001-case-created/

cp -R skills.tools.workflows/runtime/test-fixtures/case-ladder/001-case-created/expected/cases/test-client-one/. \
  cases/test-ladder-002-document-collection-active/
cp -R skills.tools.workflows/runtime/test-fixtures/case-ladder/002-document-collection-active/expected/cases/test-client-one/. \
  cases/test-ladder-002-document-collection-active/

cp -R skills.tools.workflows/runtime/test-fixtures/case-ladder/003-phase0-complete/expected/cases/test-client-one/. \
  cases/test-ladder-003-phase0-complete/
```

Expected: folders exist under `cases/test-ladder-*`.

- [ ] **Step 2: Rewrite synthetic slugs and add test frontmatter**

For each copied root case file, rename it to match the folder slug and update frontmatter:

```text
cases/test-ladder-001-case-created/test-client-one.md
  -> cases/test-ladder-001-case-created/test-ladder-001-case-created.md

cases/test-ladder-002-document-collection-active/test-client-one.md
  -> cases/test-ladder-002-document-collection-active/test-ladder-002-document-collection-active.md

cases/test-ladder-003-phase0-complete/test-client-one.md
  -> cases/test-ladder-003-phase0-complete/test-ladder-003-phase0-complete.md
```

Each root case frontmatter must include:

```yaml
schema_version: 3
case_slug: test-ladder-001-case-created
client_name: Test Ladder 001 Case Created
source_system: test-fixture
workflow_test: true
pii_profile: synthetic
```

Use the matching slug/name for each folder. Replace body headings and wikilinks that reference `Test Client One` only where they identify the case title. Keep synthetic placeholder values such as `{{client_address}}`.

Create `cases/test-ladder-000-new-intake-upload/test-ladder-000-new-intake-upload.md`:

```markdown
---
schema_version: 3
case_id: "00000000-0000-4000-8000-000000000100"
case_slug: test-ladder-000-new-intake-upload
client_name: Test Ladder 000 New Intake Upload
case_type: auto_accident
status: intake
date_of_incident: "2026-04-01"
jurisdiction: KY
opened_date: "2026-04-01"
closed_date:
source_system: test-fixture
workflow_test: true
real_file_root: test://phase-0/test-ladder-000-new-intake-upload
pii_profile: synthetic
landmarks:
  client_info_received:
    satisfied: false
    evidence: []
  case_type_classified:
    satisfied: true
    evidence:
      - test-ladder-000-new-intake-upload.md
  contract_signed:
    satisfied: false
    evidence: []
  medical_auth_signed:
    satisfied: false
    evidence: []
workflow_summary:
  active:
    - case_setup
  waiting: []
  completed: []
---

# Test Ladder 000 New Intake Upload - auto_accident

**Status:** intake
**Incident:** 2026-04-01

## Case Summary

Synthetic pre-case intake state for Mission Control workflow testing. The parsed
intake shadow exists, but the canonical case shell has not been produced by the
`case_setup` workflow yet.

## Key Links

- [[documents/shadows/client/intake-packet|Parsed Intake Shadow]]
- [[activity/2026-04-01-0855-new-intake-uploaded|New Intake Upload Activity]]

## Workflow Notes

- `case_setup` is the next workflow to start manually in tests.
- This folder is synthetic and must not be treated as a real client matter.
```

Create `cases/test-ladder-000-new-intake-upload/activity/2026-04-01-0855-new-intake-uploaded.md`:

```markdown
---
schema_version: 3
category: intake
case_slug: test-ladder-000-new-intake-upload
timestamp: "2026-04-01T08:55:00-04:00"
workflow_test: true
---

# New Intake Uploaded

Synthetic intake upload received for Phase 0 Mission Control workflow testing.
```

Create `cases/test-ladder-000-new-intake-upload/workflow-log/2026-04-01-0855-test-ladder-state.md`:

```markdown
---
schema_version: 3
workflow: test_ladder_state
case_slug: test-ladder-000-new-intake-upload
status: snapshot
timestamp: "2026-04-01T08:55:00-04:00"
workflow_test: true
---

# Test Ladder State

This synthetic folder represents the new-intake-upload state before the
`case_setup` workflow creates the normal case shell.
```

- [ ] **Step 3: Validate FirmVault synthetic cases**

Run:

```bash
cd /Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault
python3 skills.tools.workflows/runtime/scripts/validate_case_ladder_fixtures.py
find cases/test-ladder-* -name '*.json' -print
find cases/test-ladder-* -maxdepth 1 -type f -name '*.md' -print | sort
```

Expected:

- Fixture validator passes.
- JSON scan prints nothing.
- Four root markdown files print, one per synthetic case.

- [ ] **Step 4: Commit FirmVault test cases**

Run:

```bash
cd /Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault
git add cases/test-ladder-000-new-intake-upload cases/test-ladder-001-case-created cases/test-ladder-002-document-collection-active cases/test-ladder-003-phase0-complete
git commit -m "Add synthetic test ladder cases"
```

Expected: FirmVault commit succeeds.

## Task 2: Add Mission Control Workflow Integration Tests

**Files in Mission Control repo:**
- Create: `src/lib/__tests__/firmvault-test-ladder-workflows.test.ts`

- [ ] **Step 1: Write failing integration tests**

Create `src/lib/__tests__/firmvault-test-ladder-workflows.test.ts`:

```typescript
import { beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { existsSync } from 'fs'
import { join } from 'path'
import { runMigrations } from '../migrations'
import {
  createWorkflowDefinition,
  materializeReadyWorkflowNodes,
  startWorkflowInstance,
} from '../workflow-engine'

const FIRMVAULT_ROOT = '/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault'

let db: Database.Database
let projectId: number

function createProject(): number {
  const result = db.prepare(`
    INSERT INTO projects (
      name, description, status, ticket_prefix, ticket_counter,
      workspace_id, tenant_id, created_at, updated_at
    ) VALUES ('FirmVault Test Ladder', '', 'active', 'FVTEST', 0, 1, 1, 1000, 1000)
  `).run()
  return Number(result.lastInsertRowid)
}

function taskRows() {
  return db.prepare(`
    SELECT id, title, status, recipe_slug, metadata
    FROM tasks
    ORDER BY id ASC
  `).all() as Array<{
    id: number
    title: string
    status: string
    recipe_slug: string | null
    metadata: string | null
  }>
}

beforeEach(() => {
  db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  runMigrations(db)
  projectId = createProject()
})

describe('FirmVault test ladder workflows', () => {
  it('has real synthetic FirmVault case folders available to Mission Control', () => {
    for (const slug of [
      'test-ladder-000-new-intake-upload',
      'test-ladder-001-case-created',
      'test-ladder-002-document-collection-active',
      'test-ladder-003-phase0-complete',
    ]) {
      expect(existsSync(join(FIRMVAULT_ROOT, 'cases', slug, `${slug}.md`))).toBe(true)
    }
  })

  it('manually starts case_setup for the new-intake test case and materializes its first recipe task', () => {
    const definitionId = createWorkflowDefinition(db, `
schema_version: 1
id: firmvault-case-setup
name: FirmVault Case Setup
version: 1
subject_type: law_firm_case
triggers:
  - type: manual
nodes:
  review_intake:
    type: recipe
    recipe: firmvault-document-collection-review-intake
  create_case_shell:
    type: recipe
    recipe: firmvault-case-setup-create-shell
    depends_on:
      - review_intake
`, 'workflow-test', 1, 1)

    const instance = startWorkflowInstance(db, {
      definitionId,
      subjectType: 'law_firm_case',
      subjectId: 'test-ladder-000-new-intake-upload',
      actor: 'workflow-test',
      workspaceId: 1,
      tenantId: 1,
      now: 1000,
    })

    expect(instance.ready_nodes).toEqual(['review_intake'])

    const materialized = materializeReadyWorkflowNodes(db, {
      workflowInstanceId: instance.instance_id,
      projectId,
      workspaceId: 1,
      actor: 'workflow-test',
      now: 1001,
      status: 'inbox',
    })

    expect(materialized.created).toMatchObject([
      { node_key: 'review_intake' },
    ])

    const tasks = taskRows()
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({
      status: 'inbox',
      recipe_slug: 'firmvault-document-collection-review-intake',
    })
    expect(JSON.parse(tasks[0].metadata ?? '{}')).toMatchObject({
      workflow: {
        definition_slug: 'firmvault-case-setup',
        subject_type: 'law_firm_case',
        subject_id: 'test-ladder-000-new-intake-upload',
        node_key: 'review_intake',
        recipe_slug: 'firmvault-document-collection-review-intake',
      },
      law_firm: {
        case_slug: 'test-ladder-000-new-intake-upload',
      },
    })
  })

  it('manually starts document_collection for the case-created test case and materializes only that case', () => {
    const definitionId = createWorkflowDefinition(db, `
schema_version: 1
id: firmvault-document-collection
name: FirmVault Document Collection
version: 1
subject_type: law_firm_case
triggers:
  - type: manual
nodes:
  load_document_checklist:
    type: recipe
    recipe: firmvault-document-collection-review-intake
  request_missing_documents:
    type: recipe
    recipe: firmvault-document-collection-review-intake
    depends_on:
      - load_document_checklist
`, 'workflow-test', 1, 1)

    const instance = startWorkflowInstance(db, {
      definitionId,
      subjectType: 'law_firm_case',
      subjectId: 'test-ladder-001-case-created',
      actor: 'workflow-test',
      workspaceId: 1,
      tenantId: 1,
      now: 2000,
    })

    const materialized = materializeReadyWorkflowNodes(db, {
      workflowInstanceId: instance.instance_id,
      projectId,
      workspaceId: 1,
      actor: 'workflow-test',
      now: 2001,
      status: 'inbox',
    })

    expect(materialized.created).toMatchObject([
      { node_key: 'load_document_checklist' },
    ])

    const tasks = taskRows()
    expect(tasks).toHaveLength(1)
    expect(JSON.parse(tasks[0].metadata ?? '{}')).toMatchObject({
      workflow: {
        definition_slug: 'firmvault-document-collection',
        subject_id: 'test-ladder-001-case-created',
      },
      law_firm: {
        case_slug: 'test-ladder-001-case-created',
      },
    })
    expect(tasks[0].metadata).not.toContain('abby-sitgraves')
  })
})
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
cd /Users/aaronwhaley/Github/mission-control
pnpm vitest run src/lib/__tests__/firmvault-test-ladder-workflows.test.ts
```

Expected before Task 1: fails because the synthetic case folders do not exist.
Expected after Task 1: may pass if workflow metadata already has the required shape. If it passes after Task 1, keep the test as the regression proof.

- [ ] **Step 3: Commit Mission Control tests**

Run:

```bash
cd /Users/aaronwhaley/Github/mission-control
git add src/lib/__tests__/firmvault-test-ladder-workflows.test.ts
git commit -m "test: cover FirmVault test ladder workflows"
```

Expected: Mission Control commit succeeds after tests pass.

## Task 3: Documentation And Verification

**Files in Mission Control repo:**
- Modify: `docs/workflow-engine-v1.md`

- [ ] **Step 1: Document manual test-ladder workflow starts**

Add a short section to `docs/workflow-engine-v1.md` after the lifecycle section:

```markdown
## FirmVault Test Ladder

FirmVault workflow tests use synthetic cases under the normal FirmVault
`cases/` tree. These cases use the reserved `test-ladder-*` slug prefix and
frontmatter `workflow_test: true`.

Global FirmVault workflow automation remains disabled while Phase 0 is under
test. Tests and operators manually start workflow instances for specific
synthetic case slugs, then call the normal materialization path. This exercises
the same workflow instance, node, task, recipe, and review machinery used by
real cases without scanning or materializing work for the rest of the vault.
```

- [ ] **Step 2: Run final verification**

Run:

```bash
cd /Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault
python3 skills.tools.workflows/runtime/scripts/validate_case_ladder_fixtures.py
find cases/test-ladder-* -name '*.json' -print

cd /Users/aaronwhaley/Github/mission-control
pnpm vitest run src/lib/__tests__/firmvault-test-ladder-workflows.test.ts
git diff --check -- docs/workflow-engine-v1.md src/lib/__tests__/firmvault-test-ladder-workflows.test.ts
```

Expected:

- Fixture validator passes.
- JSON scan prints nothing.
- Vitest test passes.
- Diff check prints nothing.

- [ ] **Step 3: Commit docs**

Run:

```bash
cd /Users/aaronwhaley/Github/mission-control
git add docs/workflow-engine-v1.md
git commit -m "docs: explain FirmVault test ladder workflow testing"
```

Expected: commit succeeds.

## Final Verification

Run:

```bash
cd /Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault
python3 skills.tools.workflows/runtime/scripts/validate_case_ladder_fixtures.py
find cases/test-ladder-* -maxdepth 1 -type f -name '*.md' -print | sort
find cases/test-ladder-* -name '*.json' -print
git status --short -- cases/test-ladder-000-new-intake-upload cases/test-ladder-001-case-created cases/test-ladder-002-document-collection-active cases/test-ladder-003-phase0-complete

cd /Users/aaronwhaley/Github/mission-control
pnpm vitest run src/lib/__tests__/firmvault-test-ladder-workflows.test.ts
git status --short -- src/lib/__tests__/firmvault-test-ladder-workflows.test.ts docs/workflow-engine-v1.md docs/superpowers/specs/2026-04-26-firmvault-test-ladder-mission-control-integration-design.md docs/superpowers/plans/2026-04-26-firmvault-test-ladder-mission-control-integration.md
```

Expected:

- FirmVault validator passes.
- Four synthetic root case files print.
- JSON scan prints nothing.
- Scoped FirmVault status is clean after commit.
- Mission Control Vitest test passes.
- Scoped Mission Control status is clean after commits.

## Self-Review

Spec coverage:

- Task 1 adds real synthetic FirmVault cases under normal `cases/`.
- Task 2 tests Mission Control manual workflow start and task materialization.
- Task 3 documents the manual test-ladder path.
- Global automation remains disabled.

Placeholder scan:

- No unspecified implementation steps remain.
- The plan intentionally avoids Docker runner execution in this slice.

Type consistency:

- Synthetic slugs use the same `test-ladder-*` prefix throughout.
- Mission Control tests use existing workflow engine APIs and existing recipe slugs.
