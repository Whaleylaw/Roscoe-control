# Feature Research

**Domain:** Project Dashboard / Workspace UI for AI Agent Orchestration
**Researched:** 2026-04-13
**Confidence:** HIGH

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist. Missing these = product feels incomplete.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Project dashboard landing page | Linear, Asana, GitHub Projects all show an overview when you click into a project. Users expect a dedicated space, not a filtered global view. | MEDIUM | Must feel like a workspace, not a detail drawer. Full-takeover view with its own sub-navigation. |
| Project-scoped task list | Every project tool shows tasks filtered to that project. Seeing unrelated tasks in a project view is disorienting. | LOW | Already have task board + tasks API with `project_id`. Filter existing task list component by project. |
| Task creation pre-scoped to project | When inside a project, "new task" should auto-assign to that project. Linear and Plane do this implicitly. | LOW | Pass `project_id` as default when creating tasks from within project context. |
| Breadcrumb navigation | Users need to know where they are and how to get back. Every workspace-style tool (Linear, Jira, Asana, Notion) uses breadcrumbs. | LOW | `Projects > Project Name > Tasks`. Integrates with existing catch-all route panel system. |
| Project status indicator | On Track / At Risk / Off Track / Complete. Asana pioneered this; Linear uses progress bars. Users expect at-a-glance health. | LOW | Simple status field on project model. Already have `status` (active/archived) -- extend to include health states or keep separate. |
| Progress overview (task completion metrics) | Every project tool shows % complete, tasks done vs remaining. Without this, users have to count manually. | MEDIUM | Aggregate query: count tasks by status per project. Display as progress bar + counts. SSE updates keep it live. |
| Activity feed | Users expect to see "what happened recently" when landing on a project. Linear shows recent issue updates; Asana shows status updates. | MEDIUM | Aggregate recent task status changes, agent session events, and comments scoped to project. Requires querying across tables with project_id filter. |
| Project brief / description | Linear has project descriptions; Asana has project briefs. Users need context about what the project IS. | LOW | Already have `description` field on projects table. Render it prominently on the dashboard. Consider rich text later. |
| Project settings page | Name, description, status, ticket prefix, color, GitHub repo -- all editable. Every project tool has a settings page. | LOW | PATCH `/api/projects/[id]` already supports all these fields. Build the form UI. |
| Project-scoped agent sessions | This is specific to Mission Control's domain. When viewing a project, users expect to see only the agent work related to that project. | MEDIUM | Sessions may need a `project_id` foreign key if not already present. Filter session list by project. |

### Differentiators (Competitive Advantage)

Features that set the product apart. Not required, but valuable.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Agent assignment to projects | No traditional PM tool has this -- it is unique to AI orchestration. Show which agents are working on a project, their current status, and active sessions. | LOW | `project_agent_assignments` table already exists. Surface it in the project workspace UI. |
| Live agent activity on dashboard | Real-time view of agents working on project tasks right now. Traditional tools show human activity after the fact; Mission Control can show AI work in progress. | MEDIUM | Leverage existing SSE + WebSocket infrastructure. Filter real-time events by project scope. |
| One-click task dispatch to agents | From the project workspace, assign a task to an agent and watch it start working. This is the core value prop of Mission Control over Linear/Jira. | MEDIUM | Requires wiring the project task list to the existing agent session/task dispatch flow. |
| Project cost tracking | Show token usage and API costs scoped to a project. No traditional PM tool tracks AI compute costs; this is a differentiator for agent orchestration. | MEDIUM | Existing cost tracker tracks by agent/session. Aggregate by project_id through session or task association. |
| Blocked task visibility | Surface tasks that are blocked or need human intervention, prominently on the dashboard. AI agents often get stuck; surfacing this fast is high value. | LOW | Filter tasks by blocked/needs-review status. Display as a callout section on the project dashboard. |
| Project-scoped agent performance | How are agents performing on THIS project? Completion rates, average time, error rates. This is unique to AI orchestration dashboards. | HIGH | Requires aggregating session telemetry data by project. Defer to v1.x unless data model already supports it. |

### Anti-Features (Commonly Requested, Often Problematic)

Features that seem good but create problems.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Gantt chart / timeline view | Traditional PM expectation; looks professional | High implementation cost, low value for AI agent work which is measured in minutes not months. Agents don't need resource leveling. | Simple deadline field + progress bar. Tasks have created_at and completion timestamps already. |
| Project templates / cloning | "Save time setting up similar projects" | Premature abstraction. Need to understand real usage patterns before templating. Templates often become stale and misleading. | Good defaults on project creation. Add templates in v2 when patterns emerge from real usage. |
| Cross-project dependencies | "Project A blocks Project B" | Massively increases data model complexity. Projects in Mission Control are independent scopes of agent work. | Document dependencies in project descriptions. Add formal cross-project links only if user demand emerges. |
| Custom fields on projects | "Every team tracks different metadata" | Scope creep. Custom fields need UI builders, validation, migration tooling. The projects table already has useful fields (deadline, color, github_repo). | Use the description field for freeform metadata. Add specific fields as clear needs emerge. |
| Project-level permissions / roles | "Different teams need different access" | Existing workspace auth (viewer/operator/admin) is sufficient. Per-project ACLs add massive complexity for a self-hosted tool primarily used by small teams. | Use workspace-level roles. If multi-team need emerges, add project visibility (public/private) as a simple toggle, not full ACL. |
| Real-time collaborative editing | "Multiple people editing the project brief simultaneously" | Requires CRDT or OT infrastructure (Yjs, Automerge). Enormous complexity for minimal value in a dashboard tool. | Optimistic locking with "last write wins" and SSE notifications when someone else edits. |
| Drag-and-drop project reordering | "I want to prioritize my projects visually" | Adds a `sort_order` column, drag-and-drop library, and state sync complexity. Low value when most users have 3-10 projects. | Sort alphabetically or by recent activity. Add manual ordering later if users request it. |

## Feature Dependencies

```
[Breadcrumb Navigation]
    |
    v
[Project Dashboard Landing Page]
    |
    +--requires--> [Project Status Indicator]
    +--requires--> [Progress Overview]
    +--requires--> [Activity Feed]
    +--requires--> [Project Brief]
    |
    v
[Project-Scoped Task List]
    +--requires--> [Task Creation Pre-Scoped]
    +--enhances--> [Blocked Task Visibility]
    +--enhances--> [One-Click Task Dispatch]
    |
    v
[Project-Scoped Agent Sessions]
    +--enhances--> [Live Agent Activity on Dashboard]
    +--enhances--> [Agent Assignment to Projects]
    |
    v
[Project Settings Page]

[Project Cost Tracking] --requires--> [Project-Scoped Agent Sessions]

[Project-Scoped Agent Performance] --requires--> [Project Cost Tracking]
```

### Dependency Notes

- **Dashboard requires status + progress + feed:** The landing page is the container; the metrics and feed are its content. Build them together.
- **Scoped task list requires breadcrumbs:** Users need to navigate into the project (breadcrumbs) before seeing scoped tasks. Breadcrumbs are the navigation backbone.
- **Task dispatch enhances scoped task list:** You can build the task list without dispatch, but dispatch without a task list has no home.
- **Cost tracking requires session scoping:** Cannot aggregate costs by project unless sessions are associated with projects.
- **Agent performance requires cost tracking infrastructure:** Performance metrics build on the same session-to-project mapping that cost tracking needs.

## MVP Definition

### Launch With (v1)

Minimum viable product -- what's needed to validate the concept.

- [ ] **Project dashboard landing page** -- the core "full takeover" workspace experience
- [ ] **Breadcrumb navigation** -- enables moving in/out of project context
- [ ] **Project brief display** -- shows what the project is (uses existing description field)
- [ ] **Project status indicator** -- at-a-glance health (extend existing status field or add health field)
- [ ] **Progress overview** -- task completion counts and percentage (aggregate query)
- [ ] **Activity feed** -- recent task updates and agent activity scoped to project
- [ ] **Project-scoped task list** -- filtered view of existing task board
- [ ] **Task creation pre-scoped** -- new tasks auto-assigned to current project
- [ ] **Project-scoped agent sessions** -- sessions filtered to project
- [ ] **Agent assignment display** -- show which agents work on this project (data already exists)
- [ ] **Project settings page** -- edit project metadata (API already exists)
- [ ] **Blocked task callouts** -- surface stuck/blocked items on dashboard

### Add After Validation (v1.x)

Features to add once core is working.

- [ ] **Live agent activity** -- real-time indicators of agents working on project tasks now (trigger: users want to "watch" agent work)
- [ ] **One-click task dispatch** -- assign and launch agent work from project context (trigger: users find the current dispatch workflow too many clicks)
- [ ] **Project cost tracking** -- token usage and API costs per project (trigger: users managing cost budgets across projects)
- [ ] **Rich text project brief** -- markdown or rich editor for project descriptions (trigger: users outgrow plain text descriptions)

### Future Consideration (v2+)

Features to defer until product-market fit is established.

- [ ] **Project-scoped agent performance analytics** -- completion rates, error rates, avg time per project (why defer: requires significant telemetry aggregation infrastructure)
- [ ] **Project templates** -- create new projects from templates (why defer: need real usage patterns first)
- [ ] **Kanban/board view toggle within project** -- switch between list and board views of project tasks (why defer: existing task board may be sufficient; assess after v1 feedback)

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Project dashboard landing page | HIGH | MEDIUM | P1 |
| Breadcrumb navigation | HIGH | LOW | P1 |
| Project brief display | MEDIUM | LOW | P1 |
| Project status indicator | HIGH | LOW | P1 |
| Progress overview (task metrics) | HIGH | LOW | P1 |
| Activity feed | HIGH | MEDIUM | P1 |
| Project-scoped task list | HIGH | LOW | P1 |
| Task creation pre-scoped | MEDIUM | LOW | P1 |
| Project-scoped agent sessions | HIGH | MEDIUM | P1 |
| Agent assignment display | MEDIUM | LOW | P1 |
| Project settings page | MEDIUM | LOW | P1 |
| Blocked task callouts | HIGH | LOW | P1 |
| Live agent activity | MEDIUM | MEDIUM | P2 |
| One-click task dispatch | HIGH | MEDIUM | P2 |
| Project cost tracking | MEDIUM | MEDIUM | P2 |
| Rich text project brief | LOW | MEDIUM | P3 |
| Agent performance analytics | MEDIUM | HIGH | P3 |

**Priority key:**
- P1: Must have for launch
- P2: Should have, add when possible
- P3: Nice to have, future consideration

## Competitor Feature Analysis

| Feature | Linear | GitHub Projects | Plane | Asana | Mission Control Approach |
|---------|--------|----------------|-------|-------|-------------------------|
| Project overview page | Yes -- shows issues, progress graph, details | Limited -- just filtered views | Yes -- overview with stats | Yes -- dashboard with charts | Full-takeover workspace with status, progress, feed, brief |
| Task scoping | Issues belong to projects | Items added to projects | Issues in projects | Tasks in projects | Tasks have `project_id` -- filter all views by project |
| Progress tracking | Completion graph with date projection | No built-in progress | Burn-down charts in cycles | % complete, milestones | Task completion counts + progress bar (simpler, fits agent work cadence) |
| Activity feed | Recent issue updates in project view | Activity on individual items only | Activity log per project | Status updates + activity | Aggregate task + session events scoped to project |
| Multiple views | List, board, triage per project | Table, board, roadmap per project | List, board, spreadsheet, gantt | List, board, calendar, gantt, dashboard | Task list is primary; board view is stretch goal |
| Status indicators | Progress bar + completion date range | None at project level | Status badges | On Track / At Risk / Off Track | Health status (on track/at risk/off track) + progress bar |
| AI/Agent features | None | None | AI triage (new) | AI status updates (new) | Agent sessions, agent assignments, live agent activity, task dispatch -- this is the differentiator |
| Breadcrumbs | Team > Project > View | Org > Project | Workspace > Project | Team > Project | Projects > Project Name > Sub-view |
| Settings | Name, description, members, lead, dates | Title, description, README | Name, description, members, modules | Name, description, color, status | Name, description, status, ticket prefix, color, deadline, GitHub repo |

## Sources

- [Linear Projects Documentation](https://linear.app/docs/projects) -- project structure, milestones, progress tracking
- [Linear Concepts](https://linear.app/docs/conceptual-model) -- issues, projects, cycles, initiatives hierarchy
- [GitHub Projects Overview](https://docs.github.com/en/issues/planning-and-tracking-with-projects/learning-about-projects/about-projects) -- table, board, roadmap layouts
- [GitHub Projects Customizing Views](https://docs.github.com/en/issues/planning-and-tracking-with-projects/customizing-views-in-your-project) -- custom fields, view configuration
- [Plane GitHub Repository](https://github.com/makeplane/plane) -- open-source PM features
- [Asana Status Updates](https://asana.com/features/project-management/status-updates) -- on track/at risk/off track pattern
- [Asana Project Features Overview](https://www.richardsather.com/post/asana-project-features-overview) -- views, dashboards, reporting
- [Planisware - 11 Must-Have Dashboard Features](https://planisware.com/resources/planisware-hub/11-things-your-project-dashboard-must-have) -- dashboard best practices
- [AI Agent Dashboard Comparison 2026](https://thecrunch.io/ai-agent-dashboard/) -- agent-specific dashboard patterns

---
*Feature research for: Project Dashboard / Workspace UI for AI Agent Orchestration*
*Researched: 2026-04-13*
