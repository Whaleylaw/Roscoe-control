# Waypoint Task-Scoped Discussion Sessions Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Let selected Waypoint tasks open and own an interactive agent discussion session inside Mission Control, so deliberate discussion/intake/planning phases can run from the task queue instead of relying on slow task-comment relay or external Telegram/Slack threads.

**Architecture:** Reuse Mission Control's existing `messages` table and chat/event-bus infrastructure, but bind conversations to a task-scoped conversation id. Keep the first implementation metadata-first to avoid risky schema churn: tasks opt in through `tasks.metadata.waypoint.discussion`, route materialization can set that metadata, and new `/api/tasks/[id]/discussion` endpoints start/resume/post/read messages for enabled tasks. Comments remain the audit/note layer; discussion messages are the interactive transport and may be summarized or mirrored later.

**Tech Stack:** Next.js App Router route handlers, TypeScript 5, SQLite/better-sqlite3, Vitest, existing Mission Control auth/rate-limit/event-bus/message store.

---

## Context

Related docs:

- `docs/waypoint-runtime-design.md` section 5.5, Task-scoped discussion sessions.
- `docs/superpowers/plans/2026-05-02-waypoint-command-api.md` for the general `/waypoint` command adapter.

Existing implementation to reuse:

- `src/app/api/tasks/[id]/comments/route.ts`
  - already writes task comment relays into `messages` using `conversation_id = project:{project_id}:agent:{assignee}`.
  - already broadcasts `chat.message` through `eventBus`.
  - already knows how to call Hermes/OpenClaw for comment relay, but this plan should not depend on comments as the primary transport.
- `src/lib/migrations.ts` migration `004_messages`
  - defines `messages(conversation_id, from_agent, to_agent, content, message_type, metadata, read_at, created_at)`.
- `src/lib/db.ts`
  - exports `Message` interface.
- `src/store/index.ts`
  - already has chat message/conversation client state.
- `src/lib/workflow-engine.ts`
  - already materializes Waypoint tasks with `metadata.waypoint`.

Non-goals for this slice:

- Do not replace task comments.
- Do not build full UI chat panels yet; expose APIs and read-model data first.
- Do not require Telegram/Slack as the chat transport.
- Do not introduce a new conversation table unless the metadata-first approach proves insufficient.
- Do not auto-enable discussion for every task; discussion must be explicitly enabled by metadata, route node config, or a future direct task field.

---

## Proposed API surface

```http
GET  /api/tasks/:id/discussion
POST /api/tasks/:id/discussion/start
POST /api/tasks/:id/discussion/messages
```

Optional `/waypoint` command grammar extension after the basic command API lands:

```text
/waypoint discuss --task-id 123
/waypoint discuss --task-id 123 --message "Can you clarify the acceptance criteria?"
```

---

## Metadata contract

Store the initial state in `tasks.metadata`:

```json
{
  "waypoint": {
    "discussion": {
      "enabled": true,
      "mode": "agent_chat",
      "conversation_id": "task:123:discussion:gsd-researcher",
      "agent": "gsd-researcher",
      "started_at": 1777720000,
      "status": "active",
      "summary_comment_id": null
    }
  }
}
```

Conversation id convention:

```text
task:{task_id}:discussion:{agent_or_assignee_slug}
```

Message metadata convention:

```json
{
  "kind": "waypoint_task_discussion",
  "task_id": 123,
  "project_id": 42,
  "workflow_instance_id": 77,
  "workflow_node_instance_id": 88,
  "waypoint": true
}
```

---

## Task 1: Add pure discussion metadata helper tests

**Objective:** Lock the metadata contract and conversation id convention before adding API routes.

**Files:**

- Create: `src/lib/__tests__/waypoint-task-discussion.test.ts`
- Create later: `src/lib/waypoint-task-discussion.ts`

**Step 1: Write failing tests**

```ts
import { describe, expect, it } from 'vitest'
import {
  buildTaskDiscussionConversationId,
  isTaskDiscussionEnabled,
  mergeTaskDiscussionMetadata,
  parseTaskDiscussionMetadata,
} from '../waypoint-task-discussion'

describe('waypoint task discussion helpers', () => {
  it('builds stable task-scoped conversation ids', () => {
    expect(buildTaskDiscussionConversationId(123, 'GSD Researcher')).toBe('task:123:discussion:gsd-researcher')
  })

  it('detects enabled discussion metadata', () => {
    expect(isTaskDiscussionEnabled({ waypoint: { discussion: { enabled: true } } })).toBe(true)
    expect(isTaskDiscussionEnabled({})).toBe(false)
  })

  it('parses missing or malformed metadata safely', () => {
    expect(parseTaskDiscussionMetadata(null)).toEqual({ enabled: false })
    expect(parseTaskDiscussionMetadata('{bad json')).toEqual({ enabled: false })
  })

  it('merges discussion metadata without dropping other task metadata', () => {
    const merged = mergeTaskDiscussionMetadata({ existing: true }, {
      enabled: true,
      conversation_id: 'task:123:discussion:agent',
      agent: 'agent',
      status: 'active',
    })

    expect(merged).toMatchObject({
      existing: true,
      waypoint: {
        discussion: {
          enabled: true,
          conversation_id: 'task:123:discussion:agent',
          agent: 'agent',
          status: 'active',
        },
      },
    })
  })
})
```

**Step 2: Run test to verify failure**

```bash
pnpm vitest run src/lib/__tests__/waypoint-task-discussion.test.ts
```

Expected: FAIL because `src/lib/waypoint-task-discussion.ts` does not exist.

---

## Task 2: Implement discussion metadata helpers

**Objective:** Provide the small pure functions needed by API routes and workflow materialization.

**Files:**

- Create: `src/lib/waypoint-task-discussion.ts`
- Test: `src/lib/__tests__/waypoint-task-discussion.test.ts`

**Step 1: Add implementation**

```ts
export type WaypointTaskDiscussionMetadata = {
  enabled: boolean
  mode?: 'agent_chat'
  conversation_id?: string
  agent?: string
  started_at?: number
  status?: 'pending' | 'active' | 'summarized' | 'closed'
  summary_comment_id?: number | null
}

export function slugifyAgent(value: string | null | undefined): string {
  return (value || 'agent')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'agent'
}

export function buildTaskDiscussionConversationId(taskId: number, agent: string | null | undefined): string {
  return `task:${taskId}:discussion:${slugifyAgent(agent)}`
}

export function parseJsonObject(raw: unknown): Record<string, unknown> {
  if (!raw) return {}
  if (typeof raw === 'object') return raw as Record<string, unknown>
  if (typeof raw !== 'string') return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

export function parseTaskDiscussionMetadata(raw: unknown): WaypointTaskDiscussionMetadata {
  const metadata = parseJsonObject(raw)
  const waypoint = parseJsonObject(metadata.waypoint)
  const discussion = parseJsonObject(waypoint.discussion)
  return {
    enabled: discussion.enabled === true,
    mode: discussion.mode === 'agent_chat' ? 'agent_chat' : undefined,
    conversation_id: typeof discussion.conversation_id === 'string' ? discussion.conversation_id : undefined,
    agent: typeof discussion.agent === 'string' ? discussion.agent : undefined,
    started_at: typeof discussion.started_at === 'number' ? discussion.started_at : undefined,
    status: ['pending', 'active', 'summarized', 'closed'].includes(String(discussion.status))
      ? discussion.status as WaypointTaskDiscussionMetadata['status']
      : undefined,
    summary_comment_id: typeof discussion.summary_comment_id === 'number' ? discussion.summary_comment_id : null,
  }
}

export function isTaskDiscussionEnabled(raw: unknown): boolean {
  return parseTaskDiscussionMetadata(raw).enabled
}

export function mergeTaskDiscussionMetadata(
  raw: unknown,
  discussion: Omit<WaypointTaskDiscussionMetadata, 'mode'> & { mode?: 'agent_chat' },
): Record<string, unknown> {
  const metadata = parseJsonObject(raw)
  const waypoint = parseJsonObject(metadata.waypoint)
  return {
    ...metadata,
    waypoint: {
      ...waypoint,
      discussion: {
        mode: 'agent_chat',
        ...discussion,
      },
    },
  }
}
```

**Step 2: Run test**

```bash
pnpm vitest run src/lib/__tests__/waypoint-task-discussion.test.ts
```

Expected: PASS.

---

## Task 3: Add discussion start route tests

**Objective:** Verify `POST /api/tasks/:id/discussion/start` enables or resumes a task-scoped conversation only when the task exists and belongs to the caller's workspace.

**Files:**

- Create: `src/app/api/tasks/[id]/discussion/__tests__/start-route.test.ts`
- Create later: `src/app/api/tasks/[id]/discussion/start/route.ts`

**Step 1: Test cases**

Cover:

1. starts discussion for task with `assigned_to` and returns `conversation_id`;
2. reuses existing `metadata.waypoint.discussion.conversation_id` idempotently;
3. returns 404 for missing task;
4. rejects unauthenticated/unauthorized requests following existing route patterns.

**Step 2: Run test to verify failure**

```bash
pnpm vitest run src/app/api/tasks/[id]/discussion/__tests__/start-route.test.ts
```

Expected: FAIL because route does not exist.

---

## Task 4: Implement discussion start route

**Objective:** Add the mutation endpoint that turns a queue task into a discussion-capable task.

**Files:**

- Create: `src/app/api/tasks/[id]/discussion/start/route.ts`
- Modify if needed: shared test setup only.

**Implementation notes:**

- Use `requireRole(request, 'operator')` or the same role threshold as comments mutation.
- Use `mutationLimiter` as in `src/app/api/tasks/[id]/comments/route.ts`.
- Load task by `id` and workspace.
- Agent defaults to `task.assigned_to || 'agent'` unless request body includes a safe `agent` override.
- Build conversation id via `buildTaskDiscussionConversationId(task.id, agent)`.
- Update `tasks.metadata` with `mergeTaskDiscussionMetadata()`.
- Broadcast a lightweight event if the existing event bus has an appropriate task event; otherwise skip broadcast in the first slice.

**Response shape:**

```json
{
  "discussion": {
    "enabled": true,
    "conversation_id": "task:123:discussion:gsd-researcher",
    "agent": "gsd-researcher",
    "status": "active"
  }
}
```

---

## Task 5: Add discussion read/post route tests

**Objective:** Verify clients can list and append interactive discussion messages without using task comments.

**Files:**

- Create/extend: `src/app/api/tasks/[id]/discussion/__tests__/discussion-route.test.ts`
- Create later: `src/app/api/tasks/[id]/discussion/route.ts`
- Create later: `src/app/api/tasks/[id]/discussion/messages/route.ts`

**Test cases:**

1. `GET /api/tasks/:id/discussion` returns discussion metadata and recent messages.
2. `GET` returns disabled state with empty messages when discussion is not enabled.
3. `POST /messages` inserts into `messages` with `conversation_id` from task metadata.
4. `POST /messages` rejects when discussion is not enabled.
5. Inserted message metadata includes `kind: 'waypoint_task_discussion'`, `task_id`, and `project_id`.

---

## Task 6: Implement discussion read/post routes

**Objective:** Provide the actual interactive transport for task-owned discussions.

**Files:**

- Create: `src/app/api/tasks/[id]/discussion/route.ts`
- Create: `src/app/api/tasks/[id]/discussion/messages/route.ts`

**Implementation notes:**

- Reuse `messages` table; do not create new tables.
- `GET` queries latest 100 messages by `conversation_id` ascending.
- `POST` accepts `{ content: string, from?: string, to?: string }`.
- `from` should default to authenticated username/operator if available.
- `to` should default to discussion agent.
- Broadcast `chat.message` using the same shape as the comments route.
- Do not call Hermes/OpenClaw automatically in this task; that is the next slice.

---

## Task 7: Teach Waypoint materialization to enable discussion for discussion nodes

**Objective:** Let workflow route nodes opt into task discussion when materialized.

**Files:**

- Modify: `src/lib/workflow-engine.ts`
- Test: add to `src/lib/__tests__/waypoint-materialization.test.ts` or create `src/lib/__tests__/waypoint-discussion-materialization.test.ts`

**Config convention:**

```yaml
nodes:
  clarify_objective:
    type: recipe
    recipe: gsd-doc-drafter
    config:
      waypoint:
        discussion:
          enabled: true
          agent: gsd-doc-drafter
          prompt: Clarify project objective and acceptance criteria with the operator.
```

**Expected behavior:**

- Materialized task metadata includes `waypoint.discussion.enabled = true`.
- If the task id is known at creation time, include `conversation_id = task:{task_id}:discussion:{agent}` immediately.
- If conversation id cannot be known before insert, update the task metadata immediately after insert inside the same materialization function.

---

## Task 8: Extend `/waypoint` command parser for discussion

**Objective:** Add a command entry point to start/resume a task discussion.

**Files:**

- Modify: `src/lib/__tests__/waypoint-command.test.ts`
- Modify: `src/lib/waypoint-command.ts`
- Modify: `src/lib/waypoint-command-executor.ts` if already created by the command API plan.

**Grammar:**

```text
/waypoint discuss --task-id 123
/waypoint discuss --task-id 123 --message "Question text"
```

**Expected parsed forms:**

```ts
{ action: 'discussion', taskId: 123 }
{ action: 'discussion', taskId: 123, message: 'Question text' }
```

**Execution behavior:**

- Without `--message`, call/start the discussion and return `conversation_id` plus last messages.
- With `--message`, start if needed and append the message.

---

## Task 9: Add a Waypoint discussion route definition

**Objective:** Make discussion a deliberate workflow node pattern for intake/planning phases.

**Files:**

- Create or modify: `workflows/waypoint-project-intake.yaml`
- Test: extend `src/lib/__tests__/waypoint-workflows.test.ts`

**Minimum node example:**

```yaml
nodes:
  discuss_objective:
    type: recipe
    recipe: gsd-doc-drafter
    description: Discuss and refine the project objective and acceptance criteria with the operator.
    config:
      waypoint:
        discussion:
          enabled: true
          agent: gsd-doc-drafter
          prompt: Ask targeted questions until the project objective and acceptance criteria are clear.
```

---

## Task 10: Verification

**Objective:** Prove the task-scoped discussion transport is green without disturbing existing comments or chat.

Run targeted tests:

```bash
pnpm vitest run \
  src/lib/__tests__/waypoint-task-discussion.test.ts \
  src/lib/__tests__/waypoint-materialization.test.ts \
  src/lib/__tests__/waypoint-command.test.ts \
  src/app/api/tasks/[id]/discussion/__tests__/start-route.test.ts \
  src/app/api/tasks/[id]/discussion/__tests__/discussion-route.test.ts
```

Run broader checks:

```bash
pnpm typecheck
pnpm lint
```

Manual smoke once the dev server is available:

```bash
curl -s -X POST http://localhost:3000/api/tasks/123/discussion/start \
  -H 'Content-Type: application/json' \
  -b cookies.txt \
  -d '{"agent":"gsd-doc-drafter"}'

curl -s -X POST http://localhost:3000/api/tasks/123/discussion/messages \
  -H 'Content-Type: application/json' \
  -b cookies.txt \
  -d '{"content":"Can you help clarify the acceptance criteria?"}'

curl -s http://localhost:3000/api/tasks/123/discussion -b cookies.txt
```

---

## Acceptance criteria

- A task can explicitly enable a Waypoint discussion session.
- A task has a stable discussion `conversation_id`.
- Discussion messages are stored in `messages`, not as comments by default.
- The discussion endpoint returns task metadata plus recent messages.
- Posting a discussion message broadcasts `chat.message` for live clients.
- Workflow node config can opt materialized tasks into discussion mode.
- `/waypoint discuss --task-id` can start/resume the discussion after the command API exists.
- Existing task comments continue to work unchanged.
