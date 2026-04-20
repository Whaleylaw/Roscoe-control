#!/usr/bin/env node
// Mission Control Phase 14 reference agent.
// Minimal image that exercises the full container contract (mounts, preamble, progress.md,
// checkpoints.jsonl, HELLO.md git-commit, runner-token submit-to-done) without calling any
// external model provider. See .planning/phases/14-runner-container-v1-2/14-09-PLAN.md.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

function log(level, msg, ctx = {}) {
  console.log(JSON.stringify({ level, ts: new Date().toISOString(), agent: 'hello-world', msg, ...ctx }))
}

async function main() {
  const {
    MC_API_URL,
    MC_TASK_ID,
    MC_API_TOKEN,
    MC_MODEL_PRIMARY,
    MC_PREAMBLE_PATH,
    MC_WORKSPACE,
    MC_RECIPE_PATH,
  } = process.env

  // Step 1: log env vars present
  log('info', 'env snapshot', {
    MC_TASK_ID,
    MC_API_URL,
    MC_MODEL_PRIMARY,
    has_token: Boolean(MC_API_TOKEN),
    MC_PREAMBLE_PATH,
    MC_WORKSPACE,
    MC_RECIPE_PATH,
  })

  // Step 2: read preamble + SOUL.md
  try {
    const preamble = fs.readFileSync(MC_PREAMBLE_PATH, 'utf8')
    log('info', 'preamble loaded', { chars: preamble.length })
    const soulPath = path.join(MC_RECIPE_PATH, 'SOUL.md')
    if (fs.existsSync(soulPath)) {
      const soul = fs.readFileSync(soulPath, 'utf8')
      log('info', 'soul loaded', { chars: soul.length })
    }
  } catch (err) {
    log('warn', 'preamble/soul read failed', { err: String(err) })
  }

  // Step 3: append to progress.md
  const progressPath = path.join(MC_WORKSPACE, '.mc', 'progress.md')
  const progressLine = `${new Date().toISOString()} | hello-world agent greets you\n`
  fs.appendFileSync(progressPath, progressLine)
  log('info', 'progress.md appended', { line: progressLine.trim() })

  // Step 4: append to checkpoints.jsonl
  const checkpointsPath = path.join(MC_WORKSPACE, '.mc', 'checkpoints.jsonl')
  const checkpoint = {
    step: 'hello-world-smoke',
    summary: 'Container exercised mounts, read preamble, and is about to submit.',
    status: 'completed',
    ts: new Date().toISOString(),
    task_id: MC_TASK_ID,
    model: MC_MODEL_PRIMARY,
  }
  fs.appendFileSync(checkpointsPath, JSON.stringify(checkpoint) + '\n')
  log('info', 'checkpoints.jsonl appended')

  // Step 5: commit HELLO.md into /workspace
  const helloPath = path.join(MC_WORKSPACE, 'HELLO.md')
  fs.writeFileSync(helloPath, `# Hello from mc-hello-world-agent\n\nTask: ${MC_TASK_ID}\nTime: ${new Date().toISOString()}\n`)
  const addR = spawnSync('git', ['-C', MC_WORKSPACE, 'add', 'HELLO.md'])
  if (addR.status !== 0) log('warn', 'git add failed', { stderr: addR.stderr?.toString() })
  const commitR = spawnSync('git', ['-C', MC_WORKSPACE, 'commit', '-m', `hello-world: task ${MC_TASK_ID}`])
  if (commitR.status !== 0) log('warn', 'git commit failed', { stderr: commitR.stderr?.toString() })
  else log('info', 'HELLO.md committed')

  // Step 6: POST /api/runner/tasks/:id/submit {status: 'done'} via runner-token
  // NOTE: This is the submit endpoint (Plan 14-11), NOT PUT /api/tasks/:id.
  // The runner-token allowlist in src/lib/runner-tokens.ts ONLY permits /api/runner/tasks/:id/*
  // paths — a PUT to /api/tasks/:id would fail with 401 at the auth-layer allowlist guard.
  const url = `${MC_API_URL}/api/runner/tasks/${MC_TASK_ID}/submit`
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${MC_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ status: 'done' }),
    })
    if (!res.ok) {
      const body = await res.text()
      log('error', 'POST submit failed', { status: res.status, body: body.slice(0, 500) })
      process.exit(3)
    }
    log('info', 'task submitted done', { status: res.status })
  } catch (err) {
    log('error', 'POST submit threw', { err: String(err) })
    process.exit(4)
  }

  // Step 7: exit 0
  process.exit(0)
}

main().catch((err) => {
  log('error', 'fatal', { err: String(err), stack: err?.stack })
  process.exit(1)
})
