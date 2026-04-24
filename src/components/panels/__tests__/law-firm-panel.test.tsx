import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { LawFirmPanel } from '../law-firm-panel'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

const push = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}))

const caseAlpha = {
  slug: 'colleen-colvin',
  name: 'Colleen Colvin',
  case_type: 'auto_accident',
  current_phase: 'litigation',
  date_of_incident: '2023-10-01',
  jurisdiction: 'KY',
  legacy_id: '2023-10-01-MVA-001',
  updated_at: 1_700_000_000_000,
  activity_count: 2,
  document_count: 4,
  claim_count: 1,
  lien_count: 0,
  landmark_count: 10,
  satisfied_landmark_count: 6,
}

const caseBeta = {
  ...caseAlpha,
  slug: 'timothy-ruhl',
  name: 'Timothy Ruhl',
  case_type: 'premises_liability',
  legacy_id: '2023-09-14-PrL-001',
  satisfied_landmark_count: 4,
}

beforeEach(() => {
  push.mockReset()
  vi.stubGlobal('fetch', vi.fn(async () => {
    return new Response(JSON.stringify({
      root: '/FirmVault',
      cases: [caseAlpha, caseBeta],
    }))
  }))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('LawFirmPanel', () => {
  it('loads and renders FirmVault case summaries', async () => {
    render(<LawFirmPanel />)

    await waitFor(() => expect(screen.getByText('Colleen Colvin')).toBeTruthy())

    expect(fetch).toHaveBeenCalledWith('/api/law-firm/cases', { cache: 'no-store' })
    expect(screen.getByText('/FirmVault')).toBeTruthy()
    expect(screen.getByText('Timothy Ruhl')).toBeTruthy()
    expect(document.body.textContent).toContain('2023-10-01-MVA-001')
    expect(screen.getByText('10/20')).toBeTruthy()
  })

  it('filters cases by search query', async () => {
    render(<LawFirmPanel />)
    await waitFor(() => expect(screen.getByText('Colleen Colvin')).toBeTruthy())

    fireEvent.change(screen.getByLabelText('searchLabel'), { target: { value: 'timothy' } })

    expect(screen.queryByText('Colleen Colvin')).toBeNull()
    expect(screen.getByText('Timothy Ruhl')).toBeTruthy()
  })

  it('opens a case workspace when a case is selected', async () => {
    render(<LawFirmPanel />)
    await waitFor(() => expect(screen.getByText('Colleen Colvin')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: /Colleen Colvin/i }))
    expect(push).toHaveBeenCalledWith('/law-firm/case/colleen-colvin', { scroll: false })
  })

  it('shows an error when case loading fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'No vault' }), { status: 500 })))

    render(<LawFirmPanel />)

    await waitFor(() => expect(screen.getByText('No vault')).toBeTruthy())
  })
})
