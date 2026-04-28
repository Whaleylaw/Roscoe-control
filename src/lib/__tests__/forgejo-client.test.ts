import Database from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createForgejoClient } from '@/lib/forgejo-client'
import { runMigrations } from '../migrations'

const hoisted = vi.hoisted(() => ({
  dbRef: { current: null as Database.Database | null },
  auditSpy: (() => vi.fn())(),
}))

vi.mock('@/lib/auth', () => ({
  requireRole: () => ({
    user: { id: 1, username: 'admin' },
  }),
}))

vi.mock('@/lib/db', () => ({
  getDatabase: () => {
    if (!hoisted.dbRef.current) throw new Error('test did not initialise dbRef')
    return hoisted.dbRef.current
  },
  logAuditEvent: hoisted.auditSpy,
}))

vi.mock('@/lib/rate-limit', () => ({
  mutationLimiter: () => null,
}))

vi.mock('@/lib/validation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/validation')>()
  return {
    ...actual,
    validateBody: async (request: Request) => ({ data: await request.json() }),
  }
})

import { DELETE, GET, PUT } from '@/app/api/settings/route'

function createSettingsDb() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  runMigrations(db)
  hoisted.dbRef.current = db
  return db
}

function seedSetting(key: string, value: string) {
  if (!hoisted.dbRef.current) throw new Error('dbRef not set')
  hoisted.dbRef.current
    .prepare(
      `INSERT OR REPLACE INTO settings (key, value, category, updated_at) VALUES (?, ?, 'runtime', unixepoch())`,
    )
    .run(key, value)
}

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
      headSha: null,
      base: 'codex/complete-workflow-v2',
      baseSha: null,
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

describe('settings route Forgejo token handling', () => {
  afterEach(() => {
    hoisted.dbRef.current?.close()
    hoisted.dbRef.current = null
    hoisted.auditSpy.mockReset()
  })

  it('masks runtime.forgejo_token in GET responses while indicating it is set', async () => {
    createSettingsDb()
    seedSetting('runtime.forgejo_token', 'real-token-secret')

    const response = await GET(new Request('http://localhost/api/settings') as any)
    const json = await response.json()
    const tokenSetting = json.settings.find(
      (setting: { key: string }) => setting.key === 'runtime.forgejo_token',
    )

    expect(tokenSetting.value).toBe('********')
    expect(JSON.stringify(json)).not.toContain('real-token-secret')
  })

  it('returns an empty Forgejo token value in GET when no token is stored', async () => {
    createSettingsDb()

    const response = await GET(new Request('http://localhost/api/settings') as any)
    const json = await response.json()
    const tokenSetting = json.settings.find(
      (setting: { key: string }) => setting.key === 'runtime.forgejo_token',
    )

    expect(tokenSetting.value).toBe('')
  })

  it('preserves the stored Forgejo token when PUT receives the masked sentinel', async () => {
    createSettingsDb()
    seedSetting('runtime.forgejo_token', 'real-token-secret')

    const response = await PUT(
      new Request('http://localhost/api/settings', {
        method: 'PUT',
        body: JSON.stringify({ settings: { 'runtime.forgejo_token': '********' } }),
      }) as any,
    )
    expect(response.status).toBe(200)

    const row = hoisted.dbRef.current
      ?.prepare(`SELECT value FROM settings WHERE key = 'runtime.forgejo_token'`)
      .get() as { value: string }
    expect(row.value).toBe('real-token-secret')
  })

  it('masks Forgejo token values in PUT audit details', async () => {
    createSettingsDb()
    seedSetting('runtime.forgejo_token', 'old-token-secret')

    await PUT(
      new Request('http://localhost/api/settings', {
        method: 'PUT',
        body: JSON.stringify({ settings: { 'runtime.forgejo_token': 'new-token-secret' } }),
      }) as any,
    )

    const auditPayload = hoisted.auditSpy.mock.calls.at(-1)?.[0]
    expect(auditPayload.detail.changes['runtime.forgejo_token']).toEqual({
      old: '********',
      new: '********',
    })
    expect(JSON.stringify(auditPayload)).not.toContain('old-token-secret')
    expect(JSON.stringify(auditPayload)).not.toContain('new-token-secret')
  })

  it('masks Forgejo token values in DELETE reset audit details', async () => {
    createSettingsDb()
    seedSetting('runtime.forgejo_token', 'reset-token-secret')

    const response = await DELETE(
      new Request('http://localhost/api/settings', {
        method: 'DELETE',
        body: JSON.stringify({ key: 'runtime.forgejo_token' }),
      }) as any,
    )
    expect(response.status).toBe(200)

    const auditPayload = hoisted.auditSpy.mock.calls.at(-1)?.[0]
    expect(auditPayload.detail).toEqual({
      key: 'runtime.forgejo_token',
      old_value: '********',
    })
    expect(JSON.stringify(auditPayload)).not.toContain('reset-token-secret')
  })
})
