import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  collectObservabilityCronDetail,
  collectObservabilityLogsDetail,
  collectObservabilityMemoryDetail,
  isLocalHttpUrl,
  parseGatewayPid,
  redactObservabilityValue,
} from '@/lib/observability'

const tempDirs: string[] = []

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-observability-test-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe('observability safety primitives', () => {
  it('refuses non-local HTTP probe targets', () => {
    expect(isLocalHttpUrl('http://127.0.0.1:8642/health')).toBe(true)
    expect(isLocalHttpUrl('http://localhost:8000/health')).toBe(true)
    expect(isLocalHttpUrl('https://example.com/health')).toBe(false)
    expect(isLocalHttpUrl('file:///tmp/status')).toBe(false)
  })

  it('redacts secret-shaped keys and values', () => {
    const redacted = redactObservabilityValue({
      ok: 'normal text',
      token: 'xoxb-s...oken',
      nested: { apiKey: 'sk-abc...3456' },
    }) as { ok: string; token: string; nested: { apiKey: string } }

    expect(redacted.ok).toBe('normal text')
    expect(redacted.token).toBe('[REDACTED]')
    expect(redacted.nested.apiKey).toBe('[REDACTED]')
  })

  it('parses plain and JSON gateway pid files without preserving extra metadata', () => {
    expect(parseGatewayPid('12345\n')).toEqual({ pid: 12345, metadata: {} })
    expect(parseGatewayPid('{"pid":23456,"host":"127.0.0.1","token":"secret"}')).toEqual({
      pid: 23456,
      metadata: { host: '127.0.0.1' },
    })
  })
})

describe('observability detail collectors', () => {
  it('summarizes cron jobs without exposing prompts, scripts, or full delivery targets', () => {
    const home = tempDir()
    fs.mkdirSync(path.join(home, 'cron'), { recursive: true })
    fs.writeFileSync(path.join(home, 'cron', 'jobs.json'), JSON.stringify({
      jobs: [
        {
          id: 'case-email-heartbeat',
          name: 'Case Email Heartbeat',
          enabled: true,
          schedule: '*/15 * * * *',
          prompt: 'secret prompt body should not appear',
          script: '/tmp/secret-script.py',
          delivery: 'slack:CSECRETCHANNEL',
          last_status: 'ok',
        },
        {
          id: 'broken-job',
          enabled: false,
          schedule: { expr: '0 9 * * *', tz: 'America/New_York' },
          last_error: 'xoxb-secret-token should be redacted',
        },
      ],
    }))

    const detail = collectObservabilityCronDetail({ hermesHome: home })
    const serialized = JSON.stringify(detail)

    expect(detail.counts).toMatchObject({ total: 2, enabled: 1, paused: 1, failures: 1 })
    expect(detail.jobs[0]).toMatchObject({ id: 'case-email-heartbeat', deliveryMode: 'slack' })
    expect(detail.jobs[1].timezone).toBe('America/New_York')
    expect(serialized).not.toContain('secret prompt body')
    expect(serialized).not.toContain('/tmp/secret-script.py')
    expect(serialized).not.toContain('CSECRETCHANNEL')
    expect(serialized).toContain('[REDACTED]')
  })

  it('tails bounded log entries and redacts secret values', () => {
    const root = tempDir()
    fs.writeFileSync(path.join(root, 'mission-control.log'), [
      '2026-05-19T17:00:00Z info boot ok',
      '2026-05-19T17:01:00Z error failed with token xoxb-secret-token',
      '2026-05-19T17:02:00Z warning degraded but bounded',
    ].join('\n'))

    const detail = collectObservabilityLogsDetail({ roots: [root], limit: 2 })
    const serialized = JSON.stringify(detail)

    expect(detail.filesScanned).toBe(1)
    expect(detail.entries).toHaveLength(2)
    expect(detail.entries.some((entry) => entry.level === 'error')).toBe(true)
    expect(detail.truncated).toBe(true)
    expect(serialized).not.toContain('xoxb-secret-token')
    expect(serialized).toContain('[REDACTED]')
  })

  it('lists memory profile locations without reading case/client content', async () => {
    const home = tempDir()
    const profiles = path.join(home, 'profiles')
    fs.mkdirSync(path.join(profiles, 'paralegal', 'memory'), { recursive: true })
    fs.mkdirSync(path.join(profiles, 'default', 'sessions'), { recursive: true })
    fs.writeFileSync(path.join(profiles, 'paralegal', 'memory', 'client-note.txt'), 'do not expose client content')

    const detail = await collectObservabilityMemoryDetail({ hermesHome: home, timeoutMs: 1 })
    const serialized = JSON.stringify(detail)

    expect(detail.profiles).toHaveLength(2)
    expect(detail.caseScopedProfiles).toBe(1)
    expect(detail.profiles.find((profile) => profile.name === 'paralegal')?.restricted).toBe(true)
    expect(detail.safeguards.noHonchoContentPulled).toBe(true)
    expect(serialized).not.toContain('do not expose client content')
  })
})
