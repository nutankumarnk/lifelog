/**
 * Task and reminder list.
 *
 * Shows the action items Lifelog extracted across conversations and lets the
 * user tick them off. Completion is a status change on the extracted item; the
 * original conversation text is never edited.
 */
import { useCallback, useEffect, useState } from 'react';
import { fetchTasks, updateTaskStatus } from '../api';
import type { TaskItem, TaskListResponse } from '../types';

function dueLabel(task: TaskItem): string | null {
  if (task.dueAt) {
    const date = new Date(task.dueAt);
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleDateString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      });
    }
  }
  return task.temporalRaw;
}

export function TaskList({ refreshKey }: { refreshKey: number }) {
  const [data, setData] = useState<TaskListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetchTasks(signal);
      setData(response);
      setError(null);
    } catch {
      if (!signal?.aborted) setError('Could not load your tasks.');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void load(controller.signal);
    return () => controller.abort();
  }, [load, refreshKey]);

  const toggle = async (task: TaskItem) => {
    setPendingId(task.id);
    try {
      await updateTaskStatus(task.id, task.status === 'DONE' ? 'OPEN' : 'DONE');
      await load();
    } catch {
      setError('Could not update that item.');
    } finally {
      setPendingId(null);
    }
  };

  const items = data?.items ?? [];
  const visible = showDone ? items : items.filter((task) => task.status !== 'DONE');

  return (
    <section className="panel panel--tasks" aria-label="Tasks and reminders">
      <div className="tasks__head">
        <h2>Tasks &amp; reminders</h2>
        {data ? (
          <span className="muted">
            {data.counts.open} open · {data.counts.done} done
          </span>
        ) : null}
      </div>

      {items.some((task) => task.status === 'DONE') ? (
        <label className="tasks__filter">
          <input
            type="checkbox"
            checked={showDone}
            onChange={(event) => setShowDone(event.target.checked)}
          />
          Show completed
        </label>
      ) : null}

      {loading ? (
        <p className="muted">Loading your list…</p>
      ) : error ? (
        <p className="tasks__error" role="alert">
          {error}
        </p>
      ) : visible.length === 0 ? (
        <div className="empty">
          <h3>{items.length === 0 ? 'No tasks yet' : 'All caught up'}</h3>
          <p>
            {items.length === 0
              ? 'Write something like "remind me to call Priya tomorrow at 5" and it will appear here.'
              : 'Everything on your list is complete.'}
          </p>
        </div>
      ) : (
        <ul className="tasks">
          {visible.map((task) => {
            const due = dueLabel(task);
            const done = task.status === 'DONE';
            return (
              <li key={task.id} className={`task${done ? ' task--done' : ''}`}>
                <label className="task__check">
                  <input
                    type="checkbox"
                    checked={done}
                    disabled={pendingId === task.id}
                    onChange={() => void toggle(task)}
                  />
                  <span className="task__body">
                    <span className="task__title">{task.displayText || task.title}</span>
                    <span className="task__meta">
                      <span className={`task__kind task__kind--${task.type.toLowerCase()}`}>
                        {task.type === 'REMINDER' ? 'reminder' : 'task'}
                      </span>
                      {due ? <span className="task__due">{due}</span> : null}
                      {task.priority && task.priority !== 'NORMAL' ? (
                        <span className="task__priority">{task.priority.toLowerCase()}</span>
                      ) : null}
                    </span>
                    <span className="task__source">“{task.sourceText}”</span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
