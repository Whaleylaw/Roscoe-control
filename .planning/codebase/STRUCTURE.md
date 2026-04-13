# Codebase Structure

**Analysis Date:** 2026-04-13

## Directory Layout

```
mission-control/
├── src/
│   ├── app/                  # Next.js App Router pages and API routes
│   │   ├── [[...panel]]/     # Catch-all dashboard route (all panels)
│   │   ├── api/              # REST API route handlers (~60 resource groups)
│   │   ├── docs/             # In-app docs page
│   │   ├── login/            # Login page
│   │   ├── setup/            # First-run setup page
│   │   ├── layout.tsx        # Root layout (fonts, theme, i18n)
│   │   └── globals.css       # Global Tailwind CSS
│   ├── components/
│   │   ├── chat/             # Chat panel components
│   │   ├── dashboard/        # Dashboard/overview widgets and grid
│   │   ├── hud/              # HUD overlays
│   │   ├── layout/           # Shell chrome (nav, header, live feed, banners)
│   │   ├── modals/           # Full-screen modal overlays
│   │   ├── onboarding/       # Onboarding wizard
│   │   ├── panels/           # Feature panel components (one per dashboard tab)
│   │   ├── settings/         # Settings panel sub-components
│   │   ├── terminal/         # Terminal/PTY components
│   │   ├── ui/               # Primitive UI components (button, loader, etc.)
│   │   ├── ErrorBoundary.tsx # Per-tab error boundary
│   │   └── markdown-renderer.tsx
│   ├── i18n/                 # next-intl config and request handler
│   ├── lib/                  # All server-side and shared logic (100+ modules)
│   └── store/
│       └── index.ts          # Zustand store — single client-side state container
├── messages/                 # i18n message files (en.json, ar.json, de.json, etc.)
├── scripts/                  # CLI, MCP server, install, diagnostic scripts
│   ├── mc-cli.cjs            # pnpm mc <command> CLI
│   ├── mc-mcp-server.cjs     # MCP server for Claude Code agents
│   ├── mc-server.cjs         # Standalone server wrapper
│   └── mc-tui.cjs            # TUI interface
├── tests/                    # Playwright e2e + vitest integration tests
├── skills/                   # Agent skill packages
│   ├── mission-control-installer/
│   └── mission-control-manage/
├── ops/                      # Operational templates and configs
├── docs/                     # Guides and release notes
├── public/                   # Static assets (brand, sprites)
├── .data/                    # SQLite DB + runtime state (gitignored)
├── .planning/                # GSD planning documents
├── next.config.js            # Next.js config (standalone output, i18n, security headers)
├── tailwind.config.js        # Tailwind config
├── tsconfig.json             # TypeScript config
├── vitest.config.ts          # Vitest unit test config
├── playwright.config.ts      # Playwright e2e config
├── openapi.json              # OpenAPI spec
└── docker-compose.yml        # Docker setup
```

## Directory Purposes

**`src/app/[[...panel]]/`:**
- Purpose: Single catch-all page that renders the entire dashboard SPA
- Contains: `page.tsx` (boot logic + `ContentRouter`), no sub-pages
- Key files: `src/app/[[...panel]]/page.tsx`

**`src/app/api/`:**
- Purpose: REST API surface — one sub-directory per resource group
- Contains: `route.ts` files with named exports `GET`, `POST`, `PUT`, `DELETE`
- Key sub-routes: `agents/`, `tasks/`, `sessions/`, `chat/`, `auth/`, `gateways/`, `events/`, `memory/`, `skills/`, `cron/`, `webhooks/`, `workspaces/`, `projects/`
- Versioned surface: `v1/` contains `evals/` and `runs/` under a stable prefix

**`src/components/panels/`:**
- Purpose: One component per dashboard tab/panel
- Contains: 35+ files, each named `<feature>-panel.tsx`
- Pattern: Large self-contained components that fetch their own data via `fetch('/api/...')`

**`src/components/layout/`:**
- Purpose: Persistent shell UI that wraps all panels
- Key files: `nav-rail.tsx` (left icon navigation), `header-bar.tsx`, `live-feed.tsx` (right sidebar)

**`src/components/dashboard/`:**
- Purpose: Overview/home panel components
- Key files: `dashboard.tsx`, `widget-grid.tsx`, `widget-primitives.tsx`, `sidebar.tsx`, `stats-grid.tsx`

**`src/components/modals/`:**
- Purpose: Full-screen overlay modals mounted globally in the shell
- Key files: `exec-approval-overlay.tsx` (global exec approval UI), `project-manager-modal.tsx`

**`src/components/ui/`:**
- Purpose: Reusable primitive UI components; no external icon library
- Key files: `button.tsx`, `loader.tsx`, `theme-background.tsx`, `theme-selector.tsx`, `digital-clock.tsx`

**`src/lib/`:**
- Purpose: All server-side logic, utilities, and integrations
- Key files:
  - `db.ts` — SQLite singleton, WAL config, schema init
  - `schema.sql` — Base schema (tasks, agents, comments, activities, notifications, etc.)
  - `migrations.ts` — Migration runner + `registerMigrations()` plugin hook
  - `auth.ts` — `requireRole()`, session verification, `User` type
  - `validation.ts` — Zod schemas for all resources
  - `event-bus.ts` — Server-side SSE event emitter singleton
  - `config.ts` — All env var resolution and path configuration
  - `logger.ts` — Pino logger
  - `rate-limit.ts` — In-memory per-IP rate limiter
  - `websocket.ts` — Client WebSocket hook for gateway connection
  - `use-server-events.ts` — Client SSE hook
  - `plugins.ts` — Plugin registry (`registerNavItems`, `registerPanel`, etc.)
  - `sessions.ts` — Gateway session management
  - `claude-sessions.ts` — Local Claude Code session scanning
  - `hermes-sessions.ts` — Hermes session management
  - `scheduler.ts` — Built-in cron scheduler
  - `github-sync-engine.ts` — GitHub issue/PR sync
  - `navigation.ts` — `panelHref()` and `useNavigateToPanel()` helpers

**`src/store/`:**
- Purpose: Single Zustand store for all client-side shared state
- Key file: `src/store/index.ts` (1192 lines; types + store definition)
- Exported hook: `useMissionControl()`

**`tests/`:**
- Purpose: Integration + e2e tests
- Contains: 65+ Playwright `.spec.ts` test files plus `src/lib/__tests__/` for vitest unit tests
- Key helper: `tests/helpers.ts`, `tests/fixtures/`

**`scripts/`:**
- Purpose: Operational tooling — CLI, MCP server, install scripts, diagnostics
- Key files: `mc-cli.cjs`, `mc-mcp-server.cjs`, `install.sh`, `station-doctor.sh`

**`messages/`:**
- Purpose: i18n translation message files (next-intl)
- Contains: `en.json` (canonical), plus `ar.json`, `de.json`, `es.json`, `fr.json`, `ja.json`, `ko.json`, `pt.json`, `ru.json`, `zh.json`

**`.data/`:**
- Purpose: Runtime data directory (SQLite DB, token cache, runtime state)
- Generated: Yes
- Committed: No (gitignored)
- Override: `MISSION_CONTROL_DATA_DIR` env var

## Key File Locations

**Entry Points:**
- `src/app/layout.tsx`: Root HTML layout
- `src/app/[[...panel]]/page.tsx`: Main dashboard SPA entry
- `src/app/login/`: Login page
- `src/app/setup/`: First-run setup

**Configuration:**
- `src/lib/config.ts`: All runtime path and env var resolution
- `next.config.js`: Next.js config (standalone output, security headers, i18n plugin)
- `tailwind.config.js`: Tailwind config
- `tsconfig.json`: TypeScript config; defines `@/*` → `./src/*` path alias

**Core Logic:**
- `src/lib/db.ts`: Database singleton
- `src/lib/schema.sql`: Base database schema
- `src/lib/migrations.ts`: Migration runner
- `src/lib/auth.ts`: Authentication and authorization
- `src/lib/event-bus.ts`: SSE event bus
- `src/lib/validation.ts`: Zod request schemas
- `src/store/index.ts`: Client state store

**Testing:**
- `vitest.config.ts`: Unit test config
- `playwright.config.ts`: E2e test config
- `tests/`: Integration and e2e spec files
- `src/lib/__tests__/`: Unit tests co-located with lib

## Naming Conventions

**Files:**
- Components: `kebab-case.tsx` (e.g., `task-board-panel.tsx`, `nav-rail.tsx`)
- Lib modules: `kebab-case.ts` (e.g., `event-bus.ts`, `rate-limit.ts`)
- Test files: `<subject>.spec.ts` (Playwright e2e) or `<subject>.test.ts` (vitest unit)
- API routes: always named `route.ts` inside their resource directory

**Directories:**
- API resource groups: `kebab-case/` matching the URL path segment (e.g., `src/app/api/exec-approvals/`)
- Dynamic segments: `[id]/` Next.js convention
- Panel components: all in flat `src/components/panels/` (no sub-directories)

## Where to Add New Code

**New Dashboard Panel:**
- Component: `src/components/panels/<feature>-panel.tsx`
- Register in `ContentRouter`: `src/app/[[...panel]]/page.tsx` — add a `case '<tab-id>':` in the switch
- Add nav item: `src/components/layout/nav-rail.tsx`

**New API Resource:**
- Create directory: `src/app/api/<resource>/route.ts`
- Use `requireRole(request, 'viewer')` at the top of every handler
- Call `validateBody(request, schema)` for mutation endpoints
- Emit events via `eventBus.emit(...)` after writes if client should update in real-time
- Add Zod schema to `src/lib/validation.ts`

**New DB Table:**
- Add a migration object in `src/lib/migrations.ts` (append to `migrations` array)
- Do NOT modify `src/lib/schema.sql` directly (it is only used by migration `001_init`)

**New Shared Types:**
- Server-side types: `src/lib/db.ts` (exported interfaces like `Agent`, `Task`)
- Client-side types: `src/store/index.ts`

**New Utility/Service:**
- `src/lib/<module>.ts` — server-only or isomorphic logic
- If client-only: prefix with `use-` (hook) or place in `src/lib/` with `'use client'` guard in the consumer

**Shared UI Primitives:**
- `src/components/ui/<component>.tsx`

## Special Directories

**`.data/`:**
- Purpose: SQLite database (`mission-control.db`), token usage cache, runtime state
- Generated: Yes (on first run)
- Committed: No
- Override: `MISSION_CONTROL_DATA_DIR` env var

**`.planning/`:**
- Purpose: GSD planning documents (codebase maps, phase plans)
- Generated: Yes (by GSD commands)
- Committed: Yes

**`.claude/worktrees/`:**
- Purpose: Git worktrees for parallel Claude agent work
- Generated: Yes
- Committed: Partially (worktree metadata)

**`.next/`:**
- Purpose: Next.js build output
- Generated: Yes
- Committed: No

**`skills/`:**
- Purpose: Agent skill packages (self-contained Claude skill definitions)
- Generated: No
- Committed: Yes

---

*Structure analysis: 2026-04-13*
