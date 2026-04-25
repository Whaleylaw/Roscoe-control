/**
 * Deterministic content hash for a recipe directory.
 *
 * The recipe indexer (see `recipe-indexer.ts`) calls `computeDirSha(absDir)` to
 * build a dedup key for each recipe. When the hash of a recipe directory matches
 * the existing `recipes.dir_sha` row, the indexer skips the re-parse + UPSERT
 * path entirely — this is the RECIPE-03 dedup fast path exercised by the
 * chokidar watcher (Plan 12-03) and the POST endpoint (Plan 12-04).
 *
 * The hash is produced over the raw bytes of the files that semantically make
 * up a recipe:
 *   - `recipe.yaml`, `SOUL.md`, `REVIEW.md`, `README.md` at the recipe root (each optional)
 *   - Every file recursively under `tools/`, `skills/`, and `references/` (all extensions)
 *
 * Path ordering is normalised (POSIX separators, lexicographic sort) so the
 * same files produce the same hash regardless of the directory-walk order the
 * OS returns. Editor temp/swap files at the root (`.recipe.yaml.swp`,
 * `recipe.yaml~`, random `.txt` files) are ignored so saves in-progress don't
 * flip `dir_sha` and cause spurious re-indexing.
 */

import { createHash } from 'crypto'
import { readFile, readdir, stat } from 'fs/promises'
import { join, relative, sep } from 'path'

/**
 * Files at the recipe root that contribute to `dir_sha`. Each is optional —
 * a missing `recipe.yaml` is the indexer's hard-fail case, not the hasher's.
 */
const ROOT_FILES = ['recipe.yaml', 'SOUL.md', 'REVIEW.md', 'README.md']

/**
 * Subdirectories recursively walked for `dir_sha`. Anything outside these
 * (temp files, editor swap files, node_modules) is ignored.
 */
const WALKED_DIRS = ['tools', 'skills', 'references']

/**
 * Compute SHA-256 over the recipe directory's contributing contents.
 *
 * Algorithm (deterministic across platforms):
 *   1. Discover contributing files:
 *      - `recipe.yaml`, `SOUL.md`, `REVIEW.md`, `README.md` at the root (each optional)
 *      - Every file recursively under `tools/`, `skills/`, and `references/` (no extension filter)
 *   2. Normalise each path to POSIX-style (forward slashes) relative to `absDir`
 *   3. Sort the path list lexicographically (UTF-8 byte order)
 *   4. For each sorted path, append to the hash:
 *        `\u0000` + relPath + `\u0000` + <fileSize:LE 64-bit> + <file bytes>
 *      Null-byte delimiters prevent path/content boundary collisions.
 *   5. Return hex-encoded digest.
 *
 * Missing paths silently contribute nothing — a recipe without a `SOUL.md` simply
 * has one fewer entry in the hash stream than one with a `SOUL.md`, which is
 * fine for dedup.
 */
export async function computeDirSha(absDir: string): Promise<string> {
  const hasher = createHash('sha256')
  const files: string[] = []

  // Root files
  for (const name of ROOT_FILES) {
    const p = join(absDir, name)
    if ((await exists(p)) && (await stat(p)).isFile()) files.push(p)
  }

  // Walked subtrees
  for (const sub of WALKED_DIRS) {
    const subAbs = join(absDir, sub)
    if ((await exists(subAbs)) && (await stat(subAbs)).isDirectory()) {
      await collectFiles(subAbs, files)
    }
  }

  // Sort by POSIX-relative path for determinism
  const pairs = files.map((f) => ({
    rel: relative(absDir, f).split(sep).join('/'),
    abs: f,
  }))
  pairs.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))

  for (const { rel, abs } of pairs) {
    const bytes = await readFile(abs)
    const sizeBuf = Buffer.alloc(8)
    sizeBuf.writeBigUInt64LE(BigInt(bytes.length))
    hasher.update(Buffer.from([0])) // null delimiter
    hasher.update(Buffer.from(rel, 'utf8'))
    hasher.update(Buffer.from([0]))
    hasher.update(sizeBuf)
    hasher.update(bytes)
  }

  return hasher.digest('hex')
}

/** Recursive file collector. Symlinks and special files are skipped. */
async function collectFiles(dir: string, out: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const abs = join(dir, entry.name)
    if (entry.isDirectory()) {
      await collectFiles(abs, out)
    } else if (entry.isFile()) {
      out.push(abs)
    }
    // Symlinks and special files are intentionally skipped.
  }
}

/** fs.stat-based existence probe — returns false on any error (ENOENT, EACCES, …). */
async function exists(p: string): Promise<boolean> {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}
