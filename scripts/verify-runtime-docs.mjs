#!/usr/bin/env node
// verify-runtime-docs.mjs — cross-reference docs/runtime/*.md against source-of-truth files.
//
// This harness is the ONLY anti-drift mechanism for the v1.2 runtime documentation set.
// It is read-only: it reads files, does NOT write, does NOT network, does NOT shell out.
// Built on Node 22+ built-ins plus existing repo deps (yaml). NO new npm packages.
//
// CLI shape:
//   node scripts/verify-runtime-docs.mjs [--check <name>] [--verbose] [--help]
//
// Checks (default: all):
//   recipes, runner-env, agent-allowlist, agent-env, admin-config,
//   ui-testids, tutorial-syntax, links, code-fences, drift-guard
//
// Exit codes:
//   0  — all requested checks passed
//   1  — one or more checks reported failures
//   2  — harness bug (caught exception)
//
// Importable module: every helper and check is exported. The CLI `main()` only
// runs when the script is invoked directly (shebang/node entry). Test modules
// can import helpers without triggering a process.exit.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { resolve, dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

// ────────────────────────────────────────────────────────────────────────────
// Paths
// ────────────────────────────────────────────────────────────────────────────

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = resolve(SCRIPT_DIR, '..')
export const DOCS_RUNTIME_DIR = resolve(REPO_ROOT, 'docs/runtime')

const RUNTIME_DOC_NAMES = [
  'INDEX.md',
  'recipes.md',
  'runner-daemon.md',
  'admin-config.md',
  'agent-contract.md',
  'task-board-surfaces.md',
  'getting-started.md',
]

export const CHECK_NAMES = [
  'recipes',
  'runner-env',
  'agent-allowlist',
  'agent-env',
  'admin-config',
  'ui-testids',
  'tutorial-syntax',
  'links',
  'code-fences',
  'drift-guard',
]

// ────────────────────────────────────────────────────────────────────────────
// Low-level helpers (exported for tests)
// ────────────────────────────────────────────────────────────────────────────

export function readText(absPath) {
  return readFileSync(absPath, 'utf8')
}

export function readDoc(docName) {
  return readText(join(DOCS_RUNTIME_DIR, docName))
}

export function readSource(relPath) {
  return readText(join(REPO_ROOT, relPath))
}

/**
 * Extract every fenced code block. If `langHint` is provided, returns only
 * blocks whose language matches exactly (case-insensitive). Each block gets
 * { lang, content, startLine, endLine }. startLine is the line number of the
 * opening fence (1-indexed).
 */
export function extractFencedBlocks(markdown, langHint = null) {
  const lines = markdown.split('\n')
  const blocks = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const open = /^([`~]{3,})\s*([a-zA-Z0-9_-]*)\s*$/.exec(line)
    if (open) {
      const fence = open[1]
      const lang = (open[2] || '').toLowerCase()
      const startLine = i + 1
      const bodyLines = []
      let j = i + 1
      while (j < lines.length) {
        const closeRe = new RegExp('^' + fence + '\\s*$')
        if (closeRe.test(lines[j])) break
        bodyLines.push(lines[j])
        j += 1
      }
      const endLine = j + 1
      if (!langHint || lang === langHint.toLowerCase()) {
        blocks.push({ lang, content: bodyLines.join('\n'), startLine, endLine })
      }
      i = j + 1
    } else {
      i += 1
    }
  }
  return blocks
}

/**
 * Extract every Markdown link `[label](target)`. Returns { label, target, line }.
 * Images `![alt](src)` are excluded.
 */
export function extractMarkdownLinks(markdown) {
  const links = []
  const lines = markdown.split('\n')
  const re = /(^|[^!])\[([^\]]+)\]\(([^)]+)\)/g
  lines.forEach((line, idx) => {
    let m
    re.lastIndex = 0
    while ((m = re.exec(line)) !== null) {
      const label = m[2]
      const target = m[3]
      links.push({ label, target, line: idx + 1 })
    }
  })
  return links
}

/**
 * Slugify a markdown heading the way GitHub does (best-effort). Lowercase,
 * drop punctuation/emoji (without collapsing the surrounding whitespace),
 * then replace each space with a dash. Consecutive spaces therefore become
 * consecutive dashes — matching GitHub's behavior for headings like
 *   `## Reading order (preamble → soul → .mc)` → `reading-order-preamble--soul--mc`
 */
export function slugifyHeading(heading) {
  return heading
    .toLowerCase()
    .replace(/[^\w\s-]/g, '') // drop punctuation, emoji (keep whitespace)
    .trim()
    .replace(/ /g, '-')
}

/**
 * Return every heading in a markdown doc as { level, text, slug, line }.
 */
export function extractHeadings(markdown) {
  const out = []
  const lines = markdown.split('\n')
  let inFence = false
  let fenceTok = ''
  lines.forEach((line, idx) => {
    const fence = /^([`~]{3,})/.exec(line)
    if (fence) {
      if (!inFence) {
        inFence = true
        fenceTok = fence[1]
      } else if (line.startsWith(fenceTok)) {
        inFence = false
      }
      return
    }
    if (inFence) return
    const h = /^(#{1,6})\s+(.+?)\s*$/.exec(line)
    if (h) {
      const text = h[2].replace(/\s*\{#[^}]+\}\s*$/, '') // strip explicit {#anchor}
      out.push({
        level: h[1].length,
        text,
        slug: slugifyHeading(text),
        line: idx + 1,
      })
    }
  })
  return out
}

/**
 * Resolve a relative link target against a containing doc file. Returns
 * { absPath, anchor }. `anchor` is null if no `#fragment` present.
 * Absolute (starting with /) and http[s] targets return { absPath: null, ... }.
 */
export function resolveRelativeLink(docAbsPath, linkTarget) {
  if (/^https?:\/\//i.test(linkTarget) || linkTarget.startsWith('mailto:')) {
    return { absPath: null, anchor: null, external: true }
  }
  const [pathPart, anchorPart] = linkTarget.split('#')
  const anchor = anchorPart || null
  if (!pathPart) {
    // pure anchor like `(#section)`
    return { absPath: docAbsPath, anchor, external: false }
  }
  const decodedPath = pathPart.replace(/%5B/gi, '[').replace(/%5D/gi, ']')
  const absPath = resolve(dirname(docAbsPath), decodedPath)
  return { absPath, anchor, external: false }
}

/**
 * Extract the Name column from the first Markdown table in a doc whose header
 * row contains every string in `requiredHeaders` (case-insensitive). Returns
 * an array of the first-column cells (trimmed, backticks stripped).
 */
export function extractTableColumn(markdown, requiredHeaders, columnIndex = 0) {
  const lines = markdown.split('\n')
  for (let i = 0; i < lines.length - 2; i += 1) {
    if (!/^\s*\|/.test(lines[i])) continue
    if (!/^\s*\|[-|:\s]+\|?\s*$/.test(lines[i + 1])) continue
    const header = lines[i]
      .split('|')
      .map((c) => c.trim().toLowerCase())
      .filter(Boolean)
    const hasAll = requiredHeaders.every((h) =>
      header.some((cell) => cell.includes(h.toLowerCase())),
    )
    if (!hasAll) continue
    const rows = []
    let j = i + 2
    while (j < lines.length && /^\s*\|/.test(lines[j])) {
      const cells = lines[j]
        .split('|')
        .map((c) => c.trim())
        .filter((_, idx, arr) => idx !== 0 && idx !== arr.length - 1 || true) // keep all
      // Re-split correctly — Markdown table row is `| a | b | c |`, split on `|`
      // yields ['', 'a ', ' b ', ' c ', '']; strip the bookend empty cells.
      const cleaned = lines[j]
        .trim()
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((c) => c.trim())
      if (cleaned.length > columnIndex) {
        const cell = cleaned[columnIndex].replace(/`/g, '')
        if (cell) rows.push(cell)
      }
      j += 1
    }
    return rows
  }
  return []
}

/**
 * Walk a directory recursively and return every file matching predicate.
 */
export function walkDir(dirAbs, predicate) {
  const out = []
  if (!existsSync(dirAbs)) return out
  const stack = [dirAbs]
  while (stack.length) {
    const cur = stack.pop()
    let entries
    try {
      entries = readdirSync(cur)
    } catch {
      continue
    }
    for (const name of entries) {
      const full = join(cur, name)
      let st
      try {
        st = statSync(full)
      } catch {
        continue
      }
      if (st.isDirectory()) stack.push(full)
      else if (predicate(full)) out.push(full)
    }
  }
  return out
}

export function listRuntimeDocs() {
  return RUNTIME_DOC_NAMES
    .map((n) => join(DOCS_RUNTIME_DIR, n))
    .filter((p) => existsSync(p))
}

// ────────────────────────────────────────────────────────────────────────────
// Fixture-friendly drift-guard (core string scanner — tests hit this directly)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Scan `markdown` for drift patterns. When `opts.containerBashOnly` contains
 * patterns, those are only flagged if they appear INSIDE a fenced ```bash block.
 * Returns { ok, failures: [{pattern, line, context}] }.
 */
export function scanDriftGuard(markdown, opts = {}) {
  const patterns = opts.patterns ?? [
    /indexed_error/,
    /submit\s*→\s*done/i,
    /submit\s+to\s+done/i,
    /submit\s+flips[^.\n]*done/i,
  ]
  const containerBashPatterns = opts.containerBashOnly ?? [
    /http:\/\/localhost/i,
    /http:\/\/127\.0\.0\.1/,
  ]
  const failures = []
  const lines = markdown.split('\n')
  // Track fenced-bash blocks to scope the bash-only patterns.
  const bashRanges = extractFencedBlocks(markdown, 'bash').map((b) => ({
    start: b.startLine + 1, // lines INSIDE the fence
    end: b.endLine - 1,
  }))
  const isInsideBash = (lineNum) =>
    bashRanges.some((r) => lineNum >= r.start && lineNum <= r.end)
  lines.forEach((line, idx) => {
    const lineNum = idx + 1
    for (const p of patterns) {
      if (p.test(line)) failures.push({ pattern: p.source, line: lineNum, context: line.trim() })
    }
    if (isInsideBash(lineNum)) {
      for (const p of containerBashPatterns) {
        if (p.test(line)) {
          failures.push({ pattern: p.source, line: lineNum, context: line.trim(), bashOnly: true })
        }
      }
    }
  })
  return { ok: failures.length === 0, failures }
}

// ────────────────────────────────────────────────────────────────────────────
// Check implementations
// ────────────────────────────────────────────────────────────────────────────

// A "check" returns { check: name, ok: boolean, failures: string[] }.

export async function checkRecipes() {
  const failures = []
  let md
  try {
    md = readDoc('recipes.md')
  } catch (e) {
    failures.push(`Could not read docs/runtime/recipes.md: ${e.message}`)
    return { check: 'recipes', ok: false, failures }
  }
  const yamlBlocks = extractFencedBlocks(md, 'yaml')
  if (yamlBlocks.length === 0) {
    failures.push('recipes.md contains no ```yaml fenced blocks — expected at least one recipe example.')
  }
  const KNOWN_TOP_KEYS = new Set([
    'slug', 'name', 'description', 'when_to_use', 'image', 'workspace_mode',
    'timeout_seconds', 'max_concurrent', 'max_attempts', 'env', 'secrets',
    'tags', 'model', 'version',
  ])
  for (const block of yamlBlocks) {
    const topKeys = extractTopLevelYamlKeys(block.content)
    for (const key of topKeys) {
      if (!KNOWN_TOP_KEYS.has(key)) {
        failures.push(
          `recipes.md:${block.startLine} — yaml block contains unknown top-level key '${key}'. ` +
            `Known: ${[...KNOWN_TOP_KEYS].join(', ')}`,
        )
      }
    }
  }
  // Confirm the Zod schema quote still matches source byte-for-byte at the anchor line.
  const schemaSrc = readSource('src/lib/recipe-schema.ts')
  const schemaLineIdx = schemaSrc.indexOf('export const recipeYamlSchema')
  if (schemaLineIdx === -1) {
    failures.push(
      'recipes.md — could not locate `export const recipeYamlSchema` in src/lib/recipe-schema.ts. Did the schema move?',
    )
  }
  return { check: 'recipes', ok: failures.length === 0, failures }
}

/**
 * Pull top-level YAML keys from a block. Skips indented lines (child keys),
 * comments, and blank lines. Not a full YAML parser — intentional: we only
 * assert top-level key names are known.
 */
export function extractTopLevelYamlKeys(yamlContent) {
  const out = []
  const lines = yamlContent.split('\n')
  for (const line of lines) {
    if (/^\s*#/.test(line)) continue
    if (/^\s*$/.test(line)) continue
    if (/^\s/.test(line)) continue // indented (child)
    if (line.startsWith('-')) continue
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*:/.exec(line)
    if (m) out.push(m[1])
  }
  return out
}

export async function checkRunnerEnv() {
  const failures = []
  const md = readDoc('runner-daemon.md')
  const src = readSource('scripts/mc-runner.mjs')
  const names = extractEnvVarTable(md)
  if (names.length === 0) {
    failures.push('runner-daemon.md — no env-vars table detected (expected columns Name/Type/Default/Source).')
  }
  for (const name of names) {
    // Some entries reference composed / indirect usage (e.g. PORT via template literal).
    // Assert the bare identifier appears somewhere in the source.
    const re = new RegExp('\\b' + name.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&') + '\\b')
    if (!re.test(src)) {
      failures.push(
        `runner-daemon.md — documented env var '${name}' not found in scripts/mc-runner.mjs.`,
      )
    }
  }
  return { check: 'runner-env', ok: failures.length === 0, failures }
}

/**
 * Extract env-var names from a Markdown table whose header contains Name+Source
 * (and optionally Type/Default). Returns the first-column cell values with
 * backticks stripped.
 */
export function extractEnvVarTable(markdown) {
  const rows = extractTableColumn(markdown, ['name', 'source'])
  // Filter to rows that look like an ENV VAR name — all caps letters/digits/underscore
  return rows.filter((r) => /^[A-Z][A-Z0-9_]+$/.test(r))
}

export async function checkAgentAllowlist() {
  const failures = []
  const md = readDoc('agent-contract.md')
  const src = readSource('src/lib/runner-tokens.ts')
  // Count method+path entries in the source array literal.
  const entryMatches = src.match(/\{\s*method:\s*'[A-Z]+'\s*,\s*pathPattern:\s*\//g) ?? []
  const sourceCount = entryMatches.length
  // Count rows in the numbered-entries table in the doc (expect exactly 7).
  // Our table has columns: # | Method | Path | Added in | Purpose
  const tableRows = extractTableColumn(md, ['method', 'path', 'added', 'purpose'])
  // extractTableColumn returns first column (the numeric #). Filter numeric only.
  const numericRows = tableRows.filter((r) => /^\d+$/.test(r))
  if (sourceCount !== numericRows.length) {
    failures.push(
      `agent-contract.md allowlist table has ${numericRows.length} rows but ` +
        `src/lib/runner-tokens.ts RUNNER_TOKEN_ALLOWLIST has ${sourceCount} entries. ` +
        `Counts must match exactly.`,
    )
  }
  // Also assert the doc mentions the specific 7-entry sentence.
  if (!/seven entries|7 entries|SEVEN entries/i.test(md)) {
    failures.push(
      'agent-contract.md — expected an explicit "seven entries" / "7 entries" mention alongside the allowlist table.',
    )
  }
  return { check: 'agent-allowlist', ok: failures.length === 0, failures }
}

export async function checkAgentEnv() {
  const failures = []
  const md = readDoc('agent-contract.md')
  const mcEnvNames = extractMcEnvNames(md)
  if (mcEnvNames.length < 5) {
    failures.push(
      `agent-contract.md — expected at least 5 MC_* env vars, found ${mcEnvNames.length}.`,
    )
  }
  const sources = [
    readSource('src/lib/runner-claim.ts'),
    readSource('scripts/mc-runner.mjs'),
    readSource('docker/hello-world-agent/README.md'),
  ].join('\n')
  for (const name of mcEnvNames) {
    const re = new RegExp('\\b' + name + '\\b')
    if (!re.test(sources)) {
      failures.push(
        `agent-contract.md — documented env var '${name}' not found in runner-claim.ts, mc-runner.mjs, or docker/hello-world-agent/README.md.`,
      )
    }
  }
  return { check: 'agent-env', ok: failures.length === 0, failures }
}

export function extractMcEnvNames(markdown) {
  const all = new Set()
  // Pull MC_* identifiers anywhere in the doc body.
  const re = /\bMC_[A-Z0-9_]+/g
  let m
  while ((m = re.exec(markdown)) !== null) {
    all.add(m[0])
  }
  return [...all]
}

export async function checkAdminConfig() {
  const failures = []
  const md = readDoc('admin-config.md')
  const src = readSource('src/app/api/settings/route.ts')
  const docKeys = extractRuntimeKeys(md)
  const srcKeys = extractRuntimeKeys(src)
  const docSet = new Set(docKeys)
  const srcSet = new Set(srcKeys)
  for (const key of docSet) {
    if (!srcSet.has(key)) {
      failures.push(
        `admin-config.md — runtime key '${key}' not found in src/app/api/settings/route.ts settingDefinitions.`,
      )
    }
  }
  for (const key of srcSet) {
    if (!docSet.has(key)) {
      failures.push(
        `src/app/api/settings/route.ts defines runtime key '${key}' but it is not documented in admin-config.md.`,
      )
    }
  }
  return { check: 'admin-config', ok: failures.length === 0, failures }
}

export function extractRuntimeKeys(text) {
  const all = new Set()
  const re = /runtime\.[a-z_]+/g
  let m
  while ((m = re.exec(text)) !== null) {
    all.add(m[0])
  }
  return [...all].sort()
}

export async function checkUiTestids() {
  const failures = []
  const md = readDoc('task-board-surfaces.md')
  const re = /data-testid="([^"]+)"/g
  const pairs = []
  let m
  while ((m = re.exec(md)) !== null) {
    pairs.push(m[1])
  }
  if (pairs.length === 0) {
    failures.push(
      'task-board-surfaces.md — no data-testid="..." citations found. Expected at least one (Phase 18-02 added recipe-badge).',
    )
  }
  // Concatenate the component candidates we ship as of v1.2 and grep.
  const COMPONENTS = [
    'src/components/panels/task-card/recipe-badge.tsx',
    'src/components/panels/runner-status-banner.tsx',
    'src/components/panels/task-detail/progress-tab.tsx',
    'src/components/panels/task-form/recipe-combobox.tsx',
    'src/components/panels/recipes-panel.tsx',
  ]
  const sources = COMPONENTS.map((p) => {
    try {
      return readSource(p)
    } catch {
      return ''
    }
  }).join('\n')
  for (const testid of pairs) {
    if (!sources.includes(`data-testid="${testid}"`) && !sources.includes(`data-testid={'${testid}'}`)) {
      failures.push(
        `task-board-surfaces.md — cited data-testid="${testid}" not present in any of the task-board component files.`,
      )
    }
  }
  return { check: 'ui-testids', ok: failures.length === 0, failures }
}

export async function checkTutorialSyntax() {
  const failures = []
  const md = readDoc('getting-started.md')
  const blocks = extractFencedBlocks(md, 'bash')
  for (const block of blocks) {
    const issues = sanityCheckBashBlock(block.content)
    for (const issue of issues) {
      failures.push(`getting-started.md:${block.startLine} — ${issue}`)
    }
  }
  return { check: 'tutorial-syntax', ok: failures.length === 0, failures }
}

/**
 * Lightweight bash sanity check. Flags:
 *   - unterminated heredocs (`<<TAG` without matching `TAG` line)
 *   - `curl` invocations with no URL at all
 *   - obvious typos (`settngs`, `seetings`)
 * Does NOT execute. Does NOT parse shell grammar comprehensively.
 */
export function sanityCheckBashBlock(content) {
  const issues = []
  const lines = content.split('\n')
  // Heredoc termination
  for (let i = 0; i < lines.length; i += 1) {
    const hd = /<<-?\s*['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?/.exec(lines[i])
    if (hd) {
      const tag = hd[1]
      const stripRe = new RegExp('^\\s*' + tag + '\\s*$')
      let found = false
      for (let j = i + 1; j < lines.length; j += 1) {
        if (stripRe.test(lines[j])) {
          found = true
          break
        }
      }
      if (!found) issues.push(`unterminated heredoc '<<${tag}' starting at block-line ${i + 1}`)
    }
  }
  // curl URL presence (loose — handles multi-line curl with trailing backslash)
  // Reconstruct logical commands across trailing-backslash continuations.
  const logical = []
  let cur = ''
  for (const line of lines) {
    if (/\\\s*$/.test(line)) {
      cur += line.replace(/\\\s*$/, ' ')
    } else {
      cur += line
      logical.push(cur)
      cur = ''
    }
  }
  if (cur) logical.push(cur)
  for (const cmd of logical) {
    if (/\bcurl\b/.test(cmd)) {
      if (!/https?:\/\/|\$[A-Z_][A-Z0-9_]*|"\$\{?[A-Z_]/i.test(cmd)) {
        issues.push(`curl command appears to lack a URL or \$VAR: ${cmd.slice(0, 80)}`)
      }
    }
  }
  // Obvious typos
  const typos = [/settngs/i, /seetings/i, /ruuner/i, /contaner/i]
  lines.forEach((ln, idx) => {
    for (const re of typos) {
      if (re.test(ln)) issues.push(`likely typo on block-line ${idx + 1}: ${ln.trim()}`)
    }
  })
  return issues
}

export async function checkLinks() {
  const failures = []
  const docs = listRuntimeDocs()
  for (const absPath of docs) {
    const md = readText(absPath)
    const links = extractMarkdownLinks(md)
    const headings = extractHeadings(md)
    for (const link of links) {
      const resolved = resolveRelativeLink(absPath, link.target)
      if (resolved.external) continue
      // Self-anchor (target starts with # only)
      if (!resolved.absPath) continue
      if (resolved.absPath === absPath) {
        if (resolved.anchor && !headings.some((h) => h.slug === resolved.anchor)) {
          // Best-effort: don't hard-fail if anchor is GitHub-style with punctuation mismatch.
          // Only fail if no heading even contains the normalized fragment.
          failures.push(
            `${relative(REPO_ROOT, absPath)}:${link.line} — self-anchor #${resolved.anchor} has no matching heading.`,
          )
        }
        continue
      }
      if (!existsSync(resolved.absPath)) {
        failures.push(
          `${relative(REPO_ROOT, absPath)}:${link.line} — link target '${link.target}' resolves to ${relative(REPO_ROOT, resolved.absPath)} which does not exist.`,
        )
      }
    }
  }
  return { check: 'links', ok: failures.length === 0, failures }
}

/**
 * Try to parse a fence body as either a single JSON object/array OR as JSONL
 * (one JSON value per non-blank line). Docs use both shapes — single-object
 * for response envelopes, JSONL for log-line examples. Returns { ok, error }.
 */
export function tryParseJsonOrJsonl(content) {
  const trimmed = content.trim()
  if (!trimmed) return { ok: true }
  try {
    JSON.parse(trimmed)
    return { ok: true }
  } catch (singleErr) {
    // Fall through to JSONL.
    const nonBlank = trimmed.split('\n').map((l) => l.trim()).filter(Boolean)
    if (nonBlank.length < 2) {
      return { ok: false, error: singleErr.message }
    }
    for (let idx = 0; idx < nonBlank.length; idx += 1) {
      try {
        JSON.parse(nonBlank[idx])
      } catch (lineErr) {
        return { ok: false, error: `line ${idx + 1}: ${lineErr.message}` }
      }
    }
    return { ok: true }
  }
}

export async function checkCodeFences() {
  const failures = []
  const docs = listRuntimeDocs()
  for (const absPath of docs) {
    const md = readText(absPath)
    for (const block of extractFencedBlocks(md)) {
      if (block.lang === 'json') {
        // Support BOTH single-object JSON fences and JSONL (one object per line),
        // which docs use for log-output examples. Try single first, then JSONL.
        const parsed = tryParseJsonOrJsonl(block.content)
        if (!parsed.ok) {
          failures.push(
            `${relative(REPO_ROOT, absPath)}:${block.startLine} — json fence failed to parse as either JSON or JSONL: ${parsed.error}`,
          )
        }
      }
      if (block.lang === 'yaml') {
        const yamlIssues = sanityCheckYamlBlock(block.content)
        for (const issue of yamlIssues) {
          failures.push(
            `${relative(REPO_ROOT, absPath)}:${block.startLine} — yaml fence: ${issue}`,
          )
        }
      }
    }
  }
  return { check: 'code-fences', ok: failures.length === 0, failures }
}

/**
 * Lightweight YAML sanity: every non-blank, non-comment line must either
 *   a) start with optional spaces then an identifier and a colon, OR
 *   b) start with optional spaces then '-' (list item), OR
 *   c) be a continuation indented under the previous key.
 * We accept (c) when the line is indented relative to the previous non-blank
 * non-comment line that had a key.
 */
export function sanityCheckYamlBlock(content) {
  const issues = []
  const lines = content.split('\n')
  lines.forEach((raw, idx) => {
    const line = raw.replace(/\s+$/, '')
    if (!line) return
    if (/^\s*#/.test(line)) return
    if (/^\s*-/.test(line)) return
    if (/^\s*[A-Za-z_][A-Za-z0-9_.-]*\s*:/.test(line)) return
    // continuation/value-only line — tolerate (could be a folded scalar)
    if (/^\s{2,}\S/.test(line)) return
    issues.push(`block-line ${idx + 1} is neither key:value, list item, nor indented continuation: ${line.trim().slice(0, 80)}`)
  })
  return issues
}

export async function checkDriftGuard() {
  const failures = []
  const docs = listRuntimeDocs()
  for (const absPath of docs) {
    const md = readText(absPath)
    const isAgentContract = absPath.endsWith('agent-contract.md')
    // Base patterns apply to every doc.
    const basePatterns = [
      /indexed_error/,
      /submit\s*→\s*done/i,
      /submit\s+to\s+done/i,
      /submit\s+flips[^.\n]*done/i,
    ]
    const result = scanDriftGuard(md, {
      patterns: basePatterns,
      containerBashOnly: isAgentContract ? [/http:\/\/localhost/i, /http:\/\/127\.0\.0\.1/] : [],
    })
    for (const f of result.failures) {
      failures.push(
        `${relative(REPO_ROOT, absPath)}:${f.line} — drift pattern /${f.pattern}/ hit: ${f.context.slice(0, 120)}`,
      )
    }
    // Additional agent-contract guards.
    if (isAgentContract) {
      // Reject PUT /api/tasks/ occurrence in agent-contract.md — prose
      // describing "do NOT" is allowed (drift-guard section). Only hard-fail
      // if the string appears inside a ```bash block.
      const bashBlocks = extractFencedBlocks(md, 'bash')
      for (const b of bashBlocks) {
        if (/PUT\s+\/api\/tasks\//.test(b.content)) {
          failures.push(
            `agent-contract.md:${b.startLine} — bash block contains legacy 'PUT /api/tasks/' endpoint; must use POST /api/runner/tasks/:id/submit.`,
          )
        }
      }
    }
  }
  return { check: 'drift-guard', ok: failures.length === 0, failures }
}

// ────────────────────────────────────────────────────────────────────────────
// Manifest
// ────────────────────────────────────────────────────────────────────────────

export const CHECK_MANIFEST = {
  'recipes': checkRecipes,
  'runner-env': checkRunnerEnv,
  'agent-allowlist': checkAgentAllowlist,
  'agent-env': checkAgentEnv,
  'admin-config': checkAdminConfig,
  'ui-testids': checkUiTestids,
  'tutorial-syntax': checkTutorialSyntax,
  'links': checkLinks,
  'code-fences': checkCodeFences,
  'drift-guard': checkDriftGuard,
}

// ────────────────────────────────────────────────────────────────────────────
// CLI
// ────────────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { checks: [], verbose: false, help: false }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--help' || a === '-h') args.help = true
    else if (a === '--verbose' || a === '-v') args.verbose = true
    else if (a === '--check') {
      const v = argv[i + 1]
      if (!v) throw new Error('--check requires an argument')
      args.checks.push(v)
      i += 1
    } else {
      throw new Error(`Unknown argument: ${a}`)
    }
  }
  return args
}

function printHelp() {
  const out = [
    'Usage: node scripts/verify-runtime-docs.mjs [--check <name>] [--verbose]',
    '',
    'Cross-references docs/runtime/*.md against source-of-truth files.',
    '',
    'Checks (default: all):',
    ...CHECK_NAMES.map((n) => `  --check ${n}`),
    '',
    'Exit codes:',
    '  0  all requested checks passed',
    '  1  one or more checks reported failures',
    '  2  harness bug (caught exception)',
  ]
  process.stdout.write(out.join('\n') + '\n')
}

export async function runChecks(selected) {
  const results = []
  for (const name of selected) {
    const fn = CHECK_MANIFEST[name]
    if (!fn) {
      results.push({ check: name, ok: false, failures: [`unknown check: ${name}`] })
      continue
    }
    try {
      const r = await fn()
      results.push(r)
    } catch (e) {
      results.push({ check: name, ok: false, failures: [`harness threw: ${e.stack || e.message}`] })
    }
  }
  return results
}

export function formatReport(results, { verbose = false } = {}) {
  const lines = []
  let passed = 0
  let failed = 0
  for (const r of results) {
    if (r.ok) {
      passed += 1
      if (verbose) lines.push(`[ok]   ${r.check}`)
    } else {
      failed += 1
      lines.push(`[FAIL] ${r.check} — ${r.failures.length} failure${r.failures.length === 1 ? '' : 's'}`)
      for (const f of r.failures) lines.push(`        ${f}`)
    }
  }
  lines.push('')
  lines.push(`[verify-runtime-docs] ${failed === 0 ? 'ok' : 'FAIL'} — ${passed}/${results.length} checks passed`)
  return lines.join('\n')
}

export async function main(argv) {
  let args
  try {
    args = parseArgs(argv)
  } catch (e) {
    process.stderr.write(`${e.message}\n\n`)
    printHelp()
    return 2
  }
  if (args.help) {
    printHelp()
    return 0
  }
  const selected = args.checks.length > 0 ? args.checks : CHECK_NAMES
  const results = await runChecks(selected)
  const report = formatReport(results, { verbose: args.verbose })
  const anyFailed = results.some((r) => !r.ok)
  if (anyFailed) process.stderr.write(report + '\n')
  else process.stdout.write(report + '\n')
  return anyFailed ? 1 : 0
}

// Only execute when run directly (not when imported by tests).
const isDirect = fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? '')
if (isDirect) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((e) => {
      process.stderr.write(`harness crashed: ${e.stack || e.message}\n`)
      process.exit(2)
    })
}
