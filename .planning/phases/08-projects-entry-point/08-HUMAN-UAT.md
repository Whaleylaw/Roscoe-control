---
status: diagnosed
phase: 08-projects-entry-point
source: [08-VERIFICATION.md]
started: 2026-04-14T17:35:32Z
updated: 2026-04-14T17:45:00Z
---

## Current Test

[complete — gaps diagnosed, awaiting gap closure]

## Tests

### 1. End-to-end cold-start journey
expected: `pnpm build && cp -r .next/static .next/standalone/.next/static && cp -r public .next/standalone/public && pnpm test:e2e -- projects-entry-point` → "1 passed" in ~3-5s. Journey: login → nav-rail "Projects" click → `/projects` → project row click → `/project/e2e-phase-8` → breadcrumb "Projects" click → returns to `/projects` (not `/`).
result: passed (implicitly — user reached the projects panel, clicked into a project, and returned via breadcrumb; no complaint about the journey itself)

## Summary

total: 1
passed: 1
issues: 2
pending: 0
skipped: 0
blocked: 0

## Gaps

### Gap 1: No "Create new project" button on the Projects panel
status: failed
severity: high
description: The Projects panel lists projects but offers no way to create a new one when the list is non-empty. The only create CTA is inside the empty state. Users currently have to navigate to Tasks → Project filter → "New project" picker button to reach the create flow, which breaks the promise that the Projects panel is the entry point for project management.
expected: A visible "New project" button in the Projects panel header (top-right, next to the title) that opens the project creation modal.
actual: Header shows only the panel title. Creation is reachable only from task-board-panel.tsx or when activeProjects.length === 0.
files_affected:
  - src/components/panels/projects-panel.tsx
  - messages/{ar,de,en,es,fr,ja,ko,pt,ru,zh}.json (new i18n key for header CTA)
  - src/components/panels/__tests__/projects-panel.test.tsx (test header CTA)

### Gap 2: Create-project modal is outdated — no GitHub linking at creation
status: failed
severity: medium
description: The project-manager-modal collects only name, ticket_prefix, and description at creation time, even though the backend POST /api/projects already accepts github_repo, deadline, and color. Projects with GitHub integration require a 3-step flow today (create → edit inline to add repo → GitHub Sync panel to init labels + enable sync), which is bad UX given GitHub integration is a first-class capability (github-sync-engine.ts, github-sync-panel.tsx, POST /api/github?action=init-labels).
expected: Create-project modal collects github_repo (optional), deadline (optional), color (optional) at creation. If github_repo is provided, offer a "Enable sync + initialize labels" checkbox that, when checked, triggers POST /api/github?action=init-labels and sets github_sync_enabled=1 after the project is created.
actual: Modal form fields at project-manager-modal.tsx lines 98-102 are only name + ticket_prefix + description. github_repo and github_sync_enabled are editable only post-creation via inline edit (lines 333-371).
files_affected:
  - src/components/modals/project-manager-modal.tsx
  - messages/{ar,de,en,es,fr,ja,ko,pt,ru,zh}.json (new i18n keys for the added fields)
  - src/components/modals/__tests__/project-manager-modal.test.tsx (tests for new fields + init-labels flow)
