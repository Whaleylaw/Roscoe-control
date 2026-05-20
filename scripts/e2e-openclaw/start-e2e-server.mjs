#!/usr/bin/env node
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import process from 'node:process'
import Database from 'better-sqlite3'

async function findAvailablePort(host = '127.0.0.1') {
  return await new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, host, () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('failed to resolve dynamic port')))
        return
      }
      const { port } = address
      server.close((err) => {
        if (err) reject(err)
        else resolve(port)
      })
    })
  })
}

const modeArg = process.argv.find((arg) => arg.startsWith('--mode='))
const mode = modeArg ? modeArg.split('=')[1] : 'local'
if (mode !== 'local' && mode !== 'gateway') {
  process.stderr.write(`Invalid mode: ${mode}\n`)
  process.exit(1)
}

const repoRoot = process.cwd()
const fixtureSource = path.join(repoRoot, 'tests', 'fixtures', 'openclaw')
const runtimeRoot = path.join(repoRoot, '.tmp', 'e2e-openclaw', mode)
const dataDir = path.join(runtimeRoot, 'data')
const openCodeDir = path.join(runtimeRoot, '.local', 'share', 'opencode')
const openCodeDbPath = path.join(openCodeDir, 'opencode-e2e.db')
const mockBinDir = path.join(repoRoot, 'scripts', 'e2e-openclaw', 'bin')
const skillsRoot = path.join(runtimeRoot, 'skills')

function findStandaloneServer(root) {
  const direct = path.join(root, '.next', 'standalone', 'server.js')
  if (fs.existsSync(direct)) return direct

  const standaloneRoot = path.join(root, '.next', 'standalone')
  if (!fs.existsSync(standaloneRoot)) return null

  const stack = [standaloneRoot]
  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) continue
    const entries = fs.readdirSync(current, { withFileTypes: true })
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(full)
      } else if (entry.isFile() && entry.name === 'server.js') {
        return full
      }
    }
  }

  return null
}

function runBlocking(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      env: baseEnv,
      stdio: 'inherit',
      ...options,
    })
    child.on('error', reject)
    child.on('exit', (code, signal) => {
      if (code === 0) return resolve(undefined)
      reject(new Error(`${command} ${args.join(' ')} exited with code ${code ?? 'null'} signal ${signal ?? 'none'}`))
    })
  })
}

fs.rmSync(runtimeRoot, { recursive: true, force: true })
fs.mkdirSync(runtimeRoot, { recursive: true })
fs.mkdirSync(dataDir, { recursive: true })
fs.mkdirSync(openCodeDir, { recursive: true })
fs.cpSync(fixtureSource, runtimeRoot, { recursive: true })

const openCodeDb = new Database(openCodeDbPath)
const now = Date.now()
openCodeDb.exec(`
  CREATE TABLE IF NOT EXISTS project (
    id TEXT PRIMARY KEY,
    worktree TEXT,
    vcs TEXT,
    name TEXT,
    icon_url TEXT,
    icon_color TEXT,
    time_created INTEGER,
    time_updated INTEGER,
    time_initialized INTEGER,
    sandboxes TEXT,
    commands TEXT
  );
  CREATE TABLE IF NOT EXISTS session (
    id TEXT PRIMARY KEY,
    project_id TEXT,
    parent_id TEXT,
    slug TEXT,
    title TEXT,
    directory TEXT,
    time_created INTEGER,
    time_updated INTEGER,
    version TEXT,
    share_url TEXT,
    summary_additions INTEGER,
    summary_deletions INTEGER,
    summary_files INTEGER,
    summary_diffs TEXT,
    revert TEXT,
    permission TEXT,
    time_compacting INTEGER,
    time_archived INTEGER,
    workspace_id TEXT
  );
  CREATE TABLE IF NOT EXISTS message (
    id TEXT PRIMARY KEY,
    session_id TEXT,
    data TEXT,
    time_created INTEGER,
    time_updated INTEGER
  );
`)
openCodeDb.prepare(`INSERT OR REPLACE INTO project (id, worktree, vcs, name, icon_url, icon_color, time_created, time_updated, time_initialized, sandboxes, commands) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
  'proj_e2e',
  '/tmp/opencode-e2e-project',
  'git',
  null,
  null,
  null,
  now - 10000,
  now,
  null,
  '[]',
  null,
)
openCodeDb.prepare(`INSERT OR REPLACE INTO session (id, project_id, parent_id, slug, title, directory, time_created, time_updated, version, share_url, summary_additions, summary_deletions, summary_files, summary_diffs, revert, permission, time_compacting, time_archived, workspace_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
  'ses_e2e_1',
  'proj_e2e',
  null,
  'hidden-wolf',
  'OpenCode E2E Session',
  '/tmp/opencode-e2e-project',
  now - 10000,
  now - 1000,
  '1.0.0',
  null,
  0,
  0,
  0,
  null,
  null,
  null,
  null,
  null,
  null,
)
openCodeDb.prepare(`INSERT OR REPLACE INTO message (id, session_id, data, time_created, time_updated) VALUES (?, ?, ?, ?, ?)`).run(
  'msg_e2e_1',
  'ses_e2e_1',
  JSON.stringify({ role: 'user', model: { providerID: 'anthropic', modelID: 'claude-sonnet-4-5' }, tokens: { input: 12, output: 0 } }),
  now - 10000,
  now - 10000,
)
openCodeDb.prepare(`INSERT OR REPLACE INTO message (id, session_id, data, time_created, time_updated) VALUES (?, ?, ?, ?, ?)`).run(
  'msg_e2e_2',
  'ses_e2e_1',
  JSON.stringify({ role: 'assistant', providerID: 'anthropic', modelID: 'claude-sonnet-4-5', content: 'CONTINUE_OK', tokens: { input: 0, output: 6 } }),
  now - 5000,
  now - 1000,
)
openCodeDb.close()

const gatewayHost = '127.0.0.1'
const gatewayPort = String(await findAvailablePort(gatewayHost))

const baseEnv = {
  ...process.env,
  API_KEY: process.env.API_KEY || 'test-api-key-e2e-12345',
  AUTH_USER: process.env.AUTH_USER || 'admin',
  AUTH_PASS: process.env.AUTH_PASS || 'admin',
  HOSTNAME: '127.0.0.1',
  PORT: '3005',
  MISSION_CONTROL_TEST_MODE: process.env.MISSION_CONTROL_TEST_MODE || '1',
  MC_DISABLE_RATE_LIMIT: '1',
  MISSION_CONTROL_DATA_DIR: dataDir,
  MISSION_CONTROL_DB_PATH: path.join(dataDir, 'mission-control.db'),
  HOME: runtimeRoot,
  OPENCODE_DB_PATH: openCodeDbPath,
  OPENCLAW_STATE_DIR: runtimeRoot,
  OPENCLAW_CONFIG_PATH: path.join(runtimeRoot, 'openclaw.json'),
  OPENCLAW_GATEWAY_HOST: gatewayHost,
  OPENCLAW_GATEWAY_PORT: gatewayPort,
  OPENCLAW_BIN: path.join(mockBinDir, 'openclaw'),
  OPENCODE_BIN: path.join(mockBinDir, 'opencode'),
  CLAWDBOT_BIN: path.join(mockBinDir, 'clawdbot'),
  MC_SKILLS_USER_AGENTS_DIR: path.join(skillsRoot, 'user-agents'),
  MC_SKILLS_USER_CODEX_DIR: path.join(skillsRoot, 'user-codex'),
  MC_SKILLS_PROJECT_AGENTS_DIR: path.join(skillsRoot, 'project-agents'),
  MC_SKILLS_PROJECT_CODEX_DIR: path.join(skillsRoot, 'project-codex'),
  MC_SKILLS_OPENCLAW_DIR: path.join(skillsRoot, 'openclaw'),
  PATH: `${mockBinDir}:${process.env.PATH || ''}`,
  E2E_GATEWAY_EXPECTED: mode === 'gateway' ? '1' : '0',
}

const children = []
let app = null

if (mode === 'gateway') {
  const gw = spawn('node', ['scripts/e2e-openclaw/mock-gateway.mjs'], {
    cwd: repoRoot,
    env: baseEnv,
    stdio: 'inherit',
  })
  gw.on('error', (err) => {
    process.stderr.write(`[openclaw-e2e] mock gateway failed to start: ${String(err)}\n`)
    shutdown('SIGTERM')
    process.exit(1)
  })
  gw.on('exit', (code, signal) => {
    const exitCode = code ?? (signal ? 1 : 0)
    if (exitCode !== 0) {
      process.stderr.write(`[openclaw-e2e] mock gateway exited unexpectedly (code=${exitCode}, signal=${signal ?? 'none'})\n`)
      shutdown('SIGTERM')
      process.exit(exitCode)
    }
  })
  children.push(gw)
}

const buildIdPath = path.join(repoRoot, '.next', 'BUILD_ID')

if (!fs.existsSync(buildIdPath)) {
  await runBlocking('pnpm', ['build'])
}

const standaloneServerPath = findStandaloneServer(repoRoot)

// Next.js `output: 'standalone'` produces server.js but does NOT copy
// `.next/static` or `/public` into the standalone dir — the build system
// expects the deploy tool (or scripts/start-standalone.sh) to do that
// copy. When `pnpm test:all` runs `pnpm build && pnpm test:e2e`, the
// standalone server boots with missing chunks/public assets, which
// manifests as "Refused to apply style ... MIME type ('text/html')"
// console errors and a boot sequence that never completes because the
// React bundle fails to hydrate. Copy the assets here so the e2e harness
// is self-contained.
if (standaloneServerPath && fs.existsSync(standaloneServerPath)) {
  const standaloneDir = path.dirname(standaloneServerPath)
  const staticSrc = path.join(repoRoot, '.next', 'static')
  const staticDst = path.join(standaloneDir, '.next', 'static')
  const publicSrc = path.join(repoRoot, 'public')
  const publicDst = path.join(standaloneDir, 'public')
  if (fs.existsSync(staticSrc)) {
    fs.rmSync(staticDst, { recursive: true, force: true })
    fs.cpSync(staticSrc, staticDst, { recursive: true })
  }
  if (fs.existsSync(publicSrc)) {
    fs.rmSync(publicDst, { recursive: true, force: true })
    fs.cpSync(publicSrc, publicDst, { recursive: true })
  }
}

app = standaloneServerPath && fs.existsSync(standaloneServerPath)
  ? spawn('node', [standaloneServerPath], {
      cwd: repoRoot,
      env: baseEnv,
      stdio: 'inherit',
    })
  : spawn('pnpm', ['start'], {
      cwd: repoRoot,
      env: baseEnv,
      stdio: 'inherit',
    })
children.push(app)

// ---------------------------------------------------------------------------
// Phase 17 Plan 17-06 — optional runner daemon child process.
//
// Gated by PHASE17_SPAWN_RUNNER=1. When set, we wait for the MC server to
// become reachable on 127.0.0.1:3005 (readiness probe) and then spawn
// scripts/mc-runner.mjs as a sibling child with MC_URL pointed at the
// e2e server. The runner inherits MISSION_CONTROL_DATA_DIR so it sees the
// same runner.secret and DB the server just initialised.
//
// On SIGINT/SIGTERM the shared `shutdown()` helper kills the runner with the
// same signal; a 5s grace window then escalates to SIGKILL to guarantee no
// process leaks in the Playwright webServer teardown.
//
// Default (unset/0) behavior is unchanged — existing specs continue to pass.
// ---------------------------------------------------------------------------
let runnerChild = null
let runnerBooted = false

async function spawnRunner() {
  if (process.env.PHASE17_SPAWN_RUNNER !== '1') return
  if (runnerBooted) return
  runnerBooted = true

  // Readiness probe — poll /api/status until the MC server answers. We use
  // fetch (Node 22 has native fetch) and a 30s budget. Once MC answers we
  // know runner.secret has been auto-generated and /api/runner/config will
  // accept the daemon's bearer.
  const deadline = Date.now() + 30_000
  let ready = false
  while (Date.now() < deadline) {
    try {
      const res = await fetch('http://127.0.0.1:3005/api/status')
      if (res.ok || res.status === 401 || res.status === 403) {
        ready = true
        break
      }
    } catch {
      // still booting
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  if (!ready) {
    process.stderr.write('[e2e] PHASE17_SPAWN_RUNNER=1 but MC server never became reachable; skipping runner spawn\n')
    return
  }

  runnerChild = spawn('node', ['scripts/mc-runner.mjs'], {
    cwd: repoRoot,
    env: {
      ...baseEnv,
      MC_URL: 'http://127.0.0.1:3005',
    },
    stdio: ['ignore', 'inherit', 'inherit'],
  })
  children.push(runnerChild)
  // eslint-disable-next-line no-console
  console.log(`[e2e] Spawned mc-runner.mjs pid=${runnerChild.pid}`)
  runnerChild.on('exit', (code, signal) => {
    // eslint-disable-next-line no-console
    console.log(`[e2e] mc-runner.mjs exited code=${code ?? 'null'} signal=${signal ?? 'none'}`)
  })
}

// Kick the runner spawn off the event loop so the rest of startup can finish
// initialising shutdown handlers first. The readiness probe inside spawnRunner
// handles the race between MC boot and runner launch.
void spawnRunner().catch((err) => {
  process.stderr.write(`[e2e] failed to spawn runner daemon: ${String(err)}\n`)
})

function shutdown(signal = 'SIGTERM') {
  // Phase 17: kill the runner child first so it does not try to register
  // a heartbeat against a server that is already tearing down.
  if (runnerChild && !runnerChild.killed) {
    try {
      runnerChild.kill(signal)
    } catch {
      // noop
    }
    setTimeout(() => {
      if (runnerChild && !runnerChild.killed) {
        try {
          runnerChild.kill('SIGKILL')
        } catch {
          // noop
        }
      }
    }, 5000).unref?.()
  }
  for (const child of children) {
    if (!child.killed) {
      try {
        child.kill(signal)
      } catch {
        // noop
      }
    }
  }
}

process.on('SIGINT', () => {
  shutdown('SIGINT')
  process.exit(130)
})
process.on('SIGTERM', () => {
  shutdown('SIGTERM')
  process.exit(143)
})

app.on('exit', (code) => {
  shutdown('SIGTERM')
  process.exit(code ?? 0)
})
