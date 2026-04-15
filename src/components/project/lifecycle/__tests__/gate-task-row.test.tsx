import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

// Covers: GSD-22.
// GateTaskRow renders one gate-required task with an inline
// Approve/Reject control set (operators only) and a keyboard-accessible
// destructive-confirmation flow for rejection.

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => `lifecycle.${key}`,
}))

import { GateTaskRow } from '@/components/project/lifecycle/gate-task-row'

const baseTask = {
  id: 101,
  title: 'Review architecture decision',
  ticket_ref: 'GSD-42',
  gate_status: 'pending' as const,
  gate_required: 1 as const,
  project_id: 1,
  status: 'review' as const,
  priority: 'medium' as const,
  created_at: 0,
  updated_at: 0,
  created_by: 'aaron',
}

afterEach(() => cleanup())

describe('GateTaskRow (GSD-22)', () => {
  it('operator sees Approve + Reject buttons with aria-label containing ticket_ref', () => {
    render(
      <GateTaskRow
        task={baseTask as any}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        isViewer={false}
      />
    )
    const approve = screen.getByRole('button', { name: /Approve gate for GSD-42/i })
    const reject = screen.getByRole('button', { name: /Reject gate for GSD-42/i })
    expect(approve).toBeTruthy()
    expect(reject).toBeTruthy()
  })

  it('viewer sees row + status pill but no Approve/Reject buttons', () => {
    render(
      <GateTaskRow
        task={baseTask as any}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        isViewer={true}
      />
    )
    expect(screen.getByText('GSD-42')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Approve gate/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /Reject gate/i })).toBeNull()
  })

  it('clicking Reject reveals inline note input + Confirm reject (destructive) + Cancel', () => {
    render(
      <GateTaskRow
        task={baseTask as any}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        isViewer={false}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /Reject gate for GSD-42/i }))
    // note input becomes visible
    const input = screen.getByPlaceholderText(/lifecycle\.gate\.rejectNotePlaceholder/)
    expect(input).toBeTruthy()
    // Confirm reject + Cancel buttons render
    expect(screen.getByRole('button', { name: /lifecycle\.gate\.rejectConfirmSubmit/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /lifecycle\.cta\.cancel/ })).toBeTruthy()
  })

  it('pressing Escape on note input cancels (returns row to initial state)', () => {
    render(
      <GateTaskRow
        task={baseTask as any}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        isViewer={false}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /Reject gate for GSD-42/i }))
    const input = screen.getByPlaceholderText(/lifecycle\.gate\.rejectNotePlaceholder/)
    fireEvent.keyDown(input, { key: 'Escape' })
    // back to idle: Approve/Reject buttons visible again
    expect(screen.getByRole('button', { name: /Approve gate for GSD-42/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Reject gate for GSD-42/i })).toBeTruthy()
    // note input gone
    expect(screen.queryByPlaceholderText(/lifecycle\.gate\.rejectNotePlaceholder/)).toBeNull()
  })

  it('clicking Confirm reject invokes onReject with task id and note', async () => {
    const onReject = vi.fn().mockResolvedValue(undefined)
    render(
      <GateTaskRow
        task={baseTask as any}
        onApprove={vi.fn()}
        onReject={onReject}
        isViewer={false}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /Reject gate for GSD-42/i }))
    const input = screen.getByPlaceholderText(/lifecycle\.gate\.rejectNotePlaceholder/) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'not ready' } })
    fireEvent.click(screen.getByRole('button', { name: /lifecycle\.gate\.rejectConfirmSubmit/ }))
    expect(onReject).toHaveBeenCalledWith(101, 'not ready')
  })

  it('approved status renders success-toned badge; rejected renders destructive-toned badge', () => {
    const { rerender } = render(
      <GateTaskRow
        task={{ ...baseTask, gate_status: 'approved' } as any}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        isViewer={true}
      />
    )
    expect(screen.getByText(/lifecycle\.gate\.statusApproved/)).toBeTruthy()
    rerender(
      <GateTaskRow
        task={{ ...baseTask, gate_status: 'rejected' } as any}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        isViewer={true}
      />
    )
    expect(screen.getByText(/lifecycle\.gate\.statusRejected/)).toBeTruthy()
  })
})
