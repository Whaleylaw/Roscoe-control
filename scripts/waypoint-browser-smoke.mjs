#!/usr/bin/env node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromium } from '@playwright/test'
import Database from 'better-sqlite3'

const baseUrl = process.env.MC_URL || 'http://127.0.0.1:3000'
const dataDir = process.env.MISSION_CONTROL_DATA_DIR || path.join(os.homedir(), '.mission-control', 'data')
const dbPath = process.env.MISSION_CONTROL_DB_PATH || path.join(dataDir, 'mission-control.db')
const outDir = path.join(process.cwd(), 'dogfood-output', `waypoint-browser-smoke-${Date.now()}`)
const screenshotDir = path.join(outDir, 'screenshots')
fs.mkdirSync(screenshotDir, { recursive: true })

function parseDotEnv(file) {
  const env = {}
  if (!fs.existsSync(file)) return env
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (!m) continue
    let value = m[2].trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    env[m[1]] = value
  }
  return env
}

function requireEnvValue(name, fallback) {
  const value = process.env[name] || fallback
  if (!value) throw new Error(`Missing ${name}`)
  return value
}

function apiKey() {
  const autoPath = path.join(dataDir, '.auto-generated')
  const autoEnv = parseDotEnv(autoPath)
  if (autoEnv.API_KEY) return autoEnv.API_KEY
  const env = parseDotEnv(path.join(process.cwd(), '.env'))
  if (env.API_KEY) return env.API_KEY
  throw new Error('Missing API_KEY')
}

async function api(pathname, init = {}) {
  const res = await fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey(),
      ...(init.headers || {}),
    },
  })
  const text = await res.text()
  let json
  try { json = text ? JSON.parse(text) : null } catch { json = { raw: text } }
  if (!res.ok) throw new Error(`${init.method || 'GET'} ${pathname} failed ${res.status}: ${text.slice(0, 500)}`)
  return json
}

function waypointMetadata(caseRoot, sourceRoot) {
  return JSON.stringify({
    waypoint: {
      host_runtime: {
        enabled: true,
        package_source: 'forgejo',
        package_pin: '@waypoint/core@0.1.2 @waypoint/folder-host@0.1.2',
        core_version: '0.1.2',
        folder_host_version: '0.1.2',
      },
      trusted_roots: {
        case_root_key: 'browser-smoke',
        case_root: caseRoot,
        source_root: sourceRoot,
        source_readonly: true,
      },
      quest: {
        slug: 'referral-package',
        version: 1,
      },
    },
  })
}

async function dismissOnboarding(page) {
  await page.evaluate(async () => {
    sessionStorage.setItem('mc-onboarding-dismissed', '1')
    localStorage.setItem('mc-onboarding-dismissed', '1')
    await fetch('/api/onboarding', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'skip' }),
    }).catch(() => undefined)
  }).catch(() => undefined)
  await page.keyboard.press('Escape').catch(() => undefined)
  await page.waitForTimeout(500)
  return true
}

async function main() {
  const env = parseDotEnv(path.join(process.cwd(), '.env'))
  const username = requireEnvValue('AUTH_USER', env.AUTH_USER)
  const password = requireEnvValue('AUTH_PASS', env.AUTH_PASS)
  const stamp = Date.now()
  const root = path.join(dataDir, 'browser-smoke', String(stamp))
  const caseRoot = path.join(root, 'case')
  const sourceRoot = path.join(root, 'source')
  fs.mkdirSync(caseRoot, { recursive: true })
  fs.mkdirSync(sourceRoot, { recursive: true })
  fs.writeFileSync(path.join(sourceRoot, 'intake-note.txt'), 'Browser smoke source note\n')

  const projectBody = {
    name: `Waypoint Browser Smoke ${stamp}`,
    slug: `waypoint-browser-smoke-${stamp}`,
    ticket_prefix: `WBS${String(stamp).slice(-5)}`,
    description: 'Temporary browser smoke project for Waypoint referral-package UI verification.',
    gsd_enabled: true,
    gsd_track: 'custom',
  }
  const projectJson = await api('/api/projects', { method: 'POST', body: JSON.stringify(projectBody) })
  const project = projectJson.project

  const db = new Database(dbPath)
  db.prepare('UPDATE projects SET metadata = ?, updated_at = unixepoch() WHERE id = ?').run(waypointMetadata(caseRoot, sourceRoot), project.id)
  db.close()

  const startJson = await api(`/api/projects/${project.id}/waypoint/routes`, {
    method: 'POST',
    body: JSON.stringify({ subject: 'quest', quest_slug: 'referral-package' }),
  })
  const routeId = startJson.workflow_instance_id
  const taskIds = startJson.materialized_task_ids || []
  if (!routeId || taskIds.length === 0) throw new Error(`Route start did not materialize tasks: ${JSON.stringify(startJson)}`)

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const loginResponse = await context.request.post(`${baseUrl}/api/auth/login`, {
    data: { username, password },
  })
  if (!loginResponse.ok()) {
    throw new Error(`Browser context login failed: ${loginResponse.status()} ${await loginResponse.text()}`)
  }
  const page = await context.newPage()
  const consoleErrors = []
  const failedRequests = []
  page.on('console', (msg) => { if (['error'].includes(msg.type())) consoleErrors.push(msg.text()) })
  page.on('requestfailed', (request) => {
    const errorText = request.failure()?.errorText || ''
    if (errorText === 'net::ERR_ABORTED') return
    failedRequests.push(`${request.method()} ${request.url()} ${errorText}`)
  })

  await page.goto(`${baseUrl}/tasks`, { waitUntil: 'domcontentloaded' })
  await page.screenshot({ path: path.join(screenshotDir, '01-after-login.png'), fullPage: true })
  await dismissOnboarding(page)

  await page.goto(`${baseUrl}/tasks`, { waitUntil: 'domcontentloaded' })
  await dismissOnboarding(page)
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => undefined)
  await page.screenshot({ path: path.join(screenshotDir, '02-tasks-panel.png'), fullPage: true })
  const firstTask = await api(`/api/tasks/${taskIds[0]}`)
  const taskTitle = firstTask.task?.title || firstTask.title
  const taskClickText = firstTask.task?.ticket_ref || firstTask.ticket_ref || taskTitle
  if (!taskTitle || !taskClickText) throw new Error(`Could not read task title/ref for ${taskIds[0]}`)
  await page.goto(`${baseUrl}/tasks?taskId=${taskIds[0]}`, { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => undefined)
  await page.screenshot({ path: path.join(screenshotDir, '03-task-detail.png'), fullPage: true })

  await page.getByRole('tab', { name: 'Waypoint' }).click({ timeout: 15000 })
  await page.waitForSelector('[data-testid="waypoint-review-tab"]', { timeout: 15000 })
  await page.screenshot({ path: path.join(screenshotDir, '04-waypoint-review-tab.png'), fullPage: true })

  const reviewText = await page.locator('[data-testid="waypoint-review-tab"]').innerText()
  const required = [/Referral Package/i, /Package runtime/i, /Route nodes/i]
  const missing = required.filter((regex) => !regex.test(reviewText)).map((regex) => regex.source)
  if (missing.length > 0) throw new Error(`Waypoint tab missing expected text: ${missing.join(', ')}\n${reviewText}`)

  const report = {
    baseUrl,
    projectId: project.id,
    routeId,
    materializedTaskIds: taskIds,
    taskTitle,
    reviewText: reviewText.split('\n').slice(0, 40),
    screenshots: fs.readdirSync(screenshotDir).map((name) => path.join(screenshotDir, name)),
    consoleErrors,
    failedRequests,
  }
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  await browser.close()
}

main().catch((err) => {
  console.error(err.stack || err.message)
  process.exit(1)
})
