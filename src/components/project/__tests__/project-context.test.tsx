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
