---
phase: 6
slug: settings
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-13
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 2.1.x |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `pnpm test -- src/components/project/__tests__/settings-view.test.tsx` |
| **Full suite command** | `pnpm test` |
| **Estimated runtime** | ~5s quick / ~60s full |

---

## Sampling Rate

- **After every task commit:** Run quick command
- **After every plan wave:** Run full suite command
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 6-01-01 | 01 | 0 | SETT-01, SETT-02, SETT-03 | unit | `pnpm test -- src/components/project/__tests__/settings-view.test.tsx` | ❌ W0 | ⬜ pending |
| 6-01-02 | 01 | 0 | SETT-01, SETT-02, SETT-03 | i18n | `pnpm test -- src/components/__tests__/i18n-coverage.test.tsx` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/components/project/__tests__/settings-view.test.tsx` — stubs for SETT-01, SETT-02, SETT-03
- [ ] i18n keys added to all 10 locale files, asserted by extending `src/components/__tests__/i18n-coverage.test.tsx`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Visual parity with UI-SPEC.md (colors, spacing, swatch grid) | SETT-01, SETT-02 | Pixel-level visual decisions | Compare rendered settings view against `.planning/phases/06-settings/06-UI-SPEC.md` ASCII mockups |
| Workspace rename reflects in breadcrumb + nav immediately after save | SETT-03 | Cross-component reactivity via Zustand | Change project name, save, confirm breadcrumb and nav list update without page reload |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
