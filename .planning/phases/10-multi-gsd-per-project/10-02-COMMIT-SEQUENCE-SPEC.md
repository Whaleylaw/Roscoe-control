# Phase 10 — Strict First 10 Commits

Goal: deterministic implementation sequence for multi-GSD per project.

1) feat(gsd10): add additive schema for workstreams milestones phases plans
- migration(s) creating new tables + indexes + nullable task FK columns
- no behavior changes

2) feat(gsd10): extend db types/interfaces for hierarchical gsd entities
- src/lib/db.ts type additions
- compile passes

3) feat(gsd10): add zod validation schemas for new gsd endpoints
- request/response validation contracts
- transition/dependency validation primitives

4) feat(gsd10): implement core lifecycle service for phase/plan transitions
- deterministic transition engine
- optimistic lock checks
- idempotency helpers

5) feat(gsd10): add workstream and milestone CRUD API routes
- role enforcement + tests

6) feat(gsd10): add phase and plan CRUD+transition API routes
- dependency and ordering checks + tests

7) feat(gsd10): add lifecycle graph rollup endpoint for project hierarchy
- single-read model for UI consumption

8) feat(gsd10): emit hierarchical gsd events on create/update/transition
- event-bus type extensions + broadcast wiring

9) feat(gsd10): migrate lifecycle tab to hierarchical workstream/milestone view
- UI reads lifecycle-graph endpoint
- preserves legacy fallback

10) test(gsd10): add e2e multi-milestone-single-project scenario + docs/openapi updates
- OpenAPI paths/schemas updated
- docs/agent-gsd-guide + docs/GSD-FLOW-MAP updated
- regression checks for legacy phase-9 routes

Notes:
- Do not reorder these commits.
- Keep each commit atomic and reviewable.
- If a commit fails tests, fix within same commit before moving on.
