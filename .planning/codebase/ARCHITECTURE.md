# Architecture

**Analysis Date:** 2026-04-13

## Pattern Overview

**Overall:** Server-rendered Next.js App Router with a thick client-side SPA shell

**Key Characteristics:**
- Single catch-all route (`src/app/[[...panel]]/page.tsx`) renders all dashboard panels — URL path maps to active panel via Zustand state
- REST API routes in `src/app/api/` talk directly to SQLite via `better-sqlite3`; no ORM, no separate API process
- Two real-time data channels: SSE (`/api/events`) for local DB mutations, WebSocket for remote gateway agent data
- Two operating modes: **local** (SQLite only, no gateway) and **full** (gateway WebSocket connected)
- Plugin system via module-scoped `register*()` hooks (`src/lib/plugins.ts`, `src/lib/migrations.ts`, `src/lib/auth.ts`)

## Layers

**Routing / Shell:**
- Purpose: Initialise app, handle auth redirect, boot sequence, route URL to active panel
- Location: `src/app/[[...panel]]/page.tsx`
- Contains: `Home` component (boot logic), `ContentRouter` (tab → panel mapping), SSE + WebSocket setup
- Depends on: Zustand store, `src/lib/websocket.ts`, `src/lib/use-server-events.ts`, all panel components
- Used by: Next.js router

**Layout:**
- Purpose: Chrome around panel content — nav rail, header, live feed sidebar, banners
- Location: `src/components/layout/`
- Contains: `nav-rail.tsx`, `header-bar.tsx`, `live-feed.tsx`, update/mode banners
- Depends on: Zustand store for active tab and connection state
- Used by: `src/app/[[...panel]]/page.tsx`

**Panels:**
- Purpose: Full-page feature views rendered inside the main content area
- Location: `src/components/panels/`
- Contains: 35+ panel components (e.g., `task-board-panel.tsx`, `agent-squad-panel-phase3.tsx`, `cost-tracker-panel.tsx`)
- Depends on: REST API via `fetch`, Zustand store for shared state, UI components
- Used by: `ContentRouter` in `src/app/[[...panel]]/page.tsx`

**Global State (Zustand):**
- Purpose: Client-side cache of server data; drives UI reactivity; shared between shell, panels, and layout
- Location: `src/store/index.ts`
- Contains: Single store with `subscribeWithSelector` middleware; holds agents, tasks, sessions, chat, UI flags, boot state
- Depends on: Nothing (pure store, no network calls)
- Used by: All client components via `useMissionControl()`

**API Routes:**
- Purpose: REST handlers for all CRUD operations, agents, sessions, chat, auth, webhooks, settings
- Location: `src/app/api/`
- Contains: ~60 route groups, each with a `route.ts` (GET/POST/PUT/DELETE)
- Depends on: `src/lib/db.ts`, `src/lib/auth.ts`, `src/lib/event-bus.ts`, domain lib modules
- Used by: Client fetch calls, MCP server (`scripts/mc-mcp-server.cjs`), CLI (`scripts/mc-cli.cjs`)

**Core Library:**
- Purpose: All server-side business logic — DB access, auth, agent sync, scheduling, webhooks, integrations
- Location: `src/lib/`
- Contains: 100+ modules: `db.ts`, `auth.ts`, `migrations.ts`, `event-bus.ts`, `sessions.ts`, `scheduler.ts`, `webhooks.ts`, `github-sync-engine.ts`, `validation.ts`, etc.
- Depends on: `better-sqlite3`, external SDKs, Node.js stdlib
- Used by: API route handlers exclusively (never imported by client components directly)

**UI Components:**
- Purpose: Primitive and shared UI building blocks
- Location: `src/components/ui/`
- Contains: `button.tsx`, `loader.tsx`, `theme-background.tsx`, `digital-clock.tsx`, etc. (no icon library)
- Depends on: Tailwind CSS, `next-themes`
- Used by: Panels, layout, modals

## Data Flow

**Panel Data Load (polling/on-demand):**
1. Panel component mounts and calls `fetch('/api/<resource>')`
2. API route handler calls `requireRole(request, 'viewer')` to authenticate
3. Handler queries SQLite via `getDatabase()` prepared statements
4. Response JSON is stored in local React state or Zustand via setter

**Real-time Local Updates (SSE):**
1. `useServerEvents()` hook opens `EventSource('/api/events')` on boot
2. API route handler (`src/app/api/events/route.ts`) subscribes to `eventBus.on('server-event', ...)`
3. On DB mutation in any API route, handler calls `eventBus.emit(...)` 
4. SSE event arrives at client; `useServerEvents` dispatches to Zustand (e.g., `updateTask`, `addAgent`)

**Remote Agent Data (WebSocket gateway):**
1. Boot sequence resolves gateway URL from DB (`/api/gateways`) then calls `/api/gateways/connect`
2. `useWebSocket()` establishes WS connection with device identity token
3. Gateway pushes `session_update`, `log`, `spawn_result`, `cron_status` frames
4. Frames are parsed in `src/lib/websocket.ts` and dispatched to Zustand store

**State Management:**
- Single Zustand store (`src/store/index.ts`) is the only client-side state container
- Server state is fetched on boot and updated reactively via SSE or WebSocket
- URL path is the source of truth for active panel; Zustand `activeTab` is synced from URL on route change

## Key Abstractions

**`getDatabase()` (`src/lib/db.ts`):**
- Purpose: Singleton SQLite connection, WAL mode, auto-migrations on first open
- Pattern: Called at top of every API route handler; never instantiated outside `src/lib/`

**`requireRole(request, role)` (`src/lib/auth.ts`):**
- Purpose: Request authentication guard; returns `{ user }` or `{ error, status }`
- Pattern: First call in every API route handler; supports session cookie, API key, proxy auth headers
- Example usage in `src/app/api/agents/route.ts`, `src/app/api/tasks/route.ts`

**`eventBus` (`src/lib/event-bus.ts`):**
- Purpose: Server-side singleton `EventEmitter`; decouples DB mutation from SSE delivery
- Pattern: API routes call `eventBus.emit(...)` after writes; SSE route listens and forwards to clients

**`useMissionControl()` (`src/store/index.ts`):**
- Purpose: Central Zustand store hook; exposes all shared UI state and setters
- Pattern: Destructured at top of any client component needing shared state

**`validateBody(request, schema)` (`src/lib/validation.ts`):**
- Purpose: Zod-based request body validation with consistent 400 error responses
- Pattern: Called in mutation handlers before any DB write

**`register*()` hooks (plugin system):**
- `registerMigrations()` — `src/lib/migrations.ts`: add DB migrations from plugins
- `registerAuthResolver()` — `src/lib/auth.ts`: custom API key resolution
- `registerNavItems()` / `registerPanel()` — `src/lib/plugins.ts`: extend navigation and panels

## Entry Points

**Main Dashboard:**
- Location: `src/app/[[...panel]]/page.tsx`
- Triggers: Any HTTP request to `/`, `/<panel-name>`
- Responsibilities: Boot sequence (auth check, gateway connect, data preload), renders shell + active panel

**Root Layout:**
- Location: `src/app/layout.tsx`
- Triggers: All page renders
- Responsibilities: Fonts, theme provider, i18n provider, metadata

**Login Page:**
- Location: `src/app/login/`
- Triggers: Unauthenticated access redirects from any panel

**Setup Page:**
- Location: `src/app/setup/`
- Triggers: First-run admin account creation at `/setup`

**API Routes:**
- Location: `src/app/api/<resource>/route.ts`
- Triggers: HTTP requests from browser, MCP server, CLI, external webhooks

**MCP Server:**
- Location: `scripts/mc-mcp-server.cjs`
- Triggers: Claude Code agent `claude mcp add` configuration
- Responsibilities: 35 tools over MCP protocol hitting local REST API

**CLI:**
- Location: `scripts/mc-cli.cjs`
- Triggers: `pnpm mc <command>`
- Responsibilities: Agent and task management from terminal

## Error Handling

**Strategy:** Per-layer; no global catch-all middleware

**Patterns:**
- API routes: `requireRole` returns structured error object; route returns `NextResponse.json({ error }, { status })` on failure
- Validation errors: `validateBody` returns 400 with Zod issue details
- DB errors: Caught in route try/catch blocks; logged via `src/lib/logger.ts` (pino); return 500
- Client: `ErrorBoundary` (`src/components/ErrorBoundary.tsx`) wraps `ContentRouter` per active tab
- SSE disconnects: Auto-reconnect with exponential backoff up to 20 attempts (`src/lib/use-server-events.ts`)
- WebSocket disconnects: Auto-reconnect with heartbeat/ping logic (`src/lib/websocket.ts`)

## Cross-Cutting Concerns

**Logging:** `src/lib/logger.ts` (pino); used in API route handlers and lib modules. Client-side: `src/lib/client-logger.ts`

**Validation:** Zod schemas defined in `src/lib/validation.ts`; `validateBody()` called at mutation boundaries

**Authentication:** `requireRole()` in `src/lib/auth.ts`; supports session cookie, `X-API-Key` header, proxy auth. Role hierarchy: `viewer` < `operator` < `admin`

**Rate Limiting:** In-memory per-IP sliding window limiter in `src/lib/rate-limit.ts`; `mutationLimiter` applied to write routes

**Multi-tenancy:** `workspace_id` and `tenant_id` on all resources; enforced in every DB query via `auth.user.workspace_id`

**i18n:** `next-intl` with message files in `messages/*.json` (en, ar, de, es, fr, ja, ko, pt, ru, zh)

---

*Architecture analysis: 2026-04-13*
