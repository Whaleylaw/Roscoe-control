/**
 * Phase 16 Plan 04 — RUI-03.
 *
 * ProgressTab orchestrates the live checkpoint timeline in the task detail
 * modal. Tests cover REST load, empty state, load error, SSE append via
 * `mc:checkpoint-added` DOM CustomEvent, SSE filtering by task_id, the
 * subscribe-before-fetch ordering invariant (Pitfall 6), de-duplication of
 * REST + SSE rows sharing an id, grouping across attempts with newest-first
 * sort, and collapse-by-default for older attempts.
 *
 * Harness strategy — we don't start a real EventSource; Plan 16-01's
 * dispatcher relays SSE frames as `mc:checkpoint-added` window events and
 * we simulate that relay with `window.dispatchEvent(new CustomEvent(...))`
 * directly. This keeps the test hermetic.
 */

import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, act, cleanup } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import messages from '../../../../../messages/en.json'
import { ProgressTab } from '../progress-tab'
import type { Checkpoint } from '../checkpoint-row'

function renderWithIntl(ui: ReactNode) {
  return render(
    <NextIntlClientProvider messages={messages as never} locale="en">
      {ui}
    </NextIntlClientProvider>
  )
}

/** Build a Checkpoint row inline. `task_id` default matches the taskId used in every test. */
function mkCheckpoint(overrides: Partial<Checkpoint> & { id: number; task_id?: number }): Checkpoint {
  return {
    id: overrides.id,
    task_id: overrides.task_id ?? 42,
    attempt: overrides.attempt ?? 1,
    step: overrides.step ?? `step_${overrides.id}`,
    summary: overrides.summary ?? `summary for ${overrides.id}`,
    status: overrides.status ?? 'completed',
    ts: overrides.ts ?? '2026-04-20T12:00:00Z',
    artifacts: overrides.artifacts,
    next_step: overrides.next_step,
    blocker_reason: overrides.blocker_reason,
    tokens_used: overrides.tokens_used,
    duration_ms: overrides.duration_ms,
  }
}

/** Minimal fetch stub — returns one resolved response. */
function stubFetchOnce(data: { checkpoints: Checkpoint[] }, ok = true, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => data,
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/** Deferred fetch — caller controls when it resolves (tests the subscribe-before-fetch ordering). */
function stubFetchDeferred(data: { checkpoints: Checkpoint[] }) {
  let resolve!: (_: unknown) => void
  const p = new Promise((r) => {
    resolve = r
  })
  const fetchMock = vi.fn().mockImplementation(() => p.then(() => ({
    ok: true,
    status: 200,
    json: async () => data,
  })))
  vi.stubGlobal('fetch', fetchMock)
  return { fetchMock, release: () => resolve(null) }
}

function dispatchCheckpoint(detail: Checkpoint) {
  act(() => {
    window.dispatchEvent(new CustomEvent('mc:checkpoint-added', { detail }))
  })
}

describe('ProgressTab (RUI-03)', () => {
  beforeEach(() => {
    vi.useRealTimers()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    cleanup()
  })

  it('loads checkpoints from REST and renders them', async () => {
    const c1 = mkCheckpoint({ id: 1, step: 'install' })
    const c2 = mkCheckpoint({ id: 2, step: 'build' })
    const fetchMock = stubFetchOnce({ checkpoints: [c1, c2] })

    renderWithIntl(<ProgressTab taskId={42} />)

    await waitFor(() => {
      expect(screen.getByText('install')).toBeInTheDocument()
      expect(screen.getByText('build')).toBeInTheDocument()
    })
    expect(fetchMock).toHaveBeenCalledWith('/api/tasks/42/checkpoints')
  })

  it('empty REST response → empty state text', async () => {
    stubFetchOnce({ checkpoints: [] })
    renderWithIntl(<ProgressTab taskId={42} />)
    await waitFor(() => {
      expect(screen.getByText(messages.taskBoard.progressTab.empty)).toBeInTheDocument()
    })
  })

  it('500 response → loadError text rendered', async () => {
    stubFetchOnce({ checkpoints: [] }, false, 500)
    renderWithIntl(<ProgressTab taskId={42} />)
    await waitFor(() => {
      expect(screen.getByText(messages.taskBoard.progressTab.loadError)).toBeInTheDocument()
    })
  })

  it('SSE append — mc:checkpoint-added event adds a new row', async () => {
    const seed = mkCheckpoint({ id: 1, step: 'install' })
    stubFetchOnce({ checkpoints: [seed] })
    renderWithIntl(<ProgressTab taskId={42} />)

    await waitFor(() => expect(screen.getByText('install')).toBeInTheDocument())

    dispatchCheckpoint(mkCheckpoint({ id: 99, step: 'deploy' }))

    await waitFor(() => expect(screen.getByText('deploy')).toBeInTheDocument())
    expect(screen.getByText('install')).toBeInTheDocument()
  })

  it('SSE filter — event for a different task_id is ignored', async () => {
    stubFetchOnce({ checkpoints: [mkCheckpoint({ id: 1, step: 'install' })] })
    renderWithIntl(<ProgressTab taskId={42} />)

    await waitFor(() => expect(screen.getByText('install')).toBeInTheDocument())

    dispatchCheckpoint(mkCheckpoint({ id: 999, task_id: 999, step: 'should_not_appear' }))

    // Short delay to give any leaked state update a chance to flush.
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByText('should_not_appear')).not.toBeInTheDocument()
  })

  it('SSE-before-fetch — event during in-flight fetch is retained after fetch resolves', async () => {
    const eventCp = mkCheckpoint({ id: 50, step: 'mid_flight' })
    const fetchedCp = mkCheckpoint({ id: 1, step: 'install' })
    const { release } = stubFetchDeferred({ checkpoints: [fetchedCp] })

    renderWithIntl(<ProgressTab taskId={42} />)

    // Fire the SSE event BEFORE we let the fetch resolve — ProgressTab must
    // have subscribed already (subscribe-before-fetch invariant). The event
    // should land in state and survive the fetch merge.
    dispatchCheckpoint(eventCp)

    // Now let the fetch complete. The merge must keep both.
    act(() => release())

    await waitFor(() => {
      expect(screen.getByText('mid_flight')).toBeInTheDocument()
      expect(screen.getByText('install')).toBeInTheDocument()
    })
  })

  it('de-duplicates rows with the same id between REST and SSE', async () => {
    const shared = mkCheckpoint({ id: 10, step: 'shared_step' })
    stubFetchOnce({ checkpoints: [shared] })
    renderWithIntl(<ProgressTab taskId={42} />)

    await waitFor(() => expect(screen.getByText('shared_step')).toBeInTheDocument())

    dispatchCheckpoint({ ...shared, summary: 'updated summary' })

    await waitFor(() => expect(screen.getByText('updated summary')).toBeInTheDocument())
    // Still exactly one row visible for this step (id-keyed Map, not duplicated).
    expect(screen.getAllByTestId('checkpoint-row')).toHaveLength(1)
  })

  it('groups by attempt with newest attempt first', async () => {
    stubFetchOnce({
      checkpoints: [
        mkCheckpoint({ id: 1, attempt: 1, step: 'a1' }),
        mkCheckpoint({ id: 2, attempt: 2, step: 'a2' }),
        mkCheckpoint({ id: 3, attempt: 3, step: 'a3' }),
      ],
    })

    renderWithIntl(<ProgressTab taskId={42} />)

    await waitFor(() => expect(screen.getByTestId('attempt-3')).toBeInTheDocument())

    const sections = screen.getAllByTestId(/^attempt-\d+$/)
    const attemptNums = sections.map((el) =>
      Number(el.getAttribute('data-testid')!.replace('attempt-', ''))
    )
    expect(attemptNums).toEqual([3, 2, 1])
  })

  it('collapses all but the latest attempt by default', async () => {
    stubFetchOnce({
      checkpoints: [
        mkCheckpoint({ id: 1, attempt: 1, step: 'old_attempt' }),
        mkCheckpoint({ id: 2, attempt: 2, step: 'latest_attempt' }),
      ],
    })

    renderWithIntl(<ProgressTab taskId={42} />)

    await waitFor(() => expect(screen.getByText('latest_attempt')).toBeInTheDocument())

    // Older attempt is collapsed → its rows container is absent.
    expect(screen.queryByTestId('attempt-1-rows')).not.toBeInTheDocument()
    expect(screen.getByTestId('attempt-2-rows')).toBeInTheDocument()
  })

  it('sorts newest-first (id DESC) within an attempt', async () => {
    stubFetchOnce({
      checkpoints: [
        mkCheckpoint({ id: 5, attempt: 1, step: 'step_id_5' }),
        mkCheckpoint({ id: 7, attempt: 1, step: 'step_id_7' }),
      ],
    })

    renderWithIntl(<ProgressTab taskId={42} />)

    await waitFor(() => expect(screen.getByText('step_id_7')).toBeInTheDocument())

    const rowsContainer = screen.getByTestId('attempt-1-rows')
    const rowIds = Array.from(
      rowsContainer.querySelectorAll('[data-testid="checkpoint-row"]')
    ).map((el) => el.getAttribute('data-checkpoint-id'))
    expect(rowIds).toEqual(['7', '5'])
  })

  it('blocked checkpoint shows red-bordered row and blocker_reason text', async () => {
    stubFetchOnce({
      checkpoints: [
        mkCheckpoint({ id: 1, status: 'blocked', blocker_reason: 'Missing credential' }),
      ],
    })

    renderWithIntl(<ProgressTab taskId={42} />)

    await waitFor(() => {
      const row = screen.getByTestId('checkpoint-row')
      expect(row).toHaveClass('border-red-500/40')
      expect(row).toHaveAttribute('data-status', 'blocked')
      expect(screen.getByText(/Missing credential/)).toBeInTheDocument()
    })
  })
})
