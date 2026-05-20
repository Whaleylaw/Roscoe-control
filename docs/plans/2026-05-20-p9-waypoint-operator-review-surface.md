# P9 Waypoint Operator Review Surface Plan

Date: 2026-05-20
Repo: Mission Control
Branch: `feat/waypoint-runtime-slice`

## Goal

Add a Mission Control operator-facing review surface for package-backed Waypoint `referral-package` runs, without claiming the unresolved P10 full production build gate is green.

The surface should let an operator inspect package route state, see whether the local package run completed/blocked/failed, review produced artifact paths and unresolved blockers, and approve/resume handoff gates when available.

## Starting state

- P10 host smoke exists at commit `c0b4d95 test(waypoint): add referral package host smoke`.
- P10 build blocker is documented at commit `14ba065 docs(waypoint): document p10 build blocker`.
- Existing Waypoint API routes include project route list/detail/state/events/gate endpoints under `/api/projects/[id]/waypoint/routes`.
- No dedicated UI component currently matches `waypoint` by filename under `src/components`.

## Phase P9.1 — API/UI contract discovery

Deliverables:
- Identify the route state/event/gate payloads already exposed by Mission Control.
- Identify where project/task/operator panels should host the review surface.

Verification gate:
- Source inspection of existing API tests and panel conventions.

## Phase P9.2 — Add focused operator review component

Deliverables:
- A reusable component/panel that accepts project id + route id/task context and renders:
  - package quest/recipe/run status;
  - runtime result summary;
  - artifact links/paths;
  - unresolved blockers;
  - gate status/action affordance if the route exposes a handoff gate.

Verification gate:
- Component test covering completed and blocked referral-package states.

## Phase P9.3 — Wire the surface into the existing Mission Control UI

Deliverables:
- Add an entry point in the appropriate task/project panel so operators can reach the Waypoint review state from active referral-package work.
- Keep UI additive and low-risk; avoid rewriting unrelated panels.

Verification gate:
- Focused React/Vitest test for the entry point or panel integration.

## Phase P9.4 — Verify and commit

Verification commands:
- Focused component/API tests added in this slice.
- `pnpm typecheck` if feasible.
- Do **not** rerun full `pnpm build` as a completion gate for this slice unless the documented P10 build blocker has been separately fixed.

Done criteria:
- P9 operator review surface exists and is reachable.
- Focused tests pass with output captured.
- Commit created with primary-source commit hash.

## Implementation notes — 2026-05-20

- Added `WaypointReviewTab` as the focused operator review component.
- The component loads existing route detail and route event APIs:
  - `GET /api/projects/:id/waypoint/routes/:routeId`
  - `GET /api/projects/:id/waypoint/routes/:routeId/events?limit=25`
- It renders route status, case root, latest local package runtime summary, artifacts, missing artifacts, route nodes, and blocked handoff gate approval affordances.
- Wired the task detail modal to show a `Waypoint` tab when task metadata exposes either `metadata.waypoint.route_id` or `metadata.workflow.workflow_instance_id` and the task has a `project_id`.
- Verification captured in this slice:
  - focused component tests: `2 passed`
  - typecheck: `pnpm typecheck` exit code `0`
- Full `pnpm build` was intentionally not used as the P9 completion gate because P10 documents the unresolved Next production build timeout/OOM blocker.
