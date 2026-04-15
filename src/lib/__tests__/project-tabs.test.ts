import { describe, it } from 'vitest'

describe('ProjectTabs', () => {
  it.todo('renders all 5 tab buttons: Dashboard, Tasks, Sessions, Agents, Settings')
  it.todo('highlights the active tab matching current view')
  it.todo('clicking a tab calls router.push with correct URL')
  it.todo('dashboard tab navigates to /project/{slug}')
  it.todo('non-dashboard tabs navigate to /project/{slug}/{view}')
  it.todo('uses i18n translations for tab labels')
})
