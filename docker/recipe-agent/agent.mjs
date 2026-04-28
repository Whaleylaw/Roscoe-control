#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const AGENT = 'recipe-agent'
const MAX_TOOL_ROUNDS = Number.parseInt(process.env.MC_AGENT_MAX_TOOL_ROUNDS || '40', 10)
const MAX_READ_CHARS = Number.parseInt(process.env.MC_AGENT_MAX_READ_CHARS || '50000', 10)
const MODEL_TIMEOUT_MS = Number.parseInt(process.env.MC_AGENT_MODEL_TIMEOUT_MS || '120000', 10)
const CAPABILITY_TOOL_NAMES = new Set(['read_file', 'list_dir', 'grep_files', 'write_file', 'copy_case_template', 'run_shell'])
const SKIPPED_SEARCH_DIRS = new Set([
  '.git',
  '.next',
  '.obsidian',
  '_archive',
  'archive-cases',
  'build',
  'coverage',
  'dist',
  'node_modules',
])

function log(level, msg, ctx = {}) {
  console.log(JSON.stringify({ level, ts: new Date().toISOString(), agent: AGENT, msg, ...ctx }))
}

function envSnapshot() {
  const keys = [
    'MC_API_URL',
    'MC_TASK_ID',
    'MC_WORKSPACE',
    'MC_RECIPE_PATH',
    'MC_PREAMBLE_PATH',
    'MC_MODEL_PRIMARY',
    'MC_MODEL_PROVIDER',
    'MC_MODEL_FALLBACK',
    'MC_RUNNER_MODE',
  ]
  return Object.fromEntries(keys.map((key) => [key, process.env[key] || null]))
}

function missionControlHeaders(extra = {}) {
  const hostOverride = process.env.MC_API_HOST_HEADER
  return {
    ...extra,
    ...(hostOverride
      ? {
          'X-Forwarded-Host': hostOverride,
          'X-Original-Host': hostOverride,
        }
      : {}),
  }
}

function readText(filePath, maxChars = MAX_READ_CHARS) {
  const raw = fs.readFileSync(filePath, 'utf8')
  return raw.length > maxChars ? `${raw.slice(0, maxChars)}\n\n[truncated ${raw.length - maxChars} chars]` : raw
}

function readOptional(filePath, maxChars = MAX_READ_CHARS) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return ''
    return readText(filePath, maxChars)
  } catch (err) {
    return `[failed to read ${filePath}: ${String(err)}]`
  }
}

function appendProgress(line) {
  const workspace = process.env.MC_WORKSPACE || '/workspace'
  const progressPath = path.join(workspace, '.mc', 'progress.md')
  try {
    fs.mkdirSync(path.dirname(progressPath), { recursive: true })
    fs.appendFileSync(progressPath, `${new Date().toISOString()} | ${line}\n`)
  } catch (err) {
    log('warn', 'progress append failed', { err: String(err) })
  }
}

function appendCheckpointLocal(checkpoint) {
  const workspace = process.env.MC_WORKSPACE || '/workspace'
  const checkpointsPath = path.join(workspace, '.mc', 'checkpoints.jsonl')
  try {
    fs.mkdirSync(path.dirname(checkpointsPath), { recursive: true })
    fs.appendFileSync(checkpointsPath, `${JSON.stringify({ ...checkpoint, ts: new Date().toISOString() })}\n`)
  } catch (err) {
    log('warn', 'local checkpoint append failed', { err: String(err) })
  }
}

async function postCheckpoint(body) {
  const { MC_API_URL, MC_TASK_ID, MC_API_TOKEN } = process.env
  const checkpoint = {
    step: body.step || 'recipe-agent',
    status: body.status || 'in_progress',
    summary: body.summary || '',
    ...(body.next_step ? { next_step: body.next_step } : {}),
    ...(body.blocker_reason ? { blocker_reason: body.blocker_reason } : {}),
    ...(Array.isArray(body.artifacts) ? { artifacts: body.artifacts } : {}),
  }
  appendCheckpointLocal(checkpoint)
  if (!MC_API_URL || !MC_TASK_ID || !MC_API_TOKEN) return { ok: false, skipped: 'missing runner env' }

  const res = await fetch(`${MC_API_URL}/api/tasks/${MC_TASK_ID}/checkpoints`, {
    method: 'POST',
    headers: missionControlHeaders({
      Authorization: `Bearer ${MC_API_TOKEN}`,
      'Content-Type': 'application/json',
    }),
    body: JSON.stringify(checkpoint),
  })
  const text = await res.text()
  return { ok: res.ok, status: res.status, body: text.slice(0, 1000) }
}

async function submitDone(resolution) {
  const { MC_API_URL, MC_TASK_ID, MC_API_TOKEN } = process.env
  if (!MC_API_URL || !MC_TASK_ID || !MC_API_TOKEN) return { ok: false, error: 'missing runner env' }
  const trimmedResolution = String(resolution || '').trim().slice(0, 10000)
  const res = await fetch(`${MC_API_URL}/api/runner/tasks/${MC_TASK_ID}/submit`, {
    method: 'POST',
    headers: missionControlHeaders({
      Authorization: `Bearer ${MC_API_TOKEN}`,
      'Content-Type': 'application/json',
    }),
    body: JSON.stringify({ status: 'done', ...(trimmedResolution ? { resolution: trimmedResolution } : {}) }),
  })
  const text = await res.text()
  return { ok: res.ok || res.status === 409, status: res.status, body: text.slice(0, 1000) }
}

async function submitReview(verdict, notes) {
  const { MC_API_URL, MC_TASK_ID, MC_API_TOKEN } = process.env
  if (!MC_API_URL || !MC_TASK_ID || !MC_API_TOKEN) return { ok: false, error: 'missing runner env' }
  const status = String(verdict || '').trim().toLowerCase()
  const trimmedNotes = String(notes || '').trim().slice(0, 10000)
  const res = await fetch(`${MC_API_URL}/api/runner/tasks/${MC_TASK_ID}/review`, {
    method: 'POST',
    headers: missionControlHeaders({
      Authorization: `Bearer ${MC_API_TOKEN}`,
      'Content-Type': 'application/json',
    }),
    body: JSON.stringify({ verdict: status, notes: trimmedNotes }),
  })
  const text = await res.text()
  return { ok: res.ok || res.status === 409, status: res.status, body: text.slice(0, 1000) }
}

function resolveInsideContainer(inputPath, base = process.env.MC_WORKSPACE || '/workspace') {
  if (!inputPath || typeof inputPath !== 'string') throw new Error('path is required')
  const candidate = path.isAbsolute(inputPath) ? inputPath : path.join(base, inputPath)
  return path.normalize(candidate)
}

function isReadablePath(filePath) {
  return filePath === '/workspace'
    || filePath.startsWith('/workspace/')
    || filePath === '/recipe'
    || filePath.startsWith('/recipe/')
    || filePath === '/refs'
    || filePath.startsWith('/refs/')
    || filePath === '/skills'
    || filePath.startsWith('/skills/')
}

function isWorkspacePath(filePath) {
  return filePath === '/workspace' || filePath.startsWith('/workspace/')
}

function isProbablyTextFile(filePath) {
  const textExtensions = new Set([
    '.cjs',
    '.css',
    '.csv',
    '.js',
    '.json',
    '.jsx',
    '.mjs',
    '.md',
    '.mdx',
    '.py',
    '.sh',
    '.ts',
    '.tsx',
    '.txt',
    '.xml',
    '.yaml',
    '.yml',
  ])
  const ext = path.extname(filePath).toLowerCase()
  return textExtensions.has(ext) || ext === ''
}

function safeCaseSlug(value) {
  const slug = String(value || '').trim()
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error('case_slug must be a safe FirmVault slug')
  return slug
}

function titleFromSlug(slug) {
  return slug.split('-').map((part) => part ? `${part[0].toUpperCase()}${part.slice(1)}` : '').join(' ')
}

function templateReplacementMap(input, caseSlug) {
  const clientName = String(input.client_name || titleFromSlug(caseSlug)).trim()
  const openedDate = String(input.opened_date || new Date().toISOString().slice(0, 10)).trim()
  return {
    '{{case_id}}': caseSlug,
    '{{case_slug}}': caseSlug,
    '{{client_name}}': clientName,
    '{{case_type}}': String(input.case_type || 'personal injury').trim(),
    '{{date_of_incident}}': String(input.date_of_incident || 'unknown').trim(),
    '{{jurisdiction}}': String(input.jurisdiction || 'unknown').trim(),
    '{{opened_date}}': openedDate,
    '{{real_file_root}}': String(input.real_file_root || '').trim(),
  }
}

function applyTemplateReplacements(content, replacements) {
  let output = content
  for (const [needle, value] of Object.entries(replacements)) {
    output = output.split(needle).join(value)
  }
  return output
}

function copyCaseTemplate(input) {
  const caseSlug = safeCaseSlug(input.case_slug)
  const workspace = process.env.MC_WORKSPACE || '/workspace'
  const templatePath = path.join(workspace, 'skills.tools.workflows', 'case_template', 'blank-personal-injury-case')
  if (!fs.existsSync(templatePath)) throw new Error(`case template not found: ${templatePath}`)
  const targetRoot = path.join(workspace, 'cases', caseSlug)
  if (!isWorkspacePath(targetRoot)) throw new Error(`copy target denied outside /workspace: ${targetRoot}`)
  const replacements = templateReplacementMap(input, caseSlug)
  const written = []

  for (const sourcePath of walkSearchFiles(templatePath)) {
    const rel = path.relative(templatePath, sourcePath)
    const targetRel = rel === '_case-slug.md' ? `${caseSlug}.md` : rel
    const targetPath = path.join(targetRoot, targetRel)
    if (!isWorkspacePath(targetPath)) throw new Error(`copy target denied outside /workspace: ${targetPath}`)
    fs.mkdirSync(path.dirname(targetPath), { recursive: true })
    if (path.basename(sourcePath) === '.gitkeep') {
      fs.writeFileSync(targetPath, '', 'utf8')
    } else {
      fs.writeFileSync(targetPath, applyTemplateReplacements(fs.readFileSync(sourcePath, 'utf8'), replacements), 'utf8')
    }
    written.push(path.relative(workspace, targetPath))
  }

  return { ok: true, case_slug: caseSlug, target: targetRoot, files_written: written.length, files: written.slice(0, 200) }
}

function walkSearchFiles(root, files = []) {
  const entries = fs.readdirSync(root, { withFileTypes: true })
  for (const entry of entries) {
    if (SKIPPED_SEARCH_DIRS.has(entry.name)) continue
    const entryPath = path.join(root, entry.name)
    if (entry.isDirectory()) {
      walkSearchFiles(entryPath, files)
      continue
    }
    if (entry.isFile() && isProbablyTextFile(entryPath)) files.push(entryPath)
  }
  return files
}

function grepFiles(input) {
  const rootPath = resolveInsideContainer(input.root || '.')
  if (!isReadablePath(rootPath)) throw new Error(`grep denied outside allowed mounts: ${rootPath}`)
  if (!fs.existsSync(rootPath)) throw new Error(`grep root does not exist: ${rootPath}`)
  const needleRaw = String(input.pattern || '')
  if (!needleRaw.trim()) throw new Error('pattern is required')
  const maxResults = Math.max(1, Math.min(Number(input.max_results || 100), 500))
  const caseSensitive = Boolean(input.case_sensitive)

  const rgArgs = [
    '--fixed-strings',
    '--line-number',
    '--with-filename',
    '--no-heading',
    '--color',
    'never',
    '--max-filesize',
    '250K',
    '--glob',
    '!.git/**',
    '--glob',
    '!.next/**',
    '--glob',
    '!node_modules/**',
    '--glob',
    '!archive-cases/**',
    '--glob',
    '!_archive/**',
  ]
  if (!caseSensitive) rgArgs.push('--ignore-case')
  rgArgs.push('--', needleRaw, rootPath)
  const rg = spawnSync('rg', rgArgs, {
    encoding: 'utf8',
    timeout: Number.parseInt(process.env.MC_AGENT_GREP_TIMEOUT_MS || '30000', 10),
    maxBuffer: 1024 * 1024,
  })
  if (rg.status === 0 || rg.status === 1) {
    const matches = []
    for (const line of (rg.stdout || '').split(/\r?\n/)) {
      if (!line || matches.length >= maxResults) break
      const parts = line.split(':')
      if (parts.length < 3) continue
      const lineNumber = Number.parseInt(parts[1], 10)
      matches.push({
        path: parts[0],
        line_number: Number.isFinite(lineNumber) ? lineNumber : 0,
        line: parts.slice(2).join(':').slice(0, 1000),
      })
    }
    return {
      ok: true,
      root: rootPath,
      pattern: needleRaw,
      case_sensitive: caseSensitive,
      matches,
      truncated: Boolean(rg.stdout && rg.stdout.split(/\r?\n/).length > maxResults),
    }
  }
  if (rg.error || rg.signal || rg.status === null) {
    return {
      ok: false,
      root: rootPath,
      pattern: needleRaw,
      error: `ripgrep failed or timed out: ${rg.error ? String(rg.error) : rg.signal || 'unknown'}`,
      stderr: (rg.stderr || '').slice(0, 1000),
    }
  }

  const needle = caseSensitive ? needleRaw : needleRaw.toLowerCase()
  const stat = fs.statSync(rootPath)
  const files = stat.isDirectory() ? walkSearchFiles(rootPath) : [rootPath]
  const matches = []

  for (const filePath of files) {
    if (matches.length >= maxResults) break
    if (!isProbablyTextFile(filePath)) continue
    const fileStat = fs.statSync(filePath)
    if (fileStat.size > 250000) continue
    const content = fs.readFileSync(filePath, 'utf8')
    const lines = content.split(/\r?\n/)
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]
      const haystack = caseSensitive ? line : line.toLowerCase()
      if (!haystack.includes(needle)) continue
      matches.push({
        path: filePath,
        line_number: index + 1,
        line: line.slice(0, 1000),
      })
      if (matches.length >= maxResults) break
    }
  }

  return {
    ok: true,
    root: rootPath,
    pattern: needleRaw,
    case_sensitive: caseSensitive,
    matches,
    truncated: matches.length >= maxResults,
  }
}

function recipeToolAllowlist() {
  const recipeYaml = readOptional(path.join(process.env.MC_RECIPE_PATH || '/recipe', 'recipe.yaml'), 12000)
  const configured = parseRecipeTools(recipeYaml)
  if (!configured) return CAPABILITY_TOOL_NAMES
  return new Set(configured.filter((name) => CAPABILITY_TOOL_NAMES.has(name)))
}

function parseRecipeTools(recipeYaml) {
  if (!recipeYaml) return null
  const inline = recipeYaml.match(/^tools:\s*\[([^\]]*)\]\s*$/m)
  if (inline) {
    return inline[1]
      .split(',')
      .map((value) => value.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean)
  }
  const lines = recipeYaml.split(/\r?\n/)
  const tools = []
  for (let i = 0; i < lines.length; i += 1) {
    if (!/^tools:\s*$/.test(lines[i])) continue
    for (let j = i + 1; j < lines.length; j += 1) {
      const match = lines[j].match(/^\s+-\s+([^#\s]+)\s*(?:#.*)?$/)
      if (match) {
        tools.push(match[1].replace(/^['"]|['"]$/g, ''))
        continue
      }
      if (/^\s*$/.test(lines[j])) continue
      break
    }
    return tools
  }
  return null
}

function allToolDefinitions() {
  return [
    {
      name: 'read_file',
      description: 'Read a UTF-8 text file from /workspace, /recipe, /refs, or /skills.',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          max_chars: { type: 'number' },
        },
        required: ['path'],
      },
    },
    {
      name: 'list_dir',
      description: 'List entries in a directory under /workspace, /recipe, /refs, or /skills.',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
        },
        required: ['path'],
      },
    },
    {
      name: 'grep_files',
      description: 'Search text files under /workspace, /recipe, /refs, or /skills without shell access. Use this to find case facts, recipe references, or vault paths.',
      input_schema: {
        type: 'object',
        properties: {
          root: { type: 'string', description: 'Directory or file to search. Defaults to /workspace for relative paths.' },
          pattern: { type: 'string', description: 'Literal text to search for.' },
          max_results: { type: 'number', description: 'Maximum matches to return, capped at 500.' },
          case_sensitive: { type: 'boolean' },
        },
        required: ['pattern'],
      },
    },
    {
      name: 'write_file',
      description: 'Write a UTF-8 text file under /workspace. Do not use this for /refs, /recipe, or /skills because those are read-only mounts.',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string' },
        },
        required: ['path', 'content'],
      },
    },
    {
      name: 'copy_case_template',
      description: 'Deterministically copy the FirmVault blank personal-injury case template from /workspace/skills.tools.workflows/case_template/blank-personal-injury-case into /workspace/cases/<case_slug>, replacing safe placeholders. Use this for FirmVault case setup instead of hand-creating every starter path.',
      input_schema: {
        type: 'object',
        properties: {
          case_slug: { type: 'string' },
          client_name: { type: 'string' },
          case_type: { type: 'string' },
          date_of_incident: { type: 'string' },
          jurisdiction: { type: 'string' },
          opened_date: { type: 'string' },
          real_file_root: { type: 'string' },
        },
        required: ['case_slug'],
      },
    },
    {
      name: 'run_shell',
      description: 'Run a shell command in /workspace. Use for tests, git diff/status, and safe local commands.',
      input_schema: {
        type: 'object',
        properties: {
          command: { type: 'string' },
          timeout_seconds: { type: 'number' },
        },
        required: ['command'],
      },
    },
    {
      name: 'checkpoint',
      description: 'Post a Mission Control checkpoint and append local checkpoint JSONL. Use status=blocked when you need user input, recipe clarification, missing facts, or other review before continuing; Mission Control will move the task to awaiting_owner and create a task-thread comment from blocker_reason.',
      input_schema: {
        type: 'object',
        properties: {
          step: { type: 'string' },
          status: { type: 'string', enum: ['completed', 'in_progress', 'blocked'] },
          summary: { type: 'string' },
          next_step: { type: 'string' },
          blocker_reason: { type: 'string' },
        },
        required: ['step', 'status', 'summary'],
      },
    },
    {
      name: 'submit_done',
      description: 'Submit the task as complete. Mission Control will move it to review and post resolution as the task-thread handoff comment for the user/reviewer.',
      input_schema: {
        type: 'object',
        properties: {
          resolution: {
            type: 'string',
            description: 'User-facing review comment: summarize what you did, what changed, evidence checked, artifacts produced, and any remaining caveats or configuration gaps.',
          },
        },
        required: ['resolution'],
      },
    },
  ]
}

function toolDefinitions() {
  const reviewMode = process.env.MC_RUNNER_MODE === 'review'
  const allowlist = recipeToolAllowlist()
  const tools = allToolDefinitions().filter((tool) => !CAPABILITY_TOOL_NAMES.has(tool.name) || allowlist.has(tool.name))
  if (reviewMode) {
    return tools
      .filter((tool) => tool.name !== 'write_file' && tool.name !== 'submit_done')
      .concat({
        name: 'submit_review',
        description: 'Submit the recipe-specific quality review verdict. APPROVED promotes accepted work; REJECTED returns it for runner fixes; BLOCKED leaves it in quality review for owner/configuration input.',
        input_schema: {
          type: 'object',
          properties: {
            verdict: { type: 'string', enum: ['approved', 'rejected', 'blocked'] },
            notes: { type: 'string' },
          },
          required: ['verdict', 'notes'],
        },
      })
  }
  return tools
}

async function handleTool(name, input) {
  try {
    const allowlist = recipeToolAllowlist()
    if (CAPABILITY_TOOL_NAMES.has(name) && !allowlist.has(name)) {
      throw new Error(`tool '${name}' is not allowed by /recipe/recipe.yaml tools`)
    }
    if (name === 'read_file') {
      const filePath = resolveInsideContainer(input.path)
      if (!isReadablePath(filePath)) throw new Error(`read denied outside allowed mounts: ${filePath}`)
      return { ok: true, path: filePath, content: readText(filePath, input.max_chars || MAX_READ_CHARS) }
    }
    if (name === 'list_dir') {
      const dirPath = resolveInsideContainer(input.path)
      if (!isReadablePath(dirPath)) throw new Error(`list denied outside allowed mounts: ${dirPath}`)
      const entries = fs.readdirSync(dirPath, { withFileTypes: true }).map((entry) => ({
        name: entry.name,
        kind: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other',
      }))
      return { ok: true, path: dirPath, entries }
    }
    if (name === 'grep_files') return grepFiles(input)
    if (name === 'write_file') {
      const filePath = resolveInsideContainer(input.path)
      if (!isWorkspacePath(filePath)) throw new Error(`write denied outside /workspace: ${filePath}`)
      fs.mkdirSync(path.dirname(filePath), { recursive: true })
      fs.writeFileSync(filePath, input.content, 'utf8')
      return { ok: true, path: filePath, bytes: Buffer.byteLength(input.content) }
    }
    if (name === 'copy_case_template') return copyCaseTemplate(input)
    if (name === 'run_shell') {
      const workspace = process.env.MC_WORKSPACE || '/workspace'
      const timeout = Math.max(1, Math.min(Number(input.timeout_seconds || 120), 900)) * 1000
      const result = spawnSync('bash', ['-lc', input.command], {
        cwd: fs.existsSync(workspace) ? workspace : '/',
        encoding: 'utf8',
        timeout,
        maxBuffer: 1024 * 1024,
      })
      return {
        ok: result.status === 0,
        status: result.status,
        signal: result.signal,
        stdout: (result.stdout || '').slice(-20000),
        stderr: (result.stderr || '').slice(-20000),
      }
    }
    if (name === 'checkpoint') return await postCheckpoint(input)
    if (name === 'submit_done') return await submitDone(input.resolution)
    if (name === 'submit_review') return await submitReview(input.verdict, input.notes)
    throw new Error(`unknown tool: ${name}`)
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

function openAiTools() {
  return toolDefinitions().map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    },
  }))
}

function parseToolArguments(raw) {
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    return { raw }
  }
}

function toOpenAiMessages(messages, system) {
  const converted = [{ role: 'system', content: system }]
  for (const message of messages) {
    if (message.role === 'user' && typeof message.content === 'string') {
      converted.push({ role: 'user', content: message.content })
      continue
    }
    if (message.role === 'assistant' && Array.isArray(message.content)) {
      const text = message.content
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('\n')
      const toolCalls = message.content
        .filter((part) => part.type === 'tool_use')
        .map((part) => ({
          id: part.id,
          type: 'function',
          function: {
            name: part.name,
            arguments: JSON.stringify(part.input || {}),
          },
        }))
      converted.push({
        role: 'assistant',
        content: text || null,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      })
      continue
    }
    if (message.role === 'user' && Array.isArray(message.content)) {
      for (const part of message.content) {
        if (part.type === 'tool_result') {
          converted.push({
            role: 'tool',
            tool_call_id: part.tool_use_id,
            content: typeof part.content === 'string' ? part.content : JSON.stringify(part.content),
          })
        }
      }
    }
  }
  return converted
}

async function callOpenRouter(messages, system) {
  const key = process.env.OPENROUTER_API_KEY
  if (!key) throw new Error('OPENROUTER_API_KEY is required for mc-recipe-agent when MC_MODEL_PROVIDER=openrouter')
  const model = process.env.MC_MODEL_PRIMARY || 'openai/gpt-5.4-mini'
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), MODEL_TIMEOUT_MS)
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    signal: controller.signal,
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(process.env.OPENROUTER_SITE_URL ? { 'HTTP-Referer': process.env.OPENROUTER_SITE_URL } : {}),
      'X-Title': process.env.OPENROUTER_APP_NAME || 'Mission Control Recipe Agent',
    },
    body: JSON.stringify({
      model,
      messages: toOpenAiMessages(messages, system),
      max_tokens: Number.parseInt(process.env.MC_AGENT_MAX_TOKENS || '4096', 10),
      temperature: Number.parseFloat(process.env.MC_AGENT_TEMPERATURE || '0.2'),
      tools: openAiTools(),
      tool_choice: 'auto',
    }),
  }).finally(() => clearTimeout(timer))
  const body = await res.text()
  if (!res.ok) throw new Error(`OpenRouter API failed ${res.status}: ${body.slice(0, 1000)}`)
  const parsed = JSON.parse(body)
  const choice = parsed.choices?.[0]
  const message = choice?.message || {}
  const content = []
  if (typeof message.content === 'string' && message.content.trim()) {
    content.push({ type: 'text', text: message.content })
  }
  for (const call of message.tool_calls || []) {
    content.push({
      type: 'tool_use',
      id: call.id,
      name: call.function?.name,
      input: parseToolArguments(call.function?.arguments),
    })
  }
  return { content }
}

async function callAnthropic(messages, system) {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) throw new Error('ANTHROPIC_API_KEY is required for mc-recipe-agent')
  const model = process.env.MC_MODEL_PRIMARY || 'claude-sonnet-4-6'
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), MODEL_TIMEOUT_MS)
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    signal: controller.signal,
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: Number.parseInt(process.env.MC_AGENT_MAX_TOKENS || '4096', 10),
      temperature: Number.parseFloat(process.env.MC_AGENT_TEMPERATURE || '0.2'),
      system,
      tools: toolDefinitions(),
      messages,
    }),
  }).finally(() => clearTimeout(timer))
  const body = await res.text()
  if (!res.ok) throw new Error(`Anthropic API failed ${res.status}: ${body.slice(0, 1000)}`)
  return JSON.parse(body)
}

async function callModel(messages, system) {
  const provider = process.env.MC_MODEL_PROVIDER || 'openrouter'
  if (provider === 'anthropic') return callAnthropic(messages, system)
  return callOpenRouter(messages, system)
}

function buildSystemPrompt() {
  const preamble = readOptional(process.env.MC_PREAMBLE_PATH || '/recipe/PREAMBLE.md', 30000)
  const soul = readOptional(path.join(process.env.MC_RECIPE_PATH || '/recipe', 'SOUL.md'), 50000)
  const review = readOptional(path.join(process.env.MC_RECIPE_PATH || '/recipe', 'REVIEW.md'), 50000)
  const recipeYaml = readOptional(path.join(process.env.MC_RECIPE_PATH || '/recipe', 'recipe.yaml'), 12000)
  const taskJson = readOptional(path.join(process.env.MC_WORKSPACE || '/workspace', '.mc', 'task.json'), 50000)
  const priorProgress = readOptional(path.join(process.env.MC_WORKSPACE || '/workspace', '.mc', 'progress.md'), 20000)
  const allowedTools = [...recipeToolAllowlist()].sort()

  return [
    'You are running inside the generic Mission Control recipe agent image.',
    'The Docker image provides tools. The mounted recipe provides your role, behavior, and domain instructions.',
    process.env.MC_RUNNER_MODE === 'review'
      ? 'Follow /recipe/PREAMBLE.md first, then /recipe/REVIEW.md, then the task metadata. You are reviewing work, not performing it.'
      : 'Follow /recipe/PREAMBLE.md first, then /recipe/SOUL.md, then the task metadata.',
    'Use tools to inspect files and make changes. Never claim success without either completing the task or clearly blocking with a checkpoint.',
    process.env.MC_RUNNER_MODE === 'review'
      ? 'Review mode is read-only. Do not write files. Inspect the task, comments, progress, worktree diff, and relevant case files, then submit a review verdict.'
      : 'Only write under /workspace. /refs, /recipe, and /skills are read-only references.',
    'The Mission Control task comment thread is the user-facing chat and handoff channel. Your checkpoints and final submit are recorded for audit.',
    `Recipe-enabled capability tools: ${allowedTools.join(', ') || '(none)'}. Mission Control control tools are available separately for checkpointing and submission.`,
    `Do not call tools that are not in this list. In particular, do not call run_code; use grep_files/list_dir/read_file/write_file${allowedTools.includes('run_shell') ? '/run_shell' : ''} only as allowed by the recipe.`,
    'Use checkpoints sparingly: start, meaningful milestone, blocked question, or final handoff context. Do not post a checkpoint after every file read.',
    'If you have a question, find missing facts, identify unclear recipe behavior, or need human approval, call checkpoint with status blocked. Put the exact question or configuration problem in blocker_reason. Do not silently improvise around unclear legal-workflow instructions.',
    'When work is complete, call submit_done with a detailed resolution. Mission Control will move the task to review and post that resolution into the task comments so the user can see what you did and what remains.',
    '',
    '## Environment',
    JSON.stringify(envSnapshot(), null, 2),
    '',
    '## PREAMBLE.md',
    preamble,
    '',
    '## recipe.yaml',
    recipeYaml,
    '',
    '## SOUL.md',
    soul,
    '',
    '## REVIEW.md',
    review,
    '',
    '## .mc/task.json',
    taskJson,
    '',
    '## Prior progress',
    priorProgress,
  ].join('\n')
}

async function main() {
  log('info', 'starting', {
    env: envSnapshot(),
    has_openrouter_key: Boolean(process.env.OPENROUTER_API_KEY),
    has_anthropic_key: Boolean(process.env.ANTHROPIC_API_KEY),
  })
  appendProgress('recipe-agent started')
  await postCheckpoint({ step: 'start', status: 'in_progress', summary: 'Generic recipe agent loaded runtime context.' })

  const system = buildSystemPrompt()
  const messages = [{
    role: 'user',
    content: process.env.MC_RUNNER_MODE === 'review'
      ? 'Review this Mission Control task according to /recipe/REVIEW.md. Use read-only tools to inspect the worktree and task metadata. Do not modify files. When finished, call submit_review with verdict approved, rejected, or blocked and detailed notes.'
      : 'Execute this Mission Control task according to the recipe. Use the available tools. If the task cannot be completed safely or you need user input, post a blocked checkpoint with the exact question or reason. When finished, submit a detailed resolution for the task comment thread.',
  }]
  let lastCompletedSummary = ''
  let lastToolFailure = ''

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const response = await callModel(messages, system)
    messages.push({ role: 'assistant', content: response.content })

    const toolUses = response.content.filter((part) => part.type === 'tool_use')
    if (toolUses.length === 0) {
      const text = response.content
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('\n')
      if (lastCompletedSummary) {
        const resolution = (text || lastCompletedSummary).trim()
        const submit = await submitDone(resolution || `Completed work: ${lastCompletedSummary}`)
        if (submit.ok) {
          appendProgress('recipe-agent submitted task after completed checkpoint')
          process.exit(0)
        }
        lastToolFailure = `submit_done fallback returned ${JSON.stringify(submit).slice(0, 1000)}`
      }
      await postCheckpoint({
        step: 'model-finished',
        status: 'blocked',
        summary: (text || lastCompletedSummary || lastToolFailure).slice(0, 1000) || 'Model stopped without submitting or blocking explicitly.',
        blocker_reason: lastCompletedSummary
          ? `Model stopped after reporting completed work without calling submit_done. Last completed checkpoint: ${lastCompletedSummary.slice(0, 1500)}`
          : lastToolFailure
            ? `Model stopped after a Mission Control tool call failed: ${lastToolFailure.slice(0, 1500)}`
            : 'Model stopped without calling submit_done or a blocked checkpoint.',
      })
      log('warn', 'model stopped without tool use')
      process.exit(2)
    }

    const toolResults = []
    for (const toolUse of toolUses) {
      log('info', 'tool use', { name: toolUse.name })
      const result = await handleTool(toolUse.name, toolUse.input || {})
      if (!result?.ok) {
        lastToolFailure = `${toolUse.name} returned ${JSON.stringify(result).slice(0, 1000)}`
        log('warn', 'tool result not ok', { name: toolUse.name, result })
      }
      if (toolUse.name === 'checkpoint' && toolUse.input?.status === 'completed') {
        lastCompletedSummary = String(toolUse.input.summary || '').trim()
      }
      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: JSON.stringify(result).slice(0, 60000),
      })
      if (toolUse.name === 'submit_done' && result.ok) {
        appendProgress('recipe-agent submitted task')
        process.exit(0)
      }
      if (toolUse.name === 'submit_review' && result.ok) {
        appendProgress('recipe-agent submitted review')
        process.exit(0)
      }
      if (toolUse.name === 'checkpoint' && toolUse.input?.status === 'blocked' && result.ok) {
        appendProgress(`recipe-agent blocked: ${toolUse.input.blocker_reason || toolUse.input.summary}`)
        process.exit(0)
      }
    }
    messages.push({ role: 'user', content: toolResults })
  }

  await postCheckpoint({
    step: 'max-tool-rounds',
    status: 'blocked',
    summary: `Stopped after ${MAX_TOOL_ROUNDS} tool rounds.`,
    blocker_reason: `Generic recipe agent exceeded ${MAX_TOOL_ROUNDS} tool rounds without submitting.`,
  })
  process.exit(2)
}

main().catch(async (err) => {
  log('error', 'fatal', { err: String(err), stack: err?.stack })
  appendProgress(`recipe-agent fatal: ${String(err)}`)
  try {
    await postCheckpoint({
      step: 'fatal',
      status: 'blocked',
      summary: String(err).slice(0, 1000),
      blocker_reason: String(err).slice(0, 2000),
    })
  } catch {}
  process.exit(1)
})
