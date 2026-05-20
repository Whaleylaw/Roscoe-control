# Mission Control

Open-source dashboard for AI agent orchestration. Manage agent fleets, track tasks, monitor costs, and orchestrate workflows.

**Stack**: Next.js 16, React 19, TypeScript 5, SQLite (better-sqlite3), Tailwind CSS 3, Zustand, pnpm

## Prerequisites

- Node.js >= 22 (LTS recommended; 24.x also supported)
- pnpm (`corepack enable` to auto-install)

## Setup

```bash
pnpm install
pnpm build
```

Secrets (AUTH_SECRET, API_KEY) auto-generate on first run if not set.
Visit `http://localhost:3000/setup` to create an admin account, or set `AUTH_USER`/`AUTH_PASS` in `.env` for headless/CI seeding.

## Run

```bash
pnpm dev              # development (localhost:3000)
pnpm start            # production
node .next/standalone/server.js   # standalone mode (after build)
```

## Docker

```bash
docker compose up                 # zero-config
bash install.sh --docker          # full guided setup
```

Production hardening: `docker compose -f docker-compose.yml -f docker-compose.hardened.yml up -d`

## Tests

```bash
pnpm test             # unit tests (vitest)
pnpm test:e2e         # end-to-end (playwright)
pnpm typecheck        # tsc --noEmit
pnpm lint             # eslint
pnpm test:all         # lint + typecheck + test + build + e2e
```

## Key Directories

```
src/app/          Next.js pages + API routes (App Router)
src/components/   UI panels and shared components
src/lib/          Core logic, database, utilities
.data/            SQLite database + runtime state (gitignored)
scripts/          Install, deploy, diagnostics scripts
docs/             Documentation and guides
```

Path alias: `@/*` maps to `./src/*`

## Data Directory

Set `MISSION_CONTROL_DATA_DIR` env var to change the data location (defaults to `.data/`).
Database path: defaults to `<MISSION_CONTROL_DATA_DIR>/mission-control.db`.

## Conventions

- **Commits**: Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`)
- **No AI attribution**: Never add `Co-Authored-By` or similar trailers to commits
- **Package manager**: pnpm only (no npm/yarn)
- **Icons**: No icon libraries -- use raw text/emoji in components
- **Standalone output**: `next.config.js` sets `output: 'standalone'`

## Agent Control Interfaces

Mission Control provides three interfaces for autonomous agents:

### MCP Server (recommended for agents)
```bash
# Add to any Codex agent:
Codex mcp add mission-control -- node /path/to/mission-control/scripts/mc-mcp-server.cjs

# Environment config:
MC_URL=http://127.0.0.1:3000 MC_API_KEY=<key>
```
72 tools: agents, projects/GSD hierarchy, tasks, sessions, memory, soul, comments, tokens, skills, cron, status, runs/evals.
See `docs/cli-agent-control.md` for full tool list.

### CLI
```bash
pnpm mc agents list --json
pnpm mc tasks queue --agent Aegis --max-capacity 2 --json
pnpm mc events watch --types agent,task
```

### REST API
OpenAPI spec: `openapi.json`. Interactive docs at `/docs` when running.

## Common Pitfalls

- **Standalone mode**: Use `node .next/standalone/server.js`, not `pnpm start` (which requires full `node_modules`)
- **better-sqlite3**: Native addon -- needs rebuild when switching Node versions (`pnpm rebuild better-sqlite3`)
- **AUTH_PASS with `#`**: Quote it (`AUTH_PASS="my#pass"`) or use `AUTH_PASS_B64` (base64-encoded)
- **Gateway optional**: Set `NEXT_PUBLIC_GATEWAY_OPTIONAL=true` for standalone deployments without gateway connectivity

<!-- GSD:project-start source:PROJECT.md -->
## Project

**Project Workspace & Dashboard**

A full-takeover project workspace for Mission Control that elevates projects from a task-grouping label into a first-class destination. Users navigate into a project and get a dedicated dashboard with status overview, activity feed, and project brief — plus scoped views for tasks, agent sessions, agents, and settings. Breadcrumb navigation moves between projects and back to the main view.

**Core Value:** When I click into a project, I see everything about that project — what it is, what's happening, what's next — and I can manage all its work from one place.

### Constraints

- **Stack**: Must use existing Next.js 16 / React 19 / TypeScript / Tailwind / Zustand stack
- **Routing**: Must work within the existing catch-all route and panel system
- **Database**: SQLite via better-sqlite3 — no ORM, prepared statements only
- **Icons**: No icon libraries — raw text/emoji per project conventions
- **i18n**: All user-facing strings must go through next-intl message files
<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->
## Technology Stack

## Languages
- TypeScript 5.7.x - All application code (`src/`)
- SQL - Database schema and migrations (`src/lib/schema.sql`, `src/lib/migrations.ts`)
- JavaScript (CommonJS) - CLI scripts and MCP server (`scripts/mc-cli.cjs`, `scripts/mc-mcp-server.cjs`, `scripts/mc-tui.cjs`)
- CSS - Global styles (`src/app/globals.css`)
## Runtime
- Node.js >= 22 (enforced via `scripts/check-node-version.mjs` and `package.json` engines field)
- LTS 22.x recommended; 24.x also supported
- `.nvmrc` pins to `22`
- pnpm (only — npm/yarn explicitly prohibited per AGENTS.md)
- Lockfile: `pnpm-lock.yaml` present
- Native addon builds restricted via `pnpm.onlyBuiltDependencies`: `better-sqlite3`, `node-pty`
## Frameworks
- Next.js 16.1.x - App Router, standalone output mode (`next.config.js`)
- React 19.0.x - UI rendering
- next-intl 4.8.x - i18n/localization (`src/i18n/request.ts`)
- next-themes 0.4.x - Dark/light theme support
- Zustand 5.0.x - Client-side global state (`src/store/index.ts`)
- Turbopack - Enabled in `next.config.js` via `turbopack: {}` (replaces Webpack for dev)
- PostCSS 8.5.x - CSS processing (`postcss.config.js`)
- Tailwind CSS 3.4.x - Utility-first CSS (`tailwind.config.js`)
- Vitest 2.1.x - Unit test runner (`vitest.config.ts`)
- Playwright 1.51.x - End-to-end tests (`playwright.config.ts`, `playwright.openclaw.local.config.ts`, `playwright.openclaw.gateway.config.ts`)
- @testing-library/react 16.1.x - React component testing
- jsdom 26.x - Browser environment simulation
## Key Dependencies
- `better-sqlite3` 12.6.x - Embedded SQLite database; native addon requiring rebuild when switching Node versions
- `node-pty` 1.1.x - Pseudo-terminal support for spawning agent processes; native addon
- `ws` 8.19.x - WebSocket server for real-time gateway communication
- `zod` 4.3.x - Runtime schema validation throughout API routes and config
- `pino` 10.3.x - Structured JSON logging (`src/lib/logger.ts`)
- `@radix-ui/react-slot` 1.2.x - Headless slot primitive
- `class-variance-authority` 0.7.x + `clsx` 2.1.x + `tailwind-merge` 3.4.x - CSS variant composition
- `@xterm/xterm` 6.x + addons - Terminal emulator for PTY display
- `@xyflow/react` 12.x + `reactflow` 11.x - Agent/workflow graph visualization
- `reagraph` 4.x - Graph rendering
- `recharts` 3.7.x - Charts for token usage/cost metrics
- `react-markdown` 10.x + `remark-gfm` 4.x - Markdown rendering in chat/comments
- `@scalar/api-reference-react` 0.8.x - OpenAPI interactive docs at `/docs`
## Configuration
- All configuration via environment variables; see `.env.example` for full reference
- On first run, `AUTH_SECRET` and `API_KEY` auto-generate and persist to `.data/.auto-generated`
- Setup flow available at `http://localhost:3000/setup` (creates admin account)
- Data directory: `MISSION_CONTROL_DATA_DIR` (defaults to `.data/`)
- Database path: `MISSION_CONTROL_DB_PATH` (defaults to `<data-dir>/mission-control.db`)
- `AUTH_USER` / `AUTH_PASS` / `AUTH_PASS_B64` - Seed admin account headlessly
- `AUTH_SECRET` - Session signing key (auto-generated)
- `API_KEY` - Bearer token for headless/external API access (auto-generated)
- `MC_COOKIE_SECURE`, `MC_COOKIE_SAMESITE` - Cookie security settings
- `OPENCLAW_GATEWAY_HOST` / `OPENCLAW_GATEWAY_PORT` - Server-side gateway address
- `NEXT_PUBLIC_GATEWAY_HOST` / `NEXT_PUBLIC_GATEWAY_PORT` / `NEXT_PUBLIC_GATEWAY_URL` - Browser-side gateway address
- `NEXT_PUBLIC_GATEWAY_OPTIONAL=true` - Run without gateway connectivity
- `PORT` - HTTP server port (default: 3000)
- `next.config.js` - Next.js config with standalone output, security headers, turbopack, ESM transpilation
- `tsconfig.json` - Strict TypeScript, `bundler` module resolution, `@/*` path alias to `./src/*`
- `tailwind.config.js` - Tailwind theme
- `vitest.config.ts` - Test environment (jsdom), coverage provider (v8), 60% thresholds
## Platform Requirements
- Node.js 22+ required
- pnpm (via `corepack enable`)
- `better-sqlite3` and `node-pty` native addons compile on install
- Standalone mode: `node .next/standalone/server.js`
- Docker: `docker compose up` (zero-config); hardened variant available
- `MC_DISABLE_HSTS=1` / `MC_ENABLE_HSTS=1` control HSTS header in production
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

## Naming Patterns
- React components: `kebab-case.tsx` (e.g., `alert-rules-panel.tsx`, `agent-squad-panel.tsx`)
- API routes: `route.ts` inside `src/app/api/[resource]/` directories
- Lib modules: `kebab-case.ts` (e.g., `rate-limit.ts`, `event-bus.ts`)
- Test files: `[module-name].test.ts` inside `src/lib/__tests__/`
- E2E tests: `[feature].spec.ts` inside `tests/`
- camelCase for all functions: `requireRole`, `getDatabase`, `createRateLimiter`
- Named exports for lib functions: `export function requireRole(...)`
- Named exports for React components: `export function AlertRulesPanel()` (not default)
- Default exports only for Next.js pages: `export default function Home()`
- camelCase for local variables and state
- SCREAMING_SNAKE_CASE for module-level constants: `API_KEY_HEADER`, `ENTITY_FIELDS`, `OPERATORS`
- Prefix boolean state with verb: `loading`, `saving`, `evaluating`, `showCreate`
- PascalCase: `AlertRule`, `EvalResult`, `AgentStatus`
- Defined inline at top of file if component-local
- Exported from `src/types/index.ts` or the module file if shared
## Code Style
- No Prettier config detected — formatting is enforced via ESLint only
- `eslint-config-next` base (see `eslint.config.mjs`)
- Semicolons: inconsistent — newer lib files omit them, older API routes include them
- ESLint with `eslint-config-next` (`eslint.config.mjs`)
- Three React hooks rules disabled due to React 19 false positives: `react-hooks/set-state-in-effect`, `react-hooks/purity`, `react-hooks/immutability`
- Ignored paths: `.data/**`, `ops/**`
- Strict mode enabled (`"strict": true` in `tsconfig.json`)
- Path alias `@/*` maps to `./src/*` — use `@/lib/...`, `@/components/...` everywhere
- Avoid `any` — use specific types; `any[]` found in legacy routes but avoid in new code
## Import Organization
- Always use `@/` prefix for internal imports — no relative paths between feature areas
## Error Handling
## Validation
## Logging
## React Component Patterns
- Local state: `useState` (granular, one state per concept)
- Async fetching: `useCallback` for fetch functions, `useEffect` to call them
- Global state: Zustand stores (see `src/lib/` for store files)
## Comments
## Module Design
- Named exports only for lib modules (`export function`, `export const`, `export type`)
- Default exports only for Next.js pages and layouts
- One or two `vi.mock(...)` exceptions for test stubs
- Not used — import directly from the module file
- `src/types/index.ts` is the one exception (shared type definitions)
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

## Pattern Overview
- Single catch-all route (`src/app/[[...panel]]/page.tsx`) renders all dashboard panels — URL path maps to active panel via Zustand state
- REST API routes in `src/app/api/` talk directly to SQLite via `better-sqlite3`; no ORM, no separate API process
- Two real-time data channels: SSE (`/api/events`) for local DB mutations, WebSocket for remote gateway agent data
- Two operating modes: **local** (SQLite only, no gateway) and **full** (gateway WebSocket connected)
- Plugin system via module-scoped `register*()` hooks (`src/lib/plugins.ts`, `src/lib/migrations.ts`, `src/lib/auth.ts`)
## Layers
- Purpose: Initialise app, handle auth redirect, boot sequence, route URL to active panel
- Location: `src/app/[[...panel]]/page.tsx`
- Contains: `Home` component (boot logic), `ContentRouter` (tab → panel mapping), SSE + WebSocket setup
- Depends on: Zustand store, `src/lib/websocket.ts`, `src/lib/use-server-events.ts`, all panel components
- Used by: Next.js router
- Purpose: Chrome around panel content — nav rail, header, live feed sidebar, banners
- Location: `src/components/layout/`
- Contains: `nav-rail.tsx`, `header-bar.tsx`, `live-feed.tsx`, update/mode banners
- Depends on: Zustand store for active tab and connection state
- Used by: `src/app/[[...panel]]/page.tsx`
- Purpose: Full-page feature views rendered inside the main content area
- Location: `src/components/panels/`
- Contains: 35+ panel components (e.g., `task-board-panel.tsx`, `agent-squad-panel-phase3.tsx`, `cost-tracker-panel.tsx`)
- Depends on: REST API via `fetch`, Zustand store for shared state, UI components
- Used by: `ContentRouter` in `src/app/[[...panel]]/page.tsx`
- Purpose: Client-side cache of server data; drives UI reactivity; shared between shell, panels, and layout
- Location: `src/store/index.ts`
- Contains: Single store with `subscribeWithSelector` middleware; holds agents, tasks, sessions, chat, UI flags, boot state
- Depends on: Nothing (pure store, no network calls)
- Used by: All client components via `useMissionControl()`
- Purpose: REST handlers for all CRUD operations, agents, sessions, chat, auth, webhooks, settings
- Location: `src/app/api/`
- Contains: ~60 route groups, each with a `route.ts` (GET/POST/PUT/DELETE)
- Depends on: `src/lib/db.ts`, `src/lib/auth.ts`, `src/lib/event-bus.ts`, domain lib modules
- Used by: Client fetch calls, MCP server (`scripts/mc-mcp-server.cjs`), CLI (`scripts/mc-cli.cjs`)
- Purpose: All server-side business logic — DB access, auth, agent sync, scheduling, webhooks, integrations
- Location: `src/lib/`
- Contains: 100+ modules: `db.ts`, `auth.ts`, `migrations.ts`, `event-bus.ts`, `sessions.ts`, `scheduler.ts`, `webhooks.ts`, `github-sync-engine.ts`, `validation.ts`, etc.
- Depends on: `better-sqlite3`, external SDKs, Node.js stdlib
- Used by: API route handlers exclusively (never imported by client components directly)
- Purpose: Primitive and shared UI building blocks
- Location: `src/components/ui/`
- Contains: `button.tsx`, `loader.tsx`, `theme-background.tsx`, `digital-clock.tsx`, etc. (no icon library)
- Depends on: Tailwind CSS, `next-themes`
- Used by: Panels, layout, modals
## Data Flow
- Single Zustand store (`src/store/index.ts`) is the only client-side state container
- Server state is fetched on boot and updated reactively via SSE or WebSocket
- URL path is the source of truth for active panel; Zustand `activeTab` is synced from URL on route change
## Key Abstractions
- Purpose: Singleton SQLite connection, WAL mode, auto-migrations on first open
- Pattern: Called at top of every API route handler; never instantiated outside `src/lib/`
- Purpose: Request authentication guard; returns `{ user }` or `{ error, status }`
- Pattern: First call in every API route handler; supports session cookie, API key, proxy auth headers
- Example usage in `src/app/api/agents/route.ts`, `src/app/api/tasks/route.ts`
- Purpose: Server-side singleton `EventEmitter`; decouples DB mutation from SSE delivery
- Pattern: API routes call `eventBus.emit(...)` after writes; SSE route listens and forwards to clients
- Purpose: Central Zustand store hook; exposes all shared UI state and setters
- Pattern: Destructured at top of any client component needing shared state
- Purpose: Zod-based request body validation with consistent 400 error responses
- Pattern: Called in mutation handlers before any DB write
- `registerMigrations()` — `src/lib/migrations.ts`: add DB migrations from plugins
- `registerAuthResolver()` — `src/lib/auth.ts`: custom API key resolution
- `registerNavItems()` / `registerPanel()` — `src/lib/plugins.ts`: extend navigation and panels
## Entry Points
- Location: `src/app/[[...panel]]/page.tsx`
- Triggers: Any HTTP request to `/`, `/<panel-name>`
- Responsibilities: Boot sequence (auth check, gateway connect, data preload), renders shell + active panel
- Location: `src/app/layout.tsx`
- Triggers: All page renders
- Responsibilities: Fonts, theme provider, i18n provider, metadata
- Location: `src/app/login/`
- Triggers: Unauthenticated access redirects from any panel
- Location: `src/app/setup/`
- Triggers: First-run admin account creation at `/setup`
- Location: `src/app/api/<resource>/route.ts`
- Triggers: HTTP requests from browser, MCP server, CLI, external webhooks
- Location: `scripts/mc-mcp-server.cjs`
- Triggers: Codex agent `Codex mcp add` configuration
- Responsibilities: 35 tools over MCP protocol hitting local REST API
- Location: `scripts/mc-cli.cjs`
- Triggers: `pnpm mc <command>`
- Responsibilities: Agent and task management from terminal
## Error Handling
- API routes: `requireRole` returns structured error object; route returns `NextResponse.json({ error }, { status })` on failure
- Validation errors: `validateBody` returns 400 with Zod issue details
- DB errors: Caught in route try/catch blocks; logged via `src/lib/logger.ts` (pino); return 500
- Client: `ErrorBoundary` (`src/components/ErrorBoundary.tsx`) wraps `ContentRouter` per active tab
- SSE disconnects: Auto-reconnect with exponential backoff up to 20 attempts (`src/lib/use-server-events.ts`)
- WebSocket disconnects: Auto-reconnect with heartbeat/ping logic (`src/lib/websocket.ts`)
## Cross-Cutting Concerns
<!-- GSD:architecture-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd:quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd:debug` for investigation and bug fixing
- `/gsd:execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd:profile-user` to generate your developer profile.
> This section is managed by `generate-Codex-profile` -- do not edit manually.
<!-- GSD:profile-end -->
