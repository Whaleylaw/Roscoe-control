/**
 * Tests for SkillsChipInput — Phase 16 Plan 05 (RUI-04).
 *
 * Covers:
 *  1. Renders one chip per value.
 *  2. Enter commits the trimmed, non-empty, unique entry.
 *  3. Empty / whitespace-only Enter → no-op.
 *  4. Duplicate Enter → no-op and draft clears.
 *  5. Backspace on empty input removes the last chip.
 *  6. Chip ✖ click removes that entry.
 *  7. Disabled → input readonly, chip ✖ hidden.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

vi.mock('next-intl', () => ({
  useTranslations: (ns?: string) => (k: string) => (ns ? `${ns}.${k}` : k),
}))

import { SkillsChipInput } from '../skills-chip-input'

afterEach(() => {
  cleanup()
})

describe('SkillsChipInput', () => {
  it('renders one chip per value', () => {
    render(<SkillsChipInput value={['alpha', 'beta']} onChange={vi.fn()} />)
    expect(screen.getByText('alpha')).toBeInTheDocument()
    expect(screen.getByText('beta')).toBeInTheDocument()
  })

  it('Enter commits a trimmed, non-empty, unique entry', () => {
    const handleChange = vi.fn()
    render(<SkillsChipInput value={['alpha']} onChange={handleChange} />)
    const input = screen.getByPlaceholderText('taskBoard.advancedSection.skillPlaceholder') as HTMLInputElement
    fireEvent.change(input, { target: { value: '  gamma  ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(handleChange).toHaveBeenCalledWith(['alpha', 'gamma'])
  })

  it('Empty / whitespace-only Enter is a no-op', () => {
    const handleChange = vi.fn()
    render(<SkillsChipInput value={[]} onChange={handleChange} />)
    const input = screen.getByPlaceholderText('taskBoard.advancedSection.skillPlaceholder') as HTMLInputElement
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(handleChange).not.toHaveBeenCalled()
  })

  it('Duplicate Enter is a no-op (no onChange) but clears the draft', () => {
    const handleChange = vi.fn()
    render(<SkillsChipInput value={['alpha']} onChange={handleChange} />)
    const input = screen.getByPlaceholderText('taskBoard.advancedSection.skillPlaceholder') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'alpha' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(handleChange).not.toHaveBeenCalled()
    expect(input.value).toBe('')
  })

  it('Backspace on empty input removes the last chip', () => {
    const handleChange = vi.fn()
    render(<SkillsChipInput value={['alpha', 'beta']} onChange={handleChange} />)
    const input = screen.getByPlaceholderText('taskBoard.advancedSection.skillPlaceholder') as HTMLInputElement
    fireEvent.keyDown(input, { key: 'Backspace' })
    expect(handleChange).toHaveBeenCalledWith(['alpha'])
  })

  it('Chip ✖ click removes that entry', () => {
    const handleChange = vi.fn()
    render(<SkillsChipInput value={['alpha', 'beta']} onChange={handleChange} />)
    const removeBtn = screen.getByRole('button', { name: /taskBoard\.advancedSection\.removeSkill: alpha/ })
    fireEvent.click(removeBtn)
    expect(handleChange).toHaveBeenCalledWith(['beta'])
  })

  it('disabled → input readonly, chip ✖ hidden', () => {
    render(<SkillsChipInput value={['alpha']} onChange={vi.fn()} disabled />)
    const input = screen.getByPlaceholderText('taskBoard.advancedSection.skillPlaceholder') as HTMLInputElement
    expect(input.readOnly).toBe(true)
    expect(screen.queryByRole('button', { name: /removeSkill/ })).toBeNull()
  })
})
