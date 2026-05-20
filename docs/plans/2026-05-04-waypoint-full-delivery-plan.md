# Waypoint Full Delivery Plan

> **For Hermes:** Execute this plan slice-by-slice with strict TDD (`RED -> GREEN -> REFACTOR`), targeted vitest first, then `pnpm typecheck`, then `pnpm lint`.

**Goal:** Ship Waypoint as a complete lifecycle+workflow runtime in Mission Control with stable contracts, route control surfaces, discussion transport, autopilot safety, and operational readiness.

**Architecture:** Keep `gsd_*` schema as compatibility lifecycle layer, bind Waypoint entities to Workflow Engine `workflow_instances` as execution substrate, and expose a parity-safe API/command surface (`/waypoint ...` + typed endpoints). Treat Waypoint as first-class product naming and contract layer while preserving backward compatibility.

**Tech Stack:** Next.js App Router, TypeScript, SQLite/better-sqlite3, Workflow Engine v1, Vitest, zod.

---

## 0) Current Baseline (already complete)

Completed on branch `feat/waypoint-runtime-slice`:

- Route start/reuse, status, autopilot run + autopilot history.
- Gate decisions (`/waypoint gate` + typed gate endpoint).
- Route state controls (pause/resume), route detail/list/events endpoints.
- Error-envelope parity hardening:
  - Standard error: `{ ok:false, action:'error', error, details? }`
  - Validation details normalized to `{ code, path, message }`.
- Parity matrix doc exists:
  - `docs/waypoint-envelope-parity-matrix.md`
- Recent verification for touched surfaces has been green in targeted suites.

This plan focuses on **remaining project completion work**, not redoing completed parity slices.

---

## 1) End-State Definition (what “done” means)

Waypoint is complete when all are true:

1. **Contract complete:** All Waypoint endpoints + command aliases conform to documented envelope parity and behavior matrix.
2. **Execution complete:** Lifecycle entities can reliably start/reuse/observe/advance routes and gates end-to-end.
3. **Discussion complete:** Task-scoped discussion supports start/list/post + optional guarded auto-response mode.
4. **Autopilot complete:** Bounded progression loop with history, audit events, and explicit safety rails.
5. **Operator complete:** `status`, `routes`, `route`, `route-events`, `gate`, `pause/resume`, `auto`, `auto status`, `doctor`, `forensics`, `discuss`, and `help` behave predictably.
6. **Operational complete:** Tests are comprehensive, docs are current, and rollout/guardrails are documented.

---

## 2) Remaining Work Plan (phased)

## Phase A — Command/API Closure and Contract Lock

### A1. Command grammar + typed endpoint parity sweep
**Objective:** Ensure every command has equivalent typed API behavior and consistent error semantics.

**Files likely touched**
- `src/lib/waypoint-command.ts`
- `src/app/api/projects/[id]/waypoint/**/route.ts`
- `src/app/api/projects/[id]/waypoint/**/__tests__/route.test.ts`
- `src/lib/__tests__/waypoint-command.test.ts`
- `docs/waypoint-envelope-parity-matrix.md`

**Acceptance criteria**
- No drift between command and typed endpoint behavior for equivalent actions.
- All validation errors return normalized `details` shape.
- Parity matrix explicitly maps command alias -> endpoint behavior.

---

### A2. Doctor/Forensics route starters (if not fully completed)
**Objective:** Ensure `/waypoint doctor` and `/waypoint forensics` are fully validated project-scoped starters with tests.

**Files likely touched**
- `src/lib/waypoint-command.ts`
- `src/lib/waypoint.ts` (only if helper gap exists)
- `src/lib/__tests__/waypoint-command.test.ts`
- relevant route tests

**Acceptance criteria**
- Commands parse/execute with default definition slugs.
- Failures match standard error envelope.
- Route start/reuse semantics are deterministic.

---

## Phase B — Discussion Runtime Completion

### B1. Discussion transport hardening
**Objective:** Fully lock discussion read/start/post semantics + metadata invariants.

**Files likely touched**
- `src/lib/waypoint-task-discussion.ts`
- `src/app/api/tasks/[id]/discussion/*/route.ts`
- `src/lib/__tests__/waypoint-task-discussion.test.ts`
- `src/app/api/tasks/[id]/discussion/**/__tests__/route.test.ts`

**Acceptance criteria**
- Conversation-id convention is strict and tested.
- Metadata merge preserves non-discussion metadata.
- Start/post/list endpoints all enforce auth/workspace/rate-limit parity.

---

### B2. Optional auto-response mode (gated)
**Objective:** Add opt-in task discussion agent auto-response with safe boundaries.

**Files likely touched**
- `src/app/api/tasks/[id]/discussion/messages/route.ts`
- `src/lib/waypoint-task-discussion.ts`
- `src/lib/**` integration helper for agent dispatch
- tests for side-effect gating

**Acceptance criteria**
- Auto-response is **off by default**; enabled only by explicit metadata/config.
- External side effects are guarded by approval/safety policy.
- Failure paths still return standard error envelope without breaking message persistence.

---

## Phase C — Route/Lifecycle Integration Integrity

### C1. Lifecycle scope integrity sweep
**Objective:** Ensure lifecycle scope (`project/workstream/milestone/phase/plan`) is always reconstructible from route context and vars.

**Files likely touched**
- `src/lib/waypoint.ts`
- `src/lib/workflow-engine.ts` (minimal, targeted)
- `src/lib/__tests__/waypoint*.test.ts`

**Acceptance criteria**
- Scope normalization has deterministic precedence rules.
- No ownership checks rely solely on optional vars where unsafe.
- Subject-type aliases remain backward-compatible.

---

### C2. Materialization metadata integrity
**Objective:** Guarantee route->task materialization retains Waypoint metadata and linkage columns.

**Files likely touched**
- `src/lib/workflow-engine.ts`
- `src/lib/waypoint-task-discussion.ts`
- `src/lib/__tests__/waypoint-materialization.test.ts`

**Acceptance criteria**
- Task metadata includes workflow + waypoint + optional discussion fields correctly.
- Linkage columns (`gsd_*_id`) are populated when available.
- No regression in non-Waypoint workflow materialization.

---

## Phase D — Autopilot Safety + Observability Completion

### D1. Autopilot policy and stop-reason completeness
**Objective:** Finalize autopilot bounded-loop policy, stop reasons, and deterministic resumability.

**Files likely touched**
- `src/lib/waypoint-autopilot.ts`
- `src/lib/__tests__/waypoint-autopilot*.test.ts`
- `src/app/api/projects/[id]/waypoint/autopilot/**`

**Acceptance criteria**
- Stop reasons are stable enum-like values and documented.
- All run outcomes are auditable through `workflow_events` + GET history endpoint.
- No unbounded execution path exists.

---

### D2. Autopilot + gate interplay
**Objective:** Ensure autopilot respects gate blockers and does not bypass human review.

**Acceptance criteria**
- Gate-blocked routes remain blocked until explicit gate action.
- Autopilot status surfaces gate-block reason clearly.

---

## Phase E — Operator Readiness (Docs, UX, Rollout)

### E1. Docs completion
**Objective:** Move docs from “draft slices” to operator-ready runtime docs.

**Files likely touched**
- `docs/waypoint-runtime-design.md`
- `docs/waypoint-envelope-parity-matrix.md`
- `docs/workflow-engine-v1.md` (cross-links only)
- new runbook: `docs/waypoint-operations-runbook.md`

**Acceptance criteria**
- Command reference is complete and accurate.
- Endpoint matrix includes success/error payload examples.
- Known guardrails + troubleshooting steps documented.

---

### E2. Rollout checklist + acceptance gate
**Objective:** Explicit release gate for “Waypoint runtime ready”.

**Files likely touched**
- `docs/plans/waypoint-release-checklist.md` (new)

**Acceptance criteria**
- Checklist includes smoke tests, migration safety checks, and rollback notes.
- A single explicit “GO/NO-GO” gate documented.

---

## 3) Test Strategy (global)

Per slice:
1. Add failing test(s).
2. Implement minimal change.
3. Run targeted `pnpm exec vitest run <touched suites>`.
4. Run `pnpm typecheck`.
5. Run `pnpm lint`.
6. Commit only when green.

Cross-phase full regression pack (minimum):
- `src/lib/__tests__/waypoint.test.ts`
- `src/lib/__tests__/waypoint-status.test.ts`
- `src/lib/__tests__/waypoint-workflows.test.ts`
- `src/lib/__tests__/waypoint-materialization.test.ts`
- `src/lib/__tests__/waypoint-task-discussion.test.ts`
- `src/app/api/projects/[id]/waypoint/**/__tests__/route.test.ts`
- `src/app/api/tasks/[id]/discussion/**/__tests__/route.test.ts`

---

## 4) Risks and Mitigations

1. **Workflow-engine collateral risk** (`src/lib/workflow-engine.ts` is sensitive)
   - Mitigation: tiny diffs, route-specific tests, frequent commits.
2. **Contract drift between command and typed endpoints**
   - Mitigation: parity matrix + paired tests for each action.
3. **External side-effect risk in discussion auto-response**
   - Mitigation: opt-in only, explicit gate, safe default OFF.
4. **Autopilot bypassing human gates**
   - Mitigation: explicit blocker logic + tests asserting no bypass.

---

## 5) Delivery Sequence (recommended)

1. A1 command/API parity sweep
2. A2 doctor/forensics closure
3. B1 discussion transport hardening
4. B2 optional auto-response (gated)
5. C1 lifecycle scope integrity
6. C2 materialization metadata integrity
7. D1 autopilot policy completion
8. D2 autopilot-gate interplay hardening
9. E1 docs completion
10. E2 release checklist + final acceptance gate

---

## 6) “Project Done” Exit Checklist

- [ ] All Waypoint command actions are implemented and tested.
- [ ] All typed Waypoint endpoints are behavior-parity tested.
- [ ] Error envelope + validation details format is contract-locked everywhere.
- [ ] Discussion APIs are production-safe; optional auto-response is gated.
- [ ] Autopilot run + history + gate interactions are deterministic and auditable.
- [ ] Runtime design + envelope matrix + runbook are current.
- [ ] Full targeted regression pack passes + `typecheck` + `lint` green.

---

## 7) Immediate Next Slice to start now

**Next slice:** Phase A1 — command/API parity sweep and matrix lock.

**Definition of done for next slice:**
- Add/adjust parity tests where command/endpoint contracts are still shape-only.
- Ensure all remaining validation error tests assert normalized `details[0]` object shape.
- Update matrix entries for any newly locked behavior.
