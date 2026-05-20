import { mkdir, mkdtemp, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, describe, expect, it } from 'vitest'
import { previewLawFirmWorkflowStatuses, previewLawFirmWorkflowTasks } from '../law-firm-workflow'

const previousRoot = process.env.MISSION_CONTROL_LAW_FIRM_ROOT

afterEach(() => {
  if (previousRoot === undefined) delete process.env.MISSION_CONTROL_LAW_FIRM_ROOT
  else process.env.MISSION_CONTROL_LAW_FIRM_ROOT = previousRoot
})

describe('law-firm workflow materializer', () => {
  it('translates unsatisfied FirmVault v2 landmarks into Mission Control task items', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mc-law-firm-workflow-'))
    process.env.MISSION_CONTROL_LAW_FIRM_ROOT = root
    await mkdir(join(root, 'cases', 'alpha-case'), { recursive: true })
    await mkdir(join(root, 'skills.tools.workflows', 'workflows'), { recursive: true })
    await mkdir(join(root, 'skills.tools.workflows', 'runtime', 'task_templates'), { recursive: true })

    await writeFile(join(root, 'cases', 'alpha-case', 'alpha-case.md'), `---
schema_version: 2
client_name: Alpha Case
case_type: auto_accident
status: demand
damages_calculated: true
landmarks:
  all_records_received: true
  all_bills_received: true
  demand_drafted: false
  attorney_approved_demand: false
  demand_sent: false
workflow_bypasses:
  optional_waived:
    status: not_applicable
    reason: Not needed for this case.
---
# Alpha Case
`, 'utf8')

    await writeFile(join(root, 'skills.tools.workflows', 'workflows', 'PHASE_DAG.yaml'), `
schema_version: 2
core_phases:
  phase_3_demand:
    name: Demand In Progress
    landmarks:
      - id: records_received_sufficient
        name: Records Received Sufficient
        mandatory: false
        condition: case.frontmatter.records_sufficient == true
      - id: demand_drafted
        name: Demand Drafted
        mandatory: false
        condition: case.has_document("demand")
      - id: attorney_reviewed_demand
        name: Attorney Reviewed Demand
        mandatory: true
        condition: case.flag("attorney_approved_demand")
      - id: optional_waived
        name: Optional Waived
        mandatory: false
        condition: false
parallel_tracks:
  lien_track:
    name: Liens
    landmarks:
      - id: liens_identified
        name: Liens Identified
        mandatory: false
        condition: case.flag("lien_audit_current")
      - id: final_amounts_requested
        name: Final Lien Amounts Requested
        mandatory: false
        condition: false
  client_contact:
    name: Client Contact
    landmarks: []
`, 'utf8')

    await writeFile(join(root, 'skills.tools.workflows', 'runtime', 'task_templates', 'draft-demand.yaml'), `---
template_id: draft-demand
landmark: demand_drafted
phase: phase_3_demand
skill: demand-letter-generation
priority: normal
review: true
depends_on: []
body: |
  Draft the demand for {{case_slug}}.
---
`, 'utf8')
    await writeFile(join(root, 'skills.tools.workflows', 'runtime', 'task_templates', 'attorney-review-demand.yaml'), `---
template_id: attorney-review-demand
landmark: attorney_reviewed_demand
phase: phase_3_demand
skill: demand-review
priority: high
review: true
depends_on:
  - "{case_slug}-draft-demand"
body: |
  Review the demand for {{case_slug}}.
---
`, 'utf8')

    const items = await previewLawFirmWorkflowTasks('alpha-case')

    expect(items.map((item) => item.landmark_id)).toEqual(['demand_drafted', 'liens_identified'])
    expect(items[0]).toMatchObject({
      task_template: 'draft-demand',
      status: 'inbox',
      skill: 'demand-letter-generation',
      metadata: {
        runner_auto_route: false,
        law_firm: {
          manual_start_required: true,
        },
      },
    })
    expect(items[1]).toMatchObject({
      landmark_id: 'liens_identified',
      status: 'inbox',
      blocked_by: [],
    })
  })

  it('blocks document collection until the case setup landmark is satisfied', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mc-law-firm-workflow-'))
    process.env.MISSION_CONTROL_LAW_FIRM_ROOT = root
    await mkdir(join(root, 'cases', 'new-case'), { recursive: true })

    await writeFile(join(root, 'cases', 'new-case', 'new-case.md'), `---
schema_version: 3
client_name: New Case
case_type: auto_accident
status: intake
landmarks:
  case_setup_complete:
    satisfied: false
    evidence: []
  client_info_received:
    satisfied: true
    evidence:
      - client/intake.md
---
# New Case
`, 'utf8')

    const statuses = await previewLawFirmWorkflowStatuses('new-case')
    const documentCollection = statuses.find((workflow) => workflow.workflow_id === 'document_collection')
    const loadChecklist = documentCollection?.steps.find((step) => step.id === 'load_document_checklist')

    expect(documentCollection?.status).toBe('blocked')
    expect(loadChecklist).toMatchObject({
      status: 'blocked',
      blocked_by: ['law_firm.landmarks.case_setup_complete == true'],
    })
  })
})
