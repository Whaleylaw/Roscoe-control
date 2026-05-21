#!/usr/bin/env node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const repoRoot = path.resolve(new URL('..', import.meta.url).pathname)
const legacyDataDir = path.join(repoRoot, '.data')
const targetDataDir = path.resolve(process.env.MISSION_CONTROL_DATA_DIR || path.join(os.homedir(), '.mission-control', 'data'))
const dryRun = process.argv.includes('--dry-run')
const force = process.argv.includes('--force')

function fail(message) {
  console.error(message)
  process.exit(1)
}

function describe(p) {
  try {
    const stat = fs.lstatSync(p)
    return stat.isDirectory() ? 'directory' : stat.isSymbolicLink() ? 'symlink' : 'file'
  } catch {
    return 'missing'
  }
}

console.log(`legacy=${legacyDataDir} (${describe(legacyDataDir)})`)
console.log(`target=${targetDataDir} (${describe(targetDataDir)})`)

if (!fs.existsSync(legacyDataDir)) {
  console.log('No repo-local .data directory found; nothing to relocate.')
  process.exit(0)
}

if (path.resolve(legacyDataDir) === targetDataDir) {
  fail('Target data dir resolves to repo-local .data; choose an external MISSION_CONTROL_DATA_DIR.')
}

if (fs.existsSync(targetDataDir)) {
  const entries = fs.readdirSync(targetDataDir)
  if (entries.length > 0 && !force) {
    fail('Target data dir already exists and is not empty. Re-run with --force after manually verifying merge safety.')
  }
}

if (dryRun) {
  console.log('Dry run only. Re-run without --dry-run to move data.')
  process.exit(0)
}

fs.mkdirSync(path.dirname(targetDataDir), { recursive: true })
fs.renameSync(legacyDataDir, targetDataDir)
console.log(`Moved ${legacyDataDir} -> ${targetDataDir}`)
console.log('Set MISSION_CONTROL_DATA_DIR to this target if you choose a non-default path.')
