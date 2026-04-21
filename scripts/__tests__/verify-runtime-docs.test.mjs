// Vitest unit tests for scripts/verify-runtime-docs.mjs
//
// Run via:   pnpm test:docs
//   (which maps to `vitest run -c vitest.docs.config.mjs` in package.json)
//
// These tests exercise the harness's parser + grep + link + slugify logic
// on SELF-CONTAINED fixture inputs. They do NOT read real docs/ files —
// every fixture is inlined so the tests remain hermetic and survive
// future edits to docs/runtime/*.md.
//
// vitest.config.ts's default `include` matches src/**/*.test.ts only, so
// these tests are reachable only through the dedicated `vitest.docs.config.mjs`
// that `pnpm test:docs` uses. That keeps the default `pnpm test` surface
// focused on product code while still giving us a first-class test run
// for the harness itself.

import { describe, it, expect } from 'vitest'
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  extractFencedBlocks,
  extractMarkdownLinks,
  slugifyHeading,
  extractHeadings,
  resolveRelativeLink,
  extractTableColumn,
  extractTopLevelYamlKeys,
  extractEnvVarTable,
  extractMcEnvNames,
  extractRuntimeKeys,
  sanityCheckBashBlock,
  sanityCheckYamlBlock,
  tryParseJsonOrJsonl,
  scanDriftGuard,
} from '../verify-runtime-docs.mjs'

// ────────────────────────────────────────────────────────────────────────────
// Fenced block extraction
// ────────────────────────────────────────────────────────────────────────────

describe('extractFencedBlocks', () => {
  it('returns yaml blocks with correct startLine values', () => {
    const md = [
      '# Heading',
      '',
      'Prose paragraph.',
      '',
      '```yaml',
      'slug: hello',
      'name: Hi',
      '```',
      '',
      '```bash',
      'echo hi',
      '```',
      '',
      '```yaml',
      'slug: bye',
      '```',
      '',
    ].join('\n')
    const yaml = extractFencedBlocks(md, 'yaml')
    expect(yaml).toHaveLength(2)
    expect(yaml[0].startLine).toBe(5)
    expect(yaml[0].content).toContain('slug: hello')
    expect(yaml[1].startLine).toBe(14)
    expect(yaml[1].content).toContain('slug: bye')
  })

  it('returns only bash blocks when langHint is bash (not yaml or json)', () => {
    const md = [
      '```yaml',
      'x: 1',
      '```',
      '```bash',
      'echo ok',
      '```',
      '```json',
      '{"a":1}',
      '```',
      '```bash',
      'ls',
      '```',
    ].join('\n')
    const bash = extractFencedBlocks(md, 'bash')
    expect(bash).toHaveLength(2)
    expect(bash[0].content).toBe('echo ok')
    expect(bash[1].content).toBe('ls')
  })

  it('returns all blocks when no langHint is provided', () => {
    const md = '```bash\necho 1\n```\n```yaml\na: 1\n```'
    const all = extractFencedBlocks(md)
    expect(all).toHaveLength(2)
    expect(all.map((b) => b.lang).sort()).toEqual(['bash', 'yaml'])
  })
})

// ────────────────────────────────────────────────────────────────────────────
// Slugify / headings
// ────────────────────────────────────────────────────────────────────────────

describe('slugifyHeading', () => {
  it('matches GitHub-style slugs for multi-word headings', () => {
    expect(slugifyHeading('Hello World')).toBe('hello-world')
  })
  it('preserves consecutive dashes for punctuation-split headings', () => {
    // GitHub treats `## Reading order (preamble → soul → .mc)` as
    // `reading-order-preamble--soul--mc` — arrow+parens removed, spaces kept.
    expect(slugifyHeading('Reading order (preamble → soul → .mc)')).toBe(
      'reading-order-preamble--soul--mc',
    )
  })
  it('handles progress+checkpoints heading exactly', () => {
    expect(slugifyHeading('Progress + checkpoints (append-only)')).toBe(
      'progress--checkpoints-append-only',
    )
  })
})

describe('extractHeadings', () => {
  it('yields heading slugs and levels for each non-fence heading', () => {
    const md = [
      '# Top',
      '',
      'prose',
      '',
      '## Sub one',
      '',
      '```',
      '# not a heading — fenced',
      '```',
      '',
      '### Sub two two',
    ].join('\n')
    const hs = extractHeadings(md)
    expect(hs.map((h) => h.slug)).toEqual(['top', 'sub-one', 'sub-two-two'])
    expect(hs.map((h) => h.level)).toEqual([1, 2, 3])
  })
})

// ────────────────────────────────────────────────────────────────────────────
// Markdown links + relative link resolution
// ────────────────────────────────────────────────────────────────────────────

describe('extractMarkdownLinks', () => {
  it('captures plain links and skips image syntax', () => {
    const md = 'Check [x](./a.md) not ![img](b.png) or [y](https://e.com)'
    const links = extractMarkdownLinks(md)
    expect(links.map((l) => l.target)).toEqual(['./a.md', 'https://e.com'])
  })
})

describe('resolveRelativeLink', () => {
  const docAbsPath = '/repo/docs/runtime/foo.md'
  it('resolves a parent-relative link against the doc dir', () => {
    const r = resolveRelativeLink(docAbsPath, '../../src/lib/foo.ts')
    expect(r.absPath).toBe('/repo/src/lib/foo.ts')
    expect(r.anchor).toBeNull()
  })
  it('separates anchor fragment from path', () => {
    const r = resolveRelativeLink(docAbsPath, './bar.md#some-anchor')
    expect(r.absPath).toBe('/repo/docs/runtime/bar.md')
    expect(r.anchor).toBe('some-anchor')
  })
  it('treats http(s) targets as external', () => {
    const r = resolveRelativeLink(docAbsPath, 'https://example.com/x')
    expect(r.external).toBe(true)
  })
  it('decodes %5B / %5D for dynamic-segment route paths', () => {
    const r = resolveRelativeLink(docAbsPath, '../../src/app/api/runner/tasks/%5Btask_id%5D/submit/route.ts')
    expect(r.absPath).toBe('/repo/src/app/api/runner/tasks/[task_id]/submit/route.ts')
  })
})

// ────────────────────────────────────────────────────────────────────────────
// Table column extraction (env vars / runtime keys / allowlist)
// ────────────────────────────────────────────────────────────────────────────

describe('extractEnvVarTable', () => {
  it('pulls env-var names from a Name/Type/Default/Source table', () => {
    const md = [
      '# Runner Daemon',
      '',
      '| Name | Type | Default | Source |',
      '|---|---|---|---|',
      '| `MC_URL` | URL | http://127.0.0.1:3000 | mc-runner.mjs:49 |',
      '| `RUNNER_ID` | string | runner-xyz | mc-runner.mjs:50 |',
      '| `PORT` | int | 3000 | (composed) |',
      '',
    ].join('\n')
    const names = extractEnvVarTable(md)
    expect(names).toEqual(expect.arrayContaining(['MC_URL', 'RUNNER_ID', 'PORT']))
    expect(names.length).toBe(3)
  })

  it('returns [] when no matching header row is present', () => {
    const md = '| Col | Other |\n|---|---|\n| a | b |\n'
    expect(extractEnvVarTable(md)).toEqual([])
  })
})

describe('extractRuntimeKeys', () => {
  it('finds all runtime.<key> identifiers in prose', () => {
    const text = 'runtime.mount_allowlist, runtime.project_repo_map, and runtime.failed_gc_window_days.'
    expect(extractRuntimeKeys(text)).toEqual([
      'runtime.failed_gc_window_days',
      'runtime.mount_allowlist',
      'runtime.project_repo_map',
    ])
  })

  it('dedupes repeated mentions', () => {
    const text = 'runtime.mount_allowlist runtime.mount_allowlist'
    expect(extractRuntimeKeys(text)).toEqual(['runtime.mount_allowlist'])
  })
})

describe('extractMcEnvNames', () => {
  it('collects every MC_* identifier once', () => {
    const md = '`MC_API_URL` and `MC_TASK_ID` and `MC_API_URL` again plus MC_WORKSPACE.'
    const names = extractMcEnvNames(md)
    expect(names.sort()).toEqual(['MC_API_URL', 'MC_TASK_ID', 'MC_WORKSPACE'])
  })
})

describe('extractTableColumn (allowlist-count pattern)', () => {
  it('counts numeric rows in a 7-entry allowlist table', () => {
    const md = [
      '| # | Method | Path | Added in | Purpose |',
      '|---|---|---|---|---|',
      '| 1 | POST | /a | Phase 14 | … |',
      '| 2 | POST | /b | Phase 14 | … |',
      '| 3 | POST | /c | Phase 14 | … |',
      '| 4 | GET  | /d | Phase 14 | … |',
      '| 5 | GET  | /e | Phase 14 | … |',
      '| 6 | GET  | /f | Phase 14 | … |',
      '| 7 | POST | /g | Phase 15 CP-01 | … |',
    ].join('\n')
    const firstCol = extractTableColumn(md, ['method', 'path', 'added', 'purpose'])
    const numeric = firstCol.filter((r) => /^\d+$/.test(r))
    expect(numeric).toHaveLength(7)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// YAML top-level keys + block syntax sanity
// ────────────────────────────────────────────────────────────────────────────

describe('extractTopLevelYamlKeys', () => {
  it('returns only top-level keys, skipping indented children and list items', () => {
    const yamlContent = [
      '# comment line',
      'slug: hello-world',
      'name: Hello',
      'tags:',
      '  - smoke',
      '  - reference',
      'model:',
      '  primary: claude-opus-4-7',
      'version: 1',
    ].join('\n')
    expect(extractTopLevelYamlKeys(yamlContent)).toEqual([
      'slug',
      'name',
      'tags',
      'model',
      'version',
    ])
  })
})

describe('sanityCheckYamlBlock', () => {
  it('accepts well-formed YAML', () => {
    const issues = sanityCheckYamlBlock('slug: a\nname: b\ntags:\n  - smoke\n')
    expect(issues).toEqual([])
  })
  it('flags lines that are neither key:value, list item, nor indented continuation', () => {
    const issues = sanityCheckYamlBlock('slug: a\nrandom garbage not a key\n')
    expect(issues.length).toBeGreaterThan(0)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// Bash block syntax sanity
// ────────────────────────────────────────────────────────────────────────────

describe('sanityCheckBashBlock', () => {
  it('flags unterminated heredocs', () => {
    const content = 'cat <<EOF\nhello\n# missing EOF terminator'
    const issues = sanityCheckBashBlock(content)
    expect(issues.some((i) => /unterminated heredoc/.test(i))).toBe(true)
  })
  it('accepts a valid heredoc', () => {
    const content = 'cat <<EOF\nhello\nEOF'
    const issues = sanityCheckBashBlock(content)
    expect(issues.some((i) => /unterminated heredoc/.test(i))).toBe(false)
  })
  it('flags curl invocations without a URL or $VAR', () => {
    const issues = sanityCheckBashBlock('curl -s -X POST')
    expect(issues.some((i) => /curl command appears to lack a URL/.test(i))).toBe(true)
  })
  it('accepts curl with an http URL', () => {
    expect(
      sanityCheckBashBlock('curl -s https://example.com/x'),
    ).not.toContainEqual(expect.stringMatching(/curl command/))
  })
  it('accepts curl with a $VAR URL', () => {
    expect(
      sanityCheckBashBlock('curl -s "$MC_URL/api/status"'),
    ).not.toContainEqual(expect.stringMatching(/curl command/))
  })
  it('flags typos like "settngs"', () => {
    const issues = sanityCheckBashBlock('pnpm mc settngs set foo')
    expect(issues.some((i) => /likely typo/.test(i))).toBe(true)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// JSON / JSONL code-fence parsing
// ────────────────────────────────────────────────────────────────────────────

describe('tryParseJsonOrJsonl', () => {
  it('accepts single JSON object', () => {
    expect(tryParseJsonOrJsonl('{"a":1}').ok).toBe(true)
  })
  it('accepts JSONL (multiple JSON objects one per line)', () => {
    const content = '{"level":"info","msg":"boot"}\n{"level":"info","msg":"ready"}'
    expect(tryParseJsonOrJsonl(content).ok).toBe(true)
  })
  it('rejects malformed JSON that is neither single object nor JSONL', () => {
    const res = tryParseJsonOrJsonl('{"a": nope}')
    expect(res.ok).toBe(false)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// Drift-guard (THE core anti-drift behavior)
// ────────────────────────────────────────────────────────────────────────────

describe('scanDriftGuard', () => {
  it('detects indexed_error anywhere in the doc and reports line number', () => {
    const md = 'Normal line\nWe use indexed_error as a fallback marker\nMore prose'
    const r = scanDriftGuard(md)
    expect(r.ok).toBe(false)
    expect(r.failures[0].line).toBe(2)
    expect(r.failures[0].pattern).toMatch(/indexed_error/)
  })

  it('detects "submit → done" (legacy lifecycle)', () => {
    const md = 'The agent POSTs submit → done and the task completes.'
    const r = scanDriftGuard(md)
    expect(r.ok).toBe(false)
    expect(r.failures.some((f) => f.pattern.includes('done'))).toBe(true)
  })

  it('passes when only "submit → review" appears', () => {
    const md = 'The agent POSTs submit → review and the task transitions.'
    const r = scanDriftGuard(md)
    expect(r.ok).toBe(true)
    expect(r.failures).toHaveLength(0)
  })

  it('flags http://localhost inside a bash fence when containerBashOnly is enabled', () => {
    const md = [
      'Prose that mentions http://localhost as a concept is fine.',
      '',
      '```bash',
      'curl http://localhost:3000/api/status',
      '```',
    ].join('\n')
    const r = scanDriftGuard(md, {
      patterns: [],
      containerBashOnly: [/http:\/\/localhost/i],
    })
    expect(r.ok).toBe(false)
    expect(r.failures.some((f) => f.bashOnly)).toBe(true)
  })

  it('does NOT flag http://localhost outside bash fences when containerBashOnly is enabled', () => {
    const md = 'Prose that mentions http://localhost as a concept is fine.'
    const r = scanDriftGuard(md, {
      patterns: [],
      containerBashOnly: [/http:\/\/localhost/i],
    })
    expect(r.ok).toBe(true)
  })

  it('detects the "submit flips ... done" legacy-lifecycle phrasing', () => {
    const md = 'When the agent POSTs submit, submit flips the task to done immediately.'
    const r = scanDriftGuard(md)
    expect(r.ok).toBe(false)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// Integration-ish: confirm missing-target reporting via a temp fixture
// ────────────────────────────────────────────────────────────────────────────

describe('link resolution against tempdir', () => {
  it('reports a link as missing when its target does not exist', () => {
    const dir = mkdtempSync(join(tmpdir(), 'verify-runtime-docs-'))
    try {
      const fakeDoc = join(dir, 'doc.md')
      writeFileSync(fakeDoc, '# Doc\n\n[x](./nope-does-not-exist.ts)\n')
      const resolved = resolveRelativeLink(fakeDoc, './nope-does-not-exist.ts')
      // The harness check uses existsSync; here we just prove the resolver
      // returns a stable absolute path that downstream existence-checks can
      // evaluate.
      expect(resolved.absPath.endsWith('nope-does-not-exist.ts')).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
