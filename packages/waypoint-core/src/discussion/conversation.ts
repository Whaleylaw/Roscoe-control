export function slugifyWaypointAgent(value: string | null | undefined): string {
  return (value || 'agent')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'agent'
}

export function buildWaypointTaskDiscussionConversationId(
  taskId: number,
  agent: string | null | undefined,
): string {
  return `task:${taskId}:discussion:${slugifyWaypointAgent(agent)}`
}
