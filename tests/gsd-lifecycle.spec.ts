import { test } from '@playwright/test'

// Wave 4 fills this in. Cross-layer E2E that exercises the full GSD
// lifecycle: enable → bootstrap → illegal transition → legal sequence
// → gate blocks task → approve gate → task unblocks.

test.fixme(
  'create project → enable GSD → bootstrap → illegal transition rejected → legal sequence accepted → gate blocks task → approve gate → task moves to in_progress',
  async ({ page: _page }) => {
    /* Wave 4 implements this end-to-end flow. */
  },
)
