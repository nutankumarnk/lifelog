import { useState } from 'react';
import type { Entity, Item } from '../types';

interface ConnectionsPanelProps {
  entities: Entity[];
  items?: Item[];
}

const KIND_COLORS: Record<string, { bg: string; border: string; text: string; icon: string }> = {
  PERSON: { bg: 'rgba(192, 132, 252, 0.15)', border: 'rgba(192, 132, 252, 0.4)', text: '#d8b4fe', icon: '👤' },
  PLACE: { bg: 'rgba(125, 211, 252, 0.15)', border: 'rgba(125, 211, 252, 0.4)', text: '#7dd3fc', icon: '📍' },
  ORGANIZATION: { bg: 'rgba(94, 234, 212, 0.15)', border: 'rgba(94, 234, 212, 0.4)', text: '#5eead4', icon: '🏢' },
  TOPIC: { bg: 'rgba(251, 191, 36, 0.15)', border: 'rgba(251, 191, 36, 0.4)', text: '#fbbf24', icon: '💡' },
  OBJECT: { bg: 'rgba(244, 114, 182, 0.15)', border: 'rgba(244, 114, 182, 0.4)', text: '#f472b6', icon: '📦' },
  EVENT_NAME: { bg: 'rgba(163, 230, 53, 0.15)', border: 'rgba(163, 230, 53, 0.4)', text: '#a3e635', icon: '🎯' },
  OTHER: { bg: 'rgba(148, 163, 184, 0.15)', border: 'rgba(148, 163, 184, 0.4)', text: '#cbd5e1', icon: '🏷️' },
};

export function ConnectionsPanel({ entities, items = [] }: ConnectionsPanelProps) {
  const [selectedKind, setSelectedKind] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  const kinds = Array.from(new Set(entities.map((e) => e.kind)));

  const filteredEntities = entities.filter((entity) => {
    const matchesKind = selectedKind === 'ALL' || entity.kind === selectedKind;
    const matchesSearch =
      !searchQuery ||
      entity.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (entity.relation && entity.relation.toLowerCase().includes(searchQuery.toLowerCase())) ||
      entity.aliases.some((a) => a.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesKind && matchesSearch;
  });

  // Find linked items for an entity
  const getLinkedItems = (entityId: string) => {
    return items.filter((item) => item.entity_ids && item.entity_ids.includes(entityId));
  };

  if (entities.length === 0) {
    return (
      <div className="connections-empty">
        <span className="connections-empty__icon">🔗</span>
        <h4>No Connections Detected</h4>
        <p>No people, places, or entities were identified in this conversation.</p>
      </div>
    );
  }

  return (
    <div className="connections-panel">
      {/* Filter and Search Bar */}
      <div className="connections-toolbar">
        <div className="connections-kinds">
          <button
            type="button"
            className={`kind-pill ${selectedKind === 'ALL' ? 'kind-pill--active' : ''}`}
            onClick={() => setSelectedKind('ALL')}
          >
            All ({entities.length})
          </button>
          {kinds.map((k) => {
            const count = entities.filter((e) => e.kind === k).length;
            const style = KIND_COLORS[k] || KIND_COLORS.OTHER;
            return (
              <button
                key={k}
                type="button"
                className={`kind-pill ${selectedKind === k ? 'kind-pill--active' : ''}`}
                onClick={() => setSelectedKind(k)}
              >
                <span>{style.icon}</span> {k.toLowerCase()} ({count})
              </button>
            );
          })}
        </div>

        {entities.length > 3 && (
          <input
            type="text"
            className="connections-search"
            placeholder="Search connections…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        )}
      </div>

      {/* Grid of Connection Cards */}
      <div className="connections-grid">
        {filteredEntities.map((entity) => {
          const style = KIND_COLORS[entity.kind] || KIND_COLORS.OTHER;
          const linkedItems = getLinkedItems(entity.id);
          const confidencePct = Math.round((entity.confidence ?? 0.8) * 100);

          return (
            <div
              key={entity.id}
              className="connection-card"
              style={{ borderColor: style.border }}
            >
              <div className="connection-card__header">
                <div className="connection-card__identity">
                  <span className="connection-card__icon" style={{ background: style.bg, borderColor: style.border }}>
                    {style.icon}
                  </span>
                  <div>
                    <h4 className="connection-card__name">{entity.name}</h4>
                    <span className="connection-card__kind-badge" style={{ color: style.text, background: style.bg }}>
                      {entity.raw_kind || entity.kind.toLowerCase()}
                    </span>
                  </div>
                </div>

                <div className="connection-card__confidence" title={`Confidence: ${confidencePct}%`}>
                  <div className="confidence-meter">
                    <div
                      className="confidence-meter__fill"
                      style={{
                        width: `${confidencePct}%`,
                        backgroundColor: confidencePct > 80 ? '#4ade80' : confidencePct > 60 ? '#fbbf24' : '#f87171',
                      }}
                    />
                  </div>
                  <span className="confidence-text">{confidencePct}%</span>
                </div>
              </div>

              {entity.relation && (
                <div className="connection-card__relation">
                  <span className="relation-label">Relationship:</span>
                  <span className="relation-value">🤝 {entity.relation}</span>
                </div>
              )}

              {entity.aliases && entity.aliases.length > 0 && (
                <div className="connection-card__aliases">
                  <span className="alias-label">Also known as:</span>
                  <div className="alias-list">
                    {entity.aliases.map((alias, idx) => (
                      <span key={idx} className="alias-tag">
                        {alias}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Linked tasks / events / memories */}
              {linkedItems.length > 0 && (
                <div className="connection-card__links">
                  <span className="links-label">Connected To ({linkedItems.length}):</span>
                  <div className="links-list">
                    {linkedItems.map((item) => (
                      <div key={item.id} className={`link-item link-item--${item.type.toLowerCase()}`}>
                        <span className="link-item__type">{item.type.replace(/_/g, ' ')}</span>
                        <span className="link-item__title">{item.title}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Mentions / grounded source spans */}
              {entity.attributes && Object.keys(entity.attributes).length > 0 && (
                <div className="connection-card__attributes">
                  {Object.entries(entity.attributes).map(([key, val]) => (
                    <div key={key} className="attribute-pill">
                      <strong>{key}:</strong> {String(val)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
