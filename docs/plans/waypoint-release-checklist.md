# Waypoint Runtime Release Checklist

## Purpose

This checklist is the final acceptance gate for declaring **Waypoint runtime ready**.

---

## 1) Preconditions

- [ ] Branch is up to date and based on `feat/waypoint-runtime-slice` tip.
- [ ] No uncommitted changes in the working tree.
- [ ] Required environment variables for deployment are present.
- [ ] Rollback owner is assigned for release window.

---

## 2) Contract and API Readiness

- [ ] `docs/waypoint-envelope-parity-matrix.md` is current.
- [ ] Error envelope contract is consistent on all Waypoint and discussion mutation surfaces:
  - `{ ok:false, action:'error', error, details? }`
- [ ] Validation details normalization is locked:
  - `details[]` entries are `{ code, path, message }`
  - root path fallback is `$`
- [ ] Command and typed endpoint parity has been re-verified for current HEAD.

---

## 3) Smoke Tests (must pass)

Run from repo root:

```bash
pnpm exec vitest run \
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

- [ ] All targeted suites pass.
- [ ] `pnpm typecheck` passes.
- [ ] `pnpm lint` reports 0 errors (warnings may match known baseline).

---

## 4) Migration and Data Safety Checks

- [ ] No destructive schema changes in this release scope.
- [ ] Any metadata shape changes are backward compatible.
- [ ] Discussion conversation IDs remain canonical:
  - `task:{task_id}:discussion:{agent_slug}`
- [ ] Autopilot run telemetry writes are anchored to valid workflow instance IDs.

---

## 5) Runtime Safety Gates

- [ ] Discussion auto-response remains safe by default (not requested unless explicitly enabled).
- [ ] Global auto-response kill switch verified:
  - `WAYPOINT_DISCUSSION_AUTORESPONSE_ENABLED` controls dispatch eligibility.
- [ ] Best-effort event bus dispatch behavior verified (message persistence not blocked by broadcast failure).
- [ ] Gate decisions still require explicit approve/reject actions.

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

## Decision

- [ ] **GO** — all checklist items complete, tests green, rollback owner assigned.
- [ ] **NO-GO** — any blocking failure remains.

**Release approver:** ____________________

**Date/Time:** ____________________

**Notes:**

- Blocking issues (if NO-GO):
- Post-release monitoring focus:
