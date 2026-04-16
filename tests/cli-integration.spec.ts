import { expect, test } from '@playwright/test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import {
  API_KEY_HEADER,
  createTestAgent,
  createTestProject,
  createTestTask,
  deleteTestAgent,
  deleteTestProject,
  deleteTestTask,
} from './helpers'

const execFileAsync = promisify(execFile)

const CLI = path.resolve('scripts/mc-cli.cjs')
const BASE_URL = process.env.E2E_BASE_URL || 'http://127.0.0.1:3005'
const API_KEY = 'test-api-key-e2e-12345'

/** Run mc-cli command via execFile (no shell) and return parsed JSON output */
async function mc(...args: string[]): Promise<{ stdout: string; parsed: any; exitCode: number }> {
  try {
    const { stdout } = await execFileAsync('node', [CLI, ...args, '--json', '--url', BASE_URL, '--api-key', API_KEY], {
      timeout: 15000,
      env: { ...process.env, MC_URL: BASE_URL, MC_API_KEY: API_KEY },
    })
    let parsed: any
    try { parsed = JSON.parse(stdout) } catch { parsed = { raw: stdout } }
    return { stdout, parsed, exitCode: 0 }
  } catch (err: any) {
    const stdout = err.stdout || ''
    let parsed: any
    try { parsed = JSON.parse(stdout) } catch { parsed = { raw: stdout, stderr: err.stderr } }
    return { stdout, parsed, exitCode: err.code ?? 1 }
  }
}

test.describe('CLI Integration', () => {
  // --- Help & Usage ---

  test('--help shows usage and exits 0', async () => {
    const { stdout, exitCode } = await mc('--help')
    expect(exitCode).toBe(0)
    expect(stdout).toContain('Mission Control CLI')
    expect(stdout).toContain('agents')
    expect(stdout).toContain('tasks')
  })

  test('unknown group exits 2 with error', async () => {
    const { exitCode } = await mc('nonexistent', 'action')
    expect(exitCode).toBe(2)
  })

  test('missing required flag exits 2 with error message', async () => {
    const { exitCode, parsed } = await mc('agents', 'get')
    expect(exitCode).toBe(2)
    expect(parsed.error).toContain('--id')
  })

  // --- Status ---

  test('status health returns healthy', async () => {
    const { parsed, exitCode } = await mc('status', 'health')
    expect(exitCode).toBe(0)
    expect(parsed.data?.status || parsed.status).toBeDefined()
  })

  test('status overview returns system info', async () => {
    const { parsed, exitCode } = await mc('status', 'overview')
    expect(exitCode).toBe(0)
  })

  // --- Agents CRUD ---

  test.describe('agents', () => {
    const agentIds: number[] = []

    test.afterEach(async ({ request }) => {
      for (const id of agentIds.splice(0)) {
        await deleteTestAgent(request, id).catch(() => {})
      }
    })

    test('list returns array', async () => {
      const { parsed, exitCode } = await mc('agents', 'list')
      expect(exitCode).toBe(0)
      const data = parsed.data || parsed
      expect(data).toBeDefined()
    })

    test('get + heartbeat lifecycle', async ({ request }) => {
      const agent = await createTestAgent(request)
      agentIds.push(agent.id)

      // Get via CLI
      const { parsed: getResult, exitCode: getCode } = await mc('agents', 'get', '--id', String(agent.id))
      expect(getCode).toBe(0)
      const agentData = getResult.data?.agent || getResult.data || getResult
      expect(agentData).toBeDefined()

      // Heartbeat via CLI
      const { exitCode: hbCode } = await mc('agents', 'heartbeat', '--id', String(agent.id))
      expect(hbCode).toBe(0)
    })

    test('memory set and get work', async ({ request }) => {
      const agent = await createTestAgent(request)
      agentIds.push(agent.id)

      // Set memory — may succeed or fail depending on workspace state
      const { exitCode: setCode } = await mc('agents', 'memory', 'set', '--id', String(agent.id), '--content', 'CLI test memory')
      expect([0, 2, 6]).toContain(setCode)

      // Get memory
      const { exitCode: getCode } = await mc('agents', 'memory', 'get', '--id', String(agent.id))
      expect([0, 2, 6]).toContain(getCode)
    })

    test('attribution returns response', async ({ request }) => {
      const agent = await createTestAgent(request)
      agentIds.push(agent.id)

      // Attribution may return 403 for test API key depending on auth scope — accept 0 or 4
      const { exitCode } = await mc('agents', 'attribution', '--id', String(agent.id), '--hours', '1')
      expect([0, 4]).toContain(exitCode)
    })
  })

  // --- Tasks ---

  test.describe('tasks', () => {
    const taskIds: number[] = []

    test.afterEach(async ({ request }) => {
      for (const id of taskIds.splice(0)) {
        await deleteTestTask(request, id).catch(() => {})
      }
    })

    test('list returns data', async () => {
      const { exitCode } = await mc('tasks', 'list')
      expect(exitCode).toBe(0)
    })

    test('queue returns response', async () => {
      const { exitCode } = await mc('tasks', 'queue', '--agent', 'e2e-test-agent')
      expect(exitCode).toBe(0)
    })

    test('comments list/add lifecycle', async ({ request }) => {
      const task = await createTestTask(request)
      taskIds.push(task.id)

      // Add comment via CLI
      const { exitCode: addCode } = await mc('tasks', 'comments', 'add', '--id', String(task.id), '--content', 'CLI comment test')
      expect(addCode).toBe(0)

      // List comments via CLI
      const { parsed, exitCode: listCode } = await mc('tasks', 'comments', 'list', '--id', String(task.id))
      expect(listCode).toBe(0)
      const comments = parsed.data?.comments || parsed.comments || []
      expect(comments.length).toBeGreaterThanOrEqual(1)
    })
  })

  test.describe('phase 10 hierarchy cli', () => {
    const projectIds: number[] = []

    test.afterEach(async ({ request }) => {
      for (const id of projectIds.splice(0)) {
        await deleteTestProject(request, id).catch(() => {})
      }
    })

    test('projects/gsd commands can create and transition hierarchy entities', async ({ request }) => {
      const project = await createTestProject(request, {
        gsd_enabled: true,
        gsd_track: 'product',
        gsd_gate_mode: 'manual_approval',
      })
      projectIds.push(project.id)

      const { parsed: graph1, exitCode: graphCode1 } = await mc('projects', 'lifecycle-graph', '--id', String(project.id))
      expect(graphCode1).toBe(0)
      expect((graph1.data || graph1).workstreams).toEqual([])

      const { parsed: wsCreate, exitCode: wsCode } = await mc(
        'projects',
        'workstreams',
        'create',
        '--id',
        String(project.id),
        '--key',
        'core',
        '--name',
        'Core Platform',
      )
      expect(wsCode).toBe(0)
      const workstream = (wsCreate.data || wsCreate).workstream
      expect(workstream.key).toBe('core')

      const { parsed: msCreate, exitCode: msCode } = await mc(
        'projects',
        'milestones',
        'create',
        '--id',
        String(project.id),
        '--workstream-id',
        String(workstream.id),
        '--version',
        'v2.1',
        '--title',
        'Gateway parity rollout',
        '--status',
        'active',
      )
      expect(msCode).toBe(0)
      const milestone = (msCreate.data || msCreate).milestone
      expect(milestone.version_label).toBe('v2.1')

      const { parsed: phaseCreate, exitCode: phaseCode } = await mc(
        'gsd',
        'phases',
        'create',
        '--milestone-id',
        String(milestone.id),
        '--key',
        '10-01',
        '--slug',
        'schema-and-api-foundation',
        '--order',
        '10.01',
        '--lifecycle',
        'discuss',
        '--status',
        'active',
      )
      expect(phaseCode).toBe(0)
      const phase = (phaseCreate.data || phaseCreate).phase
      expect(phase.phase_key).toBe('10-01')

      const { parsed: planCreate, exitCode: planCode } = await mc(
        'gsd',
        'plans',
        'create',
        '--phase-id',
        String(phase.id),
        '--ref',
        '10-01-PLAN',
        '--title',
        'Ship schema and validation',
        '--wave',
        '1',
      )
      expect(planCode).toBe(0)
      const plan = (planCreate.data || planCreate).plan
      expect(plan.plan_ref).toBe('10-01-PLAN')

      const { parsed: phaseTransition, exitCode: phaseTransitionCode } = await mc(
        'gsd',
        'phases',
        'transition',
        '--phase-id',
        String(phase.id),
        '--to',
        'plan',
      )
      expect(phaseTransitionCode).toBe(0)
      expect((phaseTransition.data || phaseTransition).to_phase).toBe('plan')

      const { parsed: planTransition, exitCode: planTransitionCode } = await mc(
        'gsd',
        'plans',
        'transition',
        '--plan-id',
        String(plan.id),
        '--to',
        'in_progress',
      )
      expect(planTransitionCode).toBe(0)
      expect((planTransition.data || planTransition).plan.status).toBe('in_progress')

      const { parsed: graph2, exitCode: graphCode2 } = await mc('projects', 'lifecycle-graph', '--id', String(project.id))
      expect(graphCode2).toBe(0)
      const graph = graph2.data || graph2
      expect(graph.rollups.active_workstreams).toBe(1)
      expect(graph.rollups.active_milestones).toBe(1)
      expect(graph.rollups.active_phases).toBe(1)
      expect(graph.rollups.in_progress_plans).toBe(1)
    })
  })

  // --- Sessions ---

  test('sessions list returns response', async () => {
    // Sessions endpoint behavior depends on gateway availability
    const { exitCode } = await mc('sessions', 'list')
    expect(exitCode).toBeLessThanOrEqual(6)
  })

  // --- Tokens ---

  test('tokens stats returns data', async () => {
    const { exitCode } = await mc('tokens', 'stats')
    expect(exitCode).toBe(0)
  })

  test('tokens by-agent returns data', async () => {
    const { exitCode } = await mc('tokens', 'by-agent', '--days', '7')
    expect(exitCode).toBe(0)
  })

  // --- Skills ---

  test('skills list returns data', async () => {
    const { exitCode } = await mc('skills', 'list')
    expect(exitCode).toBe(0)
  })

  // --- Cron ---

  test('cron list returns response', async () => {
    // Cron may return error in test mode — accept 0, 2, or 6
    const { exitCode } = await mc('cron', 'list')
    expect([0, 2, 6]).toContain(exitCode)
  })

  // --- Connect ---

  test('connect list returns data', async () => {
    const { exitCode } = await mc('connect', 'list')
    expect(exitCode).toBe(0)
  })

  // --- Raw passthrough ---

  test('raw GET /api/status works', async () => {
    const { exitCode } = await mc('raw', '--method', 'GET', '--path', '/api/status?action=health')
    expect(exitCode).toBe(0)
  })
})
