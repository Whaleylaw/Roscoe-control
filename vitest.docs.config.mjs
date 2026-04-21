// Minimal Vitest config dedicated to the docs-runtime harness tests.
//
// Purpose: the default vitest.config.ts `include` pattern matches
// `src/**/*.test.ts` only. The verify-runtime-docs harness ships under
// `scripts/__tests__/` as `.mjs` (matching the harness file's own extension
// and keeping the tooling tree separate from product code). This config
// overrides the include pattern for the harness's dedicated `test:docs`
// script without touching the primary vitest.config.ts.
//
// Invoked via:  pnpm test:docs
// Which runs:   vitest run -c vitest.docs.config.mjs

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['scripts/__tests__/**/*.test.mjs'],
  },
})
