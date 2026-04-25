# Workflow Engine Roadmap

Last updated: 2026-04-25
Branch: `codex/workflow-engine-v1`

This is the working source of truth for the generic workflow engine and the FirmVault law-firm workflow conversion. When someone asks "what is next?", start here, then confirm against the current git diff and recent commits.

## North Star

Mission Control should support durable, auditable workflows made of configurable nodes. A workflow can be created from YAML, triggered by a case event or condition, create recipe-backed tasks on the existing Kanban board, wait on timers or external conditions, route through review, and resume when dependencies are satisfied.

The law-firm/FirmVault workflows are the first production use case, but the engine should stay generic enough for GSD, project workflows, and future ad hoc agent-created workflows.

## Current Architecture

- Workflow definitions live in SQLite as validated YAML records.
- Workflow instances are per-subject runtime records, usually `subject_type = law_firm_case` and `subject_id = <case-slug>`.
- Workflow node instances track the state of each node in a running workflow.
- Recipe nodes materialize into the existing task system, scoped to a project and visible on the existing Kanban board.
- Task execution still goes through the existing recipe runner, worktree, task comments, review, and quality-review paths.
- Conditions are satisfied by push-style events such as case landmark changes, not by repeatedly polling every possible dependency.
- Timers are represented as workflow dependencies and advanced by the timer advancement function; the scheduled runner still needs to be wired.
- The case Workflow tab now shows workflow activity, while the Tasks tab remains the work execution board.

## Recent Commits

- `df97f71 feat: run workflow triggers for cases`
  - Added trigger runner, workflow activity listing, case-landmark trigger activation, and workflow activity UI.
- `e0e44b0 feat: add workflow triggers and variables`
  - Added YAML `triggers` and `vars` support.
- `d305a32 feat: add workflow dependency semantics`
  - Added node, condition, timer, and typed dependency semantics.
- `c83560c feat: package recipe references and narrow tools`
  - Added recipe reference packaging and tighter tool configuration.
- `646985d feat: add FirmVault medical records recipes`
  - Added initial concrete FirmVault medical records recipes.
- `f0f48f7 feat: define FirmVault medical records workflow`
  - Added the first YAML medical records workflow.
- `07cd876 feat: satisfy workflow dependencies from law firm landmarks`
  - Connected case landmark satisfaction to workflow dependencies.
- `cd95936 feat: add workflow dependency index`
  - Added dependency index foundation.

## Completed

- Generic workflow YAML parsing.
- Workflow definition creation.
- Workflow instance creation.
- Recipe node materialization into existing tasks/Kanban.
- Node dependencies.
- Condition dependencies.
- Timer dependency representation.
- Typed dependency semantics inspired by Beads-style relationships.
- Workflow trigger definitions.
- Push-style case landmark trigger activation.
- Workflow activity listing for a case.
- Case Workflow tab showing actual workflow instances and node status.
- Initial FirmVault request-medical-records workflow YAML.
- Initial FirmVault request-medical-records recipe set.
- Tool registry baseline.

## Active Design Decisions

- Reuse the existing task/Kanban board for agent work. Do not build a second workflow task board unless a later UX need proves it.
- Workflows are orchestration. Tasks are execution.
- Recipe runner remains the generic blank-slate agent. The recipe supplies prompt, tools, model, references, and workspace constraints.
- Workflow dependencies should be pushed forward by events whenever possible.
- Timers need one scheduler pass, but the scheduler should only look at due timer rows rather than every workflow and every dependency.
- Quality review should complete or reject a workflow node, then the workflow engine should promote the next eligible nodes.
- A workflow may be manually activated, cancelled, bypassed, or marked not applicable from the case UI.

## Next Implementation Steps

### 1. FirmVault Workflow Source Reconciliation

Goal: decide the canonical source material before converting more law-firm workflows.

- Use `.planning/FIRMVault_WORKFLOW_SOURCE_RECONCILIATION.md` as the source-selection rule.
- Reconcile each workflow from both historical FirmVault folders before writing Mission Control YAML.
- Initial `request_records_bills` reconciliation is documented in `.planning/REQUEST_RECORDS_BILLS_RECONCILED_SPEC.md`.
- Use that spec to update the Mission Control YAML and recipes.

Status: initial pass complete; implementation updates are next.

### 2. Workflow Definition Registry and Sync

Goal: installed YAML workflows should be first-class, repeatable, and updatable.

- Add a registry/sync path that reads `workflows/*.yaml`.
- Validate each YAML workflow with `parseWorkflowDefinition`.
- Upsert active definitions into `workflow_definitions`.
- Preserve versioning rules.
- Add a CLI, script, or admin API endpoint for sync.
- Add tests proving sync creates and updates definitions deterministically.

Status: high priority after source reconciliation.

### 3. Quality Review to Workflow Advancement

Goal: when a workflow-created task passes review, its workflow node completes and the next eligible node appears.

- Confirm the existing quality-review approval path.
- Detect workflow metadata on approved tasks.
- Call the workflow advancement function after approval.
- Materialize newly ready recipe nodes into the same case project.
- Add tests for task approval -> node complete -> next task created.

Status: high priority.

### 4. Timer Scheduler

Goal: wait nodes and timer dependencies wake up automatically at the right time.

- Add a scheduled API route or daemon call around `advanceDueWorkflowTimers`.
- Query only due scheduled timer/dependency rows.
- Materialize newly eligible nodes after timer completion.
- Ensure timers can be cancelled or bypassed if records arrive early.
- Add tests for due timer, not-yet-due timer, and early condition cancellation.

Status: high priority.

### 5. Case Workflow Controls

Goal: users can manage workflows directly from the case UI.

- Add case Workflow tab actions:
  - activate workflow
  - close/cancel workflow
  - bypass/not applicable
  - show blockers
  - show due dates/timer waits
- Keep execution tasks on the existing Tasks tab.
- Add tests around action rendering and API behavior.

Status: medium priority.

### 6. Complete Request Medical Records Workflow

Goal: make the first real FirmVault workflow production-usable.

- Review the source skill at the FirmVault workflow folder.
- Ensure each workflow node has a concrete recipe, not a placeholder.
- Ensure each recipe has an appropriate `SOUL.md`.
- Attach reference documents.
- Register or map allowed tools.
- Confirm required variables such as provider, case slug, authorization status, and request target.
- Test on Abby Sitgraves or a fixture case.

Status: active law-firm conversion track.

### 7. Additional FirmVault Workflow Conversion

Goal: convert the natural-language FirmVault workflows into concrete YAML + recipes.

Candidate workflows:

- PIP setup and confirmation.
- BI carrier identification and claim opening.
- Medical provider intake.
- Treatment monitoring.
- Request medical records and bills.
- Medical chronology update.
- Lien identification.
- Lien opening and letter of representation.
- Final lien amount request.
- Lien negotiation and payment.
- Demand package preparation.
- Demand review.
- Settlement negotiation.
- Closing statement and disbursement.
- Case closeout.

Status: pending after the first workflow is stable.

## Open Questions

- Should workflow YAML sync be manual, automatic at app startup, or operator-triggered from the UI?
- How should workflow definition versions behave when a workflow is already active for a case?
- Should a cancelled workflow instance allow the same workflow definition to start again for the same subject?
- How should repeating cron/cooldown workflows key their instances so they can repeat without duplicating active work?
- Should human review be modeled as a workflow node, a task status, or both?
- What is the exact rule for bypass/not applicable: mark node skipped, mark workflow complete, satisfy a landmark, or some combination?
- Should Beads or a Beads-like table become the workflow issue/dependency tracker later?

## Beads Note

Beads would be a good conceptual fit for this work: durable IDs, dependency edges, blocked/ready state, and an auditable task graph. We are not installing or adopting it yet because Mission Control already has SQLite-backed tasks, workflow tables, and a Kanban UI. For now, we are borrowing the useful ideas:

- explicit dependency edges
- ready vs blocked semantics
- typed relationships
- event-driven unblock behavior
- durable audit trail

Later, we can either integrate Beads directly or make Mission Control's workflow tables more Beads-like.

## How To Answer "What's Next?"

Use this order:

1. Check the current git status for uncommitted workflow changes.
2. Check the latest commits on `codex/workflow-engine-v1`.
3. Read this roadmap.
4. Recommend the first unfinished item in "Next Implementation Steps" unless the user has redirected priority.

Current recommended next step: **Add workflow definition registry/sync, then install the reconciled `firmvault-request-medical-records` definition through that path**.
