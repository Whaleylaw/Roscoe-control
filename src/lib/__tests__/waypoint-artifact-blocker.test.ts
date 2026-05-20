import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'

import { runMigrations } from '../migrations'
import { runWaypointLocalPackageTask } from '../waypoint-local-package-runtime'
import { checkWaypointTaskArtifacts, resolveWaypointTaskArtifactBlocker } from '../waypoint-artifacts'
import { bindWaypointProjectMetadata } from '../waypoint-project-binding'
import { startReferralPackageQuestRoute } from '../waypoint-quest-runtime'

const CHRONOLOGY_REQUIRED = [
  '03-medical/medical-chronology-output/reports/date-of-service-ledger.json',
  '03-medical/medical-chronology-output/reports/visit-content.json',
  '03-medical/medical-chronology-output/reports/rendered-template-check.json',
] as const

const CHRONOLOGY_INITIAL_STAGED_REQUIRED = [
  '03-medical/medical-chronology-output/reports/date-of-service-ledger.json',
  '03-medical/medical-chronology-output/reports/visit-content.json',
] as const

async function setupBlockedChronologyTask() {
  const db = new Database(':memory:')
  runMigrations(db)
  const projectRoot = await mkdtemp(join(tmpdir(), 'mc-waypoint-artifacts-case-'))
  const sourceRoot = await mkdtemp(join(tmpdir(), 'mc-waypoint-artifacts-source-'))
  const project = db.prepare(`SELECT id FROM projects WHERE workspace_id = 1 AND slug = 'general'`).get() as { id: number }
  const metadata = bindWaypointProjectMetadata(null, {
    trustedRoots: { fixture: { caseRoot: projectRoot, sourceRoot } },
    caseRootKey: 'fixture',
    caseRoot: projectRoot,
    sourceRoot,
    questSlug: 'referral-package',
    packagePin: { packageSource: 'forgejo', coreVersion: '0.1.2', folderHostVersion: '0.1.2' },
  })
  db.prepare(`UPDATE projects SET gsd_enabled = 1, metadata = ? WHERE id = ?`).run(metadata, project.id)
  const route = await startReferralPackageQuestRoute(db, { projectId: project.id, workspaceId: 1, actor: 'tester', now: 100 })
  const task = db.prepare(`SELECT id, metadata FROM tasks WHERE recipe_slug = 'firmvault-medical-chronology-update' LIMIT 1`).get() as { id: number; metadata: string }
  const blocked = await runWaypointLocalPackageTask(db, { taskId: task.id, workspaceId: 1, actor: 'tester', now: 110 })
  if (blocked.status !== 'blocked') throw new Error(`Expected blocked chronology task, got ${blocked.status}`)
  return { db, projectId: project.id, projectRoot, routeId: route.workflowInstanceId, taskId: task.id }
}

describe('Waypoint artifact blocker/resume semantics', () => {
  it('rechecks required artifacts, resolves the blocker, and reuses the existing route', async () => {
    const { db, projectId, projectRoot, routeId, taskId } = await setupBlockedChronologyTask()
    try {
      const blockedTask = db.prepare(`SELECT status, metadata FROM tasks WHERE id = ?`).get(taskId) as { status: string; metadata: string }
      expect(blockedTask.status).toBe('blocked')
      expect(JSON.parse(blockedTask.metadata).waypoint.blocker).toMatchObject({ status: 'blocked', missing_artifacts: [...CHRONOLOGY_INITIAL_STAGED_REQUIRED] })

      for (const artifact of CHRONOLOGY_REQUIRED) {
        await mkdir(join(projectRoot, artifact, '..'), { recursive: true })
        await writeFile(join(projectRoot, artifact), '{}\n')
      }

      const resolved = await resolveWaypointTaskArtifactBlocker(db, {
        taskId,
        workspaceId: 1,
        actor: 'tester',
        resolutionInput: { mode: 'recheck', note: 'chronology staged data produced' },
        now: 120,
      })

      expect(resolved).toEqual({ status: 'resolved', taskId, missingArtifacts: [] })
      const task = db.prepare(`SELECT status, metadata FROM tasks WHERE id = ?`).get(taskId) as { status: string; metadata: string }
      expect(task.status).toBe('inbox')
      expect(JSON.parse(task.metadata).waypoint.blocker).toMatchObject({
        status: 'resolved',
        missing_artifacts: [],
        resolution_input: { mode: 'recheck', note: 'chronology staged data produced' },
      })

      const route = db.prepare(`SELECT status FROM workflow_instances WHERE id = ?`).get(routeId) as { status: string }
      expect(route.status).toBe('active')
      const event = db.prepare(`SELECT event_type, payload_json FROM workflow_events WHERE task_id = ? ORDER BY id DESC LIMIT 1`).get(taskId) as { event_type: string; payload_json: string }
      expect(event.event_type).toBe('waypoint.artifacts.resolved')
      expect(JSON.parse(event.payload_json)).toMatchObject({ missing_artifacts: [], resolution_input: { mode: 'recheck' } })

      const reused = await startReferralPackageQuestRoute(db, { projectId, workspaceId: 1, actor: 'tester', now: 121 })
      expect(reused).toMatchObject({ workflowInstanceId: routeId, reused: true })
      const routeCount = db.prepare(`SELECT COUNT(*) AS count FROM workflow_instances WHERE workflow_key LIKE '%referral-package%'`).get() as { count: number }
      expect(routeCount.count).toBe(1)
    } finally {
      db.close()
    }
  })

  it('rejects unsafe required artifact paths before checking the filesystem', async () => {
    const { db, taskId } = await setupBlockedChronologyTask()
    try {
      const task = db.prepare(`SELECT metadata FROM tasks WHERE id = ?`).get(taskId) as { metadata: string }
      const metadata = JSON.parse(task.metadata)
      metadata.waypoint.required_artifacts = [{ path: '../outside.json', required_when: 'before_complete' }]
      db.prepare(`UPDATE tasks SET metadata = ? WHERE id = ?`).run(JSON.stringify(metadata), taskId)

      await expect(checkWaypointTaskArtifacts(db, { taskId, workspaceId: 1 })).rejects.toThrow(/unsafe artifact path|escapes trusted root/i)
    } finally {
      db.close()
    }
  })
})
