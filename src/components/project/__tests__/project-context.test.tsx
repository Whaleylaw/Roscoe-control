import { describe, it } from 'vitest'

// Mock next/navigation before importing the module under test
// vi.mock('next/navigation', () => ({
//   usePathname: vi.fn(),
// }))

describe('ProjectWorkspaceProvider + useProjectWorkspace', () => {
  it.todo('parses slug from /project/my-app')
  it.todo('parses view from /project/my-app/tasks')
  it.todo('defaults view to dashboard when no view segment')
  it.todo('throws when used outside provider')
})
