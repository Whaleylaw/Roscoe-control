import { mkdtemp, readFile, mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'
import { listLawFirmCases, readLawFirmCaseDetail, updateLawFirmCaseState } from '../law-firm'

const previousRoot = process.env.MISSION_CONTROL_LAW_FIRM_ROOT

afterEach(() => {
  if (previousRoot === undefined) delete process.env.MISSION_CONTROL_LAW_FIRM_ROOT
  else process.env.MISSION_CONTROL_LAW_FIRM_ROOT = previousRoot
})

describe('law-firm FirmVault adapter', () => {
  it('lists case summaries and updates phase plus landmarks in state.yaml', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mc-law-firm-'))
    process.env.MISSION_CONTROL_LAW_FIRM_ROOT = root
    const caseDir = join(root, 'cases', 'alpha-case')
    await mkdir(caseDir, { recursive: true })
    await writeFile(join(caseDir, 'Dashboard.md'), `---
case_slug: alpha-case
client_name: "Alpha Case"
case_type: "auto_accident"
date_of_incident: 2024-01-02
current_phase: "treatment"
jurisdiction: "KY"
legacy_id: "LEG-1"
---
# Alpha Case
`, 'utf8')
    await writeFile(join(caseDir, 'state.yaml'), `schema_version: 1
case_slug: alpha-case
current_phase: phase_2_treatment
phase_history:
  phase_2_treatment:
    entered: null
    exited: null
  phase_3_demand:
    entered: null
    exited: null
landmarks:
  client_info_received:
    satisfied: true
    satisfied_at: null
    satisfied_by: migration_script
    evidence: null
  demand_sent:
    satisfied: false
    satisfied_at: null
    satisfied_by: null
    evidence: null
`, 'utf8')
    await writeFile(join(caseDir, 'alpha-case.md'), `---
schema_version: 2
client_name: Alpha Case
---
# Alpha Case

## Medical Providers
- [[contacts/uofl-orthopedics|UofL Orthopedics]]

<!-- roscoe-medical-start -->
### Treatment Details (Roscoe)
| Provider | Status | Start | End | Billed | Bills Req | Bills Rec | Records Req | Records Rec |
|----------|--------|-------|-----|--------|-----------|-----------|-------------|-------------|
| UofL Orthopedics | Treatment Complete | 2024-01-03 | 2024-01-04 | $100.00 | 2024-02-02 | 2024-02-10 | 2024-02-01 | 2024-02-09 |
<!-- roscoe-medical-end -->
`, 'utf8')
    await mkdir(join(caseDir, 'contacts'), { recursive: true })
    await writeFile(join(caseDir, 'contacts', 'uofl-orthopedics.md'), `---
role: treating_provider
treatment_status: complete
records_requested: true
records_received: false
bills_requested: true
bills_received: true
records_requested_date: 2024-02-01
bills_received_date: 2024-02-10
---
# UofL Orthopedics
`, 'utf8')
    await writeFile(join(caseDir, 'contacts', 'example-adjuster.md'), `---
role: insurance_adjuster
---
# Example Adjuster
`, 'utf8')

    const cases = await listLawFirmCases()
    expect(cases).toHaveLength(1)
    expect(cases[0]).toMatchObject({
      slug: 'alpha-case',
      name: 'Alpha Case',
      satisfied_landmark_count: 1,
      landmark_count: 2,
    })

    const detail = await readLawFirmCaseDetail('alpha-case')
    expect(detail.state.phases.map((phase) => phase.key)).toEqual(['phase_2_treatment', 'phase_3_demand'])
    expect(detail.dashboard.medical_providers).toEqual([
      expect.objectContaining({
        slug: 'uofl-orthopedics',
        name: 'UofL Orthopedics',
        role: 'treating_provider',
        treatment_status: 'Treatment Complete',
        records_requested: true,
        records_received: true,
        bills_requested: true,
        bills_received: true,
        records_requested_date: '2024-02-01',
        records_received_date: '2024-02-09',
        bills_requested_date: '2024-02-02',
        bills_received_date: '2024-02-10',
      }),
    ])

    await updateLawFirmCaseState('alpha-case', {
      current_phase: 'phase_3_demand',
      landmarks: { demand_sent: true },
    })

    const state = parseYaml(await readFile(join(caseDir, 'state.yaml'), 'utf8'))
    expect(state.current_phase).toBe('phase_3_demand')
    expect(state.landmarks.demand_sent.satisfied).toBe(true)
    expect(state.landmarks.demand_sent.satisfied_by).toBe('mission-control')
  })
})
