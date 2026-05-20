import { mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'

import { runMigrations } from '../migrations'
import { completeWorkflowNodeForTask } from '../workflow-engine'
import { resolveWaypointTaskArtifactBlocker } from '../waypoint-artifacts'
import { attemptWaypointHumanGateCompletion, approveWaypointHumanGate } from '../waypoint-handoff-gate'
import { runWaypointLocalPackageTask } from '../waypoint-local-package-runtime'
import { bindWaypointProjectMetadata } from '../waypoint-project-binding'
import { startReferralPackageQuestRoute } from '../waypoint-quest-runtime'

const CHRONOLOGY_REPORTS = '03-medical/medical-chronology-output/reports'

async function setupBoundReferralProject() {
  const db = new Database(':memory:')
  runMigrations(db)
  const caseRoot = await mkdtemp(join(tmpdir(), 'mc-waypoint-host-smoke-case-'))
  const sourceRoot = await mkdtemp(join(tmpdir(), 'mc-waypoint-host-smoke-source-'))
  const project = db.prepare(`SELECT id FROM projects WHERE workspace_id = 1 AND slug = 'general'`).get() as { id: number }
  const metadata = bindWaypointProjectMetadata(null, {
    trustedRoots: { fixture: { caseRoot, sourceRoot } },
    caseRootKey: 'fixture',
    caseRoot,
    sourceRoot,
    questSlug: 'referral-package',
    packagePin: { packageSource: 'forgejo', coreVersion: '0.1.2', folderHostVersion: '0.1.2' },
  })
  db.prepare(`UPDATE projects SET gsd_enabled = 1, metadata = ? WHERE id = ?`).run(metadata, project.id)
  return { db, projectId: project.id, caseRoot, sourceRoot }
}

function taskByRecipe(db: Database.Database, recipeSlug: string) {
  return db.prepare(`SELECT id, status, metadata FROM tasks WHERE recipe_slug = ? LIMIT 1`).get(recipeSlug) as { id: number; status: string; metadata: string }
}

function handoffGateTask(db: Database.Database) {
  return db.prepare(`
    SELECT id, status, metadata
    FROM tasks
    WHERE recipe_slug IS NULL
      AND json_extract(metadata, '$.waypoint.execution.kind') = 'gate'
    LIMIT 1
  `).get() as { id: number; status: string; metadata: string }
}

function completeAgentTask(db: Database.Database, taskId: number, actor: string, now: number) {
  db.prepare(`UPDATE tasks SET status = 'done', updated_at = ? WHERE id = ?`).run(now, taskId)
  completeWorkflowNodeForTask(db, taskId, actor, { status: 'done', smoke: true }, now)
}

async function writeChronologyArtifacts(caseRoot: string) {
  await mkdir(join(caseRoot, CHRONOLOGY_REPORTS), { recursive: true })
  await writeFile(join(caseRoot, CHRONOLOGY_REPORTS, 'date-of-service-ledger.json'), JSON.stringify({ schema_version: 1, entries: [{ date_of_service: '2026-01-01', provider: 'Fixture Provider' }] }))
  await writeFile(join(caseRoot, CHRONOLOGY_REPORTS, 'visit-content.json'), JSON.stringify({ schema_version: 1, visits: [{ date_of_service: '2026-01-01', summary: 'Fixture visit summary.' }] }))
  await writeFile(join(caseRoot, CHRONOLOGY_REPORTS, 'rendered-template-check.json'), JSON.stringify({ schema_version: 1, passed: true, renderer: 'deterministic-fixture' }))
  await writeFile(join(caseRoot, '03-medical/medical-chronology-output/medical-chronology.html'), '<!doctype html><html><body>Fixture chronology</body></html>')
  await writeFile(join(caseRoot, '03-medical/medical-chronology-output/medical-chronology-timeline.pdf'), '%PDF-1.4\n% fixture\n')
}

describe('Waypoint referral-package Mission Control host smoke', () => {
  it('starts, blocks, resumes, reaches a mandatory human handoff gate, and approves without source mutation', async () => {
    const { db, projectId, caseRoot, sourceRoot } = await setupBoundReferralProject()
    try {
      const route = await startReferralPackageQuestRoute(db, { projectId, workspaceId: 1, actor: 'smoke', now: 100 })
      expect(route.reused).toBe(false)
      expect(route.materializedTaskIds.length).toBeGreaterThanOrEqual(8)

      const chronology = taskByRecipe(db, 'firmvault-medical-chronology-update')
      const blocked = await runWaypointLocalPackageTask(db, { taskId: chronology.id, workspaceId: 1, actor: 'smoke', now: 110 })
      expect(blocked).toMatchObject({ status: 'blocked', taskId: chronology.id })

      await writeChronologyArtifacts(caseRoot)
      const resolved = await resolveWaypointTaskArtifactBlocker(db, {
        taskId: chronology.id,
        workspaceId: 1,
        actor: 'smoke',
        resolutionInput: { mode: 'fixture_recheck' },
        now: 120,
      })
      expect(resolved).toEqual({ status: 'resolved', taskId: chronology.id, missingArtifacts: [] })

      const chronologyReady = await runWaypointLocalPackageTask(db, { taskId: chronology.id, workspaceId: 1, actor: 'smoke', now: 130 })
      expect(chronologyReady).toMatchObject({ status: 'ok', taskId: chronology.id })

      for (const recipe of [
        'referral-package-document-reviewer',
        'referral-package-packet-segmenter',
        'referral-package-filename-placement-reviewer',
        'firmvault-medical-chronology-adversarial-qc',
        'referral-package-package-qc',
      ]) {
        completeAgentTask(db, taskByRecipe(db, recipe).id, 'smoke', 140)
      }

      await mkdir(join(caseRoot, '03-medical/medical-chronology-output'), { recursive: true })
      const startHere = taskByRecipe(db, 'referral-package-start-here-builder')
      const startHereMetadata = JSON.parse(startHere.metadata)
      startHereMetadata.waypoint.execution = { kind: 'local_package', package_function: 'runReferralPackageBuilder' }
      db.prepare(`UPDATE tasks SET metadata = ? WHERE id = ?`).run(JSON.stringify(startHereMetadata), startHere.id)
      const startHereResult = await runWaypointLocalPackageTask(db, { taskId: startHere.id, workspaceId: 1, actor: 'smoke', now: 150 })
      expect(startHereResult).toMatchObject({ status: 'ok', taskId: startHere.id })

      const gate = handoffGateTask(db)
      const blockedGate = attemptWaypointHumanGateCompletion(db, { taskId: gate.id, workspaceId: 1, actor: 'smoke', now: 160 })
      expect(blockedGate).toMatchObject({ status: 'blocked', reason: 'human_approval_required' })
      expect(JSON.parse((db.prepare(`SELECT metadata FROM tasks WHERE id = ?`).get(gate.id) as { metadata: string }).metadata).waypoint.gate).toMatchObject({ status: 'pending' })

      const approved = approveWaypointHumanGate(db, {
        taskId: gate.id,
        workspaceId: 1,
        actor: 'aaron',
        note: 'fixture handoff approved',
        now: 170,
      })
      expect(approved).toMatchObject({ status: 'approved', taskId: gate.id, workflowInstanceId: route.workflowInstanceId })

      const finalRoute = db.prepare(`SELECT status FROM workflow_instances WHERE id = ?`).get(route.workflowInstanceId) as { status: string }
      expect(finalRoute.status).toBe('complete')

      const events = db.prepare(`SELECT event_type FROM workflow_events WHERE workflow_instance_id = ? ORDER BY id`).all(route.workflowInstanceId) as Array<{ event_type: string }>
      expect(events.map((event) => event.event_type)).toEqual(expect.arrayContaining([
        'waypoint.chronology.blocked',
        'waypoint.artifacts.resolved',
        'waypoint.chronology.ready',
        'waypoint.handoff_gate.blocked',
        'waypoint.handoff_gate.approved',
      ]))

      await expect(readdir(sourceRoot)).resolves.toEqual([])
    } finally {
      db.close()
    }
  })
})
