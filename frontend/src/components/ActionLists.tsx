/**
 * Tasks and reminders.
 *
 * They are separate tabs because they are different promises:
 *
 *   Tasks      belong to the user. They are ticked off by hand.
 *   Reminders  belong to Lifelog. The user asked to be told at a time, so
 *              there is no checkbox and no delete — only the scheduled time
 *              and, once it passes, the fact that it was delivered.
 *
 * Both show where they came from, because the same obligation said twice is one
 * row here with two origins.
 */
import { useCallback, useEffect, useState } from 'react';
import { fetchReminders, fetchTasks, updateTaskStatus } from '../api';
import type { ActionItem, ActionListResponse } from '../types';

type Tab = 'tasks' | 'reminders';

function whenLabel(item: ActionItem): string | null {
  if (item.dueAt) {
    const date = new Date(item.dueAt);
    if (!Number.isNaN(date.getTime())) {
      const sameYear = date.getFullYear() === new Date().getFullYear();
      return date.toLocaleDateString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        ...(sameYear ? {} : { year: 'numeric' }),
      });
    }
  }
  return item.temporalRaw;
}

function Origins({ item }: { item: ActionItem }) {
  const [open, setOpen] = useState(false);
  const people = item.links.filter((link) => link.kind === 'PERSON' || link.role === 'about');

  return (
    <div className="origin">
      <button type="button" className="origin__toggle" onClick={() => setOpen((value) => !value)}>
        {open ? 'Hide' : 'Where this came from'}
        {item.occurrences > 1 ? ` · said ${item.occurrences}×` : ''}
      </button>

      {open ? (
        <div className="origin__body">
          {people.length > 0 ? (
            <p className="origin__row">
              <span className="origin__label">About</span>
              {people.map((link) => (
                <span key={link.entityId} className="origin__chip">
                  {link.name}
                  {link.relation ? ` · ${link.relation}` : ''}
                </span>
              ))}
            </p>
          ) : null}

          <p className="origin__row">
            <span className="origin__label">You said</span>
          </p>
          <ul className="origin__list">
            {item.sources.map((source, index) => (
              <li key={`${source.conversationId}-${index}`}>
                <span className="origin__quote">“{source.sourceText}”</span>
                <span className="origin__meta">
                  {new Date(source.createdAt).toLocaleString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                  {' · read by '}
                  {source.provider}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function ActionLists({ refreshKey }: { refreshKey: number }) {
  const [tab, setTab] = useState<Tab>('tasks');
  const [tasks, setTasks] = useState<ActionListResponse | null>(null);
  const [reminders, setReminders] = useState<ActionListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const [taskList, reminderList] = await Promise.all([
        fetchTasks(signal),
        fetchReminders(signal),
      ]);
      setTasks(taskList);
      setReminders(reminderList);
      setError(null);
    } catch {
      if (!signal?.aborted) setError('Could not load your list.');
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

  const toggleTask = async (task: ActionItem) => {
    setPendingId(task.id);
    try {
      await updateTaskStatus(task.id, task.status === 'DONE' ? 'OPEN' : 'DONE');
      await load();
    } catch {
      setError('Could not update that task.');
    } finally {
      setPendingId(null);
    }
  };

  const taskItems = tasks?.items ?? [];
  const reminderItems = reminders?.items ?? [];
  const visibleTasks = showDone ? taskItems : taskItems.filter((task) => task.status !== 'DONE');

  return (
    <section className="panel panel--actions" aria-label="Tasks and reminders">
      <div className="tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'tasks'}
          className={`tab${tab === 'tasks' ? ' tab--active' : ''}`}
          onClick={() => setTab('tasks')}
        >
          Tasks
          <span className="tab__count">{tasks?.counts.open ?? 0}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'reminders'}
          className={`tab${tab === 'reminders' ? ' tab--active' : ''}`}
          onClick={() => setTab('reminders')}
        >
          Reminders
          <span className="tab__count">{reminders?.counts.open ?? 0}</span>
        </button>
      </div>

      {error ? (
        <p className="tasks__error" role="alert">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="muted">Loading…</p>
      ) : tab === 'tasks' ? (
        <>
          <p className="tabs__hint">Things you have to do. Tick one off when it is done.</p>

          {taskItems.some((task) => task.status === 'DONE') ? (
            <label className="tasks__filter">
              <input
                type="checkbox"
                checked={showDone}
                onChange={(event) => setShowDone(event.target.checked)}
              />
              Show completed ({tasks?.counts.done ?? 0})
            </label>
          ) : null}

          {visibleTasks.length === 0 ? (
            <div className="empty">
              <h3>{taskItems.length === 0 ? 'No tasks yet' : 'All caught up'}</h3>
              <p>
                {taskItems.length === 0
                  ? 'Say something like "I need to send the report on Friday" and it will land here.'
                  : 'Everything on your list is done.'}
              </p>
            </div>
          ) : (
            <ul className="tasks">
              {visibleTasks.map((task) => {
                const when = whenLabel(task);
                const done = task.status === 'DONE';
                return (
                  <li key={task.id} className={`task${done ? ' task--done' : ''}`}>
                    <label className="task__check">
                      <input
                        type="checkbox"
                        checked={done}
                        disabled={pendingId === task.id}
                        onChange={() => void toggleTask(task)}
                      />
                      <span className="task__body">
                        <span className="task__title">{task.displayText || task.title}</span>
                        <span className="task__meta">
                          {when ? <span className="task__due">{when}</span> : null}
                          {task.priority !== 'NORMAL' ? (
                            <span className="task__priority">{task.priority.toLowerCase()}</span>
                          ) : null}
                        </span>
                      </span>
                    </label>
                    <Origins item={task} />
                  </li>
                );
              })}
            </ul>
          )}
        </>
      ) : (
        <>
          <p className="tabs__hint">
            You asked to be told at a time, so Lifelog keeps these. There is nothing to tick and
            nothing to delete — they are delivered when they are due.
          </p>

          {reminderItems.length === 0 ? (
            <div className="empty">
              <h3>No reminders yet</h3>
              <p>Say "remind me to call Priya tomorrow at 5" and it will be scheduled here.</p>
            </div>
          ) : (
            <ul className="tasks">
              {reminderItems.map((reminder) => {
                const when = whenLabel(reminder);
                const notified = reminder.status === 'NOTIFIED';
                return (
                  <li key={reminder.id} className="task task--reminder">
                    <div className="task__body">
                      <span className="reminder__head">
                        <span className="reminder__bell" aria-hidden="true">
                          ●
                        </span>
                        <span className="task__title">
                          {reminder.displayText || reminder.title}
                        </span>
                      </span>
                      <span className="task__meta">
                        <span className={`task__kind task__kind--${notified ? 'sent' : 'scheduled'}`}>
                          {notified ? 'delivered' : 'scheduled'}
                        </span>
                        {when ? <span className="task__due">{when}</span> : null}
                        {reminder.recurrence ? (
                          <span className="task__due">repeats {reminder.recurrence}</span>
                        ) : null}
                        {!when ? <span className="task__priority">no time yet</span> : null}
                      </span>
                    </div>
                    <Origins item={reminder} />
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
