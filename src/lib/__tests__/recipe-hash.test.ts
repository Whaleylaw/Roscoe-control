import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { computeDirSha } from '../recipe-hash'

describe('computeDirSha', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'recipe-hash-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns the same sha for identical content across runs', async () => {
    writeFileSync(join(dir, 'recipe.yaml'), 'slug: a\n')
    writeFileSync(join(dir, 'SOUL.md'), '# hi')
    const sha1 = await computeDirSha(dir)
    const sha2 = await computeDirSha(dir)
    expect(sha1).toBe(sha2)
    expect(sha1).toMatch(/^[0-9a-f]{64}$/)
  })

  it('changes when any file content changes (single byte flip)', async () => {
    writeFileSync(join(dir, 'recipe.yaml'), 'slug: a\n')
    const before = await computeDirSha(dir)
    writeFileSync(join(dir, 'recipe.yaml'), 'slug: b\n')
    const after = await computeDirSha(dir)
    expect(before).not.toBe(after)
  })

  it('includes nested files under tools/, skills/, and references/', async () => {
    writeFileSync(join(dir, 'recipe.yaml'), 'slug: a\n')
    const sha0 = await computeDirSha(dir)

    mkdirSync(join(dir, 'tools'))
    writeFileSync(join(dir, 'tools', 'helper.sh'), '#!/bin/sh\necho hi\n')
    const sha1 = await computeDirSha(dir)
    expect(sha0).not.toBe(sha1)

    mkdirSync(join(dir, 'skills'))
    writeFileSync(join(dir, 'skills', 'searching.md'), 'how to search')
    const sha2 = await computeDirSha(dir)
    expect(sha1).not.toBe(sha2)

    mkdirSync(join(dir, 'references'))
    writeFileSync(join(dir, 'references', 'source-skill.md'), 'legacy skill guidance')
    const sha3 = await computeDirSha(dir)
    expect(sha2).not.toBe(sha3)
  })

  it('ignores files outside recipe.yaml/SOUL.md/README.md/tools/skills/references (editor temp files do not affect sha)', async () => {
    writeFileSync(join(dir, 'recipe.yaml'), 'slug: a\n')
    const before = await computeDirSha(dir)

    writeFileSync(join(dir, '.recipe.yaml.swp'), 'editor temp file')
    writeFileSync(join(dir, 'recipe.yaml~'), 'editor backup')
    writeFileSync(join(dir, 'notes.txt'), 'stray text file')

    const after = await computeDirSha(dir)
    expect(before).toBe(after)
  })

  it('is path-order-invariant: creating files in different orders yields same sha (sort invariance)', async () => {
    mkdirSync(join(dir, 'tools'))
    writeFileSync(join(dir, 'tools', 'a.sh'), 'a')
    writeFileSync(join(dir, 'tools', 'b.sh'), 'b')
    writeFileSync(join(dir, 'recipe.yaml'), 'slug: test\n')
    const sha1 = await computeDirSha(dir)

    // Re-create in a different order in a fresh dir
    const dir2 = mkdtempSync(join(tmpdir(), 'recipe-hash-'))
    try {
      writeFileSync(join(dir2, 'recipe.yaml'), 'slug: test\n')
      mkdirSync(join(dir2, 'tools'))
      writeFileSync(join(dir2, 'tools', 'b.sh'), 'b')
      writeFileSync(join(dir2, 'tools', 'a.sh'), 'a')
      const sha2 = await computeDirSha(dir2)
      expect(sha1).toBe(sha2)
    } finally {
      rmSync(dir2, { recursive: true, force: true })
    }
  })
})
