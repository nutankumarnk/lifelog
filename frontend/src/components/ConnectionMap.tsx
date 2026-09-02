/**
 * ConnectionMap — force-directed graph + right-side data dashboard.
 *
 * Layout: [Graph canvas (left, flexible)] | [Data panel (right, 380px)]
 *
 * Data panel features:
 *  - Summary stat cards (total objects, connections, by-type breakdown)
 *  - Filters: type picker, relationship type picker, search
 *  - Objects table: name | type | mentions | connections
 *  - Connections table: source → rel → target | confidence
 *  - Tab switcher between Objects / Connections
 *  - Clicking a table row highlights / centers the node in the graph
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { fetchGraphData } from '../api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GNode {
  id: string;
  name: string;
  type: string;
  mention_count: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  pinned: boolean;
}

interface GEdge {
  id: string;
  source: string;
  target: string;
  type: string;
  confidence: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TYPE_COLOR: Record<string, string> = {
  person:          '#c084fc',
  place:           '#7dd3fc',
  organization:    '#60a5fa',
  project:         '#34d399',
  event:           '#fbbf24',
  physical_object: '#fb923c',
  other_entity:    '#94a3b8',
  // legacy/fallback
  other:           '#94a3b8',
  object:          '#fb923c',
};

const TYPE_LABEL: Record<string, string> = {
  person:          'Person',
  place:           'Place',
  organization:    'Organization',
  project:         'Project',
  event:           'Event',
  physical_object: 'Object',
  other_entity:    'Other',
};

const EDGE_COLORS = [
  '#a3e63544', '#c084fc44', '#7dd3fc44',
  '#fbbf2444', '#fb923c44', '#6ea8fe44',
  '#f472b644', '#5eead444',
];

function nodeColor(type: string): string {
  return TYPE_COLOR[type.toLowerCase()] ?? '#6ea8fe';
}

function nodeRadius(mentionCount: number): number {
  return Math.max(7, Math.min(28, 7 + mentionCount * 4));
}

function typeLabel(type: string): string {
  return TYPE_LABEL[type.toLowerCase()] ?? type;
}

function relLabel(rel: string): string {
  return rel.replace(/_/g, ' ');
}

function confBar(conf: number): string {
  // 0–1 → bar width % color
  if (conf >= 0.8) return '#34d399';
  if (conf >= 0.6) return '#fbbf24';
  return '#fb923c';
}

// ---------------------------------------------------------------------------
// Force helpers
// ---------------------------------------------------------------------------

const REPULSION  = 4500;
const ATTRACTION = 0.04;
const DAMPING    = 0.86;
const GRAVITY    = 0.025;
const MIN_DIST   = 1;

function applyForces(nodes: GNode[], edges: GEdge[], w: number, h: number) {
  const cx = w / 2;
  const cy = h / 2;
  const n = nodes.length;

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = nodes[i]!;
      const b = nodes[j]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist2 = dx * dx + dy * dy || MIN_DIST;
      const dist  = Math.sqrt(dist2);
      const force = REPULSION / dist2;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      if (!a.pinned) { a.vx -= fx; a.vy -= fy; }
      if (!b.pinned) { b.vx += fx; b.vy += fy; }
    }
  }

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  for (const edge of edges) {
    const s = nodeMap.get(edge.source);
    const t = nodeMap.get(edge.target);
    if (!s || !t) continue;
    const dx = t.x - s.x;
    const dy = t.y - s.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || MIN_DIST;
    const ideal = 120 + (nodeRadius(s.mention_count) + nodeRadius(t.mention_count));
    const stretch = dist - ideal;
    const fx = (dx / dist) * stretch * ATTRACTION;
    const fy = (dy / dist) * stretch * ATTRACTION;
    if (!s.pinned) { s.vx += fx; s.vy += fy; }
    if (!t.pinned) { t.vx -= fx; t.vy -= fy; }
  }

  for (const node of nodes) {
    if (node.pinned) continue;
    node.vx += (cx - node.x) * GRAVITY;
    node.vy += (cy - node.y) * GRAVITY;
    node.vx *= DAMPING;
    node.vy *= DAMPING;
    node.x += node.vx;
    node.y += node.vy;
  }
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

function drawGraph(
  ctx: CanvasRenderingContext2D,
  nodes: GNode[],
  edges: GEdge[],
  hoveredId: string | null,
  selectedId: string | null,
  transform: { x: number; y: number; k: number },
) {
  const { width, height } = ctx.canvas;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#040712';
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.translate(transform.x, transform.y);
  ctx.scale(transform.k, transform.k);

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  // Edges
  let edgeColorIdx = 0;
  for (const edge of edges) {
    const s = nodeMap.get(edge.source);
    const t = nodeMap.get(edge.target);
    if (!s || !t) continue;

    const isActive = hoveredId === edge.source || hoveredId === edge.target
                  || selectedId === edge.source || selectedId === edge.target;

    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(t.x, t.y);

    if (isActive) {
      ctx.strokeStyle = '#ffffff55';
      ctx.lineWidth = 1.5;
    } else {
      ctx.strokeStyle = EDGE_COLORS[edgeColorIdx % EDGE_COLORS.length]!;
      ctx.lineWidth = 0.8;
    }
    edgeColorIdx++;
    ctx.stroke();

    if (isActive) {
      const mx = (s.x + t.x) / 2;
      const my = (s.y + t.y) / 2;
      const label = relLabel(edge.type);
      ctx.font = '9px ui-sans-serif, system-ui, sans-serif';
      ctx.fillStyle = '#ffffff88';
      ctx.textAlign = 'center';
      ctx.fillText(label, mx, my - 4);
    }
  }

  // Nodes
  for (const node of nodes) {
    const r = nodeRadius(node.mention_count);
    const color = nodeColor(node.type);
    const isHovered  = node.id === hoveredId;
    const isSelected = node.id === selectedId;

    // Glow
    if (isHovered || isSelected) {
      ctx.shadowColor = color;
      ctx.shadowBlur = isSelected ? 28 : 18;
    }

    ctx.beginPath();
    ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
    ctx.fillStyle = (isHovered || isSelected) ? color : color + 'bb';
    ctx.fill();

    if (isHovered || isSelected) {
      ctx.strokeStyle = isSelected ? '#ffffff' : '#ffffff99';
      ctx.lineWidth = isSelected ? 2 : 1.5;
      ctx.stroke();
    }

    ctx.shadowBlur = 0;

    // Label on hover or selection
    if (isHovered || isSelected) {
      ctx.font = `bold 12px ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      const textW = ctx.measureText(node.name).width;
      const px = 6, py = 4;
      const lx = node.x;
      const ly = node.y - r - 14;
      ctx.fillStyle = '#000000cc';
      ctx.beginPath();
      ctx.roundRect(lx - textW / 2 - px, ly - 12, textW + px * 2, 16 + py, 6);
      ctx.fill();
      ctx.fillStyle = color;
      ctx.fillText(node.name, lx, ly);
      ctx.font = `10px ui-sans-serif, system-ui, sans-serif`;
      ctx.fillStyle = '#ffffff88';
      ctx.fillText(typeLabel(node.type), lx, ly + 14);
    }
  }

  ctx.restore();
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface ConnectionMapProps {
  onBack: () => void;
}

export function ConnectionMap({ onBack }: ConnectionMapProps) {
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const nodesRef     = useRef<GNode[]>([]);
  const edgesRef     = useRef<GEdge[]>([]);
  const rafRef       = useRef<number>(0);
  const transformRef = useRef({ x: 0, y: 0, k: 1 });
  const hoveredRef   = useRef<string | null>(null);
  const dragRef      = useRef<{ nodeId: string; ox: number; oy: number } | null>(null);
  const panRef       = useRef<{ startX: number; startY: number; tx: number; ty: number } | null>(null);
  const iterRef      = useRef(0);

  const [status,     setStatus]     = useState<'loading' | 'empty' | 'ready' | 'error'>('loading');
  const [nodeCount,  setNodeCount]  = useState(0);
  const [edgeCount,  setEdgeCount]  = useState(0);
  const [tooltip,    setTooltip]    = useState<{ name: string; type: string; mentions: number; x: number; y: number } | null>(null);

  // Panel state
  const [tab,           setTab]          = useState<'objects' | 'connections'>('objects');
  const [typeFilter,    setTypeFilter]   = useState<string>('all');
  const [relFilter,     setRelFilter]    = useState<string>('all');
  const [search,        setSearch]       = useState('');
  const [selectedId,    setSelectedId]   = useState<string | null>(null);
  const [panelNodes,    setPanelNodes]   = useState<GNode[]>([]);
  const [panelEdges,    setPanelEdges]   = useState<GEdge[]>([]);

  // ── Load ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const controller = new AbortController();
    setStatus('loading');

    fetchGraphData(controller.signal)
      .then(({ objects, edges }: { objects: any[]; edges: any[] }) => {
        if (objects.length === 0) { setStatus('empty'); return; }

        const canvas = canvasRef.current;
        const w = canvas?.clientWidth  ?? 1000;
        const h = canvas?.clientHeight ?? 700;

        nodesRef.current = objects.map((obj: any, i: number) => {
          const angle = (i / objects.length) * Math.PI * 2;
          const dist  = Math.min(w, h) * 0.28;
          return {
            id:            obj.id,
            name:          obj.name,
            type:          obj.type,
            mention_count: obj.mention_count,
            x: w / 2 + Math.cos(angle) * dist,
            y: h / 2 + Math.sin(angle) * dist,
            vx: 0, vy: 0,
            pinned: false,
          };
        });

        edgesRef.current = edges;
        setNodeCount(objects.length);
        setEdgeCount(edges.length);
        setPanelNodes([...nodesRef.current]);
        setPanelEdges([...edgesRef.current]);
        setStatus('ready');
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          console.error(err);
          setStatus('error');
        }
      });

    return () => controller.abort();
  }, []);

  // ── Animation loop ────────────────────────────────────────────────────────
  useEffect(() => {
    if (status !== 'ready') return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      canvas.width  = canvas.clientWidth;
      canvas.height = canvas.clientHeight;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const tick = () => {
      const nodes = nodesRef.current;
      const edges = edgesRef.current;
      const { width, height } = canvas;

      iterRef.current++;
      if (iterRef.current < 300 || iterRef.current % 3 === 0) {
        applyForces(nodes, edges, width, height);
      }

      drawGraph(ctx, nodes, edges, hoveredRef.current, selectedId, transformRef.current);
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
    };
  }, [status, selectedId]);

  // ── Center on a node ─────────────────────────────────────────────────────
  const centerOnNode = useCallback((nodeId: string) => {
    const node = nodesRef.current.find((n) => n.id === nodeId);
    if (!node || !canvasRef.current) return;
    const { clientWidth: w, clientHeight: h } = canvasRef.current;
    const k = transformRef.current.k;
    transformRef.current.x = w / 2 - node.x * k;
    transformRef.current.y = h / 2 - node.y * k;
    setSelectedId(nodeId);
  }, []);

  // ── Mouse helpers ─────────────────────────────────────────────────────────
  function canvasToWorld(cx: number, cy: number) {
    const t = transformRef.current;
    return { x: (cx - t.x) / t.k, y: (cy - t.y) / t.k };
  }

  function hitTest(wx: number, wy: number): GNode | null {
    for (let i = nodesRef.current.length - 1; i >= 0; i--) {
      const n = nodesRef.current[i]!;
      const dx = n.x - wx;
      const dy = n.y - wy;
      const r  = nodeRadius(n.mention_count);
      if (dx * dx + dy * dy <= r * r) return n;
    }
    return null;
  }

  function onMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const rect = canvasRef.current!.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;

    if (dragRef.current) {
      const { nodeId } = dragRef.current;
      const w = canvasToWorld(cx, cy);
      const node = nodesRef.current.find((n) => n.id === nodeId);
      if (node) { node.x = w.x; node.y = w.y; node.vx = 0; node.vy = 0; }
      return;
    }

    if (panRef.current) {
      const { startX, startY, tx, ty } = panRef.current;
      transformRef.current.x = tx + (e.clientX - startX);
      transformRef.current.y = ty + (e.clientY - startY);
      return;
    }

    const w = canvasToWorld(cx, cy);
    const hit = hitTest(w.x, w.y);
    hoveredRef.current = hit?.id ?? null;

    if (hit) {
      setTooltip({ name: hit.name, type: hit.type, mentions: hit.mention_count, x: cx, y: cy });
      canvasRef.current!.style.cursor = 'pointer';
    } else {
      setTooltip(null);
      canvasRef.current!.style.cursor = 'grab';
    }
  }

  function onMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    const rect = canvasRef.current!.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const w  = canvasToWorld(cx, cy);
    const hit = hitTest(w.x, w.y);

    if (hit) {
      hit.pinned = true;
      dragRef.current = { nodeId: hit.id, ox: w.x - hit.x, oy: w.y - hit.y };
      setSelectedId(hit.id);
    } else {
      panRef.current = {
        startX: e.clientX, startY: e.clientY,
        tx: transformRef.current.x, ty: transformRef.current.y,
      };
      canvasRef.current!.style.cursor = 'grabbing';
    }
  }

  function onMouseUp() {
    if (dragRef.current) {
      const node = nodesRef.current.find((n) => n.id === dragRef.current!.nodeId);
      if (node) node.pinned = false;
      dragRef.current = null;
    }
    panRef.current = null;
    canvasRef.current!.style.cursor = 'grab';
  }

  function onWheel(e: React.WheelEvent<HTMLCanvasElement>) {
    e.preventDefault();
    const rect  = canvasRef.current!.getBoundingClientRect();
    const cx    = e.clientX - rect.left;
    const cy    = e.clientY - rect.top;
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const t     = transformRef.current;
    t.k = Math.max(0.2, Math.min(4, t.k * delta));
    t.x = cx - (cx - t.x) * delta;
    t.y = cy - (cy - t.y) * delta;
  }

  // ── Derived data for panel ────────────────────────────────────────────────
  const allTypes    = [...new Set(panelNodes.map((n) => n.type))].sort();
  const allRelTypes = [...new Set(panelEdges.map((e) => e.type))].sort();

  // Filter objects
  const filteredObjects = panelNodes.filter((n) => {
    if (typeFilter !== 'all' && n.type !== typeFilter) return false;
    if (search && !n.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  // Count connections per object
  const connCount = new Map<string, number>();
  for (const edge of panelEdges) {
    connCount.set(edge.source, (connCount.get(edge.source) ?? 0) + 1);
    connCount.set(edge.target, (connCount.get(edge.target) ?? 0) + 1);
  }

  // Filter connections
  const nodeNameMap = new Map(panelNodes.map((n) => [n.id, n.name]));
  const filteredEdges = panelEdges.filter((e) => {
    if (relFilter !== 'all' && e.type !== relFilter) return false;
    if (typeFilter !== 'all') {
      const s = panelNodes.find((n) => n.id === e.source);
      const t = panelNodes.find((n) => n.id === e.target);
      if (s?.type !== typeFilter && t?.type !== typeFilter) return false;
    }
    if (search) {
      const srcName = nodeNameMap.get(e.source) ?? '';
      const tgtName = nodeNameMap.get(e.target) ?? '';
      if (!srcName.toLowerCase().includes(search.toLowerCase()) &&
          !tgtName.toLowerCase().includes(search.toLowerCase()) &&
          !relLabel(e.type).toLowerCase().includes(search.toLowerCase())) return false;
    }
    return true;
  });

  // Type breakdown
  const typeBreakdown = allTypes.map((t) => ({
    type: t,
    count: panelNodes.filter((n) => n.type === t).length,
  }));

  const usedTypes = [...new Set(nodesRef.current.map((n) => n.type))].sort();

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="map-page">
      {/* Header */}
      <header className="map-header">
        <button className="map-back" onClick={onBack} aria-label="Back to console">
          ← Back
        </button>
        <div className="map-header__title">
          <span>🕸️ Connection Map</span>
          {status === 'ready' && (
            <span className="map-header__stats">
              {nodeCount} objects · {edgeCount} connections
            </span>
          )}
        </div>
        <div className="map-header__hint">
          Hover / click nodes · Drag · Scroll to zoom · Drag canvas to pan
        </div>
      </header>

      {/* Body: canvas + panel */}
      <div className="map-body">
        {/* ── Left: Canvas ── */}
        <div className="map-canvas-wrap">
          {status === 'loading' && (
            <div className="map-overlay">
              <div className="map-spinner" />
              <p>Loading memory graph…</p>
            </div>
          )}
          {status === 'empty' && (
            <div className="map-overlay">
              <p className="map-overlay__title">No objects yet</p>
              <p>Analyze some conversations first to build your memory graph.</p>
            </div>
          )}
          {status === 'error' && (
            <div className="map-overlay">
              <p className="map-overlay__title">Failed to load graph</p>
              <p>Make sure the backend is running on port 4319.</p>
            </div>
          )}

          <canvas
            ref={canvasRef}
            className="map-canvas"
            style={{ display: status === 'ready' ? 'block' : 'none' }}
            onMouseMove={onMouseMove}
            onMouseDown={onMouseDown}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseUp}
            onWheel={onWheel}
          />

          {/* Hover tooltip */}
          {tooltip && (
            <div
              className="map-tooltip"
              style={{ left: tooltip.x + 16, top: tooltip.y - 8 }}
              aria-live="polite"
            >
              <strong>{tooltip.name}</strong>
              <span>{typeLabel(tooltip.type)}</span>
              <span>×{tooltip.mentions} mention{tooltip.mentions !== 1 ? 's' : ''}</span>
            </div>
          )}

          {/* Legend */}
          {status === 'ready' && usedTypes.length > 0 && (
            <div className="map-legend">
              {usedTypes.map((t) => (
                <div key={t} className="map-legend__item">
                  <span className="map-legend__dot" style={{ background: nodeColor(t) }} />
                  {typeLabel(t)}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Right: Data Panel ── */}
        {status === 'ready' && (
          <aside className="map-panel" aria-label="Graph data panel">
            {/* Stat cards */}
            <div className="map-panel__stats">
              <div className="map-stat-card">
                <span className="map-stat-card__value">{nodeCount}</span>
                <span className="map-stat-card__label">Objects</span>
              </div>
              <div className="map-stat-card">
                <span className="map-stat-card__value">{edgeCount}</span>
                <span className="map-stat-card__label">Connections</span>
              </div>
              <div className="map-stat-card">
                <span className="map-stat-card__value">{allTypes.length}</span>
                <span className="map-stat-card__label">Types</span>
              </div>
            </div>

            {/* Type breakdown pills */}
            <div className="map-panel__type-row">
              {typeBreakdown.map(({ type, count }) => (
                <button
                  key={type}
                  className={`map-type-pill${typeFilter === type ? ' map-type-pill--active' : ''}`}
                  style={{ '--pill-color': nodeColor(type) } as React.CSSProperties}
                  onClick={() => setTypeFilter((prev) => prev === type ? 'all' : type)}
                  title={`Filter by ${typeLabel(type)}`}
                >
                  <span className="map-type-pill__dot" style={{ background: nodeColor(type) }} />
                  {typeLabel(type)}
                  <span className="map-type-pill__count">{count}</span>
                </button>
              ))}
            </div>

            {/* Filters row */}
            <div className="map-panel__filters">
              <input
                className="map-filter-input"
                type="search"
                placeholder="Search objects or connections…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search"
              />
              {tab === 'connections' && (
                <select
                  className="map-filter-select"
                  value={relFilter}
                  onChange={(e) => setRelFilter(e.target.value)}
                  aria-label="Filter by relationship type"
                >
                  <option value="all">All relationships</option>
                  {allRelTypes.map((r) => (
                    <option key={r} value={r}>{relLabel(r)}</option>
                  ))}
                </select>
              )}
              {(typeFilter !== 'all' || relFilter !== 'all' || search) && (
                <button
                  className="map-filter-clear"
                  onClick={() => { setTypeFilter('all'); setRelFilter('all'); setSearch(''); }}
                  aria-label="Clear filters"
                >
                  ✕ Clear
                </button>
              )}
            </div>

            {/* Tab switcher */}
            <div className="map-panel__tabs" role="tablist">
              <button
                role="tab"
                aria-selected={tab === 'objects'}
                className={`map-tab${tab === 'objects' ? ' map-tab--active' : ''}`}
                onClick={() => setTab('objects')}
                id="tab-objects"
              >
                Objects
                <span className="map-tab__count">{filteredObjects.length}</span>
              </button>
              <button
                role="tab"
                aria-selected={tab === 'connections'}
                className={`map-tab${tab === 'connections' ? ' map-tab--active' : ''}`}
                onClick={() => setTab('connections')}
                id="tab-connections"
              >
                Connections
                <span className="map-tab__count">{filteredEdges.length}</span>
              </button>
            </div>

            {/* Tables */}
            <div className="map-panel__table-wrap" role="tabpanel">
              {tab === 'objects' ? (
                filteredObjects.length === 0 ? (
                  <div className="map-panel__empty">No objects match your filters.</div>
                ) : (
                  <table className="map-table" aria-label="Objects table">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Type</th>
                        <th title="Mention count">×</th>
                        <th title="Connection count">↔</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredObjects.map((node) => (
                        <tr
                          key={node.id}
                          className={`map-table__row${selectedId === node.id ? ' map-table__row--selected' : ''}`}
                          onClick={() => centerOnNode(node.id)}
                          title={`Click to highlight "${node.name}" in the graph`}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => e.key === 'Enter' && centerOnNode(node.id)}
                        >
                          <td className="map-table__name">
                            <span
                              className="map-table__dot"
                              style={{ background: nodeColor(node.type) }}
                            />
                            {node.name}
                          </td>
                          <td className="map-table__type" style={{ color: nodeColor(node.type) }}>
                            {typeLabel(node.type)}
                          </td>
                          <td className="map-table__num">{node.mention_count}</td>
                          <td className="map-table__num">{connCount.get(node.id) ?? 0}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )
              ) : (
                filteredEdges.length === 0 ? (
                  <div className="map-panel__empty">No connections match your filters.</div>
                ) : (
                  <table className="map-table" aria-label="Connections table">
                    <thead>
                      <tr>
                        <th>Source</th>
                        <th>→</th>
                        <th>Target</th>
                        <th>Rel</th>
                        <th title="Confidence">%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredEdges.map((edge) => {
                        const srcNode = panelNodes.find((n) => n.id === edge.source);
                        const tgtNode = panelNodes.find((n) => n.id === edge.target);
                        const isSourceSel = selectedId === edge.source;
                        const isTargetSel = selectedId === edge.target;
                        return (
                          <tr
                            key={edge.id}
                            className={`map-table__row${(isSourceSel || isTargetSel) ? ' map-table__row--selected' : ''}`}
                            title="Click source or target to highlight in graph"
                          >
                            <td
                              className="map-table__name map-table__clickable"
                              onClick={() => edge.source && centerOnNode(edge.source)}
                              role="button"
                              tabIndex={0}
                              onKeyDown={(e) => e.key === 'Enter' && centerOnNode(edge.source)}
                            >
                              <span
                                className="map-table__dot"
                                style={{ background: nodeColor(srcNode?.type ?? '') }}
                              />
                              {nodeNameMap.get(edge.source) ?? '—'}
                            </td>
                            <td className="map-table__arrow">→</td>
                            <td
                              className="map-table__name map-table__clickable"
                              onClick={() => edge.target && centerOnNode(edge.target)}
                              role="button"
                              tabIndex={0}
                              onKeyDown={(e) => e.key === 'Enter' && centerOnNode(edge.target)}
                            >
                              <span
                                className="map-table__dot"
                                style={{ background: nodeColor(tgtNode?.type ?? '') }}
                              />
                              {nodeNameMap.get(edge.target) ?? '—'}
                            </td>
                            <td className="map-table__rel">{relLabel(edge.type)}</td>
                            <td className="map-table__conf">
                              <span className="map-conf-bar-wrap">
                                <span
                                  className="map-conf-bar"
                                  style={{
                                    width: `${Math.round(edge.confidence * 100)}%`,
                                    background: confBar(edge.confidence),
                                  }}
                                />
                              </span>
                              <span className="map-conf-val">{Math.round(edge.confidence * 100)}</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )
              )}
            </div>

            {/* Selected node detail */}
            {selectedId && (() => {
              const sel = panelNodes.find((n) => n.id === selectedId);
              if (!sel) return null;
              const selEdges = panelEdges.filter(
                (e) => e.source === selectedId || e.target === selectedId,
              );
              return (
                <div className="map-panel__detail">
                  <div className="map-panel__detail-header">
                    <span
                      className="map-panel__detail-dot"
                      style={{ background: nodeColor(sel.type) }}
                    />
                    <strong>{sel.name}</strong>
                    <span className="map-panel__detail-type" style={{ color: nodeColor(sel.type) }}>
                      {typeLabel(sel.type)}
                    </span>
                    <button
                      className="map-panel__detail-close"
                      onClick={() => setSelectedId(null)}
                      aria-label="Deselect"
                    >
                      ✕
                    </button>
                  </div>
                  <div className="map-panel__detail-meta">
                    <span>×{sel.mention_count} mention{sel.mention_count !== 1 ? 's' : ''}</span>
                    <span>·</span>
                    <span>{selEdges.length} connection{selEdges.length !== 1 ? 's' : ''}</span>
                  </div>
                  {selEdges.length > 0 && (
                    <ul className="map-panel__detail-rels">
                      {selEdges.map((e) => {
                        const isSource = e.source === selectedId;
                        const otherId  = isSource ? e.target : e.source;
                        const otherName = nodeNameMap.get(otherId) ?? '—';
                        const otherNode = panelNodes.find((n) => n.id === otherId);
                        return (
                          <li key={e.id}>
                            {isSource ? (
                              <>
                                <span className="map-detail-rel__label">{relLabel(e.type)}</span>
                                <button
                                  className="map-detail-rel__name"
                                  style={{ color: nodeColor(otherNode?.type ?? '') }}
                                  onClick={() => centerOnNode(otherId)}
                                >
                                  {otherName}
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  className="map-detail-rel__name"
                                  style={{ color: nodeColor(otherNode?.type ?? '') }}
                                  onClick={() => centerOnNode(otherId)}
                                >
                                  {otherName}
                                </button>
                                <span className="map-detail-rel__label">{relLabel(e.type)}</span>
                                <span className="map-detail-rel__direction">→ me</span>
                              </>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              );
            })()}
          </aside>
        )}
      </div>
    </div>
  );
}
