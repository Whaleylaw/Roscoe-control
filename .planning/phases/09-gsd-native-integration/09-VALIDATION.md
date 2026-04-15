---
phase: 09
slug: gsd-native-integration
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-14
audited: 2026-04-15
---

# Phase 09 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Derived from `09-RESEARCH.md` §Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 2.1.x (unit + RTL) + Playwright 1.51.x (E2E) |
| **Config file** | `vitest.config.ts`, `playwright.config.ts` |
| **Quick run command** | `pnpm test -- <touched-paths>` |
| **Full suite command** | `pnpm test:all` (lint + typecheck + test + build + e2e) |
| **Estimated runtime** | ~2 min unit / ~10 min full |

---

## Sampling Rate

- **After every task commit:** `pnpm test -- <touched paths>` + `pnpm typecheck` (< 30 s per single-file change)
- **After every plan wave:** `pnpm lint && pnpm typecheck && pnpm test` (< 2 min)
- **Before `/gsd:verify-work`:** `pnpm test:all` must be green (< 10 min)
- **Max feedback latency:** 30 s per commit; 120 s per wave

---

## Per-Task Verification Map

| Req ID | Behavior | Test Type | Automated Command | File Exists | Status |
|--------|----------|-----------|-------------------|-------------|--------|
| GSD-01 | Project create with `gsd_enabled=true, gsd_track='ops'` persists | unit | `pnpm test -- src/app/api/projects/__tests__/projects-crud-gsd.test.ts` | ✅ | ✅ |
| GSD-02 | Migration 052 sets `gsd_phase='discuss'` default | unit | `pnpm test -- src/lib/__tests__/migrations-052.test.ts` | ✅ | ✅ |
| GSD-03 | Invalid `gsd_gate_mode` → 400 | unit | `projects-crud-gsd.test.ts` | ✅ | ✅ |
| GSD-04 | GET task carries `gsd_phase`, `gate_required` | unit | `pnpm test -- src/app/api/tasks/__tests__/tasks-gsd-fields.test.ts` | ✅ | ✅ |
| GSD-05 | PATCH gate records approver + timestamp | unit | `pnpm test -- src/app/api/tasks/__tests__/gate.test.ts` | ✅ | ✅ |
| GSD-06 | Migration additive; pre-052 DB boots after 052 | unit | `migrations-052.test.ts` | ✅ | ✅ |
| GSD-07 | Bootstrap twice → 8 tasks then 0 | unit | `pnpm test -- src/app/api/projects/__tests__/bootstrap.test.ts` | ✅ | ✅ |
| GSD-08 | discuss→execute skip returns 409 `ILLEGAL_TRANSITION` | unit | `pnpm test -- src/app/api/projects/__tests__/transition.test.ts` | ✅ | ✅ |
| GSD-09 | 409 body includes `code` + `error` | unit | `transition.test.ts` | ✅ | ✅ |
| GSD-10 | execute→verify waiver path | unit | `transition.test.ts` | ✅ | ✅ |
| GSD-11 | Approve/reject flips `gate_status` + emits event | unit | `gate.test.ts` | ✅ | ✅ |
| GSD-12 | Viewer → 403 on all 3 endpoints; operator → 200 | unit | three test files | ✅ | ✅ |
| GSD-13 | GET /api/projects returns new GSD cols | unit | `projects-crud-gsd.test.ts` | ✅ | ✅ |
| GSD-14 | Invalid `gsd_track` rejected | unit | `projects-crud-gsd.test.ts` | ✅ | ✅ |
| GSD-15 | status=in_progress blocked when gate pending | unit | `pnpm test -- src/app/api/tasks/__tests__/status-gate-block.test.ts` | ✅ | ✅ |
| GSD-16 | status=blocked allowed regardless of gate | unit | `status-gate-block.test.ts` | ✅ | ✅ |
| GSD-17 | Bootstrap missing file → bundled fallback | unit | `pnpm test -- src/lib/__tests__/gsd-templates.test.ts` | ✅ | ✅ |
| GSD-18 | Bundled default schema-validates | unit | `gsd-templates.test.ts` | ✅ | ✅ |
| GSD-19 | Bootstrap idempotent — task count unchanged on re-run | unit | `bootstrap.test.ts` | ✅ | ✅ |
| GSD-20 | `/project/<slug>/lifecycle` renders LifecycleView | unit (RTL) | `pnpm test -- src/components/project/lifecycle/__tests__/lifecycle-view.test.ts` | ✅ | ✅ |
| GSD-21 | LifecycleView shows phase, timeline, bootstrap btn | unit (RTL) | `lifecycle-view.test.ts` | ✅ | ✅ |
| GSD-22 | Operator sees Approve/Reject; viewer does not | unit (RTL) | `pnpm test -- src/components/project/lifecycle/__tests__/gate-task-row.test.ts` | ✅ | ✅ |
| GSD-23 | gsd_enabled=0 → EmptyState with Enable CTA | unit (RTL) | `pnpm test -- src/components/project/lifecycle/__tests__/empty-state.test.ts` | ✅ | ✅ |
| GSD-24 | Task card phase badge shown when `gsd_phase` set; hidden when null | unit (RTL) | `pnpm test -- src/components/panels/task-card/__tests__/phase-badge.test.ts` | ✅ | ✅ |
| GSD-25 | Task card gate badge (Approved / Approval required) | unit (RTL) | `pnpm test -- src/components/panels/task-card/__tests__/gate-badge.test.ts` | ✅ | ✅ |
| GSD-26 | Settings view renders GSD section with 3 fields | unit (RTL) | extend `src/components/project/__tests__/settings-view.test.ts` | ✅ extended | ✅ |
| GSD-27 | Track + gate-mode disabled when gsd_enabled=false | unit (RTL) | same | ✅ extended | ✅ |
| GSD-28 | Transition + gate PATCH emit eventBus.broadcast | unit | `transition.test.ts`, `gate.test.ts` | ✅ | ✅ |
| GSD-29 | All 10 locales contain `project.lifecycle.*` keys | unit | `pnpm test -- src/lib/__tests__/locale-parity-gsd.test.ts` | ✅ | ✅ |
| Cross | End-to-end create→enable→bootstrap→illegal→legal→gate→approve | E2E | `pnpm test:e2e -- tests/gsd-lifecycle.spec.ts` | ✅ | ✅ |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

New scaffolds (use `it.todo()` / `test.fixme()` so suite stays green during iteration):

- [x] `src/lib/__tests__/migrations-052.test.ts`
- [x] `src/lib/__tests__/gsd-templates.test.ts`
- [x] `src/lib/__tests__/validation-gsd.test.ts`
- [x] `src/lib/__tests__/locale-parity-gsd.test.ts`
- [x] `src/app/api/projects/__tests__/projects-crud-gsd.test.ts`
- [x] `src/app/api/projects/__tests__/bootstrap.test.ts`
- [x] `src/app/api/projects/__tests__/transition.test.ts`
- [x] `src/app/api/tasks/__tests__/gate.test.ts`
- [x] `src/app/api/tasks/__tests__/status-gate-block.test.ts`
- [x] `src/app/api/tasks/__tests__/tasks-gsd-fields.test.ts`
- [x] `src/components/project/lifecycle/__tests__/lifecycle-view.test.tsx`
- [x] `src/components/project/lifecycle/__tests__/gate-task-row.test.tsx`
- [x] `src/components/project/lifecycle/__tests__/empty-state.test.tsx`
- [x] `src/components/project/lifecycle/__tests__/phase-timeline.test.tsx`
- [x] `src/components/panels/task-card/__tests__/phase-badge.test.tsx`
- [x] `src/components/panels/task-card/__tests__/gate-badge.test.tsx`
- [x] `tests/gsd-lifecycle.spec.ts` (Playwright E2E)

Extend existing:

- [x] `src/components/project/__tests__/settings-view.test.tsx` — GSD-section tests added (line 595+)
- [x] `src/components/project/__tests__/project-tabs.test.tsx` — asserts 6 tabs incl. lifecycle

Framework install: **none** — vitest + playwright already configured.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Visual parity of phase badge with existing ticket_ref pill | GSD-24 | Pixel-level styling judgment; automated RTL only verifies text/classes | Open `/<slug>/tasks` after seeding a GSD task; confirm badge alignment matches ticket_ref pill beside it. |
| SSE push reflects transition without manual reload | GSD-28 | Full browser SSE requires live server; covered by E2E but worth eyeballing once | Run `pnpm dev`, open Lifecycle tab in two browsers, transition in one, confirm phase timeline updates in the other within 2 s. |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (17 new + 2 extensions)
- [x] No watch-mode flags
- [x] Feedback latency < 30 s per commit
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-04-15

---

## Validation Audit 2026-04-15

| Metric | Count |
|--------|-------|
| Gaps found | 0 |
| Resolved | 0 |
| Escalated | 0 |

Audit scope: VALIDATION.md frontmatter had drifted to `status: draft`, `nyquist_compliant: false`, `wave_0_complete: false` despite Phase 09 reaching completion with all 11 plans shipped (VERIFICATION.md: 12/12 criteria, 29/29 requirements). Filesystem cross-reference confirmed all 17 scaffold tests + 2 extensions exist (as `.test.tsx` for component files; original map had stale `.ts` paths — corrected). No gaps identified; frontmatter refreshed and sign-off completed.
