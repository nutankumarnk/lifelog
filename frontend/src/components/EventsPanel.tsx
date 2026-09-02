import { useState } from 'react';
import type { Entity, Item } from '../types';

interface EventsPanelProps {
  items: Item[];
  entities?: Entity[];
}

export function EventsPanel({ items, entities = [] }: EventsPanelProps) {
  const [filter, setFilter] = useState<'ALL' | 'PAST' | 'FUTURE'>('ALL');

  const eventItems = items.filter(
    (item) => item.type === 'PAST_EVENT' || item.type === 'FUTURE_EVENT',
  );

  const pastEvents = eventItems.filter((i) => i.type === 'PAST_EVENT');
  const futureEvents = eventItems.filter((i) => i.type === 'FUTURE_EVENT');

  const displayedEvents = eventItems.filter((item) => {
    if (filter === 'PAST') return item.type === 'PAST_EVENT';
    if (filter === 'FUTURE') return item.type === 'FUTURE_EVENT';
    return true;
  });

  const getEntityNames = (entityIds: string[]) => {
    if (!entityIds || entityIds.length === 0) return [];
    return entities.filter((e) => entityIds.includes(e.id));
  };

  const formatDate = (resolvedDateStr: string | null) => {
    if (!resolvedDateStr) return null;
    const date = new Date(resolvedDateStr);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleDateString(undefined, {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (eventItems.length === 0) {
    return (
      <div className="events-empty">
        <span className="events-empty__icon">📅</span>
        <h4>No Events Detected</h4>
        <p>No past activities or upcoming scheduled events were detected in this message.</p>
      </div>
    );
  }

  return (
    <div className="events-panel">
      {/* Header controls */}
      <div className="events-toolbar">
        <div className="events-filter-group">
          <button
            type="button"
            className={`event-filter-btn ${filter === 'ALL' ? 'event-filter-btn--active' : ''}`}
            onClick={() => setFilter('ALL')}
          >
            All Events ({eventItems.length})
          </button>
          <button
            type="button"
            className={`event-filter-btn ${filter === 'PAST' ? 'event-filter-btn--active' : ''}`}
            onClick={() => setFilter('PAST')}
          >
            ⏪ Past Events ({pastEvents.length})
          </button>
          <button
            type="button"
            className={`event-filter-btn ${filter === 'FUTURE' ? 'event-filter-btn--active' : ''}`}
            onClick={() => setFilter('FUTURE')}
          >
            ⏩ Upcoming / Future ({futureEvents.length})
          </button>
        </div>
      </div>

      {/* Events timeline / list */}
      <div className="events-timeline">
        {displayedEvents.map((item, index) => {
          const isFuture = item.type === 'FUTURE_EVENT';
          const resolvedFormatted = formatDate(item.temporal?.resolved);
          const rawTemporal = item.temporal?.raw;
          const linkedEntities = getEntityNames(item.entity_ids);
          const confidencePct = Math.round((item.confidence ?? 0.8) * 100);

          return (
            <div
              key={item.id || index}
              className={`event-card ${isFuture ? 'event-card--future' : 'event-card--past'}`}
            >
              <div className="event-card__indicator">
                <span className="event-card__dot" />
                <span className="event-card__type-badge">
                  {isFuture ? 'Upcoming Event' : 'Past Event'}
                </span>
              </div>

              <div className="event-card__content">
                <div className="event-card__head">
                  <h4 className="event-card__title">{item.title}</h4>
                  <span className="event-card__confidence" title="Detection confidence">
                    {confidencePct}% conf
                  </span>
                </div>

                {item.summary && item.summary !== item.title && (
                  <p className="event-card__summary">{item.summary}</p>
                )}

                {/* Timing details */}
                <div className="event-card__timing">
                  <span className="timing-icon">🕒</span>
                  {resolvedFormatted ? (
                    <span className="timing-resolved">{resolvedFormatted}</span>
                  ) : null}
                  {rawTemporal ? (
                    <span className="timing-raw" title="Original expression from conversation">
                      “{rawTemporal}”
                    </span>
                  ) : null}
                  {item.temporal?.precision && (
                    <span className="timing-precision">
                      precision: {item.temporal.precision.toLowerCase()}
                    </span>
                  )}
                </div>

                {/* Linked people & places */}
                {linkedEntities.length > 0 && (
                  <div className="event-card__entities">
                    <span className="entities-label">With / At:</span>
                    <div className="entities-chips">
                      {linkedEntities.map((e) => (
                        <span key={e.id} className={`entity-chip entity-chip--${e.kind.toLowerCase()}`}>
                          {e.kind === 'PERSON' ? '👤' : e.kind === 'PLACE' ? '📍' : '🏷️'} {e.name}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Grounding verbatim quote */}
                {item.source_text && (
                  <div className="event-card__source">
                    <span className="source-label">From:</span>
                    <span className="source-quote">“{item.source_text}”</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
