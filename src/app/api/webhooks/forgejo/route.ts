import { createHmac, timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { logger } from '@/lib/logger'
import { handleForgejoReviewPrWebhook } from '@/lib/review-prs'
import { getReviewPrSettings } from '@/lib/task-runtime-settings'

type ForgejoPullRequestWebhook = {
  action?: unknown
  repository?: {
    owner?: { username?: unknown; login?: unknown; name?: unknown }
    name?: unknown
    full_name?: unknown
  }
  pull_request?: {
    number?: unknown
    merged?: unknown
    state?: unknown
    merge_commit_sha?: unknown
    merge_commit_id?: unknown
    merged_commit_id?: unknown
  }
  sender?: {
    username?: unknown
    login?: unknown
    name?: unknown
  }
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text()
  const settings = getReviewPrSettings()
  if (!settings.forgejoWebhookSecret) {
    return NextResponse.json({ error: 'Forgejo webhook secret is not configured' }, { status: 503 })
  }
  if (!verifyForgejoSignature(rawBody, settings.forgejoWebhookSecret, request.headers)) {
    return NextResponse.json({ error: 'Invalid Forgejo webhook signature' }, { status: 401 })
  }

  const event = request.headers.get('x-gitea-event') || request.headers.get('x-forgejo-event')
  if (event && event !== 'pull_request') {
    return NextResponse.json({ success: true, ignored: true, reason: 'unsupported_event', event })
  }

  let payload: ForgejoPullRequestWebhook
  try {
    payload = JSON.parse(rawBody) as ForgejoPullRequestWebhook
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 })
  }

  const repo = parseRepo(payload)
  const prNumber = numberValue(payload.pull_request?.number)
  if (!repo || !prNumber) {
    return NextResponse.json({ error: 'Webhook payload missing repository or pull request number' }, { status: 400 })
  }

  const action = stringValue(payload.action)
  const merged = payload.pull_request?.merged === true || payload.pull_request?.state === 'merged' || action === 'merged'
  const closed = action === 'closed' || payload.pull_request?.state === 'closed'
  if (!merged && !closed) {
    return NextResponse.json({ success: true, ignored: true, reason: 'pull_request_not_final', action })
  }

  try {
    const result = handleForgejoReviewPrWebhook(getDatabase(), {
      repoOwner: repo.owner,
      repoName: repo.name,
      prNumber,
      action: merged ? 'merged' : 'closed',
      actor: `forgejo-webhook${senderName(payload) ? `:${senderName(payload)}` : ''}`,
      mergeCommitSha: mergeCommitSha(payload),
    })

    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    logger.error({ err: error }, 'POST /api/webhooks/forgejo error')
    return NextResponse.json({ error: 'Failed to process Forgejo webhook' }, { status: 500 })
  }
}

function verifyForgejoSignature(rawBody: string, secret: string, headers: Headers): boolean {
  const header = headers.get('x-gitea-signature')
    || headers.get('x-forgejo-signature')
    || headers.get('x-hub-signature-256')
  if (!header) return false

  const received = header.trim().replace(/^sha256=/i, '')
  if (!/^[a-f0-9]{64}$/i.test(received)) return false

  const expected = createHmac('sha256', secret).update(rawBody).digest('hex')
  const receivedBuffer = Buffer.from(received, 'hex')
  const expectedBuffer = Buffer.from(expected, 'hex')
  return receivedBuffer.length === expectedBuffer.length && timingSafeEqual(receivedBuffer, expectedBuffer)
}

function parseRepo(payload: ForgejoPullRequestWebhook): { owner: string; name: string } | null {
  const name = stringValue(payload.repository?.name)
  const owner = stringValue(payload.repository?.owner?.username)
    || stringValue(payload.repository?.owner?.login)
    || stringValue(payload.repository?.owner?.name)
    || stringValue(payload.repository?.full_name)?.split('/')[0]
  if (!owner || !name) return null
  return { owner, name }
}

function mergeCommitSha(payload: ForgejoPullRequestWebhook): string | null {
  return stringValue(payload.pull_request?.merge_commit_sha)
    || stringValue(payload.pull_request?.merge_commit_id)
    || stringValue(payload.pull_request?.merged_commit_id)
    || null
}

function senderName(payload: ForgejoPullRequestWebhook): string | null {
  return stringValue(payload.sender?.username)
    || stringValue(payload.sender?.login)
    || stringValue(payload.sender?.name)
    || null
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null
}
