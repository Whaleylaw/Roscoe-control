import { describe, expect, it } from 'vitest'
import {
  gcShouldDestroy,
  planDestroy,
  type TerminalRow,
} from '../runner-gc'

const SECONDS_PER_DAY = 86_400

// Fixed reference instant so window arithmetic is deterministic across
// runs. Chosen to avoid wall-clock drift between `new Date()` calls.
const NOW = 1_700_000_000
const WINDOW_DAYS = 7
const WINDOW_SECONDS = WINDOW_DAYS * SECONDS_PER_DAY

describe('gcShouldDestroy', () => {
  it('WORK-07: done status returns true regardless of terminal_at age', () => {
    const ancient: TerminalRow = {
      task_id: 1,
      status: 'done',
      terminal_at: NOW - 365 * SECONDS_PER_DAY,
    }
    const fresh: TerminalRow = {
      task_id: 2,
      status: 'done',
      terminal_at: NOW,
    }
    expect(gcShouldDestroy(ancient, NOW, WINDOW_DAYS)).toBe(true)
    expect(gcShouldDestroy(fresh, NOW, WINDOW_DAYS)).toBe(true)
  })

  it('cancelled status returns true regardless of age', () => {
    const ancient: TerminalRow = {
      task_id: 3,
      status: 'cancelled',
      terminal_at: NOW - 365 * SECONDS_PER_DAY,
    }
    const fresh: TerminalRow = {
      task_id: 4,
      status: 'cancelled',
      terminal_at: NOW,
    }
    expect(gcShouldDestroy(ancient, NOW, WINDOW_DAYS)).toBe(true)
    expect(gcShouldDestroy(fresh, NOW, WINDOW_DAYS)).toBe(true)
  })

  it('failed status within window returns false', () => {
    // Failed 3 days ago, window is 7 — keep.
    const row: TerminalRow = {
      task_id: 5,
      status: 'failed',
      terminal_at: NOW - 3 * SECONDS_PER_DAY,
    }
    expect(gcShouldDestroy(row, NOW, WINDOW_DAYS)).toBe(false)
  })

  it('failed status at exact window boundary (age == windowSeconds) returns true', () => {
    // age >= windowSeconds is the gate; equality flips to destroy.
    const row: TerminalRow = {
      task_id: 6,
      status: 'failed',
      terminal_at: NOW - WINDOW_SECONDS,
    }
    expect(gcShouldDestroy(row, NOW, WINDOW_DAYS)).toBe(true)
  })

  it('failed status beyond window returns true', () => {
    const row: TerminalRow = {
      task_id: 7,
      status: 'failed',
      terminal_at: NOW - (WINDOW_SECONDS + 1),
    }
    expect(gcShouldDestroy(row, NOW, WINDOW_DAYS)).toBe(true)
  })

  it('unknown status returns false (defensive)', () => {
    // Cast through unknown: the type narrows status to the three literals,
    // but at runtime a misrouted upstream row could carry a different value
    // and must NOT accidentally be destroyed.
    const row = {
      task_id: 8,
      status: 'running' as unknown,
      terminal_at: NOW - 365 * SECONDS_PER_DAY,
    } as TerminalRow
    expect(gcShouldDestroy(row, NOW, WINDOW_DAYS)).toBe(false)
  })
})

describe('planDestroy', () => {
  it('preserves ordering and filters correctly', () => {
    const rows: TerminalRow[] = [
      { task_id: 10, status: 'done', terminal_at: NOW },
      // failed within window — filtered out
      { task_id: 11, status: 'failed', terminal_at: NOW - 3 * SECONDS_PER_DAY },
      // failed aged out — kept as 'failed-aged-out'
      { task_id: 12, status: 'failed', terminal_at: NOW - (WINDOW_SECONDS + 1) },
      { task_id: 13, status: 'cancelled', terminal_at: NOW - SECONDS_PER_DAY },
    ]
    const plan = planDestroy(rows, NOW, WINDOW_DAYS)
    expect(plan).toEqual([
      { task_id: 10, reason: 'terminal-immediate' },
      { task_id: 12, reason: 'failed-aged-out' },
      { task_id: 13, reason: 'terminal-immediate' },
    ])
  })
})
