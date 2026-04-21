# Roadmap: Project Workspace & Dashboard

## Overview

Transform projects from a task-grouping label into a first-class destination. v1.0 built the workspace itself — foundations, navigation shell, dashboard, scoped tasks/sessions/agents, settings, and entry points. v1.1 layered native GSD lifecycle support onto that workspace (Discuss → Plan → Execute → Verify → Done). Phase 10 extended that model so a single project can host multiple workstreams, milestones, phases, and plans concurrently via a hierarchical Lifecycle tab. v1.2 added the agent execution layer: Kanban tasks declare a recipe card, and a dedicated runner daemon launches short-lived containerized agents to execute them with crash-safe progress checkpoints and per-task-scoped authentication.

## Milestones

- ✅ **v1.0 — Project Workspace & Dashboard** — Phases 1–8 (shipped 2026-04-14) → [archive](milestones/v1.0-MILESTONE-AUDIT.md)
- ✅ **v1.1 — Native GSD Integration** — Phases 9–10 (shipped 2026-04-15) → [archive](milestones/v1.1-MILESTONE-AUDIT.md)
- ✅ **v1.2 — Recipe-Based Ephemeral Agent Runtime** — Phases 11–18.1 (shipped 2026-04-21) → [archive](milestones/v1.2-ROADMAP.md)
- 📋 **Next** — run `/gsd:new-milestone` to scope v1.3

## Phases

<details>
<summary>✅ v1.0 — Project Workspace & Dashboard (Phases 1–8) — SHIPPED 2026-04-14</summary>

- [x] Phase 1: Foundation (3/3 plans)
- [x] Phase 2: Navigation & Workspace Shell (2/2 plans)
- [x] Phase 3: Project Dashboard (3/3 plans)
- [x] Phase 4: Project Tasks (2/2 plans)
- [x] Phase 5: Sessions & Agents (4/4 plans)
- [x] Phase 6: Settings (2/2 plans)
- [x] Phase 7: Post-Audit Gap Closure (2/2 plans)
- [x] Phase 8: Projects Entry Point (6/6 plans)

Phase directories remain under `.planning/phases/` as historical execution record. Full audit at `.planning/v1.0-MILESTONE-AUDIT.md`.

</details>

<details>
<summary>✅ v1.1 — Native GSD Integration (Phases 9–10) — SHIPPED 2026-04-15</summary>

- [x] Phase 9: GSD Native Integration (11/11 plans)
- [x] Phase 10: Hierarchical Lifecycle Graph (complete)

Phase directories remain under `.planning/phases/` as historical execution record. Full audit at `.planning/v1.1-MILESTONE-AUDIT.md`.

</details>

<details>
<summary>✅ v1.2 — Recipe-Based Ephemeral Agent Runtime (Phases 11–18.1) — SHIPPED 2026-04-21</summary>

- [x] Phase 11: Runtime Foundation (4/4 plans)
- [x] Phase 12: Recipe System (4/4 plans)
- [x] Phase 13: Task Runtime Context (3/3 plans)
- [x] Phase 14: Runner Daemon & Container Execution (12/12 plans)
- [x] Phase 15: Checkpoints & Scheduler Integration (7/7 plans)
- [x] Phase 16: Runtime UI Surfaces (6/6 plans)
- [x] Phase 17: Integration Testing & Reference Pipeline (6/6 plans)
- [x] Phase 18: v1.2 Tech-Debt Cleanup (4/4 plans)
- [x] Phase 18.1: v1.2 Runtime Documentation (INSERTED, 7/7 plans)

Phase directories archived to `.planning/milestones/v1.2-phases/`. Full audit at `.planning/milestones/v1.2-MILESTONE-AUDIT.md`. Full roadmap snapshot at `.planning/milestones/v1.2-ROADMAP.md`.

</details>

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Foundation | v1.0 | 3/3 | Complete | 2026-04-13 |
| 2. Navigation & Workspace Shell | v1.0 | 2/2 | Complete | 2026-04-13 |
| 3. Project Dashboard | v1.0 | 3/3 | Complete | 2026-04-13 |
| 4. Project Tasks | v1.0 | 2/2 | Complete | 2026-04-13 |
| 5. Sessions & Agents | v1.0 | 4/4 | Complete | 2026-04-13 |
| 6. Settings | v1.0 | 2/2 | Complete | 2026-04-14 |
| 7. Post-Audit Gap Closure | v1.0 | 2/2 | Complete | 2026-04-14 |
| 8. Projects Entry Point | v1.0 | 6/6 | Complete | 2026-04-14 |
| 9. GSD Native Integration | v1.1 | 11/11 | Complete | 2026-04-15 |
| 10. Hierarchical Lifecycle Graph | v1.1 | — | Complete | 2026-04-15 |
| 11. Runtime Foundation | v1.2 | 4/4 | Complete | 2026-04-19 |
| 12. Recipe System | v1.2 | 4/4 | Complete | 2026-04-19 |
| 13. Task Runtime Context | v1.2 | 3/3 | Complete | 2026-04-20 |
| 14. Runner Daemon & Container Execution | v1.2 | 12/12 | Complete | 2026-04-20 |
| 15. Checkpoints & Scheduler Integration | v1.2 | 7/7 | Complete | 2026-04-20 |
| 16. Runtime UI Surfaces | v1.2 | 6/6 | Complete | 2026-04-21 |
| 17. Integration Testing & Reference Pipeline | v1.2 | 6/6 | Complete | 2026-04-21 |
| 18. v1.2 Tech-Debt Cleanup | v1.2 | 4/4 | Complete | 2026-04-21 |
| 18.1. v1.2 Runtime Documentation | v1.2 | 7/7 | Complete | 2026-04-21 |

Next milestone: run `/gsd:new-milestone` to scope v1.3.
