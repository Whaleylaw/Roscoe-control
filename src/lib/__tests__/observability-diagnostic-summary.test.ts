import { describe, expect, it } from 'vitest'
import { buildObservabilityDiagnosticSummary } from '@/lib/observability-diagnostic-summary'

describe('buildObservabilityDiagnosticSummary', () => {
  it('renders a bounded diagnostic summary from redacted snapshot data', () => {
    const summary = buildObservabilityDiagnosticSummary({
      generatedAt: '2026-05-19T18:00:00Z',
      snapshotSource: 'server',
      snapshot: {
        status: 'degraded',
        hermes: { profileCount: 3, gatewaysHealthy: 2, gatewaysDown: 1 },
        cron: { jobCount: 4, enabledCount: 3, failureCount: 1 },
      },
      signals: [
        { label: 'Errors', value: '1', detail: '1 cron failure', tone: 'warn' },
        { label: 'Traffic', value: '2/3', detail: 'Hermes gateways healthy', tone: 'good' },
      ],
      detailKind: 'logs',
      detail: {
        filesScanned: 2,
        truncated: true,
        entries: [
          { level: 'error', source: 'mission-control.log', message: 'failed with [REDACTED]' },
          { level: 'info', source: 'mission-control.log', message: 'boot ok' },
        ],
      },
    })

    expect(summary).toContain('Mission Control observability diagnostic')
    expect(summary).toContain('Source: server')
    expect(summary).toContain('Errors: 1 [warn]')
    expect(summary).toContain('Hermes: 2 healthy')
    expect(summary).toContain('Logs detail: 2 files scanned · 1 errors')
    expect(summary).toContain('[REDACTED]')
  })

  it('normalizes multiline values and includes memory guardrails', () => {
    const summary = buildObservabilityDiagnosticSummary({
      snapshotSource: 'client-fallback',
      signals: [{ label: 'Queue', value: '0', detail: 'no\nbacklog', tone: 'good' }],
      detailKind: 'memory',
      detail: {
        caseScopedProfiles: 1,
        honchoLocal: { status: 'down' },
        honchoGlobal: { note: 'remote/global Honcho content is not probed' },
        profiles: [{ name: 'paralegal', restricted: true }],
      },
    })

    expect(summary).toContain('Source: client-fallback')
    expect(summary).toContain('no backlog')
    expect(summary).toContain('Memory detail: 1 profiles · 1 restricted · local Honcho down')
    expect(summary).toContain('no case/client memory excerpts included')
  })
})
