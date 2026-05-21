import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('super os-users route build tracing', () => {
  it('does not use dynamic dot-directory path joins that make Next trace repo-local runtime state', () => {
    const routePath = path.join(process.cwd(), 'src/app/api/super/os-users/route.ts')
    const source = fs.readFileSync(routePath, 'utf8')

    expect(source).not.toContain('path.join(homeDir, `.${tool}`)')
    expect(source).not.toContain("path.join(homeDir, '.' + tool)")
    expect(source).toContain('TOOL_STATE_DIRS')
  })
})
