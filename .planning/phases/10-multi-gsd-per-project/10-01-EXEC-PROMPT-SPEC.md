# Phase 10 Execution Prompt Spec (Claude Code)

Use this as the handoff prompt for implementation.

## Mission
Implement Phase 10: native multi-GSD per project in Mission Control.

## Hard Constraints
- Additive migrations first. No destructive schema changes.
- Keep existing Phase 9 APIs operational.
- Operator/admin role checks on all mutating endpoints.
- Full test coverage for new endpoints + transition invariants.
- No UI-only implementation: backend model and API come first.

## Build Order (strict)
1. Schema + migrations + DB types
2. Validation schemas
3. Core services (transition rules, dependency checks, idempotency)
4. REST endpoints
5. Event bus additions
6. Lifecycle graph read endpoint
7. UI lifecycle tab hierarchy
8. E2E + docs + OpenAPI

## Required Files to Touch
- src/lib/migrations.ts
- src/lib/db.ts
- src/lib/validation.ts
- src/lib/event-bus.ts
- src/app/api/projects/[id]/gsd/**
- src/app/api/gsd/**
- src/components/project/lifecycle/**
- openapi.json
- docs/agent-gsd-guide.md
- docs/GSD-FLOW-MAP.md

## Minimum Test Additions
- migrations test for new tables/columns
- endpoint tests for workstream/milestone/phase/plan CRUD
- transition tests (illegal ordering, dependency violations)
- parallel wave conflict rejection tests
- backward compatibility tests for existing phase-9 routes
- Playwright flow for multi-milestone one-project lifecycle

## Done Definition
- `pnpm test` green
- `pnpm test:e2e` includes new lifecycle scenario green
- OpenAPI updated
- docs updated
- no regression in existing GSD lifecycle routes
