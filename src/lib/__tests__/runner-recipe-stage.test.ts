/**
 * Unit tests for recipe-stage copy + PREAMBLE.md write (Plan 14-07).
 *
 * stageRecipe deep-copies the recipe source directory to a per-task stage
 * path and then writes the runner-authored PREAMBLE.md. Replaces the Wave-0
 * it.todo scaffold from Plan 14-03.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { stageRecipe } from '../runner-docker'

function makeRecipeFixture(parentDir: string): string {
  const recipeDir = path.join(parentDir, 'hello-world')
  fs.mkdirSync(path.join(recipeDir, 'tools'), { recursive: true })
  fs.mkdirSync(path.join(recipeDir, 'skills'), { recursive: true })
  fs.mkdirSync(path.join(recipeDir, 'references'), { recursive: true })
  fs.writeFileSync(path.join(recipeDir, 'SOUL.md'), '# SOUL — say hello\n')
  fs.writeFileSync(path.join(recipeDir, 'README.md'), '# hello-world recipe\n')
  fs.writeFileSync(path.join(recipeDir, 'tools', 'a.txt'), 'tool-a contents\n')
  fs.writeFileSync(path.join(recipeDir, 'skills', 'b.txt'), 'skill-b contents\n')
  fs.writeFileSync(path.join(recipeDir, 'references', 'c.txt'), 'reference-c contents\n')
  return recipeDir
}

describe('runner recipe-stage copy + PREAMBLE.md write', () => {
  let recipesRoot: string
  let stageRoot: string
  let recipeDir: string
  let stageDir: string

  beforeEach(() => {
    recipesRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-runner-recipes-'))
    stageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-runner-stage-'))
    recipeDir = makeRecipeFixture(recipesRoot)
    stageDir = path.join(stageRoot, 'task-42')
  })

  afterEach(() => {
    for (const dir of [recipesRoot, stageRoot]) {
      try {
        fs.rmSync(dir, { recursive: true, force: true })
      } catch {
        // best-effort cleanup
      }
    }
  })

  it('recipe-stage dir is created under the caller-provided stage path (outside the recipes root)', async () => {
    await stageRecipe({
      sourceDir: recipeDir,
      stageDir,
      preambleContents: '# preamble\n',
    })
    expect(fs.existsSync(stageDir)).toBe(true)
    // Sanity check Pitfall 10: the stage path must resolve outside the recipes root
    // so the chokidar watcher (Plan 12-03) does not re-index the staged copy.
    const rel = path.relative(recipesRoot, stageDir)
    expect(rel.startsWith('..')).toBe(true)
  })

  it('deep copy includes tools/, skills/, references/, README.md, SOUL.md (no shallow copy; no dangling files)', async () => {
    await stageRecipe({
      sourceDir: recipeDir,
      stageDir,
      preambleContents: '# preamble\n',
    })
    expect(fs.readFileSync(path.join(stageDir, 'SOUL.md'), 'utf8')).toBe('# SOUL — say hello\n')
    expect(fs.readFileSync(path.join(stageDir, 'README.md'), 'utf8')).toBe('# hello-world recipe\n')
    expect(fs.readFileSync(path.join(stageDir, 'tools', 'a.txt'), 'utf8')).toBe('tool-a contents\n')
    expect(fs.readFileSync(path.join(stageDir, 'skills', 'b.txt'), 'utf8')).toBe(
      'skill-b contents\n',
    )
    expect(fs.readFileSync(path.join(stageDir, 'references', 'c.txt'), 'utf8')).toBe(
      'reference-c contents\n',
    )
  })

  it('PREAMBLE.md is written AFTER the copy so a recipe-authored PREAMBLE.md would be overwritten (runner owns /recipe/PREAMBLE.md)', async () => {
    // Seed the recipe with a competing PREAMBLE.md
    fs.writeFileSync(path.join(recipeDir, 'PREAMBLE.md'), 'OLD recipe-authored preamble\n')

    const runnerPreamble = '# Runner-authored preamble\nattempt 1\n'
    await stageRecipe({
      sourceDir: recipeDir,
      stageDir,
      preambleContents: runnerPreamble,
    })
    const staged = fs.readFileSync(path.join(stageDir, 'PREAMBLE.md'), 'utf8')
    expect(staged).toBe(runnerPreamble)
    expect(staged).not.toContain('OLD recipe-authored preamble')
  })

  it('stageRecipe returns a promise that resolves only after all writes complete (await safety)', async () => {
    const result = stageRecipe({
      sourceDir: recipeDir,
      stageDir,
      preambleContents: '# done\n',
    })
    expect(result).toBeInstanceOf(Promise)
    await result
    // Every expected output must be present synchronously after the await resolves
    expect(fs.existsSync(path.join(stageDir, 'PREAMBLE.md'))).toBe(true)
    expect(fs.existsSync(path.join(stageDir, 'SOUL.md'))).toBe(true)
    expect(fs.existsSync(path.join(stageDir, 'tools', 'a.txt'))).toBe(true)
  })
})
