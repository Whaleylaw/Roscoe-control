# Coding Conventions

**Analysis Date:** 2026-04-13

## Naming Patterns

**Files:**
- React components: `kebab-case.tsx` (e.g., `alert-rules-panel.tsx`, `agent-squad-panel.tsx`)
- API routes: `route.ts` inside `src/app/api/[resource]/` directories
- Lib modules: `kebab-case.ts` (e.g., `rate-limit.ts`, `event-bus.ts`)
- Test files: `[module-name].test.ts` inside `src/lib/__tests__/`
- E2E tests: `[feature].spec.ts` inside `tests/`

**Functions:**
- camelCase for all functions: `requireRole`, `getDatabase`, `createRateLimiter`
- Named exports for lib functions: `export function requireRole(...)`
- Named exports for React components: `export function AlertRulesPanel()` (not default)
- Default exports only for Next.js pages: `export default function Home()`

**Variables:**
- camelCase for local variables and state
- SCREAMING_SNAKE_CASE for module-level constants: `API_KEY_HEADER`, `ENTITY_FIELDS`, `OPERATORS`
- Prefix boolean state with verb: `loading`, `saving`, `evaluating`, `showCreate`

**Types/Interfaces:**
- PascalCase: `AlertRule`, `EvalResult`, `AgentStatus`
- Defined inline at top of file if component-local
- Exported from `src/types/index.ts` or the module file if shared

## Code Style

**Formatting:**
- No Prettier config detected — formatting is enforced via ESLint only
- `eslint-config-next` base (see `eslint.config.mjs`)
- Semicolons: inconsistent — newer lib files omit them, older API routes include them
  - e.g., `src/app/api/agents/route.ts` uses semicolons; `src/app/api/v1/runs/route.ts` does not

**Linting:**
- ESLint with `eslint-config-next` (`eslint.config.mjs`)
- Three React hooks rules disabled due to React 19 false positives: `react-hooks/set-state-in-effect`, `react-hooks/purity`, `react-hooks/immutability`
- Ignored paths: `.data/**`, `ops/**`

**TypeScript:**
- Strict mode enabled (`"strict": true` in `tsconfig.json`)
- Path alias `@/*` maps to `./src/*` — use `@/lib/...`, `@/components/...` everywhere
- Avoid `any` — use specific types; `any[]` found in legacy routes but avoid in new code

## Import Organization

**Order (observed pattern):**
1. External framework imports (`next/server`, `react`)
2. Internal `@/lib/` imports (grouped by domain, no blank lines between)
3. Node built-ins last (`node:path`, `node:fs`)

**Example from `src/app/api/agents/route.ts`:**
```typescript
import { NextRequest, NextResponse } from 'next/server'
import { getDatabase, Agent, db_helpers } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { validateBody, createAgentSchema } from '@/lib/validation'
import path from 'node:path'
```

**Path Aliases:**
- Always use `@/` prefix for internal imports — no relative paths between feature areas

## Error Handling

**API Route Pattern (required in all routes):**
```typescript
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    // ... logic
    return NextResponse.json({ data })
  } catch (error) {
    logger.error({ err: error }, 'Descriptive failure message')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
```

**Auth check always comes first** — check `'error' in auth` immediately after `requireRole`.

**404 pattern:**
```typescript
if (!resource) return NextResponse.json({ error: 'Resource not found' }, { status: 404 })
```

**Client-side:** Errors in fetch calls are typically caught with `try/catch`; failures silently ignored with `catch { /* ignore */ }` in non-critical polling.

## Validation

**Framework:** Zod (`src/lib/validation.ts`)

**Pattern:**
```typescript
// Define schema in src/lib/validation.ts
export const createAgentSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  // ...
})

// Use in route handler
const validated = await validateBody(request, createAgentSchema)
if ('error' in validated) return validated.error
const { data } = validated
```

**`validateBody`** parses JSON body and returns `{ data }` or `{ error: NextResponse }`.

## Logging

**Framework:** Pino (`src/lib/logger.ts`)

**Usage:**
```typescript
import { logger } from '@/lib/logger'

logger.error({ err: error }, 'Failed to get leaderboard')
logger.info({ agentId, taskId }, 'Task dispatched')
logger.warn({ userId }, 'Session expired')
```

**Rule:** Always pass error objects as `{ err: error }` (pino serializer key), with a static message string as the second argument.

**Do not use `console.log`** in server-side code — use `logger`. Client components may use `console` sparingly.

## React Component Patterns

**Client components** always declare `'use client'` at the top:
```typescript
'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'
```

**i18n:** All user-facing text uses `next-intl`. Call `const t = useTranslations('namespace')` at the top of each component function. String keys live in `messages/en.json`.

**State management:**
- Local state: `useState` (granular, one state per concept)
- Async fetching: `useCallback` for fetch functions, `useEffect` to call them
- Global state: Zustand stores (see `src/lib/` for store files)

**No icon libraries** — use raw text, emoji, or Unicode characters inline.

**Button component** is at `src/components/ui/button.tsx` — always use it rather than a raw `<button>`.

## Comments

**JSDoc:** Used on exported API route handlers to document the HTTP method, path, and query params:
```typescript
/**
 * GET /api/agents - List all agents with optional filtering
 * Query params: status, role, limit, offset
 */
export async function GET(request: NextRequest) {
```

**Inline comments:** Used for SQL sections, config sections, and non-obvious logic. Use `// ── Section ─────` ASCII dividers inside large files to group related tests/code.

**Avoid obvious comments** — comment the "why", not the "what".

## Module Design

**Exports:**
- Named exports only for lib modules (`export function`, `export const`, `export type`)
- Default exports only for Next.js pages and layouts
- One or two `vi.mock(...)` exceptions for test stubs

**Barrel Files:**
- Not used — import directly from the module file
- `src/types/index.ts` is the one exception (shared type definitions)

---

*Convention analysis: 2026-04-13*
