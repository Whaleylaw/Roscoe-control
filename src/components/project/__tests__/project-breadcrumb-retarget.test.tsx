import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// Phase 8 D-19: the breadcrumb's "Projects" segment must navigate to /projects
// (not /) now that a /projects panel exists.

const pushMock = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}))

vi.mock('next-intl', () => ({
  useTranslations: () => (k: string) => k,
}))

vi.mock('@/components/project/project-context', () => ({
  useProjectWorkspace: () => ({
    slug: 'alpha',
    view: 'dashboard',
    detailId: null,
    project: { name: 'Alpha' },
  }),
}))

import { ProjectBreadcrumb } from '@/components/project/project-breadcrumb'

describe('ProjectBreadcrumb — Projects segment re-target (D-19)', () => {
  beforeEach(() => {
    pushMock.mockReset()
  })

  it('renders a Projects segment button', () => {
    render(<ProjectBreadcrumb />)
    expect(screen.getByRole('button', { name: /nav\.projects/i })).toBeInTheDocument()
  })

  it('navigates to /projects (not /) when the Projects segment is clicked', () => {
    render(<ProjectBreadcrumb />)
    fireEvent.click(screen.getByRole('button', { name: /nav\.projects/i }))
    expect(pushMock).toHaveBeenCalledWith('/projects', expect.anything())
    expect(pushMock).not.toHaveBeenCalledWith('/', expect.anything())
  })
})
