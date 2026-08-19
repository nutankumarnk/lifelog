/**
 * One extracted item.
 *
 * Shows what Lifelog understood *and* the evidence for it: the verbatim source
 * text, the user's own time phrase next to the resolved date, and a confidence
 * reading. The evidence is the point — this console exists to check whether
 * Lifelog is inventing things.
 */
import type { Entity, Item, ItemType } from '../types';

const TYPE_LABELS: Record<ItemType, string> = {
  MEMORY: 'Memory',
  PAST_EVENT: 'Past event',
  PRESENT_FACT: 'Present fact',
  FUTURE_EVENT: 'Future event',
  TASK: 'Task',
  REMINDER: 'Reminder',
  DECISION: 'Decision',
  FEELING: 'Feeling',
};

function formatDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(date.getTime())) return value;

  const hasTime = value.includes('T') || value.includes(':');
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
    ...(hasTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
}

/** Renders the details a given item type actually carries. */
function Details({ item }: { item: Item }) {
  const rows: Array<[string, string]> = [];
  const details = item.details;

  if (item.type === 'TASK') {
    if (details.status) rows.push(['Status', String(details.status)]);
    if (details.priority) rows.push(['Priority', String(details.priority)]);
  }
  if (item.type === 'REMINDER') {
    rows.push(['Requested by user', details.explicit === true ? 'yes' : 'no']);
    const trigger = formatDate((details.trigger_at as string | null) ?? null);
    rows.push(['Fires', trigger ?? 'not yet scheduled']);
  }
  if (item.type === 'FEELING') {
    if (details.emotion) rows.push(['Emotion', String(details.emotion)]);
    if (details.sentiment) rows.push(['Sentiment', String(details.sentiment)]);
    if (typeof details.intensity === 'number') {
      rows.push(['Intensity', `${Math.round(details.intensity * 100)}%`]);
    }
  }
  if (item.type === 'MEMORY' && typeof details.significance === 'number') {
    rows.push(['Significance', `${Math.round(details.significance * 100)}%`]);
  }
  if (item.type === 'DECISION' && Array.isArray(details.alternatives) && details.alternatives.length > 0) {
    rows.push(['Alternatives', (details.alternatives as string[]).join(', ')]);
  }

  if (rows.length === 0) return null;

  return (
    <dl className="details">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ItemCard({ item, entities }: { item: Item; entities: Entity[] }) {
  const linked = entities.filter((entity) => item.entity_ids.includes(entity.id));
  const resolved = formatDate(item.temporal.resolved);
  const uncertain = item.confidence < 0.45;

  return (
    <article className={`item item--${item.type.toLowerCase()}`}>
      <header className="item__head">
        <span className="badge">{TYPE_LABELS[item.type]}</span>
        <span className={`confidence${uncertain ? ' confidence--low' : ''}`} title="Lifelog's confidence in this extraction">
          {Math.round(item.confidence * 100)}%
        </span>
      </header>

      <h4 className="item__title">{item.title}</h4>

      {item.temporal.raw || resolved ? (
        <p className="item__when">
          {item.temporal.raw ? <span className="phrase">“{item.temporal.raw}”</span> : null}
          {resolved ? <span className="resolved">{resolved}</span> : null}
          {item.temporal.recurrence ? <span className="resolved">repeats {item.temporal.recurrence}</span> : null}
          {item.temporal.raw && !resolved ? (
            <span className="unresolved">could not be resolved to a date</span>
          ) : null}
        </p>
      ) : null}

      {linked.length > 0 ? (
        <p className="item__entities">
          {linked.map((entity) => (
            <span key={entity.id} className="chip chip--sm">
              {entity.name}
            </span>
          ))}
        </p>
      ) : null}

      <Details item={item} />

      {item.source_text ? (
        <blockquote className="item__source" title="The exact text this came from">
          {item.source_text}
        </blockquote>
      ) : null}
    </article>
  );
}
