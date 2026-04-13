# Phase 1: Foundation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-13
**Phase:** 01-foundation
**Areas discussed:** URL routing strategy, Component directory layout, i18n namespace structure, DB index scope

---

## URL Routing Strategy

### Q1: URL Shape

| Option | Description | Selected |
|--------|-------------|----------|
| /project/:slug/:view | Singular, slug-based, human-readable | ✓ |
| /projects/:slug/:view | Plural, REST convention, potential conflict with list route | |
| /p/:slug/:view | Short prefix, less readable | |

**User's choice:** /project/:slug/:view (Recommended)
**Notes:** None

### Q2: Coexistence with Catch-All

| Option | Description | Selected |
|--------|-------------|----------|
| Detect in catch-all | Keep [[...panel]] route, branch on /project/ prefix | ✓ |
| Separate route group | New src/app/project/[slug]/[...view]/page.tsx, duplicates shell logic | |
| You decide | Let Claude pick | |

**User's choice:** Detect in catch-all (Recommended)
**Notes:** None

### Q3: Default View

| Option | Description | Selected |
|--------|-------------|----------|
| Dashboard | Landing on /project/my-app shows dashboard | ✓ |
| Tasks | Action-oriented, jump to work items | |
| You decide | Let Claude pick | |

**User's choice:** Dashboard (Recommended)
**Notes:** None

### Q4: State Storage

| Option | Description | Selected |
|--------|-------------|----------|
| URL only | Parse from segments, pass as props, no Zustand | |
| URL + React context | Parse from URL, provide via context provider | ✓ |
| You decide | Let Claude pick | |

**User's choice:** URL + React context
**Notes:** URL remains source of truth (FOUN-01 compliant), context avoids prop drilling through component layers.

---

## Component Directory Layout

### Q1: Directory Location

| Option | Description | Selected |
|--------|-------------|----------|
| src/components/project/ | New top-level directory alongside panels/, layout/, chat/, ui/ | ✓ |
| src/components/panels/project/ | Nested under existing panels/ directory | |
| src/components/project-workspace/ | Hyphenated folder name | |

**User's choice:** src/components/project/ (Recommended)
**Notes:** None

### Q2: Phase 1 Granularity

| Option | Description | Selected |
|--------|-------------|----------|
| Shell + stubs | Workspace shell + placeholder stub files for each sub-view | ✓ |
| Shell only | Just the workspace shell, sub-views created in later phases | |
| You decide | Let Claude pick | |

**User's choice:** Shell + stubs (Recommended)
**Notes:** None

---

## i18n Namespace Structure

### Q1: Message Key Organization

| Option | Description | Selected |
|--------|-------------|----------|
| "project" top-level key | project.workspace.title, project.dashboard.title, etc. | ✓ |
| "projectWorkspace" key | More explicit, avoids ambiguity with existing project strings | |
| You decide | Let Claude pick | |

**User's choice:** "project" top-level key (Recommended)
**Notes:** None

---

## DB Index Scope

### Q1: Sessions Foreign Key

| Option | Description | Selected |
|--------|-------------|----------|
| Keep project_slug | Sessions use existing slug column, no migration needed | ✓ |
| Add project_id FK | Normalized FK, requires migration + backfill | |
| You decide | Let Claude assess | |

**User's choice:** Keep project_slug (Recommended)
**Notes:** None

### Q2: Additional Indexes

| Option | Description | Selected |
|--------|-------------|----------|
| Verify existing only | Run EXPLAIN, add indexes only where gaps found | |
| Add status composites | idx_tasks_project_status + idx_sessions_project_active | ✓ |
| You decide | Let Claude determine | |

**User's choice:** Add status composites
**Notes:** Proactively add composite indexes for dashboard query patterns that Phase 3 will need.

---

## Claude's Discretion

None — all areas were discussed and decided by the user.

## Deferred Ideas

None — discussion stayed within phase scope.
