---
phase: 4
slug: project-tasks
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-13
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 2.1.x (unit) + Playwright 1.51.x (E2E) |
| **Config file** | `vitest.config.ts`, `playwright.config.ts` |
| **Quick run command** | `pnpm vitest run src/components/project/__tests__/tasks-view.test.tsx src/components/panels/__tests__/task-board-panel.test.tsx` |
| **Full suite command** | `pnpm test && pnpm test:e2e` |
| **Estimated runtime** | ~90 seconds (unit) + ~60 seconds (targeted E2E) |

---

## Sampling Rate

- **After every task commit:** Run quick command (targeted component tests)
- **After every plan wave:** Run `pnpm test` (full vitest) + `pnpm typecheck` + `pnpm lint`
- **Before `/gsd:verify-work`:** `pnpm test:all` (lint + typecheck + test + build + e2e) must be green
- **Max feedback latency:** ~90 seconds per commit

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 04-00-01 | 00 | 0 | TASK-01..04 | scaffold | `pnpm vitest run src/components/project/__tests__/tasks-view.test.tsx` | ❌ W0 | ⬜ pending |
| 04-00-02 | 00 | 0 | TASK-01..04 | scaffold | `pnpm vitest run src/components/panels/__tests__/task-board-panel.test.tsx` | ❌ W0 | ⬜ pending |
| 04-00-03 | 00 | 0 | TASK-02, TASK-03 | scaffold | `pnpm test:e2e tests/project-tasks.spec.ts` | ❌ W0 | ⬜ pending |
| 04-01-01 | 01 | 1 | TASK-01 | unit | `pnpm vitest run src/components/panels/__tests__/task-board-panel.test.tsx -t "TASK-01"` | ✅ W0 | ⬜ pending |
| 04-01-02 | 01 | 1 | TASK-01 | unit | same file, `-t "hides project filter"` | ✅ W0 | ⬜ pending |
| 04-01-03 | 01 | 1 | TASK-01 | unit | same file, `-t "hides ticket_ref on card"` | ✅ W0 | ⬜ pending |
| 04-01-04 | 01 | 1 | TASK-02 | unit | same file, `-t "TASK-02"` | ✅ W0 | ⬜ pending |
| 04-01-05 | 01 | 1 | TASK-03 | unit | same file, `-t "reassigns out disappears"` | ✅ W0 | ⬜ pending |
| 04-01-06 | 01 | 1 | TASK-04 | unit | same file, `-t "TASK-04 feature parity"` | ✅ W0 | ⬜ pending |
| 04-01-07 | 01 | 1 | TASK-01..04 | integration | `pnpm vitest run src/components/project/__tests__/tasks-view.test.tsx` | ✅ W0 | ⬜ pending |
| 04-01-08 | 01 | 1 | TASK-02, TASK-03 | E2E | `pnpm test:e2e tests/project-tasks.spec.ts` | ✅ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/components/project/__tests__/tasks-view.test.tsx` — `it.todo()` stubs for TASK-01 (filter), TASK-03 (reassign-out disappears), TASK-04 (feature parity at integration level). Pattern: match `src/components/project/__tests__/dashboard-view.test.tsx`.
- [ ] `src/components/panels/__tests__/task-board-panel.test.tsx` — NEW file with `it.todo()` stubs covering the `scope` prop: default (undefined) = current behavior; `lockedProjectId` filters; `hideProjectFilter` removes dropdown; `hideProjectLabels` hides card ticket_ref (not detail modal); `defaultCreateProjectId` pre-fills create modal.
- [ ] `tests/project-tasks.spec.ts` — Playwright E2E smoke scaffold (`test.fixme()` stubs): create task in workspace → appears with correct project; reassign task via edit modal → disappears from workspace board.

*Infrastructure already installed (vitest, playwright, @testing-library/react) — only new test files needed.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Visual layout of embedded board within workspace shell (breadcrumb + tabs spacing) | TASK-04 | Layout/overflow bugs hard to assert automatically | Run `pnpm dev`, open a project, verify the board fits without double-scrollbars or clipped columns |
| Drag-and-drop across all 9 status columns | TASK-04 | Playwright drag is flaky; full D&D coverage is existing behavior | Manual smoke in dev: move a task across Ready → In Progress → Review → Done |
| Aegis approval gate still visible in workspace mode | TASK-04 | Visual verification that D-04 "no features stripped" holds | Open a task needing approval; confirm Aegis button renders inside workspace |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all ❌ MISSING references above
- [ ] No watch-mode flags (all runs one-shot `vitest run`)
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
