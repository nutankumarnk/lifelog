/**
 * The analysis view.
 *
 * Items are grouped by type rather than listed flat, because the question a
 * reviewer asks is "did it find the tasks?", not "what was item 4?".
 */
import { useState } from 'react';
import type { AnalyzeResponse, ItemType } from '../types';
import { ItemCard } from './ItemCard';

/** Display order: what the user asked Lifelog to act on comes first. */
const GROUPS: Array<{ type: ItemType; title: string }> = [
  { type: 'REMINDER', title: 'Reminders' },
  { type: 'TASK', title: 'Tasks' },
  { type: 'FUTURE_EVENT', title: 'Upcoming' },
  { type: 'PAST_EVENT', title: 'Past events' },
  { type: 'MEMORY', title: 'Memories' },
  { type: 'FEELING', title: 'Feelings' },
  { type: 'DECISION', title: 'Decisions' },
  { type: 'PRESENT_FACT', title: 'Current facts' },
];

const ENTITY_LABELS: Record<string, string> = {
  PERSON: 'Person',
  PLACE: 'Place',
  ORGANIZATION: 'Organization',
  OBJECT: 'Object',
  TOPIC: 'Topic',
  EVENT_NAME: 'Event',
  OTHER: 'Other',
};

export function ResultPanel({ result }: { result: AnalyzeResponse }) {
  const [showRaw, setShowRaw] = useState(false);
  const { analysis, meta } = result;
  const hasItems = analysis.items.length > 0;

  return (
    <section className="result" aria-label="Analysis result">
      <header className="result__head">
        <div>
          <span className="label">Intent</span>
          <strong className="intent">{analysis.intent.replace(/_/g, ' ').toLowerCase()}</strong>
          <span className="confidence">{Math.round(analysis.intent_confidence * 100)}%</span>
        </div>
        <div className="result__meta">
          <span title="Which adapter produced this reading">{meta.provider}</span>
          <span title="Model identifier">{meta.model}</span>
          <span>{meta.latency_ms} ms</span>
          <span title="Detected language">{analysis.language}</span>
        </div>
      </header>

      {meta.degraded ? (
        <p className="notice notice--warn">
          The primary model was unavailable, so this reading came from the offline rule engine.
          Extraction quality is lower than usual.
        </p>
      ) : null}

      {!meta.persisted ? (
        <p className="notice notice--warn">
          Your conversation was saved, but this analysis could not be stored. It can be recomputed later.
        </p>
      ) : null}

      {analysis.follow_up ? (
        <div className={`followup${analysis.follow_up.blocking ? ' followup--blocking' : ''}`}>
          <span className="label">Lifelog asks</span>
          <p className="followup__question">{analysis.follow_up.question}</p>
          <p className="followup__reason">{analysis.follow_up.reason}</p>
        </div>
      ) : null}

      {hasItems ? (
        <div className="groups">
          {GROUPS.map((group) => {
            const items = analysis.items.filter((item) => item.type === group.type);
            if (items.length === 0) return null;

            return (
              <section key={group.type} className="group">
                <h3 className="group__title">
                  {group.title} <span className="count">{items.length}</span>
                </h3>
                <div className="group__items">
                  {items.map((item) => (
                    <ItemCard key={item.id} item={item} entities={analysis.entities} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <div className="empty">
          <h3>Nothing to record</h3>
          <p>
            Lifelog found no life information in that message. An empty result is a correct answer —
            it does not invent items to look useful.
          </p>
        </div>
      )}

      <section className="group">
        <h3 className="group__title">
          Entities <span className="count">{analysis.entities.length}</span>
        </h3>
        {analysis.entities.length > 0 ? (
          <ul className="entities">
            {analysis.entities.map((entity) => (
              <li key={entity.id} className="chip">
                <span className="chip__name">{entity.name}</span>
                <span className="chip__kind">
                  {entity.raw_kind ?? ENTITY_LABELS[entity.kind] ?? entity.kind}
                </span>
                {entity.relation ? <span className="chip__relation">{entity.relation}</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No people, places or things were mentioned.</p>
        )}
      </section>

      {analysis.missing_information.length > 0 ? (
        <section className="group">
          <h3 className="group__title">
            Missing information <span className="count">{analysis.missing_information.length}</span>
          </h3>
          <ul className="plain">
            {analysis.missing_information.map((entry) => (
              <li key={`${entry.field}-${entry.about_item_id ?? ''}`}>
                <code>{entry.field}</code> — {entry.reason}{' '}
                <span className="muted">({entry.importance.toLowerCase()})</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {analysis.warnings.length > 0 ? (
        <section className="group">
          <h3 className="group__title">
            Pipeline notes <span className="count">{analysis.warnings.length}</span>
          </h3>
          <ul className="plain">
            {analysis.warnings.map((warning, index) => (
              <li key={`${warning.code}-${index}`}>
                <code>{warning.code}</code> — {warning.message}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="group">
        <button type="button" className="toggle" onClick={() => setShowRaw((value) => !value)}>
          {showRaw ? 'Hide' : 'Show'} raw JSON
        </button>
        {showRaw ? (
          <pre className="json" aria-label="Raw API response">
            {JSON.stringify(result, null, 2)}
          </pre>
        ) : null}
      </section>

      <footer className="result__ids">
        <span>
          conversation <code>{result.conversationId}</code>
        </span>
        <span>
          analysis <code>{result.analysisId}</code>
        </span>
      </footer>
    </section>
  );
}
