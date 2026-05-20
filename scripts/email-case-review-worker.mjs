#!/usr/bin/env node

/**
 * Mission Control Email Reviewer case-routing worker.
 *
 * Polls the Email Reviewer DB through the Mission Control API and processes
 * pending case-related emails into FirmVault Activity Logs + attachments.
 *
 * Required env:
 *   MISSION_CONTROL_API_KEY or MC_API_KEY   API key with operator/admin scope
 * Optional env:
 *   MISSION_CONTROL_URL                    Default: http://127.0.0.1:3000
 *   EMAIL_CASE_REVIEW_INTERVAL_MS          Default: 60000 in --watch mode
 *   EMAIL_CASE_REVIEW_LIMIT                Default: 25
 */

const args = new Set(process.argv.slice(2))
const watch = args.has('--watch')
const once = args.has('--once') || !watch
const baseUrl = (process.env.MISSION_CONTROL_URL || 'http://127.0.0.1:3000').replace(/\/$/, '')
const apiKey = process.env.MISSION_CONTROL_API_KEY || process.env.MC_API_KEY
const limit = Number(process.env.EMAIL_CASE_REVIEW_LIMIT || '25')
const intervalMs = Number(process.env.EMAIL_CASE_REVIEW_INTERVAL_MS || '60000')

if (!apiKey) {
  console.error('Missing MISSION_CONTROL_API_KEY or MC_API_KEY')
  process.exit(2)
}

async function runOnce() {
  const response = await fetch(`${baseUrl}/api/law-firm/email-triage`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      action: 'process_case_reviews',
      limit,
      fetch_missing_bodies: true,
      download_attachments: true,
    }),
  })

  const text = await response.text()
  let body
  try {
    body = text ? JSON.parse(text) : {}
  } catch {
    body = { raw: text }
  }

  if (!response.ok) {
    const redacted = JSON.stringify(body).replace(apiKey, '[REDACTED]')
    throw new Error(`Mission Control returned ${response.status}: ${redacted}`)
  }

  const result = body.result || {}
  console.log(JSON.stringify({
    at: new Date().toISOString(),
    processed: result.processed || 0,
    skipped: result.skipped || 0,
    failed: result.failed || 0,
    savedActivityLogs: Array.isArray(result.savedActivityLogs) ? result.savedActivityLogs.length : 0,
    savedAttachments: Array.isArray(result.savedAttachments) ? result.savedAttachments.length : 0,
  }))
}

async function main() {
  if (once) {
    await runOnce()
    return
  }

  console.log(JSON.stringify({ at: new Date().toISOString(), worker: 'email-case-review', mode: 'watch', intervalMs, baseUrl }))
  while (true) {
    try {
      await runOnce()
    } catch (error) {
      console.error(JSON.stringify({ at: new Date().toISOString(), error: error instanceof Error ? error.message : String(error) }))
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ at: new Date().toISOString(), error: error instanceof Error ? error.message : String(error) }))
  process.exit(1)
})
