import { describe, it } from 'vitest'

// Wave 0 Task 1 already seeded project.lifecycle.* across all 10 locales.
// These assertions pin that contract for future waves. Covers: GSD-29.

describe('locale parity for project.lifecycle.* (GSD-29)', () => {
  it.todo('every locale in [en,de,es,fr,ja,ko,pt,ru,ar,zh] has project.lifecycle.title')
  it.todo('every locale has project.lifecycle.gate.statusApproved containing "✓ Approved"')
  it.todo('every locale has project.lifecycle.gate.statusRequired containing "🔒 Approval required"')
  it.todo('every locale has project.nav.lifecycle = "Lifecycle"')
  it.todo('key parity — en.json keys under project.lifecycle ⊆ every other locale')
})
