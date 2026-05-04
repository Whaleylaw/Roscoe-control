# Waypoint Runtime Release Candidate Summary

## Candidate

- **Branch:** `feat/waypoint-runtime-slice`
- **Candidate window:** current HEAD
- **Status:** **NO-GO** (pending non-code release ownership + env verification)

## Scope delivered

This candidate closes the current Waypoint runtime hardening phase:

1. Error-envelope parity across Waypoint command + typed endpoints.
2. Validation-details normalization (`{ code, path, message }`, root path `$`).
3. Discussion transport hardening (strict payloads, positive task-id checks, canonical conversation IDs).
4. Safe auto-response request signaling with dual gate:
   - task metadata opt-in
   - global env gate `WAYPOINT_DISCUSSION_AUTORESPONSE_ENABLED`
5. Ops/release documentation:
   - `docs/waypoint-envelope-parity-matrix.md`
   - `docs/waypoint-operations-runbook.md`
   - `docs/plans/waypoint-release-checklist.md`

## Verification evidence

Latest recorded quality gates:

- Targeted Waypoint + discussion smoke suite: **pass**
- `pnpm typecheck`: **pass**
- `pnpm lint`: **pass** (0 errors, baseline warnings only)

Primary smoke command:

```bash
pnpm exec vitest run --testTimeout=20000 \
  src/lib/__tests__/waypoint-task-discussion.test.ts \
  src/app/api/tasks/[id]/discussion/__tests__/route.test.ts \
  src/app/api/tasks/[id]/discussion/start/__tests__/route.test.ts \
  src/app/api/tasks/[id]/discussion/messages/__tests__/route.test.ts \
  src/app/api/projects/[id]/waypoint/command/__tests__/route.test.ts \
  src/app/api/projects/[id]/waypoint/autopilot/__tests__/route.test.ts \
  src/app/api/projects/[id]/waypoint/routes/__tests__/route.test.ts \
  src/app/api/projects/[id]/waypoint/routes/[routeId]/events/__tests__/route.test.ts \
  src/app/api/projects/[id]/waypoint/routes/[routeId]/gate/__tests__/route.test.ts \
  src/app/api/projects/[id]/waypoint/routes/[routeId]/state/__tests__/route.test.ts
```

## Remaining blockers to GO

1. Release approver (name + handle) not assigned.
2. Rollback owner (name + handle) not assigned.
3. Env-var readiness not explicitly verified per release target:
   - `WAYPOINT_DISCUSSION_AUTORESPONSE_ENABLED`

## Sign-off block (copy into release ticket)

- **Release approver:** ____________________
- **Rollback owner:** ____________________
- **Release target(s):** ____________________
- **Release time (UTC):** ____________________
- **Env var value per target (`WAYPOINT_DISCUSSION_AUTORESPONSE_ENABLED`):** ____________________
- **Env verification method:** ____________________
- **Verified by:** ____________________
- **Verified at (UTC):** ____________________

## Decision

- **Current:** **NO-GO**
- **Flip to GO when:** all three blockers above are filled and checklist entries are checked in `docs/plans/waypoint-release-checklist.md`.
