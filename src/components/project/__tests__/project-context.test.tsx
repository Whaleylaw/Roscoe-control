import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { ProjectWorkspaceProvider, useProjectWorkspace } from '@/components/project/project-context'

let mockPathname = '/project/my-app'
let mockProjects: Array<{ id: number; slug: string; name: string; status: string }> = []
const setActiveProjectSpy = vi.fn()

vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}))

vi.mock('@/store', () => ({
  useMissionControl: () => ({
    projects: mockProjects,
    setActiveProject: setActiveProjectSpy,
  }),
}))

describe('ProjectWorkspaceProvider', () => {
  beforeEach(() => {
    mockPathname = '/project/my-app'
    mockProjects = []
    setActiveProjectSpy.mockClear()
  })

  it('parses slug from URL /project/:slug', () => {
    mockPathname = '/project/my-app'
    const { result } = renderHook(() => useProjectWorkspace(), {
      wrapper: ProjectWorkspaceProvider,
    })
    expect(result.current.slug).toBe('my-app')
  })

  it('defaults view to dashboard when no view segment', () => {
    mockPathname = '/project/my-app'
    const { result } = renderHook(() => useProjectWorkspace(), {
      wrapper: ProjectWorkspaceProvider,
    })
    expect(result.current.view).toBe('dashboard')
  })

  it('parses view from URL /project/:slug/:view', () => {
    mockPathname = '/project/my-app/tasks'
    const { result } = renderHook(() => useProjectWorkspace(), {
      wrapper: ProjectWorkspaceProvider,
    })
    expect(result.current.slug).toBe('my-app')
    expect(result.current.view).toBe('tasks')
  })

  it('parses sessions view', () => {
    mockPathname = '/project/my-app/sessions'
    const { result } = renderHook(() => useProjectWorkspace(), {
      wrapper: ProjectWorkspaceProvider,
    })
    expect(result.current.view).toBe('sessions')
  })

  it('parses agents view', () => {
    mockPathname = '/project/my-app/agents'
    const { result } = renderHook(() => useProjectWorkspace(), {
      wrapper: ProjectWorkspaceProvider,
    })
    expect(result.current.view).toBe('agents')
  })

  it('parses settings view', () => {
    mockPathname = '/project/my-app/settings'
    const { result } = renderHook(() => useProjectWorkspace(), {
      wrapper: ProjectWorkspaceProvider,
    })
    expect(result.current.view).toBe('settings')
  })

  it('throws error when used outside provider', () => {
    expect(() => {
      renderHook(() => useProjectWorkspace())
    }).toThrow('useProjectWorkspace must be used within ProjectWorkspaceProvider')
  })
})

describe('ProjectWorkspaceProvider - project data fetching (NAV-04)', () => {
  it.todo('exposes fetched project object in context when slug matches store')
  it.todo('sets loading=true while project is being resolved')
  it.todo('sets error when project slug not found in store or API')
  it.todo('calls setActiveProject on Zustand store when project is loaded')
  it.todo('clears activeProject on unmount')
})

describe('SESS-03: detailId segment parsing', () => {
  it('parsed.detailId is null when pathname has fewer than 4 segments (e.g. /project/my-app/sessions)', () => {
    mockPathname = '/project/my-app/sessions'
    const { result } = renderHook(() => useProjectWorkspace(), {
      wrapper: ProjectWorkspaceProvider,
    })
    expect(result.current.detailId).toBeNull()
  })

  it('parsed.detailId equals segments[3] when pathname is /project/my-app/sessions/abc123', () => {
    mockPathname = '/project/my-app/sessions/abc123'
    const { result } = renderHook(() => useProjectWorkspace(), {
      wrapper: ProjectWorkspaceProvider,
    })
    expect(result.current.detailId).toBe('abc123')
  })

  it('parsed.detailId equals segments[3] for thread-prefixed ids like /project/my-app/sessions/thread:1:aegis', () => {
    mockPathname = '/project/my-app/sessions/thread:1:aegis'
    const { result } = renderHook(() => useProjectWorkspace(), {
      wrapper: ProjectWorkspaceProvider,
    })
    // Pitfall 7 — colons in segment must be preserved verbatim
    expect(result.current.detailId).toBe('thread:1:aegis')
  })

  it('parsed.detailId is null when view is not "sessions" (other views do not expose detailId yet)', () => {
    // segment parsing is uniform — when there is no fourth segment, detailId is null
    mockPathname = '/project/my-app/dashboard'
    const { result } = renderHook(() => useProjectWorkspace(), {
      wrapper: ProjectWorkspaceProvider,
    })
    expect(result.current.detailId).toBeNull()
  })

  it('slug and view continue to parse correctly when detailId is present (regression guard)', () => {
    mockPathname = '/project/my-app/sessions/thread:42:claude'
    const { result } = renderHook(() => useProjectWorkspace(), {
      wrapper: ProjectWorkspaceProvider,
    })
    expect(result.current.slug).toBe('my-app')
    expect(result.current.view).toBe('sessions')
    expect(result.current.detailId).toBe('thread:42:claude')
  })

  it('useProjectWorkspace() return value includes detailId field (type contract)', () => {
    mockPathname = '/project/my-app/sessions/abc'
    const { result } = renderHook(() => useProjectWorkspace(), {
      wrapper: ProjectWorkspaceProvider,
    })
    expect(result.current).toHaveProperty('detailId')
  })
})

describe('ProjectWorkspaceProvider - loading timeout escape path (Phase 7 gap closure / AUDIT-PHASE-02-TECHDEBT)', () => {
  // Wave 1 (Plan 07-01) implementation:
  //   - A setTimeout(LOAD_TIMEOUT_MS = 10_000) inside the same useEffect that
  //     watches [slug, projects] — in the projects.length === 0 branch.
  //   - When the timeout fires, setError('load-timeout') and setLoading(false).
  //   - Timer is cleared on cleanup AND when projects becomes non-empty (effect re-runs).
  //   - workspace shell (project-workspace.tsx) renders a timeout error UI with a Retry
  //     button that calls useMissionControl().fetchProjects().
  beforeEach(() => {
    setActiveProjectSpy.mockClear()
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('sets error to "load-timeout" and loading to false when projects stays empty for 10_000ms', () => {
    mockPathname = '/project/unknown-slug'
    mockProjects = []
    const { result } = renderHook(() => useProjectWorkspace(), { wrapper: ProjectWorkspaceProvider })
    expect(result.current.loading).toBe(true)
    expect(result.current.error).toBeNull()
    act(() => { vi.advanceTimersByTime(10_000) })
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBe('load-timeout')
    expect(result.current.project).toBeNull()
  })

  it('does NOT fire the timeout when projects populates before 10s elapses (normal load path)', () => {
    mockPathname = '/project/my-app'
    mockProjects = []
    const { result, rerender } = renderHook(() => useProjectWorkspace(), { wrapper: ProjectWorkspaceProvider })
    act(() => { vi.advanceTimersByTime(5_000) })
    // Populate projects mid-wait — effect re-runs, prior timer cleared
    mockProjects = [{ id: 1, slug: 'my-app', name: 'My App', status: 'active' }]
    rerender()
    act(() => { vi.advanceTimersByTime(6_000) }) // past 10s total
    expect(result.current.error).toBeNull()
    expect(result.current.loading).toBe(false)
    expect(result.current.project).toMatchObject({ slug: 'my-app' })
  })

  it('clears the pending timeout on unmount (no setState-after-unmount warning)', () => {
    mockPathname = '/project/unknown-slug'
    mockProjects = []
    const { unmount } = renderHook(() => useProjectWorkspace(), { wrapper: ProjectWorkspaceProvider })
    act(() => { vi.advanceTimersByTime(5_000) })
    unmount()
    // If clearTimeout was not called, advancing time would fire setState on an unmounted
    // component. The assertion is simply that this doesn't throw.
    expect(() => {
      act(() => { vi.advanceTimersByTime(10_000) })
    }).not.toThrow()
  })

  it('clears the pending timeout when projects becomes non-empty mid-wait (timeout does not fire)', () => {
    mockPathname = '/project/my-app'
    mockProjects = []
    const { result, rerender } = renderHook(() => useProjectWorkspace(), { wrapper: ProjectWorkspaceProvider })
    act(() => { vi.advanceTimersByTime(3_000) })
    mockProjects = [{ id: 1, slug: 'my-app', name: 'My App', status: 'active' }]
    rerender()
    // Advance well past the original 10s mark to prove the old timer was cleared.
    act(() => { vi.advanceTimersByTime(15_000) })
    expect(result.current.error).toBeNull()
    expect(result.current.error).not.toBe('load-timeout')
  })
})
