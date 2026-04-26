# FirmVault Test Ladder Mission Control Integration Design

## Summary

Mission Control should test FirmVault workflows by using real synthetic
FirmVault case folders, not a parallel fixture harness. The synthetic cases live
under the normal FirmVault `cases/` tree, so every Mission Control reader,
workflow function, recipe lookup, task materializer, and runner path sees the
same shape it would see for a real law-firm case.

The first scope is Phase 0:

- `test-ladder-000-new-intake-upload`
- `test-ladder-001-case-created`
- `test-ladder-002-document-collection-active`
- `test-ladder-003-phase0-complete`

The Mission Control workflows remain globally disabled. Tests start workflow
instances manually for the synthetic case slugs only.

## Goals

- Exercise the actual Mission Control workflow engine, not a FirmVault-only
  harness.
- Exercise the actual FirmVault case layout by placing synthetic cases under
  `cases/`.
- Keep global automation off so no real cases are materialized during testing.
- Prove that manual workflow starts can create workflow instances and
  recipe-backed Mission Control tasks for the synthetic cases.
- Keep the ladder incremental: each synthetic case folder represents one real
  case state that downstream workflow tests can use.

## Non-Goals

- Do not enable automatic FirmVault workflow triggers globally.
- Do not run Docker recipe agents as part of the first integration tests.
- Do not create a separate FirmVault test harness that bypasses Mission Control.
- Do not materialize tasks for real cases.
- Do not modify existing real FirmVault cases.

## Architecture

### FirmVault Synthetic Cases

FirmVault will contain real synthetic case folders:

```text
cases/test-ladder-000-new-intake-upload/
cases/test-ladder-001-case-created/
cases/test-ladder-002-document-collection-active/
cases/test-ladder-003-phase0-complete/
```

Each folder is a normal vault case path. The content is copied from the existing
Phase 0 fixture ladder and adapted so paths and frontmatter identify the
synthetic case slug. Each root case file includes:

```yaml
workflow_test: true
source_system: test-fixture
pii_profile: synthetic
```

This flag is not an automation trigger. It exists so humans and tests can
distinguish these cases from real matters.

### Mission Control Workflow Tests

Mission Control tests will use an in-memory SQLite database and existing
workflow engine functions:

- `createWorkflowDefinition`
- `startWorkflowInstance`
- `materializeReadyWorkflowNodes`
- `listWorkflowActivity`

The tests will define or load Phase 0 workflow definitions in the same schema
Mission Control already uses. They will manually start workflows against only
the synthetic case slugs.

The test does not need to run an agent. It should prove that the workflow system
creates the expected workflow instance, node rows, and recipe-backed task rows.
The runner can then pick up those tasks through the existing runner pipeline in
separate runner tests.

### Disabled Global Automation

`workflows/firmvault-workflows.yaml` remains disabled for global automatic
materialization. The test path bypasses automatic triggers by manually starting
specific workflow definitions for specific synthetic cases.

This gives a controlled integration path:

1. Synthetic case exists in FirmVault.
2. Mission Control test starts the workflow manually.
3. Mission Control materializes ready workflow nodes.
4. Assertions confirm the expected recipe task is created.
5. No other cases are touched.

## Data Flow

```text
FirmVault/cases/test-ladder-* case folder
        |
        v
Mission Control law-firm/workflow integration test
        |
        v
startWorkflowInstance(subject_type=law_firm_case, subject_id=<test slug>)
        |
        v
materializeReadyWorkflowNodes()
        |
        v
tasks row with recipe_slug, workflow_instance_id, workflow_node_key
```

## Testing Strategy

### FirmVault Checks

FirmVault keeps its fixture validator for the saved ladder snapshots:

```bash
python3 skills.tools.workflows/runtime/scripts/validate_case_ladder_fixtures.py
```

Additional checks confirm the synthetic cases exist under `cases/` and contain
no legacy JSON state files.

### Mission Control Checks

Mission Control adds integration tests that:

- create an in-memory database
- run migrations
- create a project/workspace context
- create Phase 0 workflow definitions
- manually start workflows for `test-ladder-*` case slugs
- materialize ready nodes
- assert recipe-backed tasks exist
- assert non-test case slugs are not touched

The first tests should focus on:

- `case_setup`
- `document_collection`

## Open Decisions

None for this implementation slice.

Later work can decide whether to add a workflow materializer allowlist, for
example `workflow_test: true` or `case_slug LIKE 'test-ladder-%'`, before
automatic triggers are enabled.

## Self-Review

- Placeholder scan: no placeholders or deferred fields remain.
- Internal consistency: the design consistently keeps global automation disabled
  and uses manual starts.
- Scope check: the slice is limited to Phase 0 synthetic cases and Mission
  Control workflow-engine integration tests.
- Ambiguity check: the test path is explicit that it does not run Docker recipe
  agents yet.
