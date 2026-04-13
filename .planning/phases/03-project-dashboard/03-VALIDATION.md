---
phase: 3
slug: project-dashboard
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-13
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 2.1.x + @testing-library/react 16.1.x |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `pnpm vitest run src/components/project/__tests__/` |
| **Full suite command** | `pnpm test` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm vitest run src/components/project/__tests__/`
- **After every plan wave:** Run `pnpm test && pnpm typecheck`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 03-00-01 | 00 | 0 | DASH-01..07 | unit | `pnpm vitest run src/components/project/__tests__/dashboard-view.test.tsx` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/components/project/__tests__/dashboard-view.test.tsx` — stubs for DASH-01 through DASH-07
- [ ] Mock setup for `useMissionControl` returning tasks with various statuses
- [ ] Mock setup for `useProjectWorkspace` returning project with description
- [ ] Mock setup for `fetch` to return activities

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Visual layout and spacing | DASH-01, DASH-06 | Requires visual inspection | Open /project/test/dashboard, verify grid layout, card styling |
| SSE real-time update visual | DASH-07 | Requires live SSE event | Create a task while dashboard is open, verify counts update without refresh |
| Progress bar visual width | DASH-02 | CSS width correctness | Verify bar width matches percentage visually |
| Blocked card attention styling | DASH-05 | Color/border visual check | Create blocked task, verify amber/warning styling on card |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
