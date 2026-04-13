# Technology Stack

**Analysis Date:** 2026-04-13

## Languages

**Primary:**
- TypeScript 5.7.x - All application code (`src/`)
- SQL - Database schema and migrations (`src/lib/schema.sql`, `src/lib/migrations.ts`)

**Secondary:**
- JavaScript (CommonJS) - CLI scripts and MCP server (`scripts/mc-cli.cjs`, `scripts/mc-mcp-server.cjs`, `scripts/mc-tui.cjs`)
- CSS - Global styles (`src/app/globals.css`)

## Runtime

**Environment:**
- Node.js >= 22 (enforced via `scripts/check-node-version.mjs` and `package.json` engines field)
- LTS 22.x recommended; 24.x also supported
- `.nvmrc` pins to `22`

**Package Manager:**
- pnpm (only — npm/yarn explicitly prohibited per CLAUDE.md)
- Lockfile: `pnpm-lock.yaml` present
- Native addon builds restricted via `pnpm.onlyBuiltDependencies`: `better-sqlite3`, `node-pty`

## Frameworks

**Core:**
- Next.js 16.1.x - App Router, standalone output mode (`next.config.js`)
- React 19.0.x - UI rendering
- next-intl 4.8.x - i18n/localization (`src/i18n/request.ts`)
- next-themes 0.4.x - Dark/light theme support

**State Management:**
- Zustand 5.0.x - Client-side global state (`src/store/index.ts`)

**Build/Dev:**
- Turbopack - Enabled in `next.config.js` via `turbopack: {}` (replaces Webpack for dev)
- PostCSS 8.5.x - CSS processing (`postcss.config.js`)
- Tailwind CSS 3.4.x - Utility-first CSS (`tailwind.config.js`)

**Testing:**
- Vitest 2.1.x - Unit test runner (`vitest.config.ts`)
- Playwright 1.51.x - End-to-end tests (`playwright.config.ts`, `playwright.openclaw.local.config.ts`, `playwright.openclaw.gateway.config.ts`)
- @testing-library/react 16.1.x - React component testing
- jsdom 26.x - Browser environment simulation

## Key Dependencies

**Critical:**
- `better-sqlite3` 12.6.x - Embedded SQLite database; native addon requiring rebuild when switching Node versions
- `node-pty` 1.1.x - Pseudo-terminal support for spawning agent processes; native addon
- `ws` 8.19.x - WebSocket server for real-time gateway communication
- `zod` 4.3.x - Runtime schema validation throughout API routes and config
- `pino` 10.3.x - Structured JSON logging (`src/lib/logger.ts`)

**UI Components:**
- `@radix-ui/react-slot` 1.2.x - Headless slot primitive
- `class-variance-authority` 0.7.x + `clsx` 2.1.x + `tailwind-merge` 3.4.x - CSS variant composition
- `@xterm/xterm` 6.x + addons - Terminal emulator for PTY display
- `@xyflow/react` 12.x + `reactflow` 11.x - Agent/workflow graph visualization
- `reagraph` 4.x - Graph rendering
- `recharts` 3.7.x - Charts for token usage/cost metrics
- `react-markdown` 10.x + `remark-gfm` 4.x - Markdown rendering in chat/comments

**API/Docs:**
- `@scalar/api-reference-react` 0.8.x - OpenAPI interactive docs at `/docs`

## Configuration

**Environment:**
- All configuration via environment variables; see `.env.example` for full reference
- On first run, `AUTH_SECRET` and `API_KEY` auto-generate and persist to `.data/.auto-generated`
- Setup flow available at `http://localhost:3000/setup` (creates admin account)
- Data directory: `MISSION_CONTROL_DATA_DIR` (defaults to `.data/`)
- Database path: `MISSION_CONTROL_DB_PATH` (defaults to `<data-dir>/mission-control.db`)

**Key env vars (authentication):**
- `AUTH_USER` / `AUTH_PASS` / `AUTH_PASS_B64` - Seed admin account headlessly
- `AUTH_SECRET` - Session signing key (auto-generated)
- `API_KEY` - Bearer token for headless/external API access (auto-generated)
- `MC_COOKIE_SECURE`, `MC_COOKIE_SAMESITE` - Cookie security settings

**Key env vars (network/gateway):**
- `OPENCLAW_GATEWAY_HOST` / `OPENCLAW_GATEWAY_PORT` - Server-side gateway address
- `NEXT_PUBLIC_GATEWAY_HOST` / `NEXT_PUBLIC_GATEWAY_PORT` / `NEXT_PUBLIC_GATEWAY_URL` - Browser-side gateway address
- `NEXT_PUBLIC_GATEWAY_OPTIONAL=true` - Run without gateway connectivity
- `PORT` - HTTP server port (default: 3000)

**Build:**
- `next.config.js` - Next.js config with standalone output, security headers, turbopack, ESM transpilation
- `tsconfig.json` - Strict TypeScript, `bundler` module resolution, `@/*` path alias to `./src/*`
- `tailwind.config.js` - Tailwind theme
- `vitest.config.ts` - Test environment (jsdom), coverage provider (v8), 60% thresholds

## Platform Requirements

**Development:**
- Node.js 22+ required
- pnpm (via `corepack enable`)
- `better-sqlite3` and `node-pty` native addons compile on install

**Production:**
- Standalone mode: `node .next/standalone/server.js`
- Docker: `docker compose up` (zero-config); hardened variant available
- `MC_DISABLE_HSTS=1` / `MC_ENABLE_HSTS=1` control HSTS header in production

---

*Stack analysis: 2026-04-13*
