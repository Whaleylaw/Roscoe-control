# Claude Code Execution Prompt — Option B Native GSD in Mission Control

You are implementing native GSD lifecycle support in Mission Control.

Repository
- /Users/aaronwhaley/mission-control

Primary Plan
- Read and execute: .planning/phases/09-gsd-native-integration/09-00-PLAN.md

Execution constraints
1) Implement in small, reviewable commits.
2) Keep backward compatibility for non-GSD projects.
3) Do not remove existing endpoints/fields.
4) Add/adjust tests for each behavior change.
5) Preserve auth model and tenant/workspace scoping.

Required outputs
1) DB migration for project/task GSD columns + indexes
2) API updates for project CRUD including GSD fields
3) New endpoints:
   - POST /api/projects/:id/gsd/bootstrap
   - POST /api/projects/:id/gsd/transition
   - PATCH /api/tasks/:id/gate
4) Gate enforcement in task status changes
5) UI controls for GSD in project settings/manager
6) Tests passing for changed behavior

Minimum test pass criteria
- Project CRUD tests include gsd fields
- Bootstrap idempotency tested
- Illegal transition test
- Gate-block on task status test
- Gate-approval success test

Manual QA script (must run and report)
1) Create GSD-enabled project
2) Bootstrap phase tasks
3) Attempt illegal transition (expect reject)
4) Perform legal transition sequence
5) Create gate-required task + verify blocked until approved

Output format to return
- Summary of changes by file
- Migration ID added
- Endpoint contract examples (request/response)
- Test results
- Remaining known gaps (if any)
