import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

const STUB_VIEWS = [
  'dashboard-view.tsx',
  'tasks-view.tsx',
  'sessions-view.tsx',
  'agents-view.tsx',
  'settings-view.tsx',
]

const PROJECT_DIR = path.join(__dirname, '..')

describe('i18n coverage for stub views', () => {
  for (const file of STUB_VIEWS) {
    const filePath = path.join(PROJECT_DIR, file)

    it(`${file} uses useTranslations('project')`, () => {
      const source = fs.readFileSync(filePath, 'utf-8')
      expect(source).toContain("useTranslations('project')")
    })

    it(`${file} does not contain hardcoded English strings in JSX`, () => {
      const source = fs.readFileSync(filePath, 'utf-8')
      // Extract the return block (everything inside the return statement)
      const returnMatch = source.match(/return\s*\(([\s\S]*)\)\s*\}/)
      if (!returnMatch) return

      const jsxBlock = returnMatch[1]
      // Check that text content between > and < comes from t() calls, not string literals
      // Match content between > and < that is not whitespace and not a JSX expression
      const textContent = jsxBlock.match(/>([^<{]+)</g)
      if (textContent) {
        for (const match of textContent) {
          const text = match.slice(1, -1).trim()
          // Allow empty strings and whitespace
          expect(text).toBe('')
        }
      }
    })
  }
})
