'use client'

import { createContext, useContext, useMemo } from 'react'
import { usePathname } from 'next/navigation'

export interface ProjectWorkspaceState {
  slug: string
  view: string  // 'dashboard' | 'tasks' | 'sessions' | 'agents' | 'settings'
}

const ProjectWorkspaceContext = createContext<ProjectWorkspaceState | null>(null)

export function ProjectWorkspaceProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const state = useMemo(() => {
    // pathname: /project/:slug/:view?
    const segments = pathname.split('/').filter(Boolean)
    // segments[0] = 'project', segments[1] = slug, segments[2] = view
    return {
      slug: segments[1] || '',
      view: segments[2] || 'dashboard',  // D-03: default to dashboard
    }
  }, [pathname])

  return (
    <ProjectWorkspaceContext.Provider value={state}>
      {children}
    </ProjectWorkspaceContext.Provider>
  )
}

export function useProjectWorkspace(): ProjectWorkspaceState {
  const ctx = useContext(ProjectWorkspaceContext)
  if (!ctx) throw new Error('useProjectWorkspace must be used within ProjectWorkspaceProvider')
  return ctx
}
