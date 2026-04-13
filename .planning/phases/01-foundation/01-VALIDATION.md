---
phase: 1
slug: foundation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-13
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 2.1.x |
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
| 01-01-01 | 01 | 1 | FOUN-01 | unit | `pnpm test -- --run src/components/project/__tests__/project-context.test.tsx` | ❌ W0 | ⬜ pending |
| 01-02-01 | 02 | 1 | FOUN-02 | unit | `pnpm test -- --run src/lib/__tests__/project-indexes.test.ts` | ❌ W0 | ⬜ pending |
| 01-03-01 | 03 | 1 | FOUN-03 | smoke | Manual verification via file listing | N/A (structural) | ⬜ pending |
| 01-04-01 | 04 | 1 | FOUN-04 | unit | `pnpm test -- --run src/components/project/__tests__/i18n-coverage.test.tsx` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/components/project/__tests__/project-context.test.tsx` — stubs for FOUN-01 (URL parsing, context values, default view)
- [ ] `src/lib/__tests__/project-indexes.test.ts` — stubs for FOUN-02 (migration runs, index exists)
- [ ] `src/components/project/__tests__/i18n-coverage.test.tsx` — stubs for FOUN-04 (stub views use translations)
- [ ] Test setup: `@testing-library/react` already available; `src/test/setup.ts` imports `@testing-library/jest-dom`

*Existing infrastructure covers test framework — only test files need creation.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Component directory structure | FOUN-03 | Structural file layout, not runtime behavior | Verify `src/components/project/` has separate files per view, no single file > 300 lines |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
