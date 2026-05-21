#!/usr/bin/env node
import { cp, mkdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const standaloneRoot = path.join(root, '.next', 'standalone')
const standaloneNext = path.join(standaloneRoot, '.next')

if (!existsSync(standaloneRoot)) {
  console.log('[standalone-assets] no .next/standalone output found; skipping')
  process.exit(0)
}

await mkdir(standaloneNext, { recursive: true })

const staticSrc = path.join(root, '.next', 'static')
const staticDest = path.join(standaloneNext, 'static')
if (existsSync(staticSrc)) {
  await rm(staticDest, { recursive: true, force: true })
  await cp(staticSrc, staticDest, { recursive: true })
  console.log(`[standalone-assets] copied ${path.relative(root, staticSrc)} -> ${path.relative(root, staticDest)}`)
}

const publicSrc = path.join(root, 'public')
const publicDest = path.join(standaloneRoot, 'public')
if (existsSync(publicSrc)) {
  await rm(publicDest, { recursive: true, force: true })
  await cp(publicSrc, publicDest, { recursive: true })
  console.log(`[standalone-assets] copied public -> ${path.relative(root, publicDest)}`)
}
