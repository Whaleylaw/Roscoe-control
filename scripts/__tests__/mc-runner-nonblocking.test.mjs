import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('mc-runner container wait loop', () => {
  it('does not block the runner event loop while waiting for recipe containers', () => {
    const runner = readFileSync(join(process.cwd(), 'scripts', 'mc-runner.mjs'), 'utf8')

    expect(runner).not.toContain("spawnSync('docker', ['wait'")
    expect(runner).toContain("spawn('docker', ['wait'")
  })
})

describe('generic recipe agent model calls', () => {
  it('uses an abortable timeout for provider requests', () => {
    const agent = readFileSync(join(process.cwd(), 'docker', 'recipe-agent', 'agent.mjs'), 'utf8')

    expect(agent).toContain('MC_AGENT_MODEL_TIMEOUT_MS')
    expect(agent).toContain('new AbortController()')
    expect(agent).toContain('signal: controller.signal')
    expect(agent).toContain('clearTimeout(timer)')
  })

  it('can pass Mission Control forwarded host headers for Docker Desktop host-gateway calls', () => {
    const agent = readFileSync(join(process.cwd(), 'docker', 'recipe-agent', 'agent.mjs'), 'utf8')
    const runner = readFileSync(join(process.cwd(), 'scripts', 'mc-runner.mjs'), 'utf8')

    expect(agent).toContain('MC_API_HOST_HEADER')
    expect(agent).toContain("'X-Forwarded-Host': hostOverride")
    expect(agent).toContain("'X-Original-Host': hostOverride")
    expect(runner).toContain('MC_API_HOST_HEADER')
  })
})

describe('mc-runner git base freshness', () => {
  it('treats project repo fetch failure as fatal before creating a worktree', () => {
    const runner = readFileSync(join(process.cwd(), 'scripts', 'mc-runner.mjs'), 'utf8')

    expect(runner).not.toContain('git fetch non-zero (continuing)')
    expect(runner).toContain('git fetch exited')
    expect(runner.indexOf('git fetch exited')).toBeLessThan(
      runner.indexOf('worktree\', \'add'),
    )
  })

  it('fetches one configured git remote instead of every remote', () => {
    const runner = readFileSync(join(process.cwd(), 'scripts', 'mc-runner.mjs'), 'utf8')

    expect(runner).not.toContain("'fetch', '--all', '--prune'")
    expect(runner).toContain('resolveFetchRemote(repoPath)')
    expect(runner).toContain("'fetch', '--prune', fetchRemote")
  })
})
