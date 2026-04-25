import { describe, expect, it } from 'vitest'
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

  it('does not ready a wait node until its due_at expires', () => {
    const definition = parseWorkflowDefinition(sample)
    const nodes: WorkflowRuntimeNode[] = [
      { node_key: 'identify_liens', node_type: 'recipe', status: 'complete', due_at: null, completed_at: 10, blocked_by: [] },
      { node_key: 'open_liens', node_type: 'recipe', status: 'complete', due_at: null, completed_at: 20, blocked_by: [] },
      { node_key: 'wait_30_days', node_type: 'wait', status: 'waiting', due_at: 200, completed_at: null, blocked_by: [] },
      { node_key: 'follow_up', node_type: 'recipe', status: 'pending', due_at: null, completed_at: null, blocked_by: [] },
    ]
    expect(readyNodeKeys(definition, nodes, 100)).toEqual([])
    expect(readyNodeKeys(definition, nodes, 250)).toEqual(['wait_30_days'])
  })

  it('parses compact durations', () => {
    expect(durationToSeconds('30s')).toBe(30)
    expect(durationToSeconds('5m')).toBe(300)
    expect(durationToSeconds('2h')).toBe(7200)
    expect(durationToSeconds('3d')).toBe(259200)
  })
})
