import { describe, it } from 'vitest'

// Wave 1 fills these in. Covers: GSD-17, GSD-18.
// loadGsdTemplate(track) resolves <DATA_DIR>/gsd-templates/<track>.json
// with soft-miss fallback to DEFAULT_TEMPLATE (D-16).

describe('loadGsdTemplate (GSD-17, GSD-18)', () => {
  it.todo('DEFAULT_TEMPLATE validates against gsdTemplateSchema')
  it.todo('loadGsdTemplate(null) returns DEFAULT_TEMPLATE')
  it.todo('loadGsdTemplate("ops") with no ops.json file on disk returns DEFAULT_TEMPLATE (D-16 soft miss)')
  it.todo('loadGsdTemplate("ops") with malformed JSON logs warning + returns DEFAULT_TEMPLATE')
  it.todo('loadGsdTemplate("ops") with valid ops.json returns the parsed+validated tree')
})
