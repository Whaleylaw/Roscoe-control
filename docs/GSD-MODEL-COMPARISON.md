# GSD Model vs Mission Control Implementation (Current State)

Last updated: 2026-04-21
Compared paths:

- Model repo: `/Users/aaronwhaley/mission-control/get-shit-done-main`
- Built system: `/Users/aaronwhaley/mission-control`

---

## Executive summary

Mission Control is no longer a single-lifecycle-per-project approximation.

It now has an additive hierarchical GSD model inside a normal project:

- project shell lifecycle: `discuss -> plan -> execute -> verify -> done`
- first-class workstreams
- first-class milestones
- first-class phases with ordering and dependency edges
- first-class plans with waves and dependency edges
- project-scoped lifecycle graph read model
- interactive Lifecycle tab for create, edit, complete, and transition actions
- hierarchy SSE events and conflict signaling

Bottom line:

- the structural gap to `get-shit-done-main` is mostly closed
- the remaining gap is automation polish, not missing primitives

---

## Capability matrix

| Capability | Model (`get-shit-done-main`) | Mission Control (current) | Status |
|---|---|---|---|
| Project lifecycle shell | Yes | Yes | Parity |
| Workstreams as first-class | Yes | Yes (`gsd_workstreams`) | Parity |
| Milestones as first-class | Yes | Yes (`gsd_milestones`) | Parity |
| Phases as first-class | Yes | Yes (`gsd_phases`) | Parity |
| Plans as first-class | Yes | Yes (`gsd_plans`) | Parity |
| Parallel milestone flows in one project | Yes | Yes | Parity |
| Plan dependencies | Yes | Yes, phase-scoped | Parity |
| Phase dependencies | Yes | Yes, milestone-scoped | Parity |
| Plan waves | Yes | Yes (`wave`) | Parity (structural) |
| Decimal/manual phase ordering | Yes | Yes (`ordering_numeric`) | Parity |
| Gate approvals | Yes | Yes (`gate_required`, `gate_status`) | Parity |
| Legacy bootstrap and shell transitions | N/A | Yes | Mission Control extension |
| Interactive hierarchy UI | Planning docs and prompts | Yes, in Lifecycle tab | Mission Control extension |
| Live SSE refresh from hierarchy events | Workflow-driven | Yes | Parity |
| Automatic wave conflict detection | Yes, richer guidance | Live (`WAVE_CONFLICT_BLOCKED`, `rollups.wave_conflicts`) | Closed |
| Dedicated CLI/MCP wrappers for hierarchy | Prompt/tooling-driven | Live (`mc projects ...`, `mc gsd ...`, MCP wrappers) | Closed |

---

## What Mission Control now implements

### Structural primitives

Mission Control now has native tables and routes for:

- `gsd_workstreams`
- `gsd_milestones`
- `gsd_phases`
- `gsd_plans`

Tasks can also be linked to:

- `gsd_workstream_id`
- `gsd_milestone_id`
- `gsd_phase_id`
- `gsd_plan_id`

### Read model

The canonical hierarchy read model is:

- `GET /api/projects/:id/gsd/lifecycle-graph`

It returns:

- nested workstreams, milestones, phases, and plans
- unscoped milestones
- project shell metadata
- rollups
- legacy fallback flags for Phase 9 projects

### Mutation model

Mission Control now supports:

- workstream create, edit, complete
- milestone create, edit, complete
- phase create, edit, lifecycle transition
- plan create, edit, status transition

### UI model

The project Lifecycle tab now supports:

- graph-backed rendering
- legacy fallback for pre-Phase-10 projects
- inline creation at every hierarchy level
- inline editing for names, refs, keys, statuses, dependencies, and ordering
- milestone reassignment between workstreams
- checkbox-based dependency selection
- complete and transition controls
- live refresh from `gsd.*` SSE events
- readable conflict banners for blocked dependency transitions

---

## What is still different from the model repo

### Remaining gaps

Core parity gaps called out in earlier drafts are now closed:

- wave-conflict detection is live (`WAVE_CONFLICT_BLOCKED` + `rollups.wave_conflicts`)
- hierarchy CLI wrappers are live (`projects workstreams|milestones`, `gsd phases|plans`)
- hierarchy MCP wrappers are live in `scripts/mc-mcp-server.cjs`

Current delta vs the model repo is mostly operational polish (default queue policy, opinionated automation templates, and higher-order orchestration heuristics), not missing lifecycle primitives.

### Intentional Mission Control differences

- Mission Control keeps the project shell lifecycle as a top-level control plane for backward compatibility and reporting
- The reference repo is planning-file-first; Mission Control is database and API first, with the UI acting as an operator console over live state
- Mission Control supports mixed-mode projects where legacy Phase 9 tasks and Phase 10 hierarchy objects coexist

---

## Evidence highlights

### From the model repo (`get-shit-done-main`)

- `get-shit-done/templates/roadmap.md`
  - milestone-grouped roadmap
  - arbitrary phase ordering, including decimal inserts
  - plans per phase
- `get-shit-done/workflows/new-milestone.md`
  - milestone lifecycle orchestration
- `get-shit-done/references/workstream-flag.md`
  - workstream-scoped planning and parallel milestone work
- `get-shit-done/references/few-shot-examples/plan-checker.md`
  - dependency and same-wave conflict reasoning

### From Mission Control

- `src/lib/migrations.ts`
  - hierarchy tables and task linkage columns
- `src/lib/validation.ts`
  - hierarchy statuses, body schemas, and transition schemas
- `src/lib/gsd-hierarchy.ts`
  - scoped lookup helpers, dependency parsing, optimistic locking, and transition rules
- `src/app/api/projects/[id]/gsd/lifecycle-graph/route.ts`
  - canonical hierarchy read model
- `src/components/project/lifecycle/lifecycle-view.tsx`
  - graph-driven lifecycle UI, SSE refresh, conflict banners, legacy fallback
- `src/components/project/lifecycle/lifecycle-hierarchy.tsx`
  - interactive hierarchy create/edit/transition UI
- `src/lib/event-bus.ts`
  - hierarchy event types

---

## Recommended operating pattern now

Use one Mission Control project per real initiative, not one project per workstream.

Inside that project:

1. enable GSD
2. optionally bootstrap the legacy task pack
3. create workstreams if parallel tracks are needed
4. create milestones under workstreams or directly under the project
5. create phases under milestones
6. create plans under phases
7. attach tasks to the appropriate hierarchy nodes as execution happens
8. drive progress from the Lifecycle tab or REST

The old project-per-workstream workaround is no longer the preferred path.

---

## Decision point

The meaningful choice is no longer whether to add hierarchy primitives or wrappers. Those are in place.

The next choices are operational:

A) Keep using the hierarchy with default queue behavior
B) Add stricter project/plan queue scoping and automatic plan-linked task activation defaults
C) Add higher-order orchestration templates (auto-routing, blocker escalation, wave balancing)

Given the current state, B and C are the right follow-on work. The data model, wrappers, and UI are already in place.
