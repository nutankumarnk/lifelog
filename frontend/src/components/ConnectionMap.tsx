import { useEffect, useMemo, useState } from 'react';
import { MultiDirectedGraph } from 'graphology';
import {
  ControlsContainer,
  FullScreenControl,
  SigmaContainer,
  ZoomControl,
  useLoadGraph,
  useRegisterEvents,
  useSigma,
} from '@react-sigma/core';
import { useWorkerLayoutForceAtlas2 } from '@react-sigma/layout-forceatlas2';
import '@react-sigma/core/lib/style.css';
import { fetchGraphData } from '../api';
import type { MemoryGraphData, MemoryObject, MemoryObjectRelationship } from '../types';

const TYPE_COLOR: Record<string, string> = {
  person: '#22d3ee',
  place: '#a3e635',
  project: '#c084fc',
  organization: '#fbbf24',
  event: '#f43f5e',
  physical_object: '#fb923c',
  other_entity: '#94a3b8',
};

const TYPE_LABEL: Record<string, string> = {
  person: 'Person',
  place: 'Place',
  project: 'Project',
  organization: 'Organization',
  event: 'Event',
  physical_object: 'Object',
  other_entity: 'Other',
};

function colorFor(type: string): string {
  return TYPE_COLOR[type] ?? TYPE_COLOR.other_entity!;
}

function GraphLoader({ data }: { data: MemoryGraphData }) {
  const loadGraph = useLoadGraph();

  useEffect(() => {
    const graph = new MultiDirectedGraph();
    for (const [index, node] of data.objects.entries()) {
      const angle = index * 2.399963229728653;
      const radius = Math.sqrt(index + 1);
      graph.addNode(node.id, {
        label: node.name,
        entityType: node.type,
        mentionCount: node.mention_count,
        color: colorFor(node.type),
        size: Math.max(3, Math.min(15, 3 + Math.sqrt(node.mention_count) * 2.3)),
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
      });
    }
    for (const edge of data.relationships) {
      if (!graph.hasNode(edge.source_object_id) || !graph.hasNode(edge.target_object_id)) continue;
      graph.addDirectedEdgeWithKey(edge.id, edge.source_object_id, edge.target_object_id, {
        label: edge.relationship_type.replace(/_/g, ' '),
        relationshipType: edge.relationship_type,
        confidence: edge.confidence,
        color: edge.confidence >= 0.8 ? '#64748b99' : '#47556966',
        size: Math.max(0.5, edge.confidence * 1.6),
      });
    }
    loadGraph(graph);
  }, [data, loadGraph]);

  return null;
}

function ForceLayout({ graphVersion }: { graphVersion: string }) {
  const { start, stop } = useWorkerLayoutForceAtlas2({
    settings: {
      barnesHutOptimize: true,
      gravity: 0.08,
      scalingRatio: 12,
      slowDown: 6,
      strongGravityMode: false,
    },
  });

  useEffect(() => {
    start();
    const timer = window.setTimeout(stop, 5000);
    return () => {
      window.clearTimeout(timer);
      stop();
    };
  }, [graphVersion, start, stop]);

  return null;
}

function GraphInteractions({
  selectedId,
  onSelected,
}: {
  selectedId: string | null;
  onSelected: (id: string | null) => void;
}) {
  const sigma = useSigma();
  const registerEvents = useRegisterEvents();
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const focusedId = hoveredId ?? selectedId;

  useEffect(() => {
    registerEvents({
      enterNode: ({ node }) => setHoveredId(node),
      leaveNode: () => setHoveredId(null),
      clickNode: ({ node }) => onSelected(node),
      clickStage: () => onSelected(null),
    });
  }, [onSelected, registerEvents]);

  useEffect(() => {
    const graph = sigma.getGraph();
    const neighbors = focusedId && graph.hasNode(focusedId)
      ? new Set(graph.neighbors(focusedId))
      : new Set<string>();

    sigma.setSetting('nodeReducer', (node, attributes) => {
      if (!focusedId || node === focusedId || neighbors.has(node)) return attributes;
      return { ...attributes, color: '#273244', label: '', size: Math.max(2, Number(attributes.size) * 0.65) };
    });
    sigma.setSetting('edgeReducer', (edge, attributes) => {
      if (!focusedId || graph.extremities(edge).includes(focusedId)) {
        return focusedId ? { ...attributes, color: '#e2e8f0aa', size: 1.8 } : attributes;
      }
      return { ...attributes, color: '#1f293744', size: 0.3 };
    });
    sigma.refresh();
  }, [focusedId, sigma]);

  return null;
}

function FocusNode({ nodeId }: { nodeId: string | null }) {
  const sigma = useSigma();
  useEffect(() => {
    if (!nodeId || !sigma.getGraph().hasNode(nodeId)) return;
    const display = sigma.getNodeDisplayData(nodeId);
    if (!display) return;
    sigma.getCamera().animate({ x: display.x, y: display.y, ratio: 0.2 }, { duration: 650 });
  }, [nodeId, sigma]);
  return null;
}

export function ConnectionMap() {
  const [data, setData] = useState<MemoryGraphData>({ objects: [], relationships: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const refresh = () => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetchGraphData(controller.signal)
      .then(setData)
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : 'Could not load the graph.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return controller;
  };

  useEffect(() => {
    const controller = refresh();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const query = search.trim().toLowerCase();
    if (!query) return;
    const match = data.objects.find((node) => node.name.toLowerCase().includes(query));
    if (match) setSelectedId(match.id);
  }, [data.objects, search]);

  const filteredData = useMemo(() => {
    const objects = data.objects.filter((node) =>
      (typeFilter === 'all' || node.type === typeFilter)
    );
    const ids = new Set(objects.map((node) => node.id));
    return {
      objects,
      relationships: data.relationships.filter((edge) =>
        ids.has(edge.source_object_id) && ids.has(edge.target_object_id),
      ),
    };
  }, [data, typeFilter]);

  const selected = data.objects.find((node) => node.id === selectedId) ?? null;
  const selectedEdges = selected
    ? data.relationships.filter((edge) => edge.source_object_id === selected.id || edge.target_object_id === selected.id)
    : [];
  const nodeById = new Map(data.objects.map((node) => [node.id, node]));
  const types = [...new Set(data.objects.map((node) => node.type))].sort();
  const graphVersion = `${filteredData.objects.map((node) => node.id).join(',')}|${filteredData.relationships.map((edge) => edge.id).join(',')}`;

  return (
    <main className="connection-map-page">
      <header className="connection-map-header">
        <div>
          <p className="connection-map-eyebrow">Your personal knowledge network</p>
          <h2>Connection Map</h2>
          <p>{data.objects.length} entities · {data.relationships.length} direct connections</p>
        </div>
        <button type="button" className="secondary" onClick={refresh}>Refresh map</button>
      </header>

      <section className="connection-map-toolbar" aria-label="Connection map filters">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search people, places, projects…"
          aria-label="Search graph"
        />
        <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} aria-label="Filter by entity type">
          <option value="all">All entity types</option>
          {types.map((type) => <option key={type} value={type}>{TYPE_LABEL[type] ?? type}</option>)}
        </select>
        <div className="connection-map-legend">
          {Object.entries(TYPE_COLOR).map(([type, color]) => (
            <span key={type}><i style={{ background: color }} />{TYPE_LABEL[type] ?? type}</span>
          ))}
        </div>
      </section>

      <section className="connection-map-workspace">
        <div className="connection-map-canvas">
          {loading && <div className="connection-map-state">Building your map…</div>}
          {error && <div className="connection-map-state connection-map-state--error">{error}</div>}
          {!loading && !error && filteredData.objects.length === 0 && (
            <div className="connection-map-state">No matching connections yet. Add a journal entry with people, places, or projects.</div>
          )}
          {!loading && !error && filteredData.objects.length > 0 && (
            <SigmaContainer
              graph={MultiDirectedGraph}
              className="connection-map-sigma"
              settings={{
                allowInvalidContainer: true,
                defaultNodeColor: '#94a3b8',
                defaultEdgeColor: '#475569',
                enableEdgeEvents: true,
                labelColor: { color: '#e2e8f0' },
                labelDensity: 0.08,
                labelGridCellSize: 120,
                labelRenderedSizeThreshold: 8,
                renderEdgeLabels: false,
                stagePadding: 40,
              }}
            >
              <GraphLoader data={filteredData} />
              <ForceLayout graphVersion={graphVersion} />
              <GraphInteractions selectedId={selectedId} onSelected={setSelectedId} />
              <FocusNode nodeId={selectedId} />
              <ControlsContainer position="bottom-right">
                <ZoomControl />
                <FullScreenControl />
              </ControlsContainer>
            </SigmaContainer>
          )}
        </div>

        <aside className="connection-map-detail">
          {selected ? (
            <>
              <button className="connection-map-detail__close" type="button" onClick={() => setSelectedId(null)}>×</button>
              <span className="connection-map-detail__type" style={{ color: colorFor(selected.type) }}>
                {TYPE_LABEL[selected.type] ?? selected.type}
              </span>
              <h3>{selected.name}</h3>
              <div className="connection-map-stats">
                <div><strong>{selected.mention_count}</strong><span>mentions</span></div>
                <div><strong>{selectedEdges.length}</strong><span>connections</span></div>
              </div>
              <h4>Direct connections</h4>
              <div className="connection-map-neighbors">
                {selectedEdges.length === 0 && <p>No direct connections recorded.</p>}
                {selectedEdges.map((edge) => {
                  const otherId = edge.source_object_id === selected.id ? edge.target_object_id : edge.source_object_id;
                  const other = nodeById.get(otherId);
                  return <ConnectionRow key={edge.id} edge={edge} other={other} onSelect={setSelectedId} />;
                })}
              </div>
            </>
          ) : (
            <div className="connection-map-detail__empty">
              <span>✦</span>
              <h3>Explore a connection</h3>
              <p>Select any dot to reveal its direct relationships. Hovering dims everything outside its immediate neighborhood.</p>
            </div>
          )}
        </aside>
      </section>
    </main>
  );
}

function ConnectionRow({ edge, other, onSelect }: {
  edge: MemoryObjectRelationship;
  other: MemoryObject | undefined;
  onSelect: (id: string) => void;
}) {
  if (!other) return null;
  return (
    <button type="button" onClick={() => onSelect(other.id)}>
      <i style={{ background: colorFor(other.type) }} />
      <span>
        <strong>{other.name}</strong>
        <small>{edge.relationship_type.replace(/_/g, ' ')} · {Math.round(edge.confidence * 100)}%</small>
      </span>
    </button>
  );
}
