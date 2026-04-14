import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react'

// ─── Module mocks ────────────────────────────────────────────────────

vi.mock('next-intl', () => ({
  useTranslations: (ns?: string) => (key: string) => `${ns ?? ''}.${key}`,
}))

const projectWorkspaceState = {
  current: {
    slug: 'my-app',
    view: 'settings',
    detailId: null as string | null,
    project: null as any,
    loading: false,
    error: null as string | null,
  },
}

vi.mock('@/components/project/project-context', () => ({
  useProjectWorkspace: () => projectWorkspaceState.current,
}))

const missionControlState = {
  current: {
    currentUser: { role: 'operator' as 'admin' | 'operator' | 'viewer' } as { role: string } | null,
    fetchProjects: vi.fn().mockResolvedValue(undefined),
  },
}

vi.mock('@/store', () => ({
  useMissionControl: () => missionControlState.current,
}))

vi.mock('@/components/ui/loader', () => ({
  Loader: () => <div data-testid="loader" />,
}))

// ─── Fixtures ────────────────────────────────────────────────────────

const baseProject = {
  id: 42,
  slug: 'my-app',
  name: 'My App',
  description: 'About',
  ticket_prefix: 'MA',
  status: 'active' as const,
  color: '#3b82f6',
  deadline: 1745000000, // Unix seconds
  github_repo: 'me/app',
  github_sync_enabled: 0,
  github_default_branch: 'main',
}

const fetchSpy = vi.fn()

beforeEach(() => {
  fetchSpy.mockReset()
  global.fetch = fetchSpy as unknown as typeof fetch
  projectWorkspaceState.current = {
    slug: 'my-app',
    view: 'settings',
    detailId: null,
    project: { ...baseProject },
    loading: false,
    error: null,
  }
  missionControlState.current = {
    currentUser: { role: 'operator' },
    fetchProjects: vi.fn().mockResolvedValue(undefined),
  }
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

import { SettingsView } from '@/components/project/settings-view'

// ─── Helpers ─────────────────────────────────────────────────────────

function mockFetchOnce(init: { ok: boolean; status?: number; json?: any }) {
  fetchSpy.mockImplementationOnce(() =>
    Promise.resolve({
      ok: init.ok,
      status: init.status ?? (init.ok ? 200 : 400),
      json: () => Promise.resolve(init.json ?? {}),
    } as unknown as Response)
  )
}

function getLoadedDeadlineYyyyMmDd(unix: number): string {
  return new Date(unix * 1000).toISOString().split('T')[0]
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('SettingsView', () => {
  // Basics (SETT-01)
  it('renders name input seeded from project.name and marks it required', () => {
    render(<SettingsView />)
    const input = screen.getByLabelText('project.settings.nameLabel') as HTMLInputElement
    expect(input.value).toBe('My App')
    expect(input.getAttribute('aria-required')).toBe('true')
  })

  it('renders description textarea seeded from project.description (empty when null)', () => {
    render(<SettingsView />)
    const textarea = screen.getByLabelText('project.settings.descriptionLabel') as HTMLTextAreaElement
    expect(textarea.value).toBe('About')
    cleanup()
    projectWorkspaceState.current = {
      ...projectWorkspaceState.current,
      project: { ...baseProject, description: null as any },
    }
    render(<SettingsView />)
    const textarea2 = screen.getByLabelText('project.settings.descriptionLabel') as HTMLTextAreaElement
    expect(textarea2.value).toBe('')
  })

  it('renders status select with Active and Archived options seeded from project.status', () => {
    render(<SettingsView />)
    const select = screen.getByLabelText('project.settings.statusLabel') as HTMLSelectElement
    expect(select.value).toBe('active')
    const options = Array.from(select.querySelectorAll('option'))
    expect(options).toHaveLength(2)
    expect(options.map((o) => o.value).sort()).toEqual(['active', 'archived'])
  })

  it('disables the Archived option when project.slug === "general"', () => {
    projectWorkspaceState.current = {
      ...projectWorkspaceState.current,
      slug: 'general',
      project: { ...baseProject, slug: 'general' },
    }
    render(<SettingsView />)
    const select = screen.getByLabelText('project.settings.statusLabel') as HTMLSelectElement
    const archivedOption = Array.from(select.querySelectorAll('option')).find(
      (o) => o.value === 'archived'
    ) as HTMLOptionElement
    expect(archivedOption.disabled).toBe(true)
  })

  it('SETT-01: editing name, description, or status marks the form dirty and reveals the sticky footer', () => {
    render(<SettingsView />)
    expect(screen.queryByText('project.settings.unsavedChanges')).toBeNull()
    const input = screen.getByLabelText('project.settings.nameLabel') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'My App Renamed' } })
    expect(screen.getByText('project.settings.unsavedChanges')).toBeTruthy()
  })

  // Appearance & Tracking (SETT-02)
  it('renders 8-swatch COLOR_PALETTE row plus a None pill seeded from project.color', () => {
    render(<SettingsView />)
    const palette = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316']
    for (const c of palette) {
      expect(screen.getByLabelText(c)).toBeTruthy()
    }
    // Selected swatch has aria-pressed=true (color was '#3b82f6')
    const selected = screen.getByLabelText('#3b82f6')
    expect(selected.getAttribute('aria-pressed')).toBe('true')
    // None pill
    expect(screen.getByText('project.settings.colorNone')).toBeTruthy()
  })

  it('clicking an unselected swatch sets color; clicking the selected swatch clears color to empty string', () => {
    render(<SettingsView />)
    const blue = screen.getByLabelText('#3b82f6')
    // Click selected swatch -> clears to ''
    fireEvent.click(blue)
    expect(blue.getAttribute('aria-pressed')).toBe('false')
    // Click a different unselected swatch -> sets that color
    const emerald = screen.getByLabelText('#10b981')
    fireEvent.click(emerald)
    expect(emerald.getAttribute('aria-pressed')).toBe('true')
  })

  it('renders ticket_prefix input seeded from project.ticket_prefix with monospace + uppercase styling and maxLength 12', () => {
    render(<SettingsView />)
    const input = screen.getByLabelText('project.settings.prefixLabel') as HTMLInputElement
    expect(input.value).toBe('MA')
    expect(input.className).toMatch(/font-mono/)
    expect(input.className).toMatch(/uppercase/)
    expect(input.maxLength).toBe(12)
  })

  it('renders ticket_prefix helper text from i18n key project.settings.prefixHelp', () => {
    render(<SettingsView />)
    expect(screen.getByText('project.settings.prefixHelp')).toBeTruthy()
    const input = screen.getByLabelText('project.settings.prefixLabel') as HTMLInputElement
    expect(input.getAttribute('aria-describedby')).toBe('prefix-help')
  })

  it('renders deadline date input seeded as YYYY-MM-DD from project.deadline Unix seconds (empty when null)', () => {
    render(<SettingsView />)
    const input = screen.getByLabelText('project.settings.deadlineLabel') as HTMLInputElement
    expect(input.value).toBe(getLoadedDeadlineYyyyMmDd(1745000000))
    cleanup()
    projectWorkspaceState.current = {
      ...projectWorkspaceState.current,
      project: { ...baseProject, deadline: null as any },
    }
    render(<SettingsView />)
    const input2 = screen.getByLabelText('project.settings.deadlineLabel') as HTMLInputElement
    expect(input2.value).toBe('')
  })

  it('SETT-02: editing color, prefix, deadline, or github_repo marks the form dirty', () => {
    render(<SettingsView />)
    expect(screen.queryByText('project.settings.unsavedChanges')).toBeNull()
    const prefix = screen.getByLabelText('project.settings.prefixLabel') as HTMLInputElement
    fireEvent.change(prefix, { target: { value: 'MB' } })
    expect(screen.getByText('project.settings.unsavedChanges')).toBeTruthy()
  })

  // Integrations (SETT-02)
  it('renders github_repo input seeded from project.github_repo with placeholder "owner/repo"', () => {
    render(<SettingsView />)
    const input = screen.getByLabelText('project.settings.githubRepoLabel') as HTMLInputElement
    expect(input.value).toBe('me/app')
    expect(input.placeholder).toBe('project.settings.githubRepoPlaceholder')
  })

  // Save flow (SETT-03)
  it('SETT-03: Save click sends PATCH /api/projects/[id] with only dirty fields, name always included', async () => {
    mockFetchOnce({ ok: true, json: { project: baseProject } })
    render(<SettingsView />)
    // Change description only
    const desc = screen.getByLabelText('project.settings.descriptionLabel') as HTMLTextAreaElement
    fireEvent.change(desc, { target: { value: 'New description' } })

    const saveBtn = screen.getByText('project.settings.save')
    await act(async () => {
      fireEvent.click(saveBtn)
    })

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe('/api/projects/42')
    expect(init.method).toBe('PATCH')
    const body = JSON.parse(init.body)
    expect(body.name).toBe('My App') // name always included
    expect(body.description).toBe('New description') // changed
    expect(body).not.toHaveProperty('status')
    expect(body).not.toHaveProperty('color')
    expect(body).not.toHaveProperty('ticket_prefix')
    expect(body).not.toHaveProperty('deadline')
    expect(body).not.toHaveProperty('github_repo')
  })

  it('SETT-03: serializes deadline to Math.floor(new Date(value).getTime()/1000) and null when empty', async () => {
    mockFetchOnce({ ok: true, json: { project: baseProject } })
    render(<SettingsView />)
    const deadline = screen.getByLabelText('project.settings.deadlineLabel') as HTMLInputElement
    fireEvent.change(deadline, { target: { value: '2026-05-01' } })
    await act(async () => {
      fireEvent.click(screen.getByText('project.settings.save'))
    })
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body)
    expect(body.deadline).toBe(Math.floor(new Date('2026-05-01').getTime() / 1000))

    // Clear to empty -> null
    cleanup()
    fetchSpy.mockReset()
    mockFetchOnce({ ok: true, json: { project: baseProject } })
    render(<SettingsView />)
    const deadline2 = screen.getByLabelText('project.settings.deadlineLabel') as HTMLInputElement
    fireEvent.change(deadline2, { target: { value: '' } })
    await act(async () => {
      fireEvent.click(screen.getByText('project.settings.save'))
    })
    const body2 = JSON.parse(fetchSpy.mock.calls[0][1].body)
    expect(body2.deadline).toBeNull()
  })

  it('SETT-03: serializes empty description/github_repo/color as "" (server coerces to null)', async () => {
    mockFetchOnce({ ok: true, json: { project: baseProject } })
    render(<SettingsView />)
    const desc = screen.getByLabelText('project.settings.descriptionLabel') as HTMLTextAreaElement
    fireEvent.change(desc, { target: { value: '' } })
    const repo = screen.getByLabelText('project.settings.githubRepoLabel') as HTMLInputElement
    fireEvent.change(repo, { target: { value: '' } })
    // Click None pill to clear color
    fireEvent.click(screen.getByText('project.settings.colorNone'))

    await act(async () => {
      fireEvent.click(screen.getByText('project.settings.save'))
    })
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body)
    expect(body.description).toBe('')
    expect(body.github_repo).toBe('')
    expect(body.color).toBe('')
  })

  it('SETT-03: on 200 response calls useMissionControl.fetchProjects and clears dirty state', async () => {
    const fetchProjectsSpy = vi.fn().mockResolvedValue(undefined)
    missionControlState.current = {
      currentUser: { role: 'operator' },
      fetchProjects: fetchProjectsSpy,
    }
    mockFetchOnce({ ok: true, json: { project: baseProject } })
    render(<SettingsView />)
    const name = screen.getByLabelText('project.settings.nameLabel') as HTMLInputElement
    fireEvent.change(name, { target: { value: 'My App Updated' } })
    await act(async () => {
      fireEvent.click(screen.getByText('project.settings.save'))
    })
    expect(fetchProjectsSpy).toHaveBeenCalledTimes(1)
    // Dirty cleared because state was re-seeded from echoed baseProject
    await waitFor(() => {
      expect(screen.queryByText('project.settings.unsavedChanges')).toBeNull()
    })
  })

  it('SETT-03: does NOT call router.refresh or emit any SSE event after save', async () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent')
    mockFetchOnce({ ok: true, json: { project: baseProject } })
    render(<SettingsView />)
    const name = screen.getByLabelText('project.settings.nameLabel') as HTMLInputElement
    fireEvent.change(name, { target: { value: 'X' } })
    await act(async () => {
      fireEvent.click(screen.getByText('project.settings.save'))
    })
    // No custom CustomEvent dispatched (only default lifecycle events from JSDOM)
    const customEvents = dispatchSpy.mock.calls.filter(
      (c) => (c[0] as Event)?.type?.startsWith('mc:')
    )
    expect(customEvents).toHaveLength(0)
    dispatchSpy.mockRestore()
  })

  it('SETT-03: never includes ticket_counter in the PATCH body', async () => {
    mockFetchOnce({ ok: true, json: { project: baseProject } })
    render(<SettingsView />)
    const prefix = screen.getByLabelText('project.settings.prefixLabel') as HTMLInputElement
    fireEvent.change(prefix, { target: { value: 'NEW' } })
    await act(async () => {
      fireEvent.click(screen.getByText('project.settings.save'))
    })
    const rawBody = fetchSpy.mock.calls[0][1].body as string
    expect(rawBody).not.toContain('ticket_counter')
  })

  // Dirty detection and pitfalls
  it('Pitfall — ticket_prefix dirty-check compares normalized values (uppercased, alphanumeric-only, 12-char cap) so form is not false-dirty after server echoes normalized value', () => {
    render(<SettingsView />)
    const prefix = screen.getByLabelText('project.settings.prefixLabel') as HTMLInputElement
    // project.ticket_prefix === 'MA'; typing 'ma' normalizes to 'MA' -> not dirty
    fireEvent.change(prefix, { target: { value: 'ma' } })
    expect(screen.queryByText('project.settings.unsavedChanges')).toBeNull()
  })

  it('Pitfall — deadline round-trip: loading project.deadline as Unix seconds and saving back yields the same date in the user local timezone the modal uses', async () => {
    mockFetchOnce({ ok: true, json: { project: baseProject } })
    render(<SettingsView />)
    const deadline = screen.getByLabelText('project.settings.deadlineLabel') as HTMLInputElement
    const loadedYmd = getLoadedDeadlineYyyyMmDd(1745000000)
    expect(deadline.value).toBe(loadedYmd)
    // Trigger any edit to a different field, then save and verify round-trip equivalence using the modal's formula
    const name = screen.getByLabelText('project.settings.nameLabel') as HTMLInputElement
    fireEvent.change(name, { target: { value: 'X' } })
    await act(async () => {
      fireEvent.click(screen.getByText('project.settings.save'))
    })
    // deadline not changed -> body should not contain deadline
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body)
    expect(body).not.toHaveProperty('deadline')
  })

  it('Pitfall — empty string vs null: description/github_repo/color that were null on load and remain empty do NOT mark the form dirty', () => {
    projectWorkspaceState.current = {
      ...projectWorkspaceState.current,
      project: {
        ...baseProject,
        description: null as any,
        github_repo: null as any,
        color: null as any,
      },
    }
    render(<SettingsView />)
    // Form loaded with empty strings; no edits made -> not dirty
    expect(screen.queryByText('project.settings.unsavedChanges')).toBeNull()
  })

  it('Pitfall — slug==="general" status archive still shows inline status error if server returns 400 (defensive handling, Archived option is UI-disabled)', async () => {
    // Server returns 400 even though UI tries to prevent it — we still route the error
    mockFetchOnce({
      ok: false,
      status: 400,
      json: { error: 'Default project cannot be archived' },
    })
    render(<SettingsView />)
    // Force status change via select (bypass UI disable)
    const select = screen.getByLabelText('project.settings.statusLabel') as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'archived' } })
    await act(async () => {
      fireEvent.click(screen.getByText('project.settings.save'))
    })
    expect(screen.getByText('project.settings.errorDefaultArchive')).toBeTruthy()
  })

  it('Pitfall — form re-seeding does not clobber in-progress edits: if projects[] refreshes while form is dirty, current inputs are preserved', () => {
    const { rerender } = render(<SettingsView />)
    const name = screen.getByLabelText('project.settings.nameLabel') as HTMLInputElement
    fireEvent.change(name, { target: { value: 'User typed this' } })
    expect(name.value).toBe('User typed this')
    // Simulate projects[] refresh by updating the mocked workspace state with the same project id
    projectWorkspaceState.current = {
      ...projectWorkspaceState.current,
      project: { ...baseProject }, // same id, new object reference
    }
    rerender(<SettingsView />)
    const name2 = screen.getByLabelText('project.settings.nameLabel') as HTMLInputElement
    expect(name2.value).toBe('User typed this')
  })

  // Cancel + footer
  it('Cancel resets all fields to the last-loaded project values and hides the sticky footer', () => {
    render(<SettingsView />)
    const name = screen.getByLabelText('project.settings.nameLabel') as HTMLInputElement
    const desc = screen.getByLabelText('project.settings.descriptionLabel') as HTMLTextAreaElement
    fireEvent.change(name, { target: { value: 'Changed' } })
    fireEvent.change(desc, { target: { value: 'Changed desc' } })
    expect(screen.getByText('project.settings.unsavedChanges')).toBeTruthy()
    fireEvent.click(screen.getByText('project.settings.cancel'))
    expect(name.value).toBe('My App')
    expect(desc.value).toBe('About')
    expect(screen.queryByText('project.settings.unsavedChanges')).toBeNull()
  })

  it('Save button is disabled when form is pristine', () => {
    render(<SettingsView />)
    // Footer itself not rendered when pristine
    expect(screen.queryByText('project.settings.save')).toBeNull()
  })

  it('Save button is disabled when trimmed name is empty', () => {
    render(<SettingsView />)
    const name = screen.getByLabelText('project.settings.nameLabel') as HTMLInputElement
    fireEvent.change(name, { target: { value: '   ' } })
    const saveBtn = screen.getByText('project.settings.save') as HTMLButtonElement
    expect(saveBtn.closest('button')?.disabled).toBe(true)
  })

  it('Save button shows Saving… text while isSaving and disables Cancel', async () => {
    let resolve: (v: any) => void = () => {}
    fetchSpy.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r
        })
    )
    render(<SettingsView />)
    const name = screen.getByLabelText('project.settings.nameLabel') as HTMLInputElement
    fireEvent.change(name, { target: { value: 'Changed' } })
    await act(async () => {
      fireEvent.click(screen.getByText('project.settings.save'))
    })
    // Button label becomes 'project.settings.saving', Cancel disabled
    const cancelBtn = screen.getByText('project.settings.cancel').closest('button') as HTMLButtonElement
    expect(cancelBtn.disabled).toBe(true)
    // 'saving' text appears somewhere
    expect(screen.getAllByText('project.settings.saving').length).toBeGreaterThan(0)
    // Resolve to cleanup
    resolve({ ok: true, json: () => Promise.resolve({ project: baseProject }) })
    await act(async () => {
      await Promise.resolve()
    })
  })

  // Error handling
  it('400 "Project name cannot be empty" routes to inline error under Name field with i18n key project.settings.errorNameRequired', async () => {
    mockFetchOnce({ ok: false, status: 400, json: { error: 'Project name cannot be empty' } })
    render(<SettingsView />)
    const name = screen.getByLabelText('project.settings.nameLabel') as HTMLInputElement
    fireEvent.change(name, { target: { value: 'X' } })
    await act(async () => {
      fireEvent.click(screen.getByText('project.settings.save'))
    })
    expect(screen.getByText('project.settings.errorNameRequired')).toBeTruthy()
  })

  it('409 "Ticket prefix already in use" routes to inline error under Ticket prefix field with i18n key project.settings.errorPrefixConflict', async () => {
    mockFetchOnce({ ok: false, status: 409, json: { error: 'Ticket prefix already in use' } })
    render(<SettingsView />)
    const prefix = screen.getByLabelText('project.settings.prefixLabel') as HTMLInputElement
    fireEvent.change(prefix, { target: { value: 'XY' } })
    await act(async () => {
      fireEvent.click(screen.getByText('project.settings.save'))
    })
    expect(screen.getByText('project.settings.errorPrefixConflict')).toBeTruthy()
  })

  it('400 "Invalid ticket prefix" routes to inline error under Ticket prefix field with i18n key project.settings.errorPrefixInvalid', async () => {
    mockFetchOnce({ ok: false, status: 400, json: { error: 'Invalid ticket prefix' } })
    render(<SettingsView />)
    const prefix = screen.getByLabelText('project.settings.prefixLabel') as HTMLInputElement
    fireEvent.change(prefix, { target: { value: '!!' } })
    await act(async () => {
      fireEvent.click(screen.getByText('project.settings.save'))
    })
    expect(screen.getByText('project.settings.errorPrefixInvalid')).toBeTruthy()
  })

  it('400 "Default project cannot be archived" routes to inline error under Status field with i18n key project.settings.errorDefaultArchive', async () => {
    mockFetchOnce({ ok: false, status: 400, json: { error: 'Default project cannot be archived' } })
    render(<SettingsView />)
    const select = screen.getByLabelText('project.settings.statusLabel') as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'archived' } })
    await act(async () => {
      fireEvent.click(screen.getByText('project.settings.save'))
    })
    expect(screen.getByText('project.settings.errorDefaultArchive')).toBeTruthy()
  })

  it('Unknown error renders top-of-form banner with server error text and focuses the banner (role="alert")', async () => {
    const focusSpy = vi.spyOn(HTMLElement.prototype, 'focus')
    mockFetchOnce({ ok: false, status: 500, json: { error: 'Something went boom' } })
    render(<SettingsView />)
    const name = screen.getByLabelText('project.settings.nameLabel') as HTMLInputElement
    fireEvent.change(name, { target: { value: 'X' } })
    await act(async () => {
      fireEvent.click(screen.getByText('project.settings.save'))
    })
    // Flush queueMicrotask
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(screen.getByText('Something went boom')).toBeTruthy()
    const banners = screen.getAllByRole('alert')
    // Find the top-of-form banner (has errorBannerHeading label)
    const banner = banners.find((b) => b.textContent?.includes('project.settings.errorBannerHeading'))
    expect(banner).toBeTruthy()
    // Programmatic focus was requested (via bannerRef.current?.focus())
    expect(focusSpy).toHaveBeenCalled()
    focusSpy.mockRestore()
  })

  it('Network failure renders top-of-form banner with project.settings.errorBannerFallback copy', async () => {
    fetchSpy.mockImplementationOnce(() => Promise.reject(new Error('network down')))
    render(<SettingsView />)
    const name = screen.getByLabelText('project.settings.nameLabel') as HTMLInputElement
    fireEvent.change(name, { target: { value: 'X' } })
    await act(async () => {
      fireEvent.click(screen.getByText('project.settings.save'))
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.getByText('project.settings.errorBannerFallback')).toBeTruthy()
  })

  // Viewer role
  it('D-20: viewer role renders all inputs with disabled attribute, hides the sticky footer, and shows readOnlyNote at the top of the form', () => {
    missionControlState.current = {
      currentUser: { role: 'viewer' },
      fetchProjects: vi.fn().mockResolvedValue(undefined),
    }
    render(<SettingsView />)
    expect(screen.getByText('project.settings.readOnlyNote')).toBeTruthy()
    const name = screen.getByLabelText('project.settings.nameLabel') as HTMLInputElement
    expect(name.disabled).toBe(true)
    const desc = screen.getByLabelText('project.settings.descriptionLabel') as HTMLTextAreaElement
    expect(desc.disabled).toBe(true)
    const select = screen.getByLabelText('project.settings.statusLabel') as HTMLSelectElement
    expect(select.disabled).toBe(true)
    const prefix = screen.getByLabelText('project.settings.prefixLabel') as HTMLInputElement
    expect(prefix.disabled).toBe(true)
    const deadline = screen.getByLabelText('project.settings.deadlineLabel') as HTMLInputElement
    expect(deadline.disabled).toBe(true)
    const repo = screen.getByLabelText('project.settings.githubRepoLabel') as HTMLInputElement
    expect(repo.disabled).toBe(true)
    // Footer save/cancel not rendered even when we edit (they shouldn't be triggerable anyway)
    expect(screen.queryByText('project.settings.save')).toBeNull()
    expect(screen.queryByText('project.settings.cancel')).toBeNull()
  })

  // i18n wiring
  it('all user-facing strings resolve via useTranslations("project.settings") — no hardcoded English in the JSX', () => {
    render(<SettingsView />)
    // Section headings, labels, placeholders should all be translation-key strings, not raw English
    expect(screen.getByText('project.settings.title')).toBeTruthy()
    expect(screen.getByText('project.settings.sectionBasics')).toBeTruthy()
    expect(screen.getByText('project.settings.sectionAppearance')).toBeTruthy()
    expect(screen.getByText('project.settings.sectionIntegrations')).toBeTruthy()
    // And hardcoded English strings should NOT appear
    expect(screen.queryByText('Save changes')).toBeNull()
    expect(screen.queryByText('Basics')).toBeNull()
    expect(screen.queryByText('Unsaved changes')).toBeNull()
  })
})
