import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'

import { runMigrations } from '../migrations'
import { runWaypointLocalPackageTask } from '../waypoint-local-package-runtime'
import { bindWaypointProjectMetadata } from '../waypoint-project-binding'
import { startReferralPackageQuestRoute } from '../waypoint-quest-runtime'

async function setupReferralRoute() {
  const db = new Database(':memory:')
  runMigrations(db)
  const projectRoot = await mkdtemp(join(tmpdir(), 'mc-waypoint-runtime-case-'))
  const sourceRoot = await mkdtemp(join(tmpdir(), 'mc-waypoint-runtime-source-'))
  const project = db.prepare(`SELECT id FROM projects WHERE workspace_id = 1 AND slug = 'general'`).get() as { id: number }
  const metadata = bindWaypointProjectMetadata(null, {
    trustedRoots: {
      fixture: { caseRoot: projectRoot, sourceRoot },
    },
    caseRootKey: 'fixture',
    caseRoot: projectRoot,
    sourceRoot,
    questSlug: 'referral-package',
    packagePin: { packageSource: 'forgejo', coreVersion: '0.1.2', folderHostVersion: '0.1.2' },
  })
  db.prepare(`UPDATE projects SET gsd_enabled = 1, metadata = ? WHERE id = ?`).run(metadata, project.id)
  await startReferralPackageQuestRoute(db, { projectId: project.id, workspaceId: 1, actor: 'tester', now: 100 })
  return { db, projectId: project.id, projectRoot }
}

function taskByRecipe(db: Database.Database, recipeSlug: string) {
  return db.prepare(`SELECT id, status, metadata FROM tasks WHERE recipe_slug = ? LIMIT 1`).get(recipeSlug) as { id: number; status: string; metadata: string }
}

describe('Waypoint local package runtime', () => {
  it('blocks a local package task when declared required artifacts are missing and records event evidence', async () => {
    const { db } = await setupReferralRoute()
    try {
      const task = taskByRecipe(db, 'firmvault-medical-chronology-update')

      const result = await runWaypointLocalPackageTask(db, { taskId: task.id, workspaceId: 1, actor: 'tester', now: 200 })

      expect(result).toMatchObject({ status: 'blocked', taskId: task.id })
      if (result.status !== 'blocked') throw new Error(`Expected blocked result, got ${result.status}`)
      expect(result.missingArtifacts).toEqual([
        '03-medical/medical-chronology-output/reports/date-of-service-ledger.json',
        '03-medical/medical-chronology-output/reports/visit-content.json',
        '03-medical/medical-chronology-output/reports/rendered-template-check.json',
      ])

      const updated = db.prepare(`SELECT status, metadata FROM tasks WHERE id = ?`).get(task.id) as { status: string; metadata: string }
      expect(updated.status).toBe('blocked')
      expect(JSON.parse(updated.metadata)).toMatchObject({
        waypoint: {
          local_runtime: { status: 'blocked', adapter: 'waypoint-referral-package-builder' },
          blocker: { status: 'blocked', missing_artifacts: result.missingArtifacts },
        },
      })

      const event = db.prepare(`SELECT event_type, payload_json FROM workflow_events WHERE task_id = ? ORDER BY id DESC LIMIT 1`).get(task.id) as { event_type: string; payload_json: string }
      expect(event.event_type).toBe('waypoint.local_package.blocked')
      expect(JSON.parse(event.payload_json)).toMatchObject({ missing_artifacts: result.missingArtifacts })
    } finally {
      db.close()
    }
  })

  it('runs an allowed local package function and captures produced artifacts', async () => {
    const { db, projectRoot } = await setupReferralRoute()
    try {
      const task = taskByRecipe(db, 'referral-package-start-here-builder')
      const metadata = JSON.parse(task.metadata)
      metadata.waypoint.execution = { kind: 'local_package', package_function: 'runReferralPackageBuilder' }
      db.prepare(`UPDATE tasks SET metadata = ? WHERE id = ?`).run(JSON.stringify(metadata), task.id)
      await mkdir(join(projectRoot, '03-medical/medical-chronology-output'), { recursive: true })
      await writeFile(join(projectRoot, '03-medical/medical-chronology-output/medical-chronology.html'), '<html></html>')

      const result = await runWaypointLocalPackageTask(db, { taskId: task.id, workspaceId: 1, actor: 'tester', now: 201 })

      expect(result).toMatchObject({ status: 'ok', taskId: task.id })
      if (result.status !== 'ok') throw new Error(`Expected ok result, got ${result.status}`)
      expect(result.artifacts).toContain('referral-package-build/attorney-handoff/START_HERE.html')
      const updated = db.prepare(`SELECT metadata FROM tasks WHERE id = ?`).get(task.id) as { metadata: string }
      expect(JSON.parse(updated.metadata)).toMatchObject({
        waypoint: {
          local_runtime: {
            status: 'ok',
            artifacts: expect.arrayContaining(['referral-package-build/attorney-handoff/START_HERE.html']),
          },
        },
      })
    } finally {
      db.close()
    }
  })

  it('refuses to execute agent and gate tasks through the local package runtime', async () => {
    const { db } = await setupReferralRoute()
    try {
      const agentTask = taskByRecipe(db, 'referral-package-document-reviewer')
      const agentResult = await runWaypointLocalPackageTask(db, { taskId: agentTask.id, workspaceId: 1, actor: 'tester', now: 202 })
      expect(agentResult).toMatchObject({ status: 'skipped', reason: 'not_local_package' })

      const gate = db.prepare(`SELECT id FROM tasks WHERE recipe_slug IS NULL AND status = 'review' LIMIT 1`).get() as { id: number }
      const gateResult = await runWaypointLocalPackageTask(db, { taskId: gate.id, workspaceId: 1, actor: 'tester', now: 203 })
      expect(gateResult).toMatchObject({ status: 'skipped', reason: 'not_local_package' })
    } finally {
      db.close()
    }
  })
})
