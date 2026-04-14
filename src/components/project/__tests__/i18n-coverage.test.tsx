import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

const MESSAGES_DIR = path.resolve(__dirname, '..', '..', '..', '..', 'messages')

const REQUIRED_SUB_KEYS = [
  'workspace',
  'nav',
  'dashboard',
  'tasks',
  'sessions',
  'agents',
  'settings',
]

describe('Project i18n coverage (FOUN-04)', () => {
  it('en.json has project namespace with all required sub-keys', () => {
    const enPath = path.join(MESSAGES_DIR, 'en.json')
    const data = JSON.parse(fs.readFileSync(enPath, 'utf-8'))

    expect(data).toHaveProperty('project')

    for (const key of REQUIRED_SUB_KEYS) {
      expect(data.project).toHaveProperty(key)
    }
  })

  it('all 10 locale files have project namespace', () => {
    const files = fs.readdirSync(MESSAGES_DIR).filter((f) => f.endsWith('.json'))
    expect(files.length).toBe(10)

    for (const file of files) {
      const filePath = path.join(MESSAGES_DIR, file)
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
      expect(data, `${file} missing project key`).toHaveProperty('project')

      for (const key of REQUIRED_SUB_KEYS) {
        expect(data.project, `${file} missing project.${key}`).toHaveProperty(key)
      }
    }
  })

  it('all 10 locale files have every project.settings.* key required by Phase 6', () => {
    const SETTINGS_KEYS = [
      'title','sectionBasics','sectionAppearance','sectionIntegrations','readOnlyNote',
      'nameLabel','namePlaceholder','descriptionLabel','descriptionPlaceholder',
      'statusLabel','statusActive','statusArchived',
      'colorLabel','colorNone',
      'prefixLabel','prefixPlaceholder','prefixHelp',
      'deadlineLabel',
      'githubRepoLabel','githubRepoPlaceholder','githubRepoHelp',
      'save','cancel','saving','unsavedChanges',
      'errorNameRequired','errorPrefixConflict','errorPrefixInvalid','errorDefaultArchive',
      'errorBannerHeading','errorBannerFallback',
      'loadErrorHeading',
    ]

    const files = fs.readdirSync(MESSAGES_DIR).filter((f) => f.endsWith('.json'))
    expect(files.length).toBe(10)

    for (const file of files) {
      const filePath = path.join(MESSAGES_DIR, file)
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
      expect(data.project, `${file} missing project.settings`).toHaveProperty('settings')

      for (const k of SETTINGS_KEYS) {
        expect(
          data.project.settings,
          `${file} missing project.settings.${k}`,
        ).toHaveProperty(k)
      }

      // Stub key must be gone — settings is no longer a placeholder namespace.
      expect(
        data.project.settings.placeholder,
        `${file} still has project.settings.placeholder stub`,
      ).toBeUndefined()
    }

    // Canonical English source of truth for the title.
    const enPath = path.join(MESSAGES_DIR, 'en.json')
    const enData = JSON.parse(fs.readFileSync(enPath, 'utf-8'))
    expect(enData.project.settings.title).toBe('Project settings')
  })

  // These will be filled in by Plan 02 after stub views are created
  it.todo('all 5 stub view components use useTranslations(project)')
  it.todo('no stub view contains hardcoded English strings in JSX')
})
