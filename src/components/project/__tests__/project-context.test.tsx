import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { ProjectWorkspaceProvider, useProjectWorkspace } from '@/components/project/project-context'

let mockPathname = '/project/my-app'

vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}))

describe('ProjectWorkspaceProvider', () => {
  beforeEach(() => {
    mockPathname = '/project/my-app'
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
  it.todo('parsed.detailId is null when pathname has fewer than 4 segments (e.g. /project/my-app/sessions)')
  it.todo('parsed.detailId equals segments[3] when pathname is /project/my-app/sessions/abc123')
  it.todo('parsed.detailId equals segments[3] for thread-prefixed ids like /project/my-app/sessions/thread:1:aegis')
  it.todo('parsed.detailId is null when view is not "sessions" (other views do not expose detailId yet)')
  it.todo('slug and view continue to parse correctly when detailId is present (regression guard)')
  it.todo('useProjectWorkspace() return value includes detailId field (type contract)')
})
