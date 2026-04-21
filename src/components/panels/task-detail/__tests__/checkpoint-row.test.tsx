/**
 * Phase 16 Plan 04 — RUI-03.
 *
 * CheckpointRow renders one checkpoint in the Progress tab timeline. Tests
 * cover the status dot + border variants (completed/in_progress/blocked),
 * the blocker_reason rendering path, artifact glyph mapping for all 6
 * kinds, URL artifact anchor behavior, and the tokens/duration bottom row.
 *
 * Test harness: NextIntlClientProvider with the real en.json so the
 * `taskBoard.progressTab.*` keys resolve as shipped; any drift between
 * the seeded key set and the component's calls surfaces here.
 */

import type { ReactNode } from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import messages from '../../../../../messages/en.json'
import { CheckpointRow, type Checkpoint } from '../checkpoint-row'

function renderWithIntl(ui: ReactNode) {
  return render(
    <NextIntlClientProvider messages={messages as never} locale="en">
      {ui}
    </NextIntlClientProvider>
  )
}

function baseCheckpoint(overrides: Partial<Checkpoint> = {}): Checkpoint {
  return {
    id: 1,
    task_id: 42,
    attempt: 1,
    step: 'build',
    summary: 'Compiled project',
    status: 'completed',
    ts: '2026-04-20T12:00:00Z',
    ...overrides,
  }
}

describe('CheckpointRow (RUI-03)', () => {
  it('renders step + summary + ISO timestamp', () => {
    renderWithIntl(
      <CheckpointRow
        checkpoint={baseCheckpoint({
          step: 'install_deps',
          summary: 'pnpm install ok',
          ts: '2026-04-20T11:00:00Z',
        })}
      />
    )
    expect(screen.getByText('install_deps')).toBeInTheDocument()
    expect(screen.getByText('pnpm install ok')).toBeInTheDocument()
    expect(screen.getByText('2026-04-20T11:00:00Z')).toBeInTheDocument()
  })

  it('completed status → green dot class, no red border', () => {
    renderWithIntl(<CheckpointRow checkpoint={baseCheckpoint({ status: 'completed' })} />)
    const dot = screen.getByTestId('checkpoint-status-dot')
    expect(dot).toHaveClass('bg-green-500')
    expect(screen.getByTestId('checkpoint-row')).not.toHaveClass('border-red-500/40')
  })

  it('in_progress status → blue dot with animate-pulse class', () => {
    renderWithIntl(<CheckpointRow checkpoint={baseCheckpoint({ status: 'in_progress' })} />)
    const dot = screen.getByTestId('checkpoint-status-dot')
    expect(dot).toHaveClass('bg-blue-500', 'animate-pulse')
  })

  it('blocked status → red dot + red border + blocker_reason rendered under blockerPrefix label', () => {
    renderWithIntl(
      <CheckpointRow
        checkpoint={baseCheckpoint({
          status: 'blocked',
          blocker_reason: 'Need API key',
        })}
      />
    )
    const dot = screen.getByTestId('checkpoint-status-dot')
    expect(dot).toHaveClass('bg-red-500')
    expect(screen.getByTestId('checkpoint-row')).toHaveClass('border-red-500/40')
    expect(screen.getByText('Blocked:')).toBeInTheDocument()
    expect(screen.getByText(/Need API key/)).toBeInTheDocument()
  })

  it('blocked status WITHOUT blocker_reason → no blocker paragraph', () => {
    renderWithIntl(
      <CheckpointRow
        checkpoint={baseCheckpoint({ status: 'blocked', blocker_reason: undefined })}
      />
    )
    expect(screen.queryByText('Blocked:')).not.toBeInTheDocument()
  })

  it('renders all 6 artifact kinds with their glyphs', () => {
    renderWithIntl(
      <CheckpointRow
        checkpoint={baseCheckpoint({
          artifacts: [
            { kind: 'file', path: 'src/index.ts' },
            { kind: 'url', url: 'https://example.test/report' },
            { kind: 'diff', path: 'patch.diff' },
            { kind: 'test_result', path: 'junit.xml' },
            { kind: 'comment', summary: 'Inline note' },
            { kind: 'other', path: 'custom.log' },
          ],
        })}
      />
    )
    expect(screen.getByText('📄 src/index.ts')).toBeInTheDocument()
    expect(screen.getByText('🔗 https://example.test/report')).toBeInTheDocument()
    expect(screen.getByText('📝 patch.diff')).toBeInTheDocument()
    expect(screen.getByText('✅ junit.xml')).toBeInTheDocument()
    expect(screen.getByText('💬 Inline note')).toBeInTheDocument()
    expect(screen.getByText('✨ custom.log')).toBeInTheDocument()
  })

  it('URL artifacts render as <a target="_blank" rel="noreferrer">', () => {
    renderWithIntl(
      <CheckpointRow
        checkpoint={baseCheckpoint({
          artifacts: [{ kind: 'url', url: 'https://example.test/foo' }],
        })}
      />
    )
    const anchor = screen.getByRole('link', { name: /https:\/\/example\.test\/foo/ })
    expect(anchor).toHaveAttribute('href', 'https://example.test/foo')
    expect(anchor).toHaveAttribute('target', '_blank')
    expect(anchor).toHaveAttribute('rel', 'noreferrer')
  })

  it('tokens_used and duration_ms render in bottom row', () => {
    renderWithIntl(
      <CheckpointRow
        checkpoint={baseCheckpoint({ tokens_used: 1234, duration_ms: 567 })}
      />
    )
    expect(screen.getByText(/1,?234 tokens/)).toBeInTheDocument()
    expect(screen.getByText(/567 ms/)).toBeInTheDocument()
  })

  it('no tokens/duration → bottom row omitted', () => {
    const { container } = renderWithIntl(
      <CheckpointRow
        checkpoint={baseCheckpoint({ tokens_used: undefined, duration_ms: undefined })}
      />
    )
    expect(container.textContent).not.toMatch(/tokens/)
    expect(container.textContent).not.toMatch(/\bms\b/)
  })

  it('only tokens_used set → duration row absent; tokens visible', () => {
    renderWithIntl(<CheckpointRow checkpoint={baseCheckpoint({ tokens_used: 99 })} />)
    expect(screen.getByText(/99 tokens/)).toBeInTheDocument()
    expect(screen.queryByText(/\bms\b/)).not.toBeInTheDocument()
  })
})
