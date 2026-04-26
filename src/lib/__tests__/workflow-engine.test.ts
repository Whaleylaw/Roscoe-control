import { describe, expect, it } from 'vitest'
import { readFile } from 'fs/promises'
import { join } from 'path'
import Database from 'better-sqlite3'
import { runMigrations } from '../migrations'
import {
  advanceWorkflowAfterTaskApproval,
  advanceDueWorkflowTimers,
  bypassWorkflowNode,
  cancelWorkflowInstance,
  createWorkflowDefinition,
  durationToSeconds,
  listWorkflowActivity,
  materializeReadyWorkflowNodes,
  parseWorkflowDefinition,
  readyNodeKeys,
  runWorkflowTriggers,
  startWorkflowInstance,
  type WorkflowRuntimeNode,
} from '../workflow-engine'

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
    expect(definition.triggers).toEqual([{ type: 'manual', enabled: true, config: {} }])
    expect(definition.nodes.open_liens.depends_on).toEqual(['identify_liens'])
    expect(definition.nodes.wait_30_days.duration).toBe('30d')
  })

  it('parses workflow variables, plural triggers, and node instruction files', () => {
    const definition = parseWorkflowDefinition(`
schema_version: 1
id: trigger-vars
name: Trigger Vars
vars:
  provider_name:
    description: Provider name to request records from.
    required: true
    type: string
  follow_up_days: 30
triggers:
  - type: manual
  - type: condition
    condition: law_firm.landmarks.treatment_complete == true
  - type: event
    event: case.landmark.satisfied
  - type: cooldown
    duration: 30d
nodes:
  request_records:
    type: recipe
    recipe: hello-world
    description: Prepare and send a provider-specific records request.
    description_file: workflows/request-records/request.md
`)
    expect(definition.vars.provider_name).toMatchObject({
      description: 'Provider name to request records from.',
      required: true,
      type: 'string',
    })
    expect(definition.vars.follow_up_days).toBe(30)
    expect(definition.triggers).toEqual([
      { type: 'manual', enabled: true, config: {} },
      { type: 'condition', condition: 'law_firm.landmarks.treatment_complete == true', enabled: true, config: {} },
      { type: 'event', on: 'case.landmark.satisfied', enabled: true, config: {} },
      { type: 'cooldown', interval: '30d', enabled: true, config: {} },
    ])
    expect(definition.nodes.request_records.description_file).toBe('workflows/request-records/request.md')
  })

  it('accepts legacy singular trigger and normalizes it to triggers', () => {
    const definition = parseWorkflowDefinition(`
schema_version: 1
id: legacy-trigger
name: Legacy Trigger
trigger:
  type: condition
  condition: case.ready == true
nodes:
  run:
    type: recipe
    recipe: hello-world
`)
    expect(definition.triggers).toEqual([
      { type: 'condition', condition: 'case.ready == true', enabled: true, config: {} },
    ])
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
    expect(definition.version).toBe(2)
    expect(definition.vars.provider_slug).toMatchObject({
      required: true,
      type: 'string',
    })
    expect(definition.nodes.wait_15_days_for_records).toMatchObject({
      type: 'wait',
      duration: '15d',
      depends_on: { nodes: ['send_records_request'], conditions: [], timers: [] },
      exit_when: { condition: 'law_firm.provider.records_and_bills_received == true' },
    })
    expect(definition.nodes.first_follow_up_records_request.depends_on).toMatchObject({
      nodes: ['wait_15_days_for_records'],
    })
    expect(definition.nodes.wait_15_more_days_for_escalation).toMatchObject({
      type: 'wait',
      duration: '15d',
      depends_on: { nodes: ['third_follow_up_records_request'], conditions: [], timers: [] },
    })
    expect(definition.nodes.receive_and_process_records_bills).toMatchObject({
      type: 'recipe',
      recipe: 'firmvault-medical-records-receive-and-process',
      depends_on: {
        conditions: ['law_firm.provider.records_or_bills_received == true'],
      },
    })
  })

  it('starts and materializes a workflow from a matching condition trigger once per subject', () => {
    const db = new Database(':memory:')
    try {
      runMigrations(db)
      const project = db.prepare(`
        SELECT id FROM projects
        WHERE workspace_id = 1 AND slug = 'general'
        LIMIT 1
      `).get() as { id: number } | undefined
      expect(project).toBeTruthy()

      const definitionId = createWorkflowDefinition(db, `
schema_version: 1
id: trigger-materialization
name: Trigger Materialization
subject_type: law_firm_case
triggers:
  - type: condition
    condition: law_firm.landmarks.records_needed == true
nodes:
  request_records:
    type: recipe
    recipe: hello-world
`, 'tester', 1, 1)

      const first = runWorkflowTriggers(db, {
        subjectType: 'law_firm_case',
        subjectId: 'abby-sitgraves',
        triggerType: 'condition',
        condition: 'law_firm.landmarks.records_needed == true',
        projectId: project!.id,
        actor: 'tester',
        workspaceId: 1,
        tenantId: 1,
        now: 1000,
      })

      expect(first.matched).toBe(1)
      expect(first.started).toMatchObject([{ definition_id: definitionId, definition_slug: 'trigger-materialization' }])
      expect(first.materialized[0].created).toHaveLength(1)
      expect(first.materialized[0].created[0].node_key).toBe('request_records')

      const second = runWorkflowTriggers(db, {
        subjectType: 'law_firm_case',
        subjectId: 'abby-sitgraves',
        triggerType: 'condition',
        condition: 'law_firm.landmarks.records_needed == true',
        projectId: project!.id,
        actor: 'tester',
        workspaceId: 1,
        tenantId: 1,
        now: 1001,
      })

      expect(second.started).toHaveLength(0)
      expect(second.skipped).toMatchObject([{ definition_slug: 'trigger-materialization', reason: 'existing_active' }])

      const activity = listWorkflowActivity(db, {
        subjectType: 'law_firm_case',
        subjectId: 'abby-sitgraves',
        workspaceId: 1,
      })
      expect(activity).toHaveLength(1)
      expect(activity[0]).toMatchObject({
        definition_slug: 'trigger-materialization',
        running_nodes: 1,
        task_count: 1,
      })
    } finally {
      db.close()
    }
  })

  it('stores workflow variables and passes them into materialized task metadata and instructions', () => {
    const db = new Database(':memory:')
    try {
      runMigrations(db)
      const project = db.prepare(`
        SELECT id FROM projects
        WHERE workspace_id = 1 AND slug = 'general'
        LIMIT 1
      `).get() as { id: number } | undefined
      expect(project).toBeTruthy()

      const definitionId = createWorkflowDefinition(db, `
schema_version: 1
id: variable-materialization
name: Variable Materialization
subject_type: law_firm_case
vars:
  provider_slug:
    required: true
    type: string
  request_bills:
    default: true
    type: boolean
nodes:
  prepare_request:
    type: recipe
    recipe: hello-world
    config:
      task_goal: Prepare records request for {{provider_slug}}.
      request_bills: "{{request_bills}}"
`, 'tester', 1, 1)

      const instance = startWorkflowInstance(db, {
        definitionId,
        subjectType: 'law_firm_case',
        subjectId: 'abby-sitgraves',
        actor: 'tester',
        workspaceId: 1,
        tenantId: 1,
        vars: { provider_slug: 'bluegrass-orthopedics' },
        now: 6000,
      })
      expect(instance.vars).toEqual({ provider_slug: 'bluegrass-orthopedics', request_bills: true })

      const materialized = materializeReadyWorkflowNodes(db, {
        workflowInstanceId: instance.instance_id,
        projectId: project!.id,
        workspaceId: 1,
        actor: 'tester',
        now: 6001,
      })
      expect(materialized.created).toMatchObject([{ node_key: 'prepare_request' }])
      const task = db.prepare(`
        SELECT description, metadata
        FROM tasks
        WHERE id = ?
      `).get(materialized.created[0].task_id) as { description: string; metadata: string }
      expect(task.description).toContain('- provider_slug: bluegrass-orthopedics')
      expect(task.description).toContain('- request_bills: true')
      expect(task.description).toContain('Goal: Prepare records request for bluegrass-orthopedics.')
      expect(task.description).toContain('Case: abby-sitgraves')
      expect(task.description).toContain('Case file: cases/abby-sitgraves/abby-sitgraves.md')
      expect(JSON.parse(task.metadata)).toMatchObject({
        workflow: {
          vars: { provider_slug: 'bluegrass-orthopedics', request_bills: true },
        },
        law_firm: {
          case_slug: 'abby-sitgraves',
          provider_slug: 'bluegrass-orthopedics',
        },
      })
    } finally {
      db.close()
    }
  })

  it('rejects starting a workflow when a required variable is missing', () => {
    const db = new Database(':memory:')
    try {
      runMigrations(db)
      const definitionId = createWorkflowDefinition(db, `
schema_version: 1
id: missing-required-variable
name: Missing Required Variable
subject_type: law_firm_case
vars:
  provider_slug:
    required: true
    type: string
nodes:
  prepare_request:
    type: recipe
    recipe: hello-world
`, 'tester', 1, 1)

      expect(() => startWorkflowInstance(db, {
        definitionId,
        subjectType: 'law_firm_case',
        subjectId: 'abby-sitgraves',
        actor: 'tester',
        workspaceId: 1,
        tenantId: 1,
        now: 6100,
      })).toThrow(/requires variable 'provider_slug'/)
    } finally {
      db.close()
    }
  })

  it('skips triggered workflows with missing required variables instead of failing the whole trigger pass', () => {
    const db = new Database(':memory:')
    try {
      runMigrations(db)
      createWorkflowDefinition(db, `
schema_version: 1
id: trigger-missing-required-variable
name: Trigger Missing Required Variable
subject_type: law_firm_case
triggers:
  - type: condition
    condition: law_firm.landmarks.treatment_complete == true
vars:
  provider_slug:
    required: true
    type: string
nodes:
  prepare_request:
    type: recipe
    recipe: hello-world
`, 'tester', 1, 1)

      const result = runWorkflowTriggers(db, {
        subjectType: 'law_firm_case',
        subjectId: 'abby-sitgraves',
        triggerType: 'condition',
        condition: 'law_firm.landmarks.treatment_complete == true',
        actor: 'tester',
        workspaceId: 1,
        tenantId: 1,
        now: 6200,
      })

      expect(result.started).toHaveLength(0)
      expect(result.skipped[0]).toMatchObject({
        definition_slug: 'trigger-missing-required-variable',
      })
      expect(result.skipped[0].reason).toContain('invalid_vars:')
      expect(result.skipped[0].reason).toContain("requires variable 'provider_slug'")
    } finally {
      db.close()
    }
  })

  it('advances workflow nodes after task approval and materializes the next ready task', () => {
    const db = new Database(':memory:')
    try {
      runMigrations(db)
      const project = db.prepare(`
        SELECT id FROM projects
        WHERE workspace_id = 1 AND slug = 'general'
        LIMIT 1
      `).get() as { id: number } | undefined
      expect(project).toBeTruthy()

      const definitionId = createWorkflowDefinition(db, `
schema_version: 1
id: approval-advancement
name: Approval Advancement
subject_type: law_firm_case
nodes:
  first_step:
    type: recipe
    recipe: hello-world
  second_step:
    type: recipe
    recipe: hello-world
    depends_on:
      - first_step
`, 'tester', 1, 1)

      const instance = startWorkflowInstance(db, {
        definitionId,
        subjectType: 'law_firm_case',
        subjectId: 'abby-sitgraves',
        actor: 'tester',
        workspaceId: 1,
        tenantId: 1,
        now: 1000,
      })
      const firstMaterialized = materializeReadyWorkflowNodes(db, {
        workflowInstanceId: instance.instance_id,
        projectId: project!.id,
        workspaceId: 1,
        actor: 'tester',
        now: 1001,
      })
      expect(firstMaterialized.created).toMatchObject([{ node_key: 'first_step' }])

      const firstTaskId = firstMaterialized.created[0].task_id
      const advanced = advanceWorkflowAfterTaskApproval(db, {
        taskId: firstTaskId,
        actor: 'aegis',
        payload: { source: 'quality_review' },
        now: 1002,
      })

      expect(advanced.completed?.ready_nodes).toContain('second_step')
      expect(advanced.materialized?.created).toMatchObject([{ node_key: 'second_step' }])
      expect(db.prepare(`
        SELECT status FROM workflow_node_instances
        WHERE workflow_instance_id = ? AND node_key = 'first_step'
      `).get(instance.instance_id)).toMatchObject({ status: 'complete' })
      expect(db.prepare(`
        SELECT status FROM workflow_node_instances
        WHERE workflow_instance_id = ? AND node_key = 'second_step'
      `).get(instance.instance_id)).toMatchObject({ status: 'running' })
    } finally {
      db.close()
    }
  })

  it('marks a workflow complete when the final task-backed node is approved', () => {
    const db = new Database(':memory:')
    try {
      runMigrations(db)
      const project = db.prepare(`
        SELECT id FROM projects
        WHERE workspace_id = 1 AND slug = 'general'
        LIMIT 1
      `).get() as { id: number } | undefined
      expect(project).toBeTruthy()

      const definitionId = createWorkflowDefinition(db, `
schema_version: 1
id: final-approval
name: Final Approval
subject_type: law_firm_case
nodes:
  only_step:
    type: recipe
    recipe: hello-world
`, 'tester', 1, 1)
      const instance = startWorkflowInstance(db, {
        definitionId,
        subjectType: 'law_firm_case',
        subjectId: 'abby-sitgraves',
        actor: 'tester',
        workspaceId: 1,
        tenantId: 1,
        now: 2000,
      })
      const materialized = materializeReadyWorkflowNodes(db, {
        workflowInstanceId: instance.instance_id,
        projectId: project!.id,
        workspaceId: 1,
        actor: 'tester',
        now: 2001,
      })

      advanceWorkflowAfterTaskApproval(db, {
        taskId: materialized.created[0].task_id,
        actor: 'aegis',
        payload: { source: 'quality_review' },
        now: 2002,
      })

      expect(db.prepare(`
        SELECT status, completed_at
        FROM workflow_instances
        WHERE id = ?
      `).get(instance.instance_id)).toMatchObject({ status: 'complete', completed_at: 2002 })
      expect(db.prepare(`
        SELECT event_type
        FROM workflow_events
        WHERE workflow_instance_id = ?
        ORDER BY id DESC
        LIMIT 1
      `).get(instance.instance_id)).toMatchObject({ event_type: 'workflow.completed' })
    } finally {
      db.close()
    }
  })

  it('advances due workflow timers without scanning unrelated workflow work', () => {
    const db = new Database(':memory:')
    try {
      runMigrations(db)
      const project = db.prepare(`
        SELECT id FROM projects
        WHERE workspace_id = 1 AND slug = 'general'
        LIMIT 1
      `).get() as { id: number } | undefined
      expect(project).toBeTruthy()

      const definitionId = createWorkflowDefinition(db, `
schema_version: 1
id: timer-advancement
name: Timer Advancement
subject_type: law_firm_case
nodes:
  send_request:
    type: recipe
    recipe: hello-world
  wait_30_seconds:
    type: wait
    duration: 30s
    depends_on:
      - send_request
  follow_up:
    type: recipe
    recipe: hello-world
    depends_on:
      - wait_30_seconds
`, 'tester', 1, 1)
      const instance = startWorkflowInstance(db, {
        definitionId,
        subjectType: 'law_firm_case',
        subjectId: 'abby-sitgraves',
        actor: 'tester',
        workspaceId: 1,
        tenantId: 1,
        now: 1000,
      })
      const firstMaterialized = materializeReadyWorkflowNodes(db, {
        workflowInstanceId: instance.instance_id,
        projectId: project!.id,
        workspaceId: 1,
        actor: 'tester',
        now: 1001,
      })

      advanceWorkflowAfterTaskApproval(db, {
        taskId: firstMaterialized.created[0].task_id,
        actor: 'aegis',
        payload: { source: 'quality_review' },
        now: 1010,
      })

      expect(db.prepare(`
        SELECT status, due_at FROM workflow_node_instances
        WHERE workflow_instance_id = ? AND node_key = 'wait_30_seconds'
      `).get(instance.instance_id)).toMatchObject({ status: 'waiting', due_at: 1040 })

      const early = advanceDueWorkflowTimers(db, {
        actor: 'workflow-timer',
        workspaceId: 1,
        now: 1039,
      })
      expect(early.completed).toHaveLength(0)

      const due = advanceDueWorkflowTimers(db, {
        actor: 'workflow-timer',
        workspaceId: 1,
        now: 1040,
      })
      expect(due.completed).toMatchObject([{ node_key: 'wait_30_seconds' }])
      expect(due.materialized[0].created).toMatchObject([{ node_key: 'follow_up' }])
      expect(db.prepare(`
        SELECT status FROM workflow_node_instances
        WHERE workflow_instance_id = ? AND node_key = 'follow_up'
      `).get(instance.instance_id)).toMatchObject({ status: 'running' })
    } finally {
      db.close()
    }
  })

  it('cancels an active workflow instance and unfinished nodes without mutating linked tasks', () => {
    const db = new Database(':memory:')
    try {
      runMigrations(db)
      const project = db.prepare(`
        SELECT id FROM projects
        WHERE workspace_id = 1 AND slug = 'general'
        LIMIT 1
      `).get() as { id: number } | undefined
      expect(project).toBeTruthy()

      const definitionId = createWorkflowDefinition(db, `
schema_version: 1
id: cancel-example
name: Cancel Example
subject_type: law_firm_case
nodes:
  first_step:
    type: recipe
    recipe: hello-world
  second_step:
    type: recipe
    recipe: hello-world
    depends_on:
      - first_step
`, 'tester', 1, 1)
      const instance = startWorkflowInstance(db, {
        definitionId,
        subjectType: 'law_firm_case',
        subjectId: 'abby-sitgraves',
        actor: 'tester',
        workspaceId: 1,
        tenantId: 1,
        now: 3000,
      })
      const materialized = materializeReadyWorkflowNodes(db, {
        workflowInstanceId: instance.instance_id,
        projectId: project!.id,
        workspaceId: 1,
        actor: 'tester',
        now: 3001,
      })

      const cancelled = cancelWorkflowInstance(db, {
        workflowInstanceId: instance.instance_id,
        actor: 'operator',
        workspaceId: 1,
        reason: 'not needed',
        now: 3002,
      })

      expect(cancelled).toMatchObject({ workflow_instance_id: instance.instance_id, cancelled_nodes: 2 })
      expect(db.prepare(`SELECT status FROM workflow_instances WHERE id = ?`).get(instance.instance_id)).toMatchObject({ status: 'cancelled' })
      expect(db.prepare(`
        SELECT COUNT(*) AS count FROM workflow_node_instances
        WHERE workflow_instance_id = ? AND status = 'cancelled'
      `).get(instance.instance_id)).toMatchObject({ count: 2 })
      expect(db.prepare(`SELECT status FROM tasks WHERE id = ?`).get(materialized.created[0].task_id)).toMatchObject({ status: 'inbox' })
      expect(db.prepare(`
        SELECT event_type FROM workflow_events
        WHERE workflow_instance_id = ?
        ORDER BY id DESC LIMIT 1
      `).get(instance.instance_id)).toMatchObject({ event_type: 'workflow.cancelled' })
    } finally {
      db.close()
    }
  })

  it('bypasses a not-applicable node and promotes downstream work', () => {
    const db = new Database(':memory:')
    try {
      runMigrations(db)
      const definitionId = createWorkflowDefinition(db, `
schema_version: 1
id: bypass-example
name: Bypass Example
subject_type: law_firm_case
nodes:
  optional_step:
    type: recipe
    recipe: hello-world
  downstream_step:
    type: recipe
    recipe: hello-world
    depends_on:
      - optional_step
`, 'tester', 1, 1)
      const instance = startWorkflowInstance(db, {
        definitionId,
        subjectType: 'law_firm_case',
        subjectId: 'abby-sitgraves',
        actor: 'tester',
        workspaceId: 1,
        tenantId: 1,
        now: 4000,
      })

      const bypassed = bypassWorkflowNode(db, {
        workflowInstanceId: instance.instance_id,
        nodeKey: 'optional_step',
        actor: 'operator',
        workspaceId: 1,
        reason: 'No lien exists.',
        now: 4001,
      })

      expect(bypassed).toMatchObject({
        workflow_instance_id: instance.instance_id,
        node_key: 'optional_step',
        ready_nodes: ['downstream_step'],
      })
      expect(db.prepare(`
        SELECT status, completed_at, output_json
        FROM workflow_node_instances
        WHERE workflow_instance_id = ? AND node_key = 'optional_step'
      `).get(instance.instance_id)).toMatchObject({
        status: 'skipped',
        completed_at: 4001,
        output_json: JSON.stringify({ reason: 'No lien exists.', bypassed_by: 'operator' }),
      })
      expect(db.prepare(`
        SELECT status
        FROM workflow_node_instances
        WHERE workflow_instance_id = ? AND node_key = 'downstream_step'
      `).get(instance.instance_id)).toMatchObject({ status: 'ready' })
      expect(db.prepare(`
        SELECT event_type
        FROM workflow_events
        WHERE workflow_instance_id = ?
        ORDER BY id DESC
        LIMIT 1
      `).get(instance.instance_id)).toMatchObject({ event_type: 'node.ready' })
    } finally {
      db.close()
    }
  })

  it('lists unresolved dependency blockers for workflow activity nodes', () => {
    const db = new Database(':memory:')
    try {
      runMigrations(db)
      const definitionId = createWorkflowDefinition(db, `
schema_version: 1
id: blocker-display
name: Blocker Display
subject_type: law_firm_case
nodes:
  request_final_amount:
    type: recipe
    recipe: hello-world
    depends_on:
      conditions:
        - law_firm.landmarks.treatment_complete == true
`, 'tester', 1, 1)
      startWorkflowInstance(db, {
        definitionId,
        subjectType: 'law_firm_case',
        subjectId: 'abby-sitgraves',
        actor: 'tester',
        workspaceId: 1,
        tenantId: 1,
        now: 5000,
      })

      const activity = listWorkflowActivity(db, {
        subjectType: 'law_firm_case',
        subjectId: 'abby-sitgraves',
        workspaceId: 1,
      })

      expect(activity[0].nodes[0]).toMatchObject({
        node_key: 'request_final_amount',
        blocked_by: ['law_firm.landmarks.treatment_complete == true'],
      })
    } finally {
      db.close()
    }
  })
})
