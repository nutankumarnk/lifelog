/**
 * Connections Metrics panel.
 *
 * Displays the live memory graph: all objects extracted from conversations,
 * their mention counts, type breakdown, and inter-object relationships.
 * Talks only to /api/v1/memory/objects — no AI, no model call here.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchMemoryObjectDetail, fetchMemoryObjects, LifelogApiError } from '../api';
import type { MemoryObject, MemoryObjectDetail } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TYPE_EMOJI: Record<string, string> = {
  person: '👤',
  place: '📍',
  organization: '🏢',
  topic: '💬',
  event: '📅',
  decision: '✅',
  task: '📌',
  reminder: '🔔',
  feeling: '💛',
  other: '🔷',
};

function typeIcon(type: string): string {
  return TYPE_EMOJI[type.toLowerCase()] ?? '🔷';
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function MetricCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="metric-card">
      <span className="metric-card__value">{value}</span>
      <span className="metric-card__label">{label}</span>
      {sub ? <span className="metric-card__sub">{sub}</span> : null}
    </div>
  );
}

function TypeBadge({ type }: { type: string }) {
  return (
    <span className={`type-badge type-badge--${type.toLowerCase()}`}>
      {typeIcon(type)} {type}
    </span>
  );
}

function ObjectRow({
  obj,
  selected,
  onClick,
}: {
  obj: MemoryObject;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <li
      className={`memory-row${selected ? ' memory-row--active' : ''}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onClick()}
      aria-pressed={selected}
    >
      <div className="memory-row__main">
        <TypeBadge type={obj.type} />
        <span className="memory-row__name">{obj.name}</span>
      </div>
      <div className="memory-row__meta">
        <span className="memory-row__mentions" title="Times mentioned">
          ×{obj.mention_count}
        </span>
        <span className="memory-row__time" title={obj.last_seen_at}>
          {relativeTime(obj.last_seen_at)}
        </span>
      </div>
    </li>
  );
}

function RelationshipLine({
  rel,
  objectMap,
  selfId,
}: {
  rel: MemoryObjectDetail['relationships'][number];
  objectMap: Map<string, string>;
  selfId: string;
}) {
  const isSource = (rel.source_object_id ?? rel.source_id) === selfId;
  const otherId = (isSource ? (rel.target_object_id ?? rel.target_id) : (rel.source_object_id ?? rel.source_id)) ?? '';
  const otherName = objectMap.get(otherId) ?? (otherId ? otherId.slice(0, 8) + '…' : 'unknown');
  return (
    <li className="rel-line">
      <span className="rel-line__type">
        {rel.relationship_type.replace(/^custom:/, '').replace(/_/g, ' ')}
      </span>
      <span className="rel-line__arrow">{isSource ? '→' : '←'}</span>
      <span className="rel-line__target">{otherName}</span>
      <span className="rel-line__conf">{Math.round(rel.confidence * 100)}%</span>
    </li>
  );
}

function DetailDrawer({
  detail,
  objectMap,
  onClose,
}: {
  detail: MemoryObjectDetail;
  objectMap: Map<string, string>;
  onClose: () => void;
}) {
  return (
    <aside className="detail-drawer" aria-label="Object detail">
      <div className="detail-drawer__header">
        <div>
          <TypeBadge type={detail.type} />
          <h3 className="detail-drawer__name">{detail.name}</h3>
        </div>
        <button className="detail-drawer__close" onClick={onClose} aria-label="Close detail">
          ✕
        </button>
      </div>

      <dl className="detail-drawer__stats">
        <dt>Mentions</dt>
        <dd>{detail.mention_count}</dd>
        <dt>First seen</dt>
        <dd title={detail.first_seen_at}>{relativeTime(detail.first_seen_at)}</dd>
        <dt>Last seen</dt>
        <dd title={detail.last_seen_at}>{relativeTime(detail.last_seen_at)}</dd>
        <dt>Origins</dt>
        <dd>{detail.origins?.length ?? 0}</dd>
      </dl>

      {detail.relationships.length > 0 ? (
        <section className="detail-drawer__section">
          <h4>
            Connections <span className="count">{detail.relationships.length}</span>
          </h4>
          <ul className="rel-list">
            {detail.relationships.map((rel: any) => (
              <RelationshipLine
                key={rel.id}
                rel={rel}
                objectMap={objectMap}
                selfId={detail.id}
              />
            ))}
          </ul>
        </section>
      ) : (
        <p className="muted" style={{ marginTop: '1rem' }}>
          No connections recorded yet.
        </p>
      )}

      {Object.keys(detail.attributes).length > 0 ? (
        <section className="detail-drawer__section">
          <h4>Attributes</h4>
          <pre className="json" style={{ fontSize: '0.7rem', maxHeight: '180px', overflowY: 'auto' }}>
            {JSON.stringify(detail.attributes, null, 2)}
          </pre>
        </section>
      ) : null}
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

interface MemoryPanelProps {
  /** Bump to trigger a refresh after a new conversation is analyzed. */
  refreshKey: number;
}

export function MemoryPanel({ refreshKey }: MemoryPanelProps) {
  const [objects, setObjects] = useState<MemoryObject[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<MemoryObjectDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Derived metrics
  const typeCounts = objects.reduce<Record<string, number>>((acc, obj) => {
    acc[obj.type] = (acc[obj.type] ?? 0) + 1;
    return acc;
  }, {});
  const topType = Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0];
  const totalMentions = objects.reduce((sum, o) => sum + o.mention_count, 0);

  // Name lookup for relationship labels
  const objectMap = new Map(objects.map((o) => [o.id, o.name]));
  if (detail) objectMap.set(detail.id, detail.name);

  const load = useCallback(
    (p: number, s: string, t: string) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      setError(null);

      fetchMemoryObjects({ page: p, limit: 20, search: s || undefined, type: t || undefined }, controller.signal)
        .then((res: any) => {
          setObjects(res.objects);
          setTotal(res.pagination.total);
          setTotalPages(res.pagination.total_pages);
          setPage(p);
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          setError(err instanceof LifelogApiError ? err.message : 'Failed to load memory objects.');
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    },
    [],
  );

  // Reload on refreshKey change or filter change
  useEffect(() => {
    load(1, search, typeFilter);
    setSelectedId(null);
    setDetail(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey, typeFilter]);

  // Debounce search
  useEffect(() => {
    const id = setTimeout(() => load(1, search, typeFilter), 350);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  // Load detail when selection changes
  useEffect(() => {
    if (!selectedId) { setDetail(null); return; }
    const controller = new AbortController();
    setDetailLoading(true);
    fetchMemoryObjectDetail(selectedId, controller.signal)
      .then(setDetail)
      .catch(() => { if (!controller.signal.aborted) setDetail(null); })
      .finally(() => { if (!controller.signal.aborted) setDetailLoading(false); });
    return () => controller.abort();
  }, [selectedId]);

  const uniqueTypes = [...new Set(objects.map((o) => o.type))].sort();

  return (
    <section className="memory-panel" aria-label="Connections metrics">
      {/* Header */}
      <header className="memory-panel__head">
        <h2 className="memory-panel__title">
          <span className="memory-panel__icon">🕸️</span> Connections
        </h2>
        <span className="memory-panel__total">
          {loading ? '…' : `${total.toLocaleString()} object${total !== 1 ? 's' : ''}`}
        </span>
      </header>

      {/* Metric cards */}
      <div className="metric-row">
        <MetricCard label="Total objects" value={loading ? '…' : total} />
        <MetricCard label="Total mentions" value={loading ? '…' : totalMentions} />
        <MetricCard
          label="Top type"
          value={topType ? `${typeIcon(topType[0])} ${topType[0]}` : '—'}
          sub={topType ? `${topType[1]} object${topType[1] !== 1 ? 's' : ''}` : undefined}
        />
        <MetricCard label="Types" value={loading ? '…' : Object.keys(typeCounts).length} />
      </div>

      {/* Filters */}
      <div className="memory-filters">
        <input
          className="memory-search"
          type="search"
          placeholder="Search objects…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search memory objects"
        />
        <select
          className="memory-type-filter"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          aria-label="Filter by type"
        >
          <option value="">All types</option>
          {uniqueTypes.map((t) => (
            <option key={t} value={t}>
              {typeIcon(t)} {t}
            </option>
          ))}
        </select>
      </div>

      {/* Error */}
      {error ? <p className="notice notice--warn">{error}</p> : null}

      {/* List + Drawer */}
      <div className="memory-body">
        <div className="memory-list-wrap">
          {loading && objects.length === 0 ? (
            <div className="loading">
              <div className="skeleton skeleton--head" />
              <div className="skeleton" />
              <div className="skeleton skeleton--short" />
            </div>
          ) : objects.length === 0 ? (
            <div className="empty">
              <h3>No objects yet</h3>
              <p>Analyze a conversation and Lifelog will extract people, places, decisions and more into the memory graph.</p>
            </div>
          ) : (
            <ul className="memory-list" role="listbox" aria-label="Memory objects">
              {objects.map((obj) => (
                <ObjectRow
                  key={obj.id}
                  obj={obj}
                  selected={obj.id === selectedId}
                  onClick={() => setSelectedId(obj.id === selectedId ? null : obj.id)}
                />
              ))}
            </ul>
          )}

          {/* Pagination */}
          {totalPages > 1 ? (
            <div className="memory-pagination">
              <button
                className="toggle"
                disabled={page <= 1 || loading}
                onClick={() => load(page - 1, search, typeFilter)}
              >
                ← Prev
              </button>
              <span className="muted">
                {page} / {totalPages}
              </span>
              <button
                className="toggle"
                disabled={page >= totalPages || loading}
                onClick={() => load(page + 1, search, typeFilter)}
              >
                Next →
              </button>
            </div>
          ) : null}
        </div>

        {/* Detail drawer */}
        {selectedId ? (
          detailLoading ? (
            <aside className="detail-drawer">
              <div className="loading">
                <div className="skeleton skeleton--head" />
                <div className="skeleton" />
              </div>
            </aside>
          ) : detail ? (
            <DetailDrawer
              detail={detail}
              objectMap={objectMap}
              onClose={() => { setSelectedId(null); setDetail(null); }}
            />
          ) : null
        ) : null}
      </div>
    </section>
  );
}
