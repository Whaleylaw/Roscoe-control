'use client'

import { useTranslations } from 'next-intl'
import type { Task } from '@/store'
import { GateTaskRow } from '@/components/project/lifecycle/gate-task-row'

interface GateTaskListProps {
  gateTasks: Task[]
  onApprove: (taskId: number, note?: string) => Promise<void> | void
  onReject: (taskId: number, note?: string) => Promise<void> | void
  isViewer: boolean
}

export function GateTaskList({ gateTasks, onApprove, onReject, isViewer }: GateTaskListProps) {
  const t = useTranslations('project.lifecycle')
  const filtered = gateTasks.filter((x) => x.gate_required === 1)

  return (
    <section>
      <h3 className="text-sm font-semibold">{t('gateTasks')}</h3>
      <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
        {filtered.length === 0 ? (
          <li className="px-3 py-4 text-xs text-muted-foreground text-center">
            {t('gateTasksEmptyBody')}
          </li>
        ) : (
          filtered.map((task) => (
            <GateTaskRow
              key={task.id}
              task={task}
              onApprove={onApprove}
              onReject={onReject}
              isViewer={isViewer}
            />
          ))
        )}
      </ul>
    </section>
  )
}
