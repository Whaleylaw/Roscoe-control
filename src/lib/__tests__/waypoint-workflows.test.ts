import { describe, expect, it } from 'vitest'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { parseWorkflowDefinition } from '../workflow-engine'

describe('Waypoint workflow definitions', () => {
  it('parses waypoint-plan-execution', async () => {
    const raw = await readFile(join(process.cwd(), 'workflows/waypoint-plan-execution.yaml'), 'utf8')
    const definition = parseWorkflowDefinition(raw)

    expect(definition.id).toBe('waypoint-plan-execution')
    expect(definition.subject_type).toBe('waypoint_plan')
    expect(definition.nodes.inspect_context.type).toBe('recipe')
    expect(definition.nodes.implement_plan.recipe).toBe('gsd-coder')
    expect(definition.nodes.review_plan.recipe).toBe('gsd-reviewer')
    expect(definition.nodes.human_acceptance_gate.type).toBe('review')
  })

  it('parses waypoint-project-intake with discussion enabled', async () => {
    const raw = await readFile(join(process.cwd(), 'workflows/waypoint-project-intake.yaml'), 'utf8')
    const definition = parseWorkflowDefinition(raw)

    expect(definition.id).toBe('waypoint-project-intake')
    expect(definition.subject_type).toBe('waypoint_project')
    expect(definition.nodes.discuss_objective.type).toBe('recipe')
    expect(definition.nodes.discuss_objective.recipe).toBe('gsd-doc-drafter')
    expect(definition.nodes.discuss_objective.config).toMatchObject({
      waypoint: {
        discussion: {
          enabled: true,
          agent: 'gsd-doc-drafter',
        },
      },
    })
  })
})
