---
phase: quick/260417-silence-api-openclaw-doctor-400s
plan: 01
subsystem: dashboard-ux
tags: [openclaw, doctor, polling, ux, console-hygiene, quick-fix]
requirements: [QUICK-260417-01]
dependency_graph:
  requires: []
  provides:
    - "GET /api/openclaw/doctor soft-success contract when openclaw CLI is missing"
    - "installed: boolean discriminator on doctor status payloads"
  affects:
    - "src/components/layout/openclaw-doctor-banner.tsx (consumes new discriminator)"
    - "src/components/onboarding/runtime-setup-modal.tsx (benefits — no longer silently fails on 400; surfaces summary through verify step)"
tech_stack:
  added: []
  patterns:
    - "Soft-success for benign 'missing tool' detection on polling endpoints"
    - "Optional discriminator field (installed?: boolean) for backward-compatible client guards"
key_files:
  created: []
  modified:
    - src/app/api/openclaw/doctor/route.ts
    - src/components/layout/openclaw-doctor-banner.tsx
decisions:
  - "GET returns 200 with installed:false when CLI missing; POST still returns 400 (explicit user action)"
  - "Banner hides via installed === false check; runtime-setup-modal left unchanged"
  - "Non-ENOENT error fall-through preserved (existing parseOpenClawDoctorOutput path)"
metrics:
  duration_min: 8
  completed: "2026-04-22"
  tasks_completed: 2
  files_modified: 2
---

# Quick Task 260417: Silence /api/openclaw/doctor 400s Summary

Stopped the Mission Control dashboard from flooding browser consoles with red "Failed to load resource: 400" errors when the openclaw CLI is not installed, by converting the polling GET endpoint's "missing CLI" branch from a hard 400 to a soft 200 with an `installed: false` discriminator, and teaching the `OpenClawDoctorBanner` to hide when that discriminator is present.

## What Changed

### Server (`src/app/api/openclaw/doctor/route.ts`)

**Before — GET missing-CLI branch:**
```ts
if (isMissingOpenClaw(detail)) {
  return NextResponse.json({ error: 'OpenClaw is not installed or not reachable' }, { status: 400 })
}
```

**After — GET missing-CLI branch:**
```ts
if (isMissingOpenClaw(detail)) {
  return NextResponse.json(
    {
      installed: false,
      level: 'warning' as const,
      category: 'general' as const,
      healthy: false,
      summary: 'OpenClaw is not installed or not reachable',
      issues: [],
      canFix: false,
      raw: detail,
    },
    {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    }
  )
}
```

Both successful GET responses also now spread `installed: true` onto the `parseOpenClawDoctorOutput(...)` payload so consumers can rely on the discriminator being present whenever the endpoint succeeded.

**POST handler:** completely unchanged — still returns 400 when the CLI is missing because POST is only invoked by explicit user action (the "Run Doctor Fix" / "Auto-Fix Issues" buttons).

### Client (`src/components/layout/openclaw-doctor-banner.tsx`)

1. Extended the local `OpenClawDoctorStatus` interface with an optional `installed?: boolean`.
2. Updated the render guard:

```ts
// Before:
if (loading || dismissed || !doctor || doctor.healthy) return null

// After:
if (loading || dismissed || !doctor || doctor.healthy || doctor.installed === false) return null
```

Used `=== false` rather than `!doctor.installed` so that omitted/legacy payloads fall through to the existing `doctor.healthy` check. Only an explicit `installed: false` suppresses the banner.

## Non-Changes (Intentional)

- `parseOpenClawDoctorOutput` (parser is unaware of install state) — untouched.
- `isMissingOpenClaw` / `getCommandDetail` helpers — untouched.
- `runtime-setup-modal.tsx` — intentionally unchanged per plan decision log. Its `checkHealth` / `runOnboard` previously silently failed on 400; now it will receive the soft payload and advance to the `verify` step showing the "OpenClaw is not installed or not reachable" summary — a net UX improvement with zero code change.
- No existing tests assert 400 on ENOENT (confirmed at plan time: `src/lib/__tests__/openclaw-doctor.test.ts` is parser-only; `tests/auth-guards.spec.ts` checks auth only, not status codes). No test changes required.

## Verification

| Check                                                            | Result |
| ---------------------------------------------------------------- | ------ |
| `pnpm typecheck`                                                 | PASS   |
| `pnpm lint src/components/layout/openclaw-doctor-banner.tsx`     | SKIPPED — worktree has no `node_modules` (eslint unavailable). Full lint will run on merge. Diff is mechanical (one interface field + one `||` term). |
| GET returns 200 + `installed:false` when CLI missing             | Code-reviewed; matches plan truths. Manual browser smoke deferred to merge. |
| POST still returns 400 when CLI missing                          | Verified unchanged via git diff of POST block. |
| Banner hides when `installed === false`                          | Verified via guard update. |
| Banner still shows for real warnings (`installed:true,healthy:false`) | Guard uses `=== false`, so `undefined`/`true` fall through. |

Manual console-spam verification (DevTools on a machine without openclaw, let the dashboard poll for 60s, expect zero red 400s from `/api/openclaw/doctor`) is the last success-criterion and will be performed on the merged branch; it is not runnable inside the executor worktree.

## Deviations from Plan

### Tooling

**1. `pnpm lint` not executed on Task 2 verify step**
- **Found during:** Task 2 verification (`pnpm lint src/components/layout/openclaw-doctor-banner.tsx`)
- **Issue:** The executor worktree runs without `node_modules` installed (parallel-execution constraint), so `eslint` is unavailable (`sh: eslint: command not found`).
- **Resolution:** Task 2's automated gate is `pnpm typecheck && pnpm lint`. Typecheck PASSED. Lint was skipped as out-of-scope for the worktree and will run in CI / on merge. The two-line change is mechanical (adding an optional interface field and a `|| doctor.installed === false` term to an existing guard) with no stylistic risk.
- **Not tracked as auto-fix:** this is an environment constraint, not a code issue.

### Code

None — plan executed exactly as written. No auto-fixes (Rules 1-3) were needed; no architectural decisions (Rule 4) were raised.

## Commits

| Task | Hash      | Message                                                               |
| ---- | --------- | --------------------------------------------------------------------- |
| 1    | `0541d68` | fix(quick-260417-01): return soft 200 on GET /api/openclaw/doctor when CLI missing |
| 2    | `8f47565` | fix(quick-260417-01): hide doctor banner when OpenClaw is not installed |

## Self-Check

- [x] `src/app/api/openclaw/doctor/route.ts` exists and contains `installed: false`
- [x] `src/components/layout/openclaw-doctor-banner.tsx` exists and contains `installed === false`
- [x] Commit `0541d68` exists
- [x] Commit `8f47565` exists
- [x] POST handler preserved 400 on missing CLI (unchanged)
- [x] `pnpm typecheck` passes

## Self-Check: PASSED
