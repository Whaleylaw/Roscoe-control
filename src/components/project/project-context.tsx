'use client'

import { createContext, useContext, useMemo, useState, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { useMissionControl } from '@/store'
import type { Project } from '@/store'

export interface ProjectWorkspaceState {
  slug: string
  view: string  // 'dashboard' | 'tasks' | 'sessions' | 'agents' | 'settings'
  project: Project | null
  loading: boolean
  error: string | null
}

const ProjectWorkspaceContext = createContext<ProjectWorkspaceState | null>(null)

export function ProjectWorkspaceProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { projects, setActiveProject } = useMissionControl()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [project, setProject] = useState<Project | null>(null)

  const parsed = useMemo(() => {
    // pathname: /project/:slug/:view?
    const segments = pathname.split('/').filter(Boolean)
    // segments[0] = 'project', segments[1] = slug, segments[2] = view
    return {
      slug: segments[1] || '',
      view: segments[2] || 'dashboard',  // D-03: default to dashboard
    }
  }, [pathname])

  const { slug, view } = parsed

  // Two-tier fetch: store lookup then API fallback (D-11)
  useEffect(() => {
    if (!slug) return

    const found = projects.find(p => p.slug === slug)
    if (found) {
      setProject(found)
      setActiveProject(found)
      setLoading(false)
      setError(null)
      return
    }

    // Store loaded but slug not found -- try API fallback (D-11)
    if (projects.length > 0) {
      let cancelled = false
      fetch('/api/projects')
        .then(res => res.json())
        .then(data => {
          if (cancelled) return
          const match = data?.projects?.find((p: Project) => p.slug === slug)
          if (match) {
            setProject(match)
            setActiveProject(match)
            setLoading(false)
            setError(null)
          } else {
            setProject(null)
            setLoading(false)
            setError('not-found')
          }
        })
        .catch(() => {
          if (cancelled) return
          setProject(null)
          setLoading(false)
          setError('not-found')
        })
      return () => { cancelled = true }
    }

    // projects.length === 0 means store still booting -- keep loading=true
  }, [slug, projects, setActiveProject])

  // Cleanup: clear activeProject on unmount (Pitfall 2: stale activeProject)
  useEffect(() => {
    return () => { setActiveProject(null) }
  }, [setActiveProject])

  const state = useMemo<ProjectWorkspaceState>(() => ({
    slug,
    view,
    project,
    loading,
    error,
  }), [slug, view, project, loading, error])

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
