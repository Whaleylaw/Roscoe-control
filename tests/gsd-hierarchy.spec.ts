import { expect, test } from '@playwright/test'
import { API_KEY_HEADER, createTestProject, deleteTestProject } from './helpers'

type GsdWorkstream = { id: number; key: string; name: string; status: string; updated_at: number }
type GsdMilestone = { id: number; version_label: string; title: string; status: string; updated_at: number }
type GsdPhase = {
  id: number
  phase_key: string
  phase_slug: string
  lifecycle_phase: string
  status: string
  updated_at: number
}
type GsdPlan = { id: number; plan_ref: string; title: string; status: string; updated_at: number }

test.describe('Phase 10: GSD hierarchy end-to-end', () => {
  let projectId = 0

  test.afterAll(async ({ request }) => {
    if (projectId) {
      await deleteTestProject(request, projectId).catch(() => {})
    }
  })

  test('one project hosts multiple active milestones with independent phase and plan progression', async ({
    request,
  }) => {
    const created = await createTestProject(request, {
      gsd_enabled: true,
      gsd_track: 'product',
      gsd_gate_mode: 'manual_approval',
    })
    expect(created.res.status()).toBe(201)
    projectId = created.id

    const workstreamRes = await request.post(`/api/projects/${projectId}/gsd/workstreams`, {
      headers: API_KEY_HEADER,
      data: { key: 'core-platform', name: 'Core Platform', status: 'active' },
    })
    expect(workstreamRes.ok()).toBeTruthy()
    const workstream = (await workstreamRes.json()).workstream as GsdWorkstream

    const milestoneARes = await request.post(`/api/projects/${projectId}/gsd/milestones`, {
      headers: API_KEY_HEADER,
      data: {
        workstream_id: workstream.id,
        version_label: 'v2.1',
        title: 'Gateway parity rollout',
        status: 'active',
      },
    })
    expect(milestoneARes.ok()).toBeTruthy()
    const milestoneA = (await milestoneARes.json()).milestone as GsdMilestone

    const milestoneBRes = await request.post(`/api/projects/${projectId}/gsd/milestones`, {
      headers: API_KEY_HEADER,
      data: {
        workstream_id: workstream.id,
        version_label: 'v2.2',
        title: 'Lifecycle polish rollout',
        status: 'active',
      },
    })
    expect(milestoneBRes.ok()).toBeTruthy()
    const milestoneB = (await milestoneBRes.json()).milestone as GsdMilestone

    const phaseARes = await request.post(`/api/gsd/milestones/${milestoneA.id}/phases`, {
      headers: API_KEY_HEADER,
      data: {
        phase_key: '10-01',
        phase_slug: 'schema-and-api-foundation',
        lifecycle_phase: 'discuss',
        ordering_numeric: 10.01,
        status: 'active',
        depends_on_phase_ids: [],
      },
    })
    expect(phaseARes.ok()).toBeTruthy()
    const phaseA = (await phaseARes.json()).phase as GsdPhase

    const phaseBRes = await request.post(`/api/gsd/milestones/${milestoneB.id}/phases`, {
      headers: API_KEY_HEADER,
      data: {
        phase_key: '10-02',
        phase_slug: 'lifecycle-ui-polish',
        lifecycle_phase: 'discuss',
        ordering_numeric: 10.02,
        status: 'active',
        depends_on_phase_ids: [],
      },
    })
    expect(phaseBRes.ok()).toBeTruthy()
    const phaseB = (await phaseBRes.json()).phase as GsdPhase

    const planA1Res = await request.post(`/api/gsd/phases/${phaseA.id}/plans`, {
      headers: API_KEY_HEADER,
      data: {
        plan_ref: '10-01-PLAN-A',
        title: 'Ship hierarchy schema',
        wave: 1,
        status: 'todo',
        depends_on_plan_ids: [],
      },
    })
    expect(planA1Res.ok()).toBeTruthy()
    const planA1 = (await planA1Res.json()).plan as GsdPlan

    const planA2Res = await request.post(`/api/gsd/phases/${phaseA.id}/plans`, {
      headers: API_KEY_HEADER,
      data: {
        plan_ref: '10-01-PLAN-B',
        title: 'Ship hierarchy UI',
        wave: 2,
        status: 'todo',
        depends_on_plan_ids: [planA1.id],
      },
    })
    expect(planA2Res.ok()).toBeTruthy()
    const planA2 = (await planA2Res.json()).plan as GsdPlan

    const planB1Res = await request.post(`/api/gsd/phases/${phaseB.id}/plans`, {
      headers: API_KEY_HEADER,
      data: {
        plan_ref: '10-02-PLAN-A',
        title: 'Wire lifecycle realtime refresh',
        wave: 1,
        status: 'todo',
        depends_on_plan_ids: [],
      },
    })
    expect(planB1Res.ok()).toBeTruthy()
    const planB1 = (await planB1Res.json()).plan as GsdPlan

    const initialGraphRes = await request.get(`/api/projects/${projectId}/gsd/lifecycle-graph`, {
      headers: API_KEY_HEADER,
    })
    expect(initialGraphRes.status()).toBe(200)
    const initialGraph = await initialGraphRes.json()
    expect(initialGraph.legacy.fallback_active).toBe(false)
    expect(initialGraph.rollups.active_workstreams).toBe(1)
    expect(initialGraph.rollups.active_milestones).toBe(2)
    expect(initialGraph.rollups.active_phases).toBe(2)
    expect(initialGraph.rollups.in_progress_plans).toBe(0)
    expect(initialGraph.workstreams).toHaveLength(1)
    expect(initialGraph.workstreams[0].milestones).toHaveLength(2)

    const blockedPlanRes = await request.post(`/api/gsd/plans/${planA2.id}/transition`, {
      headers: API_KEY_HEADER,
      data: { to_status: 'in_progress' },
    })
    expect(blockedPlanRes.status()).toBe(409)
    const blockedPlanBody = await blockedPlanRes.json()
    expect(blockedPlanBody.code).toBe('PLAN_DEPENDENCY_BLOCKED')
    expect(blockedPlanBody.blocking_plan_ids).toContain(planA1.id)

    const startPlanB1Res = await request.post(`/api/gsd/plans/${planB1.id}/transition`, {
      headers: API_KEY_HEADER,
      data: { to_status: 'in_progress' },
    })
    expect(startPlanB1Res.status()).toBe(200)

    const startPlanA1Res = await request.post(`/api/gsd/plans/${planA1.id}/transition`, {
      headers: API_KEY_HEADER,
      data: { to_status: 'in_progress' },
    })
    expect(startPlanA1Res.status()).toBe(200)
    const startPlanA1Body = await startPlanA1Res.json()

    const donePlanA1Res = await request.post(`/api/gsd/plans/${planA1.id}/transition`, {
      headers: API_KEY_HEADER,
      data: {
        to_status: 'done',
        expected_updated_at: startPlanA1Body.plan.updated_at,
      },
    })
    expect(donePlanA1Res.status()).toBe(200)

    const startPlanA2Res = await request.post(`/api/gsd/plans/${planA2.id}/transition`, {
      headers: API_KEY_HEADER,
      data: { to_status: 'in_progress' },
    })
    expect(startPlanA2Res.status()).toBe(200)

    const phaseATransitionRes = await request.post(`/api/gsd/phases/${phaseA.id}/transition`, {
      headers: API_KEY_HEADER,
      data: { to_lifecycle_phase: 'plan' },
    })
    expect(phaseATransitionRes.status()).toBe(200)
    const phaseATransitionBody = await phaseATransitionRes.json()
    expect(phaseATransitionBody.to_phase).toBe('plan')

    const finalGraphRes = await request.get(`/api/projects/${projectId}/gsd/lifecycle-graph`, {
      headers: API_KEY_HEADER,
    })
    expect(finalGraphRes.status()).toBe(200)
    const finalGraph = await finalGraphRes.json()

    expect(finalGraph.rollups.active_milestones).toBe(2)
    expect(finalGraph.rollups.active_phases).toBe(2)
    expect(finalGraph.rollups.in_progress_plans).toBe(2)

    const graphMilestoneA = finalGraph.workstreams[0].milestones.find(
      (milestone: { id: number }) => milestone.id === milestoneA.id,
    )
    const graphMilestoneB = finalGraph.workstreams[0].milestones.find(
      (milestone: { id: number }) => milestone.id === milestoneB.id,
    )

    expect(graphMilestoneA).toBeTruthy()
    expect(graphMilestoneB).toBeTruthy()
    expect(graphMilestoneA.phases[0].lifecycle_phase).toBe('plan')
    expect(graphMilestoneB.phases[0].lifecycle_phase).toBe('discuss')
    expect(graphMilestoneA.phases[0].plans.map((plan: { status: string }) => plan.status)).toContain(
      'in_progress',
    )
    expect(graphMilestoneB.phases[0].plans[0].status).toBe('in_progress')
  })
})
