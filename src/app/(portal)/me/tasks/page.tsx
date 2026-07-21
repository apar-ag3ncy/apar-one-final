import type { Metadata } from 'next';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge, type StatusTone } from '@/components/shared/status-badge';
import { getMyTaskBoard, isOpenStatus } from '@/lib/server/portal/tasks';
import { todayIST } from '@/lib/ist-date';

import { TaskStatusSelect } from './task-status-select';

export const metadata: Metadata = { title: 'Apar · My tasks' };

const STATUS_LABEL: Record<string, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  little_delayed: 'Slightly delayed',
  delayed: 'Delayed',
  done: 'Completed',
  cancelled: 'Cancelled',
};

const STATUS_TONE: Record<string, StatusTone> = {
  todo: 'neutral',
  in_progress: 'info',
  little_delayed: 'warning',
  delayed: 'danger',
  done: 'success',
  cancelled: 'neutral',
};

const PRIORITY_LABEL: Record<string, string> = {
  urgent_important: 'Urgent & important',
  // Legacy value: 0070 added `priority` as a bare text column with no DB CHECK,
  // so rows predating the Eisenhower rename can still hold plain 'urgent'.
  urgent: 'Urgent',
  important: 'Important',
  nice: 'Nice to have',
};

function fmtDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
  });
}

export default async function MyTasksPage() {
  const board = await getMyTaskBoard();
  const today = todayIST();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">My tasks</h1>
        <p className="text-muted-foreground text-sm">
          {board.totalCount === 0
            ? 'Nothing assigned to you yet.'
            : `${board.openCount} open of ${board.totalCount}, by client and project.`}
        </p>
      </header>

      {board.clients.length === 0 ? (
        <Card>
          <CardContent className="text-muted-foreground py-8 text-center text-sm">
            When someone assigns you a deliverable it will show up here.
          </CardContent>
        </Card>
      ) : (
        board.clients.map((client) => (
          <Card key={client.clientId}>
            <CardHeader>
              <CardTitle className="text-base">{client.clientName}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              {client.projects.map((project) => (
                <div key={project.projectId}>
                  <div className="mb-2 flex flex-wrap items-baseline gap-x-2">
                    <h3 className="text-sm font-medium">
                      {project.parentName ? (
                        <span className="text-muted-foreground font-normal">
                          {project.parentName} ›{' '}
                        </span>
                      ) : null}
                      {project.name}
                    </h3>
                    {project.code ? (
                      <span className="text-muted-foreground font-mono text-xs">
                        {project.code}
                      </span>
                    ) : null}
                  </div>

                  <ul className="divide-y rounded-md border">
                    {project.tasks.map((task) => {
                      const overdue =
                        task.dueOn !== null && isOpenStatus(task.status) && task.dueOn < today;
                      return (
                        <li
                          key={task.taskId}
                          className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm">{task.title}</p>
                            <div className="mt-1 flex flex-wrap items-center gap-1.5">
                              <StatusBadge
                                tone={STATUS_TONE[task.status] ?? 'neutral'}
                                label={STATUS_LABEL[task.status] ?? task.status}
                                dot={false}
                              />
                              {task.priority ? (
                                <StatusBadge
                                  tone="accent"
                                  label={PRIORITY_LABEL[task.priority] ?? task.priority}
                                  dot={false}
                                />
                              ) : null}
                              {task.dueOn ? (
                                <span
                                  className={
                                    overdue
                                      ? 'text-destructive text-xs font-medium'
                                      : 'text-muted-foreground text-xs'
                                  }
                                >
                                  {overdue ? 'Overdue · ' : 'Due '}
                                  {fmtDate(task.dueOn)}
                                </span>
                              ) : null}
                            </div>
                          </div>
                          <TaskStatusSelect taskId={task.taskId} status={task.status} />
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
