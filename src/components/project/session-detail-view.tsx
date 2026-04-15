'use client'

import { useProjectWorkspace } from '@/components/project/project-context'
import { SessionDetailsPanel } from '@/components/panels/session-details-panel'

/**
 * SessionDetailView — Phase 5 SESS-03
 *
 * Renders the existing SessionDetailsPanel in scoped detail mode for a single
 * session. Threads (chat conversations between user and an assigned agent) are
 * detected via the "thread:" prefix on sessionId.
 */
export function SessionDetailView({ sessionId }: { sessionId: string }) {
  const { slug } = useProjectWorkspace()
  const threadMode = sessionId.startsWith('thread:')
  return (
    <SessionDetailsPanel
      scope={{
        sessionId,
        hideFilters: true,
        hideHeader: true,
        threadMode,
        backHref: `/project/${slug}/sessions`,
      }}
    />
  )
}
