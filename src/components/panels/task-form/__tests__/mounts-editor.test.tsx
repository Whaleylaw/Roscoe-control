/**
 * Tests for MountsEditor — Phase 16 Plan 05 (RUI-04).
 *
 * Covers:
 *  1. Empty array → no rows, Add button visible.
 *  2. One row per value.
 *  3. Add button appends an empty row.
 *  4. Remove button drops the row at index.
 *  5. Editing an input calls onChange with the updated entry.
 *  6. Disabled → inputs readonly, Add/Remove hidden.
 *  7. Per-row error message from `errors` prop renders.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

vi.mock('next-intl', () => ({
  useTranslations: (ns?: string) => (k: string) => (ns ? `${ns}.${k}` : k),
}))

import { MountsEditor, type MountEntry } from '../mounts-editor'

afterEach(() => {
  cleanup()
})

describe('MountsEditor', () => {
  it('renders no rows and shows the Add button when value is empty', () => {
    render(<MountsEditor value={[]} onChange={vi.fn()} />)
    expect(screen.queryAllByPlaceholderText('taskBoard.advancedSection.hostPathPlaceholder')).toHaveLength(0)
    expect(screen.getByText(/taskBoard\.advancedSection\.addMount/)).toBeInTheDocument()
  })

  it('renders one row per entry', () => {
    const value: MountEntry[] = [
      { host_path: '/host/a', container_path: '/ctr/a', label: 'alpha' },
      { host_path: '/host/b', container_path: '/ctr/b', label: 'beta' },
    ]
    render(<MountsEditor value={value} onChange={vi.fn()} />)
    const hostInputs = screen.getAllByPlaceholderText('taskBoard.advancedSection.hostPathPlaceholder') as HTMLInputElement[]
    expect(hostInputs).toHaveLength(2)
    expect(hostInputs[0].value).toBe('/host/a')
    expect(hostInputs[1].value).toBe('/host/b')
  })

  it('Add button appends an empty row', () => {
    const handleChange = vi.fn()
    render(<MountsEditor value={[]} onChange={handleChange} />)
    const addBtn = screen.getByText(/taskBoard\.advancedSection\.addMount/)
    fireEvent.click(addBtn)
    expect(handleChange).toHaveBeenCalledWith([{ host_path: '', container_path: '', label: '' }])
  })

  it('Remove button drops the row at index', () => {
    const value: MountEntry[] = [
      { host_path: '/host/a', container_path: '/ctr/a', label: 'alpha' },
      { host_path: '/host/b', container_path: '/ctr/b', label: 'beta' },
    ]
    const handleChange = vi.fn()
    render(<MountsEditor value={value} onChange={handleChange} />)
    const removeButtons = screen.getAllByRole('button', { name: 'taskBoard.advancedSection.removeMount' })
    expect(removeButtons).toHaveLength(2)
    fireEvent.click(removeButtons[0])
    expect(handleChange).toHaveBeenCalledWith([{ host_path: '/host/b', container_path: '/ctr/b', label: 'beta' }])
  })

  it('editing an input calls onChange with the updated entry', () => {
    const value: MountEntry[] = [{ host_path: '/host/a', container_path: '/ctr/a', label: 'alpha' }]
    const handleChange = vi.fn()
    render(<MountsEditor value={value} onChange={handleChange} />)
    const hostInput = screen.getByPlaceholderText('taskBoard.advancedSection.hostPathPlaceholder') as HTMLInputElement
    fireEvent.change(hostInput, { target: { value: '/host/updated' } })
    expect(handleChange).toHaveBeenCalledWith([
      { host_path: '/host/updated', container_path: '/ctr/a', label: 'alpha' },
    ])
  })

  it('disabled → inputs readonly, Add/Remove buttons hidden', () => {
    const value: MountEntry[] = [{ host_path: '/host/a', container_path: '/ctr/a', label: 'alpha' }]
    render(<MountsEditor value={value} onChange={vi.fn()} disabled />)
    const hostInput = screen.getByPlaceholderText('taskBoard.advancedSection.hostPathPlaceholder') as HTMLInputElement
    expect(hostInput.readOnly).toBe(true)
    expect(screen.queryAllByRole('button', { name: 'taskBoard.advancedSection.removeMount' })).toHaveLength(0)
    expect(screen.queryByText(/taskBoard\.advancedSection\.addMount/)).toBeNull()
  })

  it('per-row error message renders below the row', () => {
    const value: MountEntry[] = [
      { host_path: '/host/bad', container_path: '/ctr/bad', label: 'bad' },
      { host_path: '/host/ok', container_path: '/ctr/ok', label: 'ok' },
    ]
    render(<MountsEditor value={value} onChange={vi.fn()} errors={{ 0: 'HOST_PATH_OUT_OF_ALLOWLIST' }} />)
    expect(screen.getByText('HOST_PATH_OUT_OF_ALLOWLIST')).toBeInTheDocument()
  })
})
