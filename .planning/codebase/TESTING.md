# Testing Patterns

**Analysis Date:** 2026-04-13

## Test Framework

**Unit Test Runner:**
- Vitest (via `vitest.config.ts`)
- Config: `vitest.config.ts`
- React plugin: `@vitejs/plugin-react`
- tsconfig paths: `vite-tsconfig-paths`

**Assertion Library:**
- Vitest built-in (`expect`) + `@testing-library/jest-dom` (via `src/test/setup.ts`)

**E2E Runner:**
- Playwright (via `playwright.config.ts`)
- Browser: Chromium only (`devices['Desktop Chrome']`)
- Base URL: `http://127.0.0.1:3005` (configurable via `E2E_BASE_URL`)

**Run Commands:**
```bash
pnpm test              # unit tests (vitest)
pnpm test:e2e          # end-to-end (playwright)
pnpm typecheck         # tsc --noEmit
pnpm lint              # eslint
pnpm test:all          # lint + typecheck + test + build + e2e
```

## Test File Organization

**Unit Tests:**
- Location: `src/lib/__tests__/` (68+ files) and co-located at `src/app/api/gateways/health/health-utils.test.ts`
- Naming: `[module-name].test.ts`
- `vitest.config.ts` `include` pattern: `src/**/*.test.ts`, `src/**/*.test.tsx`

**E2E Tests:**
- Location: `tests/` directory (69+ files)
- Naming: `[feature].spec.ts`
- Helpers: `tests/helpers.ts` (shared factory/cleanup functions)

**Test Structure:**
```
src/
  lib/
    __tests__/         # Unit tests for lib modules
      auth.test.ts
      rate-limit.test.ts
      webhooks.test.ts
      ...
  app/api/
    gateways/health/
      health-utils.test.ts   # Co-located API util test
  test/
    setup.ts           # Global test setup (jest-dom imports)
tests/
  helpers.ts           # E2E shared factory helpers
  agents-crud.spec.ts
  task-queue.spec.ts
  ...
```

## Unit Test Structure

**Suite Organization:**
```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { functionUnderTest } from '@/lib/module'

// Module-level mocks declared at top
vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(),
}))

describe('functionName', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv, API_KEY: 'test-key' }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('describes expected behavior', () => {
    expect(functionUnderTest('input')).toBe('output')
  })
})
```

**Patterns:**
- Group tests by function/class using `describe`
- Test names use plain language descriptions: `'returns true for matching strings'`
- `beforeEach`/`afterEach` for env var save/restore
- `vi.resetModules()` in `beforeEach` when testing modules with side-effects
- `vi.clearAllMocks()` in `afterEach` for cleanup

## Mocking

**Framework:** Vitest `vi` API

**Module Mocking Pattern (top-level, before imports):**
```typescript
vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(() => ({ prepare })),
  logAuditEvent: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}))

vi.mock('@/lib/event-bus', () => ({
  eventBus: { broadcast: vi.fn(), on: vi.fn(), emit: vi.fn() },
}))
```

**Spy Pattern:**
```typescript
const killSpy = vi.spyOn(process, 'kill').mockImplementation((() => undefined) as any)
```

**Mock return values in test body:**
```typescript
requireRole.mockReturnValue({ user: { id: 1, username: 'admin', role: 'admin', workspace_id: 1 } })
prepare.mockImplementation((sql: string) => {
  if (sql.startsWith('SELECT * FROM agents')) return selectStmt
  if (sql.startsWith('DELETE FROM agents')) return deleteStmt
  throw new Error(`Unexpected SQL: ${sql}`)
})
```

**What to Mock:**
- `@/lib/db` — SQLite is not available in test environment
- `@/lib/auth` (requireRole) — when testing route handlers in isolation
- `@/lib/logger` — to suppress log output in tests
- `@/lib/event-bus` — to prevent singleton side-effects
- `@/lib/config` — when testing config-dependent code
- External packages (`better-sqlite3`, `ws`) — when testing server-side code

**What NOT to Mock:**
- The module under test itself
- Pure utility functions being tested directly
- Zod schemas (test the actual schema with `.safeParse`)

## Fixtures and Factories

**E2E Factory Helpers (in `tests/helpers.ts`):**
```typescript
function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export async function createTestAgent(
  request: APIRequestContext,
  overrides: Record<string, unknown> = {}
) {
  const name = `e2e-agent-${uid()}`
  const res = await request.post('/api/agents', {
    headers: API_KEY_HEADER,
    data: { name, role: 'tester', ...overrides },
  })
  const body = await res.json()
  return { id: body.agent?.id as number, name, res, body }
}

export async function deleteTestAgent(request: APIRequestContext, id: number) {
  return request.delete(`/api/agents/${id}`, { headers: API_KEY_HEADER })
}
```

**Cleanup Pattern in E2E:**
```typescript
test.describe('Feature', () => {
  const cleanup: number[] = []

  test.afterEach(async ({ request }) => {
    for (const id of cleanup) {
      await deleteResource(request, id).catch(() => {})
    }
    cleanup.length = 0
  })

  test('creates resource', async ({ request }) => {
    const { id } = await createTestResource(request)
    cleanup.push(id)
    // assertions
  })
})
```

**Unit Test Fixtures:**
- Inline `const` objects — no shared fixture files
- Use temp directories via `mkdtempSync` for file system tests
- Restore env vars with `const originalEnv = process.env` + `afterEach` restore

## Coverage

**Requirements:** 60% threshold for lines, functions, branches, and statements
**Scope:** `src/lib/**/*.ts` only (large exclusion list in `vitest.config.ts` for server-side files requiring live runtime)

**View Coverage:**
```bash
pnpm test --coverage
```

## Test Types

**Unit Tests (`src/lib/__tests__/`):**
- Pure function logic: validation, status normalization, crypto utilities, rate limiting
- Route handler isolation: mock all dependencies, test via dynamic `import()` after mocking
- No DOM rendering — jsdom environment configured but primarily used for API/lib tests

**E2E Tests (`tests/`):**
- Full HTTP request/response cycles against a live test server (`http://127.0.0.1:3005`)
- API CRUD flows: create → read → update → delete lifecycle tests
- Authentication: all E2E requests use `x-api-key: test-api-key-e2e-12345` header
- Sequential execution: `fullyParallel: false`, `workers: 1`

## Common Patterns

**Async Testing:**
```typescript
it('returns correct response', async () => {
  const response = await handler(new NextRequest('http://localhost/api/test'))
  const body = await response.json()
  expect(response.status).toBe(200)
  expect(body.data).toBeDefined()
})
```

**Error/Edge Case Testing:**
```typescript
it('returns 401 when no authentication is provided', () => {
  const result = requireRole(makeRequest(), 'viewer')
  expect(result.status).toBe(401)
  expect(result.error).toBe('Authentication required')
  expect(result.user).toBeUndefined()
})
```

**Timer-based Testing:**
```typescript
beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

it('resets after window expires', () => {
  limiter(makeRequest())
  vi.advanceTimersByTime(11_000)
  expect(limiter(makeRequest())).toBeNull()
})
```

**Dynamic Import for Route Testing (avoids hoisting issues with vi.mock):**
```typescript
vi.mock('@/lib/auth', () => ({ requireRole }))

beforeEach(() => {
  vi.resetModules()
})

it('handles DELETE', async () => {
  const { DELETE } = await import('@/app/api/agents/[id]/route')
  const response = await DELETE(request, { params: Promise.resolve({ id: '7' }) })
  expect(response.status).toBe(200)
})
```

**E2E Full Lifecycle Test:**
```typescript
test('full lifecycle: create → read → update → delete', async ({ request }) => {
  const { id } = await createTestAgent(request, { role: 'builder' })
  // Read
  const readRes = await request.get(`/api/agents/${id}`, { headers: API_KEY_HEADER })
  expect(readRes.status()).toBe(200)
  // Update
  await request.put(`/api/agents/${id}`, { headers: API_KEY_HEADER, data: { role: 'architect' } })
  // Delete
  await request.delete(`/api/agents/${id}`, { headers: API_KEY_HEADER })
  // Confirm gone
  const goneRes = await request.get(`/api/agents/${id}`, { headers: API_KEY_HEADER })
  expect(goneRes.status()).toBe(404)
})
```

---

*Testing analysis: 2026-04-13*
