# Waypoint Runtime Release Checklist

## Purpose

This checklist is the final acceptance gate for declaring **Waypoint runtime ready**.

---

## 1) Preconditions

- [x] Branch is up to date and based on `feat/waypoint-runtime-slice` tip.
- [x] No uncommitted changes in the working tree.
- [ ] Required environment variables for deployment are present and verified per target environment.
- [ ] Rollback owner is assigned for release window.
- [ ] Release approver is assigned for release window.

---

## 2) Contract and API Readiness

- [x] `docs/waypoint-envelope-parity-matrix.md` is current.
- [x] Error envelope contract is consistent on all Waypoint and discussion mutation surfaces:
  - `{ ok:false, action:'error', error, details? }`
- [x] Validation details normalization is locked:
  - `details[]` entries are `{ code, path, message }`
  - root path fallback is `$`
- [x] Command and typed endpoint parity has been re-verified for current HEAD.

---

## 3) Smoke Tests (must pass)

Run from repo root:

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
pnpm typecheck
pnpm lint
```

- [x] All targeted suites pass.
- [x] `pnpm typecheck` passes.
- [x] `pnpm lint` reports 0 errors (warnings may match known baseline).

---

## 4) Migration and Data Safety Checks

- [x] No destructive schema changes in this release scope.
- [x] Any metadata shape changes are backward compatible.
- [x] Discussion conversation IDs remain canonical:
  - `task:{task_id}:discussion:{agent_slug}`
- [x] Autopilot run telemetry writes are anchored to valid workflow instance IDs.

---

## 5) Runtime Safety Gates

- [x] Discussion auto-response remains safe by default (not requested unless explicitly enabled).
- [x] Global auto-response kill switch verified:
  - `WAYPOINT_DISCUSSION_AUTORESPONSE_ENABLED` controls dispatch eligibility.
- [x] Best-effort event bus dispatch behavior verified (message persistence not blocked by broadcast failure).
- [x] Gate decisions still require explicit approve/reject actions.

---

## 6) Rollback Plan

If release must be reverted:

1. Revert to previous known-good commit before current release candidate.
2. Redeploy prior build artifact.
3. Verify core typed endpoints:
   - `GET /api/projects/:id/waypoint/status`
   - `POST /api/projects/:id/waypoint/command`
   - `GET|POST /api/projects/:id/waypoint/autopilot`
   - `GET|POST /api/projects/:id/waypoint/routes`
4. Confirm discussion endpoints still persist/list messages.
5. Post incident summary and capture follow-up patch scope.

- [ ] Rollback owner confirmed.
- [ ] Rollback command path tested in staging.

---

## 7) Final GO / NO-GO Gate

### Release sign-off fields (required)

- **Release approver (name + handle):** ____________________
- **Rollback owner (name + handle):** ____________________
- **Release target(s):** ____________________
- **Date/Time (UTC):** ____________________

### Deployment env-var verification record (required)

Record explicit verification for each release target (staging/prod/etc):

- `WAYPOINT_DISCUSSION_AUTORESPONSE_ENABLED = ______`
- Verification method (dashboard/secret manager/manifest): ______
- Verified by: ______
- Verified at (UTC): ______

### Decision

- [ ] **GO** — all checklist items complete, tests green, rollback owner + release approver assigned, env vars verified per target.
- [x] **NO-GO** — any blocking failure remains.

**Notes:**

- Blocking issues (if NO-GO):
  - Release approver not yet assigned.
  - Rollback owner not yet assigned.
  - Deployment env-var readiness not yet explicitly confirmed for release target(s).
- Post-release monitoring focus:
  - Discussion message persistence vs broadcast side-effects (best-effort dispatch).
  - Auto-response gating behavior (`metadata` + `WAYPOINT_DISCUSSION_AUTORESPONSE_ENABLED`).
  - Waypoint command/typed endpoint error-envelope parity regressions.
