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

  it('opens the email reviewer tab under Law Firm', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/law-firm/email-triage')) {
        return new Response(JSON.stringify({
          emails: [],
          stats: { total: 0, unread: 0, pending: 0, byBucket: {}, topSenders: [], lastInventoryAt: null },
        }))
      }
      return new Response(JSON.stringify({ root: '/FirmVault', cases: [caseAlpha, caseBeta] }))
    }))

    render(<LawFirmPanel />)
    await waitFor(() => expect(screen.getByText('Colleen Colvin')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: /^Email$/i }))

    await waitFor(() => expect(screen.getByText('Indexed')).toBeTruthy())
    expect(fetch).toHaveBeenCalledWith('/api/law-firm/email-triage?bucket=all&limit=100', { cache: 'no-store' })
  })

  it('keeps email stats, search, bucket tabs, and bulk controls outside the scrolling email list', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/api/law-firm/email-triage') && init?.method !== 'PATCH' && init?.method !== 'POST') {
        return new Response(JSON.stringify({
          emails: [
            {
              id: 101,
              gmail_message_id: 'msg-101',
              gmail_thread_id: 'thread-101',
              sent_at: 1700000000,
              from_name: 'Useful Sender',
              from_email: 'sender@example.com',
              sender_domain: 'example.com',
              subject: 'Should not be junk',
              snippet: 'This should move to read later.',
              is_unread: 1,
              has_attachments: 0,
              bucket: 'junk',
              confidence: 0.8,
              reason: 'Promo heuristic',
              suggested_action: 'mark_read_archive',
              review_status: 'pending',
              action_taken: null,
              case_slug: null,
            },
          ],
          stats: { total: 1, unread: 1, pending: 1, byBucket: { junk: 1, personal: 0 }, topSenders: [], lastInventoryAt: null },
        }))
      }
      return new Response(JSON.stringify({ root: '/FirmVault', cases: [caseAlpha, caseBeta] }))
    }))

    render(<LawFirmPanel />)
    await waitFor(() => expect(screen.getByText('Colleen Colvin')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /^Email$/i }))
    await waitFor(() => expect(screen.getByText('Should not be junk')).toBeTruthy())

    const workspace = screen.getByLabelText('Email reviewer workspace')
    const controls = screen.getByLabelText('Email reviewer controls')
    const list = screen.getByLabelText('Email message list')

    expect(workspace.className).toContain('overflow-hidden')
    expect(controls.className).toContain('shrink-0')
    expect(list.className).toContain('overflow-y-auto')
    expect(controls).toContainElement(screen.getByText('Indexed'))
    expect(controls).toContainElement(screen.getByPlaceholderText('Search sender, subject, snippet…'))
    expect(controls).toContainElement(screen.getByRole('button', { name: /Needs review/i }))
    expect(controls).toContainElement(screen.getByRole('button', { name: /^Personal$/i }))
    expect(controls).toContainElement(screen.getByLabelText('Selected email actions'))
  })

  it('applies bulk category changes from the fixed email controls while reviewing selected messages', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/api/law-firm/email-triage') && init?.method !== 'PATCH' && init?.method !== 'POST') {
        return new Response(JSON.stringify({
          emails: [
            {
              id: 101,
              gmail_message_id: 'msg-101',
              gmail_thread_id: 'thread-101',
              sent_at: 1700000000,
              from_name: 'Useful Sender',
              from_email: 'sender@example.com',
              sender_domain: 'example.com',
              subject: 'Should not be junk',
              snippet: 'This should move to read later.',
              is_unread: 1,
              has_attachments: 0,
              bucket: 'junk',
              confidence: 0.8,
              reason: 'Promo heuristic',
              suggested_action: 'mark_read_archive',
              review_status: 'pending',
              action_taken: null,
              case_slug: null,
            },
          ],
          stats: { total: 1, unread: 1, pending: 1, byBucket: { junk: 1, personal: 0 }, topSenders: [], lastInventoryAt: null },
        }))
      }
      if (url === '/api/law-firm/email-triage' && init?.method === 'PATCH') {
        return new Response(JSON.stringify({ result: { updated: 1, learned: 1 } }))
      }
      return new Response(JSON.stringify({ root: '/FirmVault', cases: [caseAlpha, caseBeta] }))
    }))

    render(<LawFirmPanel />)
    await waitFor(() => expect(screen.getByText('Colleen Colvin')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /^Email$/i }))
    await waitFor(() => expect(screen.getByText('Should not be junk')).toBeTruthy())

    const bulkActions = screen.getByLabelText('Selected email actions')
    expect(screen.getByLabelText('Email reviewer controls')).toContainElement(bulkActions)

    fireEvent.click(screen.getByLabelText('Select Should not be junk'))
    fireEvent.change(screen.getByLabelText('Bulk category'), { target: { value: 'personal' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply category' }))

    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/law-firm/email-triage', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ ids: [101], bucket: 'personal', suggested_action: 'none' }),
    })))
  })

  it('shows an error when case loading fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'No vault' }), { status: 500 })))

    render(<LawFirmPanel />)

    await waitFor(() => expect(screen.getByText('No vault')).toBeTruthy())
  })
})
