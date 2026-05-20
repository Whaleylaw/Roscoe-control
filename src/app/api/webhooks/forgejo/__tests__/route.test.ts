import { createHmac } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const routeMocks = vi.hoisted(() => ({
  db: { label: 'test-db' },
  forgejoWebhookSecret: 'webhook-secret',
  handleForgejoReviewPrWebhook: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  getDatabase: () => routeMocks.db,
}))

vi.mock('@/lib/task-runtime-settings', () => ({
  getReviewPrSettings: () => ({
    provider: 'forgejo',
    remoteName: 'forgejo',
    forgejoBaseUrl: 'http://localhost:3001',
    forgejoToken: 'token',
    forgejoWebhookSecret: routeMocks.forgejoWebhookSecret,
    autoCreate: true,
  }),
}))

vi.mock('@/lib/review-prs', () => ({
  handleForgejoReviewPrWebhook: routeMocks.handleForgejoReviewPrWebhook,
}))

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn() },
}))

const { POST } = await import('../route')

function signedRequest(payload: unknown, input: { secret?: string; event?: string; signatureHeader?: string } = {}): NextRequest {
  const body = JSON.stringify(payload)
  const secret = input.secret ?? routeMocks.forgejoWebhookSecret
  const signature = createHmac('sha256', secret).update(body).digest('hex')
  return new NextRequest('http://localhost/api/webhooks/forgejo', {
    method: 'POST',
    body,
    headers: {
      'content-type': 'application/json',
      'x-gitea-event': input.event ?? 'pull_request',
      [input.signatureHeader ?? 'x-gitea-signature']: signature,
    },
  })
}

beforeEach(() => {
  routeMocks.forgejoWebhookSecret = 'webhook-secret'
  routeMocks.handleForgejoReviewPrWebhook.mockReset()
  routeMocks.handleForgejoReviewPrWebhook.mockReturnValue({
    matched: true,
    task_id: 2187,
    action: 'merged',
  })
})

describe('POST /api/webhooks/forgejo', () => {
  it('marks a matching review PR merged when Forgejo sends a merged pull request webhook', async () => {
    const response = await POST(signedRequest({
      action: 'closed',
      repository: {
        owner: { username: 'aaron' },
        name: 'FirmVault',
      },
      pull_request: {
        number: 30,
        merged: true,
        state: 'closed',
        merge_commit_sha: 'abc123',
      },
      sender: { username: 'aaron' },
    }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(routeMocks.handleForgejoReviewPrWebhook).toHaveBeenCalledWith(routeMocks.db, {
      repoOwner: 'aaron',
      repoName: 'FirmVault',
      prNumber: 30,
      action: 'merged',
      actor: 'forgejo-webhook:aaron',
      mergeCommitSha: 'abc123',
    })
    expect(body).toEqual({
      success: true,
      matched: true,
      task_id: 2187,
      action: 'merged',
    })
  })

  it('records a closed review PR without marking the task done when it was not merged', async () => {
    routeMocks.handleForgejoReviewPrWebhook.mockReturnValue({
      matched: true,
      task_id: 2187,
      action: 'closed',
    })

    const response = await POST(signedRequest({
      action: 'closed',
      repository: { full_name: 'aaron/FirmVault', name: 'FirmVault' },
      pull_request: { number: 30, merged: false, state: 'closed' },
    }))

    expect(response.status).toBe(200)
    expect(routeMocks.handleForgejoReviewPrWebhook).toHaveBeenCalledWith(routeMocks.db, {
      repoOwner: 'aaron',
      repoName: 'FirmVault',
      prNumber: 30,
      action: 'closed',
      actor: 'forgejo-webhook',
      mergeCommitSha: null,
    })
  })

  it('rejects unsigned or mismatched payloads', async () => {
    const response = await POST(signedRequest(
      {
        action: 'closed',
        repository: { full_name: 'aaron/FirmVault', name: 'FirmVault' },
        pull_request: { number: 30, merged: true },
      },
      { secret: 'wrong-secret' },
    ))

    expect(response.status).toBe(401)
    expect(routeMocks.handleForgejoReviewPrWebhook).not.toHaveBeenCalled()
  })

  it('requires the webhook secret setting', async () => {
    routeMocks.forgejoWebhookSecret = ''

    const response = await POST(signedRequest({
      action: 'closed',
      repository: { full_name: 'aaron/FirmVault', name: 'FirmVault' },
      pull_request: { number: 30, merged: true },
    }, { secret: '' }))

    expect(response.status).toBe(503)
    expect(routeMocks.handleForgejoReviewPrWebhook).not.toHaveBeenCalled()
  })
})
