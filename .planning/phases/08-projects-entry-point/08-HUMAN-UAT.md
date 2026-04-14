---
status: partial
phase: 08-projects-entry-point
source: [08-VERIFICATION.md]
started: 2026-04-14T17:35:32Z
updated: 2026-04-14T17:35:32Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. End-to-end cold-start journey
expected: `pnpm build && cp -r .next/static .next/standalone/.next/static && cp -r public .next/standalone/public && pnpm test:e2e -- projects-entry-point` → "1 passed" in ~3-5s. Journey: login → nav-rail "Projects" click → `/projects` → project row click → `/project/e2e-phase-8` → breadcrumb "Projects" click → returns to `/projects` (not `/`).
result: [pending]

## Summary

total: 1
passed: 0
issues: 0
pending: 1
skipped: 0
blocked: 0

## Gaps
