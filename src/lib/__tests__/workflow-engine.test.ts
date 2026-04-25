import { describe, expect, it } from 'vitest'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { durationToSeconds, parseWorkflowDefinition, readyNodeKeys, type WorkflowRuntimeNode } from '../workflow-engine'

const sample = `
schema_version: 1
id: lien-resolution
name: Lien Resolution
version: 1
subject_type: law_firm_case
nodes:
  identify_liens:
    type: recipe
    recipe: firmvault-identify-liens
  open_liens:
    type: recipe
    recipe: firmvault-open-liens
    depends_on:
      - identify_liens
  wait_30_days:
    type: wait
    depends_on:
      - open_liens
    duration: 30d
  follow_up:
    type: recipe
    recipe: firmvault-follow-up-liens
    depends_on:
      - wait_30_days
`

describe('workflow-engine', () => {
  it('parses a workflow definition with recipe and wait nodes', () => {
    const definition = parseWorkflowDefinition(sample)
    expect(definition.id).toBe('lien-resolution')
    expect(definition.nodes.open_liens.depends_on).toEqual(['identify_liens'])
    expect(definition.nodes.wait_30_days.duration).toBe('30d')
  })

  it('parses node, condition, and timer dependencies', () => {
    const definition = parseWorkflowDefinition(`
schema_version: 1
id: final-lien-request
name: Final Lien Request
nodes:
  identify_lien:
    type: recipe
    recipe: firmvault-identify-liens
  request_final_amount:
    type: recipe
    recipe: firmvault-request-final-lien
    depends_on:
      nodes:
        - identify_lien
      conditions:
        - law_firm.landmarks.treatment_complete == true
      timers:
        - after: identify_lien
          duration: 30d
`)
    expect(definition.nodes.request_final_amount.depends_on).toEqual({
      nodes: ['identify_lien'],
      conditions: ['law_firm.landmarks.treatment_complete == true'],
      timers: [{ after: 'identify_lien', duration: '30d' }],
    })
  })

  it('parses Beads-style typed node dependencies', () => {
    const definition = parseWorkflowDefinition(`
schema_version: 1
id: typed-dependencies
name: Typed Dependencies
nodes:
  primary_path:
    type: recipe
    recipe: hello-world
  fallback_path:
    type: recipe
    recipe: hello-world
  aggregate:
    type: recipe
    recipe: hello-world
    depends_on:
      nodes:
        - node: primary_path
          type: waits_for_any
          group: outcome
        - node: fallback_path
          type: waits_for_any
          group: outcome
        - node: primary_path
          type: related
`)
    expect(definition.nodes.aggregate.depends_on).toMatchObject({
      nodes: [
        { node: 'primary_path', type: 'waits_for_any', group: 'outcome' },
        { node: 'fallback_path', type: 'waits_for_any', group: 'outcome' },
        { node: 'primary_path', type: 'related' },
      ],
    })
  })

  it('parses gate nodes as first-class workflow nodes', () => {
    const definition = parseWorkflowDefinition(`
schema_version: 1
id: gate-workflow
name: Gate Workflow
nodes:
  wait_for_owner:
    type: gate
    depends_on:
      conditions:
        - owner.approved == true
  after_gate:
    type: recipe
    recipe: hello-world
    depends_on:
      - wait_for_owner
`)
    expect(definition.nodes.wait_for_owner.type).toBe('gate')
  })

  it('rejects unknown dependencies', () => {
    expect(() => parseWorkflowDefinition(`
schema_version: 1
id: bad-workflow
name: Bad Workflow
nodes:
  second:
    type: recipe
    recipe: hello-world
    depends_on: [missing]
`)).toThrow(/unknown node/)
  })

  it('rejects unknown timer source nodes', () => {
    expect(() => parseWorkflowDefinition(`
schema_version: 1
id: bad-timer-workflow
name: Bad Timer Workflow
nodes:
  follow_up:
    type: recipe
    recipe: hello-world
    depends_on:
      timers:
        - after: missing
          duration: 30d
`)).toThrow(/timer depends on unknown node/)
  })

  it('rejects dependency cycles', () => {
    expect(() => parseWorkflowDefinition(`
schema_version: 1
id: cyclic-workflow
name: Cyclic Workflow
nodes:
  a:
    type: recipe
    recipe: hello-world
    depends_on: [b]
  b:
    type: recipe
    recipe: hello-world
    depends_on: [a]
`)).toThrow(/cycle/)
  })

  it('computes ready nodes from completed dependencies', () => {
    const definition = parseWorkflowDefinition(sample)
    const nodes: WorkflowRuntimeNode[] = [
      { node_key: 'identify_liens', node_type: 'recipe', status: 'complete', due_at: null, completed_at: 10, blocked_by: [] },
      { node_key: 'open_liens', node_type: 'recipe', status: 'pending', due_at: null, completed_at: null, blocked_by: [] },
      { node_key: 'wait_30_days', node_type: 'wait', status: 'pending', due_at: null, completed_at: null, blocked_by: [] },
      { node_key: 'follow_up', node_type: 'recipe', status: 'pending', due_at: null, completed_at: null, blocked_by: [] },
    ]
    expect(readyNodeKeys(definition, nodes)).toEqual(['open_liens'])
  })

  it('does not let related dependencies block ready work', () => {
    const definition = parseWorkflowDefinition(`
schema_version: 1
id: related-dependency
name: Related Dependency
nodes:
  reference_only:
    type: recipe
    recipe: hello-world
  actionable:
    type: recipe
    recipe: hello-world
    depends_on:
      nodes:
        - node: reference_only
          type: related
`)
    const nodes: WorkflowRuntimeNode[] = [
      { node_key: 'reference_only', node_type: 'recipe', status: 'pending', due_at: null, completed_at: null, blocked_by: [] },
      { node_key: 'actionable', node_type: 'recipe', status: 'pending', due_at: null, completed_at: null, blocked_by: [] },
    ]
    expect(readyNodeKeys(definition, nodes)).toEqual(['reference_only', 'actionable'])
  })

  it('readies waits_for_any dependencies when any dependency in the group is complete', () => {
    const definition = parseWorkflowDefinition(`
schema_version: 1
id: any-dependency
name: Any Dependency
nodes:
  primary_path:
    type: recipe
    recipe: hello-world
  fallback_path:
    type: recipe
    recipe: hello-world
  aggregate:
    type: recipe
    recipe: hello-world
    depends_on:
      nodes:
        - node: primary_path
          type: waits_for_any
          group: outcome
        - node: fallback_path
          type: waits_for_any
          group: outcome
`)
    const nodes: WorkflowRuntimeNode[] = [
      { node_key: 'primary_path', node_type: 'recipe', status: 'complete', due_at: null, completed_at: 10, blocked_by: [] },
      { node_key: 'fallback_path', node_type: 'recipe', status: 'pending', due_at: null, completed_at: null, blocked_by: [] },
      { node_key: 'aggregate', node_type: 'recipe', status: 'pending', due_at: null, completed_at: null, blocked_by: [] },
    ]
    expect(readyNodeKeys(definition, nodes)).toEqual(['fallback_path', 'aggregate'])
  })

  it('does not ready an already-waiting wait node', () => {
    const definition = parseWorkflowDefinition(sample)
    const nodes: WorkflowRuntimeNode[] = [
      { node_key: 'identify_liens', node_type: 'recipe', status: 'complete', due_at: null, completed_at: 10, blocked_by: [] },
      { node_key: 'open_liens', node_type: 'recipe', status: 'complete', due_at: null, completed_at: 20, blocked_by: [] },
      { node_key: 'wait_30_days', node_type: 'wait', status: 'waiting', due_at: 200, completed_at: null, blocked_by: [] },
      { node_key: 'follow_up', node_type: 'recipe', status: 'pending', due_at: null, completed_at: null, blocked_by: [] },
    ]
    expect(readyNodeKeys(definition, nodes, 100)).toEqual([])
    expect(readyNodeKeys(definition, nodes, 250)).toEqual([])
  })

  it('readies a pending wait node once dependencies are complete', () => {
    const definition = parseWorkflowDefinition(sample)
    const nodes: WorkflowRuntimeNode[] = [
      { node_key: 'identify_liens', node_type: 'recipe', status: 'complete', due_at: null, completed_at: 10, blocked_by: [] },
      { node_key: 'open_liens', node_type: 'recipe', status: 'complete', due_at: null, completed_at: 20, blocked_by: [] },
      { node_key: 'wait_30_days', node_type: 'wait', status: 'pending', due_at: null, completed_at: null, blocked_by: [] },
      { node_key: 'follow_up', node_type: 'recipe', status: 'pending', due_at: null, completed_at: null, blocked_by: [] },
    ]
    expect(readyNodeKeys(definition, nodes, 100)).toEqual(['wait_30_days'])
  })

  it('parses compact durations', () => {
    expect(durationToSeconds('30s')).toBe(30)
    expect(durationToSeconds('5m')).toBe(300)
    expect(durationToSeconds('2h')).toBe(7200)
    expect(durationToSeconds('3d')).toBe(259200)
  })

  it('parses the FirmVault request-medical-records workflow definition', async () => {
    const raw = await readFile(join(process.cwd(), 'workflows', 'firmvault-request-medical-records.yaml'), 'utf8')
    const definition = parseWorkflowDefinition(raw)
    expect(definition.id).toBe('firmvault-request-medical-records')
    expect(definition.nodes.first_follow_up_records_request.depends_on).toMatchObject({
      nodes: ['send_records_request'],
      timers: [{ after: 'send_records_request', duration: '14d' }],
    })
    expect(definition.nodes.escalate_records_request.depends_on).toMatchObject({
      nodes: ['second_follow_up_records_request'],
      timers: [{ after: 'second_follow_up_records_request', duration: '9d' }],
    })
  })
})
