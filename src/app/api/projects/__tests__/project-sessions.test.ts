import { describe, it } from 'vitest'

// Mock setup (to be implemented in Plan 05-03):
// - new Database(':memory:') and run migrations
// - seed: workspace, 1 project, 2 agents assigned (via project_agent_assignments), 1 agent task-derived
// - seed messages with conversation_id = 'project:<id>:agent:<name>' for some threads, none for others
// - mock gateway/claude/codex/hermes session scanners to return fixtures
// - import { GET } from '@/app/api/projects/[id]/sessions/route'
// - call GET(request, { params: Promise.resolve({ id: '<id>' }) })

describe('GET /api/projects/[id]/sessions', () => {
  describe('SESS-01: response shape', () => {
    it.todo('returns { threads: Thread[], runtimeSessions: RuntimeSession[] }')
    it.todo('returns 400 on non-numeric project id')
    it.todo('returns 404 when project does not exist')
    it.todo('requires viewer role (requireRole)')
  })

  describe('SESS-01: threads section (D-04, D-06, Pitfall 3 Option B)', () => {
    it.todo('returns one thread per agent in the project (assigned ∪ task-derived) — NO messages required')
    it.todo('thread id format is exactly `thread:<projectId>:<agentNameLower>`')
    it.todo('conversationId format is exactly `project:<projectId>:agent:<agentNameLower>` (uses numeric project.id, not slug — Pitfall 4)')
    it.todo('thread lastMessage is null when no messages exist for the conversationId')
    it.todo('thread lastMessage is the most recent message.content for the conversationId (ORDER BY created_at DESC LIMIT 1)')
    it.todo('Pitfall 3: GET does NOT insert placeholder messages — messages table row-count is unchanged before/after the call')
    it.todo('threads are sorted by lastActivity DESC, threads with null lastMessage last')
  })

  describe('SESS-01: runtime sessions section (D-05, Open Question 1 resolution)', () => {
    it.todo('includes Claude/Codex/Hermes local sessions AND gateway sessions')
    it.todo('linkage rule — Rule A (agent-membership): session whose session.agent matches a project-assigned agent is included')
    it.todo('linkage rule — Rule B (slug match): session whose project_slug === project.slug is included')
    it.todo('linkage rule — UNION of A OR B — a session satisfying either rule appears; a session satisfying neither is excluded')
    it.todo('runtime session id is the existing session.id/session_key, not a thread: prefix (so router can distinguish)')
    it.todo('runtime session includes kind (Claude|Codex|Hermes|Gateway), ticketRef, startedAt, status')
    it.todo('runtime sessions are sorted by startedAt DESC')
  })

  describe('SESS-01: empty states', () => {
    it.todo('returns { threads: [], runtimeSessions: [] } when no agents are assigned or task-derived')
  })
})
