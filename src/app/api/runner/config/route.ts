/**
 * GET /api/runner/config — runner-secret scoped daemon startup config.
 *
 * Plan 14-11. Consolidates the five runtime.* settings the runner daemon
 * (Plan 14-08b) needs at boot + on SIGHUP reload into one response. Avoids
 * five individual settings round-trips (max_concurrent_containers,
 * project_repo_map, max_memory_per_container, max_cpu_per_container,
 * failed_gc_window_days) and keeps the daemon out of the /api/settings
 * admin-only surface.
 *
 * Read-only: no rate limit per the pattern for other runner-secret GET
 * routes (heartbeat GET, pending-containers GET, terminal-tasks GET).
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import {
  getMaxConcurrentContainers,
  getProjectRepoMap,
  getMaxMemoryPerContainer,
  getMaxCpuPerContainer,
  getFailedGcWindowDays,
  getDockerNetworkMode,
} from '@/lib/task-runtime-settings'
import { logger } from '@/lib/logger'

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  // Runner-secret only — id === -1000. Runner-token (-2000) is not allowlisted
  // for /api/runner/config, so the auth layer never issues a runner-token
  // principal on this path; any other authenticated principal (session user,
  // API key) is rejected here.
  if (auth.user.id !== -1000) {
    return NextResponse.json({ error: 'runner-secret principal required' }, { status: 403 })
  }

  try {
    return NextResponse.json({
      project_repo_map: getProjectRepoMap(),
      max_memory_per_container: getMaxMemoryPerContainer(),
      max_cpu_per_container: getMaxCpuPerContainer(),
      failed_gc_window_days: getFailedGcWindowDays(),
      max_concurrent_containers: getMaxConcurrentContainers(),
      docker_network_mode: getDockerNetworkMode(),
    })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/runner/config error')
    return NextResponse.json({ error: 'Failed to read runner config' }, { status: 500 })
  }
}
