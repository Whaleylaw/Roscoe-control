/**
 * Unit tests for runner env-file generation (Plan 14-07 / CONTAINER-01).
 *
 * Secrets flow via --env-file, not argv, so their values never surface in
 * `ps`, `docker inspect` args, or container labels. Replaces the Wave-0
 * it.todo scaffold from Plan 14-03.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { writeEnvFile, cleanupEnvFile } from '../runner-docker'

function baseEnvMap(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    MC_API_URL: 'http://host.docker.internal:3000',
    MC_TASK_ID: '42',
    MC_API_TOKEN: 'rt_dummy_abc123',
    MC_WORKSPACE: '/workspace',
    MC_RECIPE_PATH: '/recipe',
    MC_PREAMBLE_PATH: '/recipe/PREAMBLE.md',
    MC_MODEL_PRIMARY: 'claude-opus-4-7',
    MC_MODEL_PROVIDER: 'anthropic',
    MC_MODEL_PARAMS_JSON: '{"temperature":0.2}',
    ...overrides,
  }
}

describe('runner env-file generation', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-runner-envfile-'))
  })

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      // best-effort cleanup
    }
  })

  it('CONTAINER-01: env-file contents include MC_API_URL, MC_TASK_ID, MC_API_TOKEN, MC_WORKSPACE, MC_RECIPE_PATH, MC_PREAMBLE_PATH, MC_MODEL_PRIMARY, MC_MODEL_PROVIDER, MC_MODEL_PARAMS_JSON', () => {
    const filePath = path.join(tmpDir, 'mc-task-42-a3.env')
    writeEnvFile({ envMap: baseEnvMap(), filePath })
    const body = fs.readFileSync(filePath, 'utf8')
    expect(body).toContain('MC_API_URL=http://host.docker.internal:3000')
    expect(body).toContain('MC_TASK_ID=42')
    expect(body).toContain('MC_API_TOKEN=rt_dummy_abc123')
    expect(body).toContain('MC_WORKSPACE=/workspace')
    expect(body).toContain('MC_RECIPE_PATH=/recipe')
    expect(body).toContain('MC_PREAMBLE_PATH=/recipe/PREAMBLE.md')
    expect(body).toContain('MC_MODEL_PRIMARY=claude-opus-4-7')
    expect(body).toContain('MC_MODEL_PROVIDER=anthropic')
    expect(body).toContain('MC_MODEL_PARAMS_JSON={"temperature":0.2}')
  })

  it('CONTAINER-01: env-file file permissions are 0600 on disk (owner read/write only)', () => {
    if (process.platform === 'win32') {
      return
    }
    const filePath = path.join(tmpDir, 'mc-task-42-a3.env')
    writeEnvFile({ envMap: baseEnvMap(), filePath })
    const stat = fs.statSync(filePath)
    expect(stat.mode & 0o777).toBe(0o600)
  })

  it('CONTAINER-01: env-file carries recipe-declared secrets when merged into the map', () => {
    const filePath = path.join(tmpDir, 'mc-task-42-a3.env')
    writeEnvFile({
      envMap: baseEnvMap({
        ANTHROPIC_API_KEY: 'sk-ant-test-not-real',
        OPENAI_API_KEY: 'sk-openai-test-not-real',
      }),
      filePath,
    })
    const body = fs.readFileSync(filePath, 'utf8')
    expect(body).toContain('ANTHROPIC_API_KEY=sk-ant-test-not-real')
    expect(body).toContain('OPENAI_API_KEY=sk-openai-test-not-real')
  })

  it('CONTAINER-01: generated file path is whatever caller provides (deterministic by contract)', () => {
    const filePath = path.join(tmpDir, 'custom-name.env')
    writeEnvFile({ envMap: { FOO: 'bar' }, filePath })
    expect(fs.existsSync(filePath)).toBe(true)
    // Writing to a different caller-provided path produces a different file
    const otherPath = path.join(tmpDir, 'another-name.env')
    writeEnvFile({ envMap: { BAZ: 'qux' }, filePath: otherPath })
    expect(fs.existsSync(otherPath)).toBe(true)
    const original = fs.readFileSync(filePath, 'utf8')
    expect(original).toContain('FOO=bar')
    expect(original).not.toContain('BAZ=qux')
  })

  it('CONTAINER-01: cleanupEnvFile removes the file after container exit; ENOENT swallowed on double-call', () => {
    const filePath = path.join(tmpDir, 'mc-task-42-a3.env')
    writeEnvFile({ envMap: baseEnvMap(), filePath })
    expect(fs.existsSync(filePath)).toBe(true)
    cleanupEnvFile(filePath)
    expect(fs.existsSync(filePath)).toBe(false)
    // Second call must not throw (file already gone)
    expect(() => cleanupEnvFile(filePath)).not.toThrow()
  })

  it('CONTAINER-01: newline characters in a value are neutralised to a single space (defensive)', () => {
    const filePath = path.join(tmpDir, 'mc-task-42-a3.env')
    writeEnvFile({
      envMap: { WEIRD: 'line1\nline2\r\nline3' },
      filePath,
    })
    const body = fs.readFileSync(filePath, 'utf8')
    // No mid-value line break — the env-file format is newline-separated
    expect(body.split('\n').filter((l) => l.startsWith('WEIRD=')).length).toBe(1)
    expect(body).toContain('WEIRD=line1 line2 line3')
  })
})
