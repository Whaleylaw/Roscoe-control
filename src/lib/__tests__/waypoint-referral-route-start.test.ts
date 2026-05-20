import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'

import { runMigrations } from '../migrations'
import { startReferralPackageQuestRoute } from '../waypoint-quest-runtime'
import { bindWaypointProjectMetadata } from '../waypoint-project-binding'

describe('Waypoint referral-package route start', () => {
  it('starts or reuses a Mission Control workflow route and materializes referral-package tasks with metadata', async () => {
    const db = new Database(':memory:')
    try {
      runMigrations(db)
      const project = db.prepare(`SELECT id FROM projects WHERE workspace_id = 1 AND slug = 'general'`).get() as { id: number }
      const metadata = bindWaypointProjectMetadata(null, {
        trustedRoots: {
          'fixture-case': {
            caseRoot: '/trusted/cases/fixture',
            sourceRoot: '/trusted/source/fixture',
          },
        },
        caseRootKey: 'fixture-case',
        caseRoot: '/trusted/cases/fixture/referral-package',
        sourceRoot: '/trusted/source/fixture/intake',
        questSlug: 'referral-package',
        packagePin: { packageSource: 'forgejo', coreVersion: '0.1.2', folderHostVersion: '0.1.2' },
      })
      db.prepare(`UPDATE projects SET gsd_enabled = 1, metadata = ? WHERE id = ?`).run(metadata, project.id)

      const first = await startReferralPackageQuestRoute(db, { projectId: project.id, workspaceId: 1, actor: 'tester', now: 42 })
      const second = await startReferralPackageQuestRoute(db, { projectId: project.id, workspaceId: 1, actor: 'tester', now: 43 })

      expect(first.reused).toBe(false)
      expect(second.reused).toBe(true)
      expect(second.workflowInstanceId).toBe(first.workflowInstanceId)

      const routes = db.prepare(`SELECT id, workflow_key, vars_json FROM workflow_instances WHERE id = ?`).all(first.workflowInstanceId) as Array<{ id: number; workflow_key: string; vars_json: string }>
      expect(routes).toHaveLength(1)
      expect(routes[0].workflow_key).toContain('referral-package')
      expect(JSON.parse(routes[0].vars_json)).toMatchObject({ project_id: project.id, quest_slug: 'referral-package' })

      const tasks = db.prepare(`SELECT title, status, recipe_slug, metadata FROM tasks WHERE project_id = ? ORDER BY id ASC`).all(project.id) as Array<{ title: string; status: string; recipe_slug: string | null; metadata: string }>
      expect(tasks.length).toBeGreaterThanOrEqual(8)
      expect(tasks.some((task) => task.recipe_slug === 'firmvault-medical-chronology-update')).toBe(true)
      expect(tasks.some((task) => task.recipe_slug === 'firmvault-medical-chronology-adversarial-qc')).toBe(true)

      const chronology = tasks.find((task) => task.recipe_slug === 'firmvault-medical-chronology-update')!
      expect(JSON.parse(chronology.metadata)).toMatchObject({
        waypoint: {
          quest_slug: 'referral-package',
          recipe: { slug: 'firmvault-medical-chronology-update' },
          execution: { kind: 'local_package', package_function: 'runReferralPackageBuilder' },
          required_artifacts: [
            { path: '03-medical/medical-chronology-output/reports/date-of-service-ledger.json', required_when: 'before_complete' },
            { path: '03-medical/medical-chronology-output/reports/visit-content.json', required_when: 'before_complete' },
            { path: '03-medical/medical-chronology-output/reports/rendered-template-check.json', required_when: 'before_complete' },
          ],
        },
      })

      const gate = tasks.find((task) => JSON.parse(task.metadata).waypoint?.execution?.kind === 'gate')
      expect(gate).toBeTruthy()
      expect(gate?.status).toBe('review')
      expect(JSON.parse(gate!.metadata).waypoint.gate).toMatchObject({ kind: 'human', status: 'pending' })
    } finally {
      db.close()
    }
  })
})
