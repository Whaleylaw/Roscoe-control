import { afterEach, describe, expect, it, vi } from 'vitest'
import { createForgejoClient } from '@/lib/forgejo-client'

describe('forgejo client', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('creates a pull request with the Gitea-compatible API', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            number: 7,
            html_url: 'http://localhost:3001/aaron/FirmVault/pulls/7',
            state: 'open',
            head: { ref: 'mc/task-2112' },
            base: { ref: 'codex/complete-workflow-v2' },
          }),
          { status: 201, headers: { 'content-type': 'application/json' } },
        ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const client = createForgejoClient({ baseUrl: 'http://localhost:3001', token: 'secret' })
    const pr = await client.createPullRequest({
      owner: 'aaron',
      repo: 'FirmVault',
      title: 'Task 2112',
      body: 'Review task 2112',
      head: 'mc/task-2112',
      base: 'codex/complete-workflow-v2',
    })

    expect(pr).toEqual({
      number: 7,
      url: 'http://localhost:3001/aaron/FirmVault/pulls/7',
      state: 'open',
      head: 'mc/task-2112',
      base: 'codex/complete-workflow-v2',
      mergeCommitSha: null,
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3001/api/v1/repos/aaron/FirmVault/pulls',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          authorization: 'token secret',
          accept: 'application/json',
          'content-type': 'application/json',
        }),
        body: JSON.stringify({
          title: 'Task 2112',
          body: 'Review task 2112',
          head: 'mc/task-2112',
          base: 'codex/complete-workflow-v2',
        }),
      }),
    )
  })

  it('reads merged pull request state', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              number: 7,
              html_url: 'http://localhost:3001/aaron/FirmVault/pulls/7',
              state: 'closed',
              merged: true,
              merge_commit_sha: 'abc123',
              head: { ref: 'mc/task-2112' },
              base: { ref: 'codex/complete-workflow-v2' },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
      ),
    )

    const client = createForgejoClient({ baseUrl: 'http://localhost:3001', token: 'secret' })
    const pr = await client.getPullRequest({ owner: 'aaron', repo: 'FirmVault', number: 7 })

    expect(pr).toMatchObject({
      state: 'merged',
      mergeCommitSha: 'abc123',
    })
  })
})
