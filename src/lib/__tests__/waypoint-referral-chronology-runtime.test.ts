import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'

import { runMigrations } from '../migrations'
import {
  assessReferralChronologyRuntime,
  REFERRAL_CHRONOLOGY_FINAL_ARTIFACTS,
  REFERRAL_CHRONOLOGY_STAGED_ARTIFACTS,
} from '../waypoint-referral-chronology'
import { bindWaypointProjectMetadata } from '../waypoint-project-binding'
import { startReferralPackageQuestRoute } from '../waypoint-quest-runtime'

async function setupChronologyTask() {
  const db = new Database(':memory:')
  runMigrations(db)
  const projectRoot = await mkdtemp(join(tmpdir(), 'mc-waypoint-chronology-case-'))
  const sourceRoot = await mkdtemp(join(tmpdir(), 'mc-waypoint-chronology-source-'))
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
  await startReferralPackageQuestRoute(db, { projectId: project.id, workspaceId: 1, actor: 'tester', now: 100 })
  const task = db.prepare(`SELECT id, metadata FROM tasks WHERE recipe_slug = 'firmvault-medical-chronology-update' LIMIT 1`).get() as { id: number; metadata: string }
  return { db, projectRoot, taskId: task.id }
}

async function writeJson(projectRoot: string, artifactPath: string, value: unknown) {
  await mkdir(join(projectRoot, artifactPath, '..'), { recursive: true })
  await writeFile(join(projectRoot, artifactPath), `${JSON.stringify(value, null, 2)}\n`)
}

async function writeText(projectRoot: string, artifactPath: string, value: string) {
  await mkdir(join(projectRoot, artifactPath, '..'), { recursive: true })
  await writeFile(join(projectRoot, artifactPath), value)
}

describe('Waypoint referral chronology staged runtime', () => {
  it('does not allow final HTML to satisfy chronology before staged JSON artifacts exist', async () => {
    const { db, projectRoot, taskId } = await setupChronologyTask()
    try {
      await writeText(projectRoot, '03-medical/medical-chronology-output/medical-chronology.html', '<html>agent-authored chronology</html>')

      const result = await assessReferralChronologyRuntime(db, { taskId, workspaceId: 1, actor: 'tester', now: 200 })

      expect(result).toMatchObject({ status: 'blocked', stage: 'staged_data' })
      if (result.status !== 'blocked') throw new Error(`Expected blocked result, got ${result.status}`)
      expect(result.missingArtifacts).toEqual([...REFERRAL_CHRONOLOGY_STAGED_ARTIFACTS])
      expect(result.reason).toContain('date-of-service-ledger.json')

      const task = db.prepare(`SELECT status, metadata FROM tasks WHERE id = ?`).get(taskId) as { status: string; metadata: string }
      expect(task.status).toBe('blocked')
      expect(JSON.parse(task.metadata)).toMatchObject({
        waypoint: {
          chronology_runtime: {
            status: 'blocked',
            stage: 'staged_data',
            source_truth: 'staged_json',
            html_source_truth: false,
          },
        },
      })
    } finally {
      db.close()
    }
  })

  it('requires structured ledger and visit-content JSON before renderer/final artifacts can complete the chronology task', async () => {
    const { db, projectRoot, taskId } = await setupChronologyTask()
    try {
      await writeJson(projectRoot, '03-medical/medical-chronology-output/reports/date-of-service-ledger.json', {
        schema_version: 1,
        entries: [{ dos: '2024-01-02', provider: 'Example Provider', source_artifacts: ['records/example.pdf'] }],
      })
      await writeJson(projectRoot, '03-medical/medical-chronology-output/reports/visit-content.json', {
        schema_version: 1,
        visits: [{ dos: '2024-01-02', provider: 'Example Provider', summary: 'Structured visit summary.' }],
      })

      const beforeRender = await assessReferralChronologyRuntime(db, { taskId, workspaceId: 1, actor: 'tester', now: 210 })
      expect(beforeRender).toMatchObject({ status: 'blocked', stage: 'deterministic_render' })
      if (beforeRender.status !== 'blocked') throw new Error(`Expected blocked render result, got ${beforeRender.status}`)
      expect(beforeRender.missingArtifacts).toEqual([
        '03-medical/medical-chronology-output/reports/rendered-template-check.json',
        ...REFERRAL_CHRONOLOGY_FINAL_ARTIFACTS,
      ])
      expect(beforeRender.reason).toContain('deterministic renderer')

      await writeJson(projectRoot, '03-medical/medical-chronology-output/reports/rendered-template-check.json', {
        schema_version: 1,
        renderer: 'abby-deterministic-template',
        source_inputs: [...REFERRAL_CHRONOLOGY_STAGED_ARTIFACTS],
        passed: true,
      })
      await writeText(projectRoot, '03-medical/medical-chronology-output/medical-chronology.html', '<html>deterministic output</html>')
      await writeText(projectRoot, '03-medical/medical-chronology-output/medical-chronology-timeline.pdf', '%PDF-1.4\n')

      const complete = await assessReferralChronologyRuntime(db, { taskId, workspaceId: 1, actor: 'tester', now: 220 })

      expect(complete).toMatchObject({ status: 'ready', stage: 'complete' })
      if (complete.status !== 'ready') throw new Error(`Expected ready result, got ${complete.status}`)
      expect(complete.artifacts).toEqual([
        ...REFERRAL_CHRONOLOGY_STAGED_ARTIFACTS,
        '03-medical/medical-chronology-output/reports/rendered-template-check.json',
        ...REFERRAL_CHRONOLOGY_FINAL_ARTIFACTS,
      ])

      const qcTask = db.prepare(`SELECT id FROM tasks WHERE recipe_slug = 'firmvault-medical-chronology-adversarial-qc' LIMIT 1`).get() as { id: number } | undefined
      expect(qcTask?.id).toBeTypeOf('number')
    } finally {
      db.close()
    }
  })
})
