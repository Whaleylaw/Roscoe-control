import { EventEmitter } from 'events'

/**
 * Server-side event bus for broadcasting database mutations to SSE clients.
 * Singleton per Next.js server process.
 */

export interface ServerEvent {
  type: string
  data: any
  timestamp: number
}

// Event types emitted by the bus
export type EventType =
  | 'task.created'
  | 'task.updated'
  | 'task.deleted'
  | 'task.status_changed'
  | 'chat.message'
  | 'chat.message.deleted'
  | 'notification.created'
  | 'notification.read'
  | 'activity.created'
  | 'agent.updated'
  | 'agent.created'
  | 'agent.deleted'
  | 'agent.synced'
  | 'agent.status_changed'
  | 'audit.security'
  | 'security.event'
  | 'connection.created'
  | 'connection.disconnected'
  | 'github.synced'
  | 'run.created'
  | 'run.updated'
  | 'run.completed'
  | 'run.eval_attached'
  | 'task.escalated'
  | 'session.updated'
  | 'project.gsd.transition'   // Phase 09 GSD-28, D-34
  | 'task.gate.changed'         // Phase 09 GSD-28, D-34
  | 'gsd.workstream.created'
  | 'gsd.workstream.updated'
  | 'gsd.workstream.completed'
  | 'gsd.milestone.created'
  | 'gsd.milestone.updated'
  | 'gsd.milestone.completed'
  | 'gsd.phase.created'
  | 'gsd.phase.updated'
  | 'gsd.phase.transitioned'
  | 'gsd.plan.created'
  | 'gsd.plan.updated'
  | 'gsd.plan.transitioned'
  | 'gsd.conflict.detected'
  | 'task.runner_requested'     // SCHED-05 — MC tells runner a recipe-tagged task is ready for claim
  | 'task.container_started'    // SCHED-06 — emitted from POST /api/runner/tasks/:id/container-started
  | 'task.container_exited'     // SCHED-06 — emitted from POST /api/runner/tasks/:id/runner-exit
  | 'task.checkpoint_added'     // SCHED-06 — emitted from POST /api/tasks/:id/checkpoints
  | 'recipe.indexed'            // SCHED-06 — emitted from recipe-watcher scheduleReindex
  | 'recipe.removed'            // SCHED-06 — emitted from recipe-watcher scheduleReindex
  | 'gsd.plan.tasks_activated'  // Phase 19 QUEUE-02 — plan transition auto-activates linked tasks
  | 'task.blocker_transition'   // Phase 20 ROUTE-02 — unified owner-intervention pause/resume event shape across recipe + legacy paths

class ServerEventBus extends EventEmitter {
  private static instance: ServerEventBus | null = null

  private constructor() {
    super()
    this.setMaxListeners(50)
  }

  static getInstance(): ServerEventBus {
    if (!ServerEventBus.instance) {
      ServerEventBus.instance = new ServerEventBus()
    }
    return ServerEventBus.instance
  }

  /**
   * Broadcast an event to all SSE listeners
   */
  broadcast(type: EventType, data: any): ServerEvent {
    const event: ServerEvent = { type, data, timestamp: Date.now() }
    this.emit('server-event', event)
    return event
  }
}

// Use globalThis to survive HMR in development
const globalBus = globalThis as typeof globalThis & { __eventBus?: ServerEventBus }
export const eventBus = globalBus.__eventBus ?? ServerEventBus.getInstance()
globalBus.__eventBus = eventBus as ServerEventBus
