---
phase: 2
slug: navigation-workspace-shell
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-13
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 2.1.x with jsdom |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `pnpm test -- --run` |
| **Full suite command** | `pnpm test` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm test -- --run`
- **After every plan wave:** Run `pnpm test && pnpm typecheck`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 02-00-01 | 00 | 0 | NAV-01 | unit | `pnpm test -- --run src/lib/__tests__/project-workspace.test.ts` | ❌ W0 | ⬜ pending |
| 02-00-02 | 00 | 0 | NAV-02, NAV-05 | unit | `pnpm test -- --run src/lib/__tests__/project-breadcrumb.test.ts` | ❌ W0 | ⬜ pending |
| 02-00-03 | 00 | 0 | NAV-03 | unit | `pnpm test -- --run src/lib/__tests__/project-tabs.test.ts` | ❌ W0 | ⬜ pending |
| 02-00-04 | 00 | 0 | NAV-04 | unit | `pnpm test -- --run src/components/project/__tests__/project-context.test.tsx` | ✅ exists | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/lib/__tests__/project-workspace.test.ts` — stubs for NAV-01 (workspace renders with breadcrumb + tabs)
- [ ] `src/lib/__tests__/project-breadcrumb.test.ts` — stubs for NAV-02, NAV-05 (breadcrumb segments, clickable links, back navigation)
- [ ] `src/lib/__tests__/project-tabs.test.ts` — stubs for NAV-03 (all 5 tabs render, active tab highlighted)
- [ ] Extend existing `src/components/project/__tests__/project-context.test.tsx` — stubs for NAV-04 (URL reflects project and sub-view)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Browser back button navigates correctly | NAV-05 | Requires real browser history stack | Navigate to /project/my-app/tasks, click browser back, verify return to previous page |
| No page reload on tab switch | NAV-03 | Requires observing network tab | Switch between tabs, verify no full page refresh in browser dev tools |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
