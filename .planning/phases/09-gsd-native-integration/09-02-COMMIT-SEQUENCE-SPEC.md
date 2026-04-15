# 09-02 Commit Sequence — Option B Native GSD Integration (First 10 Commits)

Purpose
Enforce deterministic implementation order for Claude Code with minimal drift.

Branch
- feature/gsd-native-integration

Commit policy
- One concern per commit
- Tests included/updated in same commit where behavior changes
- No unrelated refactors
- Keep non-GSD flows backward compatible

----------------------------------------------------------------
## Commit 01 — schema: add GSD columns to projects/tasks

Message
feat(db): add native GSD lifecycle columns to projects and tasks

Scope
- src/lib/migrations.ts

Changes
- Add migration for:
  - projects: gsd_enabled, gsd_track, gsd_phase, gsd_gate_mode, gsd_project_id, gsd_updated_at
  - tasks: gsd_phase, gate_required, gate_status, gate_approved_by, gate_approved_at, depends_on_task_ids
- Add indexes:
  - idx_projects_gsd_phase
  - idx_tasks_gsd_phase
  - idx_tasks_gate_status
- Backfill defaults safely

Must pass
- App boots and migrations run on existing DB

----------------------------------------------------------------
## Commit 02 — validation: add GSD enums and payload schemas

Message
feat(validation): add gsd phase/gate schemas and transition payload validators

Scope
- src/lib/validation.ts

Changes
- Add:
  - gsd phase enum: discuss|plan|execute|verify|done
  - gsd gate mode enum: manual_approval|auto_internal
  - transition schema
  - task gate patch schema

Must pass
- invalid values return validation errors in API usage

----------------------------------------------------------------
## Commit 03 — api/projects list/detail include gsd fields

Message
feat(api): expose gsd fields in project GET list/detail responses

Scope
- src/app/api/projects/route.ts
- src/app/api/projects/[id]/route.ts

Changes
- Include GSD columns in SELECT for list/single endpoints

Must pass
- GET /api/projects and GET /api/projects/:id return gsd fields

----------------------------------------------------------------
## Commit 04 — api/projects create/patch accept gsd fields

Message
feat(api): support gsd metadata in project create/update endpoints

Scope
- src/app/api/projects/route.ts
- src/app/api/projects/[id]/route.ts

Changes
- Accept POST fields: gsd_enabled, gsd_track, gsd_phase, gsd_gate_mode, gsd_project_id
- Accept PATCH updates for same fields with validation/normalization

Must pass
- create and patch work with/without gsd payload

----------------------------------------------------------------
## Commit 05 — api: add gsd bootstrap endpoint

Message
feat(api): add POST /api/projects/:id/gsd/bootstrap with idempotent phase task seeding

Scope
- src/app/api/projects/[id]/gsd/bootstrap/route.ts
- src/app/api/index/route.ts

Changes
- New endpoint seeds default phase task pack
- Idempotent behavior (rerun does not duplicate)
- task records include gsd_phase and gate_required flags

Must pass
- bootstrap on same project twice yields stable result

----------------------------------------------------------------
## Commit 06 — api: add gsd transition endpoint

Message
feat(api): add POST /api/projects/:id/gsd/transition with lifecycle rule enforcement

Scope
- src/app/api/projects/[id]/gsd/transition/route.ts
- src/app/api/index/route.ts

Changes
- Enforce legal transitions only:
  - discuss->plan->execute->verify->done
- Enforce minimum completion criteria per phase
- Update gsd_phase + gsd_updated_at
- Log transition activity/audit

Must pass
- illegal jumps rejected, legal transitions accepted

----------------------------------------------------------------
## Commit 07 — api: add task gate approval endpoint

Message
feat(api): add PATCH /api/tasks/:id/gate for approval/rejection metadata

Scope
- src/app/api/tasks/[id]/gate/route.ts
- src/app/api/index/route.ts

Changes
- Approve/reject gate
- Record approver + timestamp
- Preserve tenant/workspace scoping and auth checks

Must pass
- gate status updates persisted and visible on task fetch

----------------------------------------------------------------
## Commit 08 — guardrail: enforce gate on task status transitions

Message
feat(tasks): block in_progress/done transitions when gate_required and not approved

Scope
- src/app/api/tasks/route.ts
- src/app/api/tasks/[id]/route.ts (if status update path exists)

Changes
- Before moving to in_progress/done:
  - if gate_required=1 and gate_status!=approved => 403
- Return explicit actionable error message

Must pass
- blocked without approval, succeeds after approval

----------------------------------------------------------------
## Commit 09 — ui: project-level gsd controls

Message
feat(ui): add gsd controls to project manager/settings with bootstrap and phase actions

Scope
- src/components/modals/project-manager-modal.tsx
- src/components/project/settings-view.tsx
- Any project detail components needed

Changes
- gsd_enabled toggle
- gsd_track, gsd_phase, gsd_gate_mode, gsd_project_id controls
- action buttons:
  - Bootstrap GSD tasks
  - Transition phase

Must pass
- operator can manage lifecycle without API client

----------------------------------------------------------------
## Commit 10 — tests + docs: lifecycle, gate, idempotency

Message
test+docs(gsd): add coverage for bootstrap idempotency, transitions, and gate enforcement

Scope
- tests/projects-crud.spec.ts (or API tests suite)
- new tests under src/app/api/projects/[id]/gsd/* and tasks gate paths
- update any API index/openapi generation docs as needed

Changes
- Tests for:
  1) project gsd field CRUD
  2) bootstrap idempotency
  3) transition rule enforcement
  4) gate-required block
  5) post-approval success

Must pass
- targeted suites + full relevant suite green

----------------------------------------------------------------
## Post-commit verification command set

1) npm/pnpm test for touched suites
2) Manual smoke (local):
- create gsd-enabled project
- bootstrap
- illegal transition fail
- legal transition pass
- gate-required task blocked until approved
3) API index includes new endpoints

----------------------------------------------------------------
## Rollback strategy

If breakage appears after Commit 05+:
- keep schema commits (01-02)
- rollback endpoint/UI commits individually by cherry-pick revert
- retain tests to isolate failing behavior quickly

----------------------------------------------------------------
## Definition of done for this 10-commit wave

- Mission Control can create + manage GSD-native projects
- Lifecycle phase progression is enforced server-side
- Gate approvals are first-class and auditable
- Non-GSD projects continue operating unchanged
