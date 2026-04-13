# External Integrations

**Analysis Date:** 2026-04-13

## AI Agent Runtimes

Mission Control manages four AI agent runtimes, each detected and interacted with differently:

**OpenClaw (primary):**
- Purpose: Multi-agent orchestration with gateway, sessions, and memory
- Config: `OPENCLAW_HOME` / `OPENCLAW_STATE_DIR`, `OPENCLAW_CONFIG_PATH`
- Binary: `OPENCLAW_BIN` (default: `openclaw`)
- Config file: `~/.openclaw/openclaw.json` (JSON, not `.env`)
- Adapter: `src/lib/adapters/openclaw.ts`
- Gateway runtime: `src/lib/gateway-runtime.ts`

**Hermes Agent:**
- Purpose: Self-improving AI agent with learning loop, skills, multi-platform messaging
- Session DB: `~/.hermes/state.db` (SQLite, opened read-only)
- Scanner: `src/lib/hermes-sessions.ts`
- Auth: configured via `hermes setup` or Mission Control UI
- Tasks: `src/lib/hermes-tasks.ts`

**Claude Code (Anthropic CLI):**
- Purpose: Software engineering tasks
- Session transcripts: `~/.claude/projects/` (JSONL files)
- Config: `MC_CLAUDE_HOME` (default: `~/.claude`)
- Scanner: `src/lib/claude-sessions.ts`
- Tasks: `src/lib/claude-tasks.ts`
- Auth: via `claude login` on the host machine

**Codex (OpenAI CLI):**
- Purpose: Code-focused tasks
- Session JSONL scanned from `~/.codex/` directories
- Scanner: `src/lib/codex-sessions.ts`

## AI Model Providers (cost tracking / routing)

Mission Control tracks token usage and cost across multiple AI providers. No direct API calls to these providers — costs are tracked from session transcripts and gateway data.

**Anthropic** (Claude Haiku/Sonnet/Opus) - pricing in `src/lib/token-pricing.ts`
**OpenAI** (GPT-4.1, GPT-4.1-mini, GPT-4.1-nano, Codex Mini) - pricing in `src/lib/models.ts`
**Google** (Gemini 2.5 Pro/Flash) - pricing in `src/lib/models.ts`
**Groq** (Llama 3.1 8B, Llama 3.3 70B) - pricing in `src/lib/models.ts`
**Ollama** (DeepSeek R1:14b, Qwen2.5-coder) - local inference, $0 pricing
**Moonshot** (Kimi K2.5), **Venice** (Llama 3.3 70B), **MiniMax** (M2.1) - pricing in `src/lib/models.ts`

Provider subscription detection: `src/lib/provider-subscriptions.ts` — reads credential files from `~/.config/openai/auth.json`, `~/.openai/auth.json`, `~/.codex/auth.json` and OpenClaw's `.env` file.

## OpenClaw Gateway

**Purpose:** WebSocket-based event relay between Mission Control and agent processes
- Protocol: Custom binary/JSON framing over WebSocket (gateway protocol v3)
- Server-side connection: `OPENCLAW_GATEWAY_HOST:OPENCLAW_GATEWAY_PORT` (default: `127.0.0.1:18789`)
- Browser-side connection: `NEXT_PUBLIC_GATEWAY_HOST:NEXT_PUBLIC_GATEWAY_PORT` or `NEXT_PUBLIC_GATEWAY_URL`
- Auth: `OPENCLAW_GATEWAY_TOKEN` (server-side; never exposed via `NEXT_PUBLIC_*`)
- Client: `NEXT_PUBLIC_GATEWAY_CLIENT_ID` (default: `openclaw-control-ui`)
- WebSocket hook: `src/lib/websocket.ts` (client-side singleton)
- Registration: `src/lib/gateway-runtime.ts` — registers MC origin in `openclaw.json`

## GitHub Integration

**Purpose:** Sync GitHub issues to MC tasks (bidirectional)
- Client: `src/lib/github.ts` — native `fetch` against `https://api.github.com`
- Auth: `GITHUB_TOKEN` — resolved first from OpenClaw's `.env` file (`~/.openclaw/.env`), then `process.env`
- Sync engine: `src/lib/github-sync-engine.ts`
- Poller: `src/lib/github-sync-poller.ts`
- API routes: `src/app/api/github/`

## Authentication & Identity

**Primary (local):**
- Custom session-based auth stored in SQLite (`users`, `sessions` tables)
- Password hashing in `src/lib/password.ts`
- Session cookie: `src/lib/session-cookie.ts`
- Auth logic: `src/lib/auth.ts`
- Roles: `admin`, `operator`, `viewer`

**Google OAuth (optional):**
- Provider: Google Identity Services (OAuth2 ID token flow)
- Token verification: `src/lib/google-auth.ts` — verifies via `https://oauth2.googleapis.com/tokeninfo`
- Required env vars: `GOOGLE_CLIENT_ID`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID`
- API routes: `src/app/api/auth/google/`

**Proxy/Header Auth (optional):**
- Header-based SSO from trusted reverse proxy
- Config: `MC_PROXY_AUTH_HEADER` (e.g., `X-User-Email`), `MC_PROXY_AUTH_DEFAULT_ROLE`
- Trusted IPs: `MC_PROXY_AUTH_TRUSTED_IPS`
- Provider label: `proxy` on the User object

**API Key Auth:**
- `x-api-key` header for headless/agent access
- Auto-generated on first run, persisted to `.data/.auto-generated`
- Config: `API_KEY` env var

**Plugin hook:** `registerAuthResolver()` in `src/lib/auth.ts` — extensions inject custom API key resolution

## Data Storage

**Primary Database:**
- SQLite via `better-sqlite3` 12.x
- Path: `MISSION_CONTROL_DB_PATH` (default: `.data/mission-control.db`)
- WAL mode enabled; `busy_timeout = 5000ms`
- Schema: `src/lib/schema.sql`; migrations: `src/lib/migrations.ts`
- Connection: `src/lib/db.ts` — singleton `getDatabase()`

**File Storage:**
- Agent memory: `OPENCLAW_MEMORY_DIR` (default: `~/.openclaw/memory/` or workspace memory)
- Agent logs: `OPENCLAW_LOG_DIR` (default: `~/.openclaw/logs/`)
- Session transcripts: filesystem scan of `~/.claude/projects/`, `~/.hermes/`, `~/.codex/`

**Caching:**
- SQLite `cache_size = 1000`; no external cache layer

## Webhooks

**Outgoing (managed):**
- Mission Control delivers webhooks to external URLs on internal events
- Events: `agent.status_change`, `activity.task_*`, `notification.*`, `security.*`
- Retry: exponential backoff (30s, 5m, 30m, 2h, 8h) with ±20% jitter, max 5 retries
- Signatures: HMAC-SHA256 with shared secret
- Config: `MC_WEBHOOK_MAX_RETRIES` (default: 5)
- Implementation: `src/lib/webhooks.ts`
- API routes: `src/app/api/webhooks/`

**Incoming:**
- No incoming webhook endpoints detected

## GNAP (Git-Native Agent Protocol)

**Purpose:** Sync MC tasks to a git-backed task repository
- Config: `GNAP_ENABLED=true`, `GNAP_REPO_PATH`, `GNAP_REMOTE_URL`, `GNAP_AUTO_SYNC`
- Sync: Phase 1 = MC → GNAP push only; bidirectional is future
- Implementation: `src/lib/gnap-sync.ts`
- API routes: `src/app/api/gnap/`

## 1Password (optional)

**Purpose:** Retrieve secrets from 1Password vaults for agent configurations
- Config: `OP_VAULT_NAME` (default: `default`)
- Requires `op` CLI installed on host
- Referenced in plugin integration defs (`src/lib/plugins.ts`)

## Tailscale (optional)

**Purpose:** Detect public URL when MC is served via Tailscale Serve (for gateway registration)
- Integration: `src/lib/tailscale-serve.ts` — shells out to `tailscale serve status --json`
- Binary locations tried: `/Applications/Tailscale.app/Contents/MacOS/Tailscale`, then PATH

## Provisioner (optional, super-admin)

**Purpose:** Execute privileged system commands (e.g., tenant provisioning) via a privileged sidecar daemon
- Transport: Unix domain socket (`/run/mc-provisioner.sock` or `MC_PROVISIONER_SOCKET`)
- Auth: `MC_PROVISIONER_TOKEN` shared secret
- Implementation: `src/lib/provisioner-client.ts`

## CI/CD & Deployment

**Hosting:**
- Self-hosted (bare metal, VPS, Docker)
- Docker: `docker-compose.yml`, `docker-compose.hardened.yml`
- Docker install script: `install.sh --docker`

**CI Pipeline:**
- Not detected in codebase (no GitHub Actions workflows found)

## Monitoring & Observability

**Logging:**
- Pino 10.x structured JSON logger (`src/lib/logger.ts`)
- Development: pino-pretty with colors when `NODE_ENV !== 'production'`
- Level: `LOG_LEVEL` env var (default: `info`)

**Error Tracking:**
- No external error tracking service detected (no Sentry, Datadog, etc.)

**Security Events:**
- Internal audit log stored in SQLite (`src/lib/security-events.ts`)
- Retention: `MC_RETAIN_AUDIT_DAYS` (default: 365)

## MCP Server (Model Context Protocol)

**Purpose:** Expose 35 Mission Control tools to any Claude Code agent
- Script: `scripts/mc-mcp-server.cjs`
- Config: `MC_URL`, `MC_API_KEY` env vars
- Tools cover: agents, tasks, sessions, memory, soul, comments, tokens, skills, cron, status

## Environment Configuration Summary

**Required for core operation:**
- None strictly required — secrets auto-generate on first run

**Required for specific integrations:**
- `GITHUB_TOKEN` — GitHub issue sync
- `GOOGLE_CLIENT_ID` + `NEXT_PUBLIC_GOOGLE_CLIENT_ID` — Google OAuth
- `OPENCLAW_GATEWAY_TOKEN` — Authenticated gateway connection
- `MC_PROVISIONER_TOKEN` + `MC_PROVISIONER_SOCKET` — Provisioner sidecar
- `GNAP_ENABLED=true` + `GNAP_REPO_PATH` — GNAP sync

**Secrets location:**
- `.env` file at project root (git-ignored)
- Auto-generated credentials: `.data/.auto-generated` (git-ignored)
- OpenClaw integration env: `~/.openclaw/.env` (read by `src/lib/runtime-env.ts`)

---

*Integration audit: 2026-04-13*
