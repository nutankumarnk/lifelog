# Connection Map

The Connection Map is Lifelog's persistent visual network of the identifiable
people, places, projects, organizations, events, and objects mentioned across a
user's journal entries.

This document defines the product behavior, AI contract, validation rules,
persistence flow, API, and frontend implementation.

---

## Product rule

> A direct edge requires direct evidence from the user's text.

Entities appearing in the same entry are not automatically connected. Shared
entities create an indirect graph path, not proof of a direct relationship.

For example:

1. `Today I met Rahul at Madras Cafe and we discussed Lifelog.`
2. `Today I met Maya at Madras Cafe.`
3. `Today I met Anuj and we discussed Lifelog.`

The resulting network may contain:

```text
Maya ── met_at ── Madras Cafe ── met_at ── Rahul
Anuj ── discussed ── Lifelog ── discussed ── Rahul
```

Maya is indirectly connected to Rahul through Madras Cafe. Anuj is indirectly
connected to Rahul through Lifelog. Lifelog must not claim that Maya knows Rahul
or that Anuj works with Rahul unless another entry explicitly supports it.

---

## Graph vocabulary

### Node types

| Public type | Stored type | Examples |
| --- | --- | --- |
| Person | `person` | Rahul, Maya, Anuj |
| Place | `place` | Mumbai, Madras Cafe, a hotel |
| Project | `project` | Lifelog |
| Organization | `organization` | A company, club, institution |
| Event | `event` | A meeting, conference, trip |
| Object | `physical_object` | A meaningful device or physical item |
| Other | `other_entity` | An identity-bearing entity outside the taxonomy |

Tasks, reminders, decisions, feelings, notes, conversations, goals, and generic
memories are not Connection Map nodes. They remain in their existing Lifelog
modules.

### Relationship matrix

The backend matrix is authoritative. The AI may suggest a relationship, but a
suggestion outside this matrix is rejected.

| Source | Target | Allowed relationships |
| --- | --- | --- |
| Person | Person | `knows`, `met_with`, `works_with`, `related_to` |
| Person | Place | `met_at`, `visited`, `lives_in`, `works_at` |
| Person | Project | `discussed`, `works_on` |
| Person | Organization | `discussed`, `works_at`, `member_of` |
| Person | Event | `participated_in` |
| Project | Organization | `belongs_to` |
| Project | Place | `located_at` |
| Project | Event | `related_to` |
| Project | Object | `uses` |
| Event | Place | `happened_at` |
| Event | Project | `related_to` |
| Event | Person | `participated_in` |
| Event | Object | `uses` |
| Organization | Place | `located_at` |
| Object | Place | `located_at` |

Relationship definitions live in
[`connection-matrix.ts`](../backend/src/modules/connection-map/connection-matrix.ts).

---

## AI extraction contract

The model returns entities and direct connection suggestions in the same
analysis response:

```json
{
  "entities": [
    {
      "id": "e1",
      "kind": "PERSON",
      "name": "Rahul",
      "confidence": 0.96
    },
    {
      "id": "e2",
      "kind": "PLACE",
      "name": "Madras Cafe",
      "confidence": 0.94
    },
    {
      "id": "e3",
      "kind": "PROJECT",
      "name": "Lifelog",
      "confidence": 0.91
    }
  ],
  "connections": [
    {
      "source_entity_id": "e1",
      "target_entity_id": "e2",
      "relationship_type": "met_at",
      "evidence": "met Rahul at Madras Cafe",
      "confidence": 0.93
    },
    {
      "source_entity_id": "e1",
      "target_entity_id": "e3",
      "relationship_type": "discussed",
      "evidence": "we discussed Lifelog",
      "confidence": 0.90
    }
  ]
}
```

Rules for model output:

- Entity IDs are temporary and valid only within the analysis.
- `evidence` must be an exact substring of the original conversation.
- Only direct relationships stated or unambiguously supported by the text are
  emitted.
- `works_on` is used only when the text says the person works on the project;
  discussing a project is `discussed`.
- If evidence is weak, the model emits no connection.
- The model never creates database IDs or decides whether a connection is valid.

The prompt is maintained in
[`prompt.ts`](../backend/src/intelligence/prompt.ts). Provider output is repaired
and grounded in
[`normalize.ts`](../backend/src/intelligence/normalize.ts).

---

## Processing flow

```text
User entry
  → AI extracts entities, items, and possible direct connections
  → normalizer repairs IDs and verifies verbatim evidence
  → object resolver reuses or creates persistent entities
  → Connection Matrix validates type + direction + relationship
  → confidence threshold rejects weak suggestions
  → accepted objects, origins, and relationships are stored
  → graph endpoint returns a bounded node/edge snapshot
  → Sigma.js renders the interactive network
```

The original conversation remains the source of truth. Derived graph data can be
rebuilt when extraction or validation improves.

### Validation guarantees

Before persistence, the backend verifies that:

- Both source and target entities exist.
- The source and target are different objects.
- The relationship type is in the matrix for that ordered type pair.
- Confidence is at least `0.50`.
- The supporting evidence came from the original entry.
- Duplicate relationships in the same batch are suppressed.
- Repeated entities are resolved using normalized type and name.

The main orchestration lives in
[`connection-builder.ts`](../backend/src/memory/connection-builder.ts) and
[`memory.service.ts`](../backend/src/services/memory.service.ts).

---

## Persistence

The Connection Map uses PostgreSQL rather than a dedicated graph database.

### `memory_objects`

Stores canonical graph nodes, their type, display name, normalized name,
attributes, first/last-seen timestamps, and mention count.

### `object_origins`

Connects a graph node back to the conversation, analysis, entity, or item that
created or mentioned it.

### `object_relationships`

Stores accepted directed edges, relationship type, confidence, source
conversation, evidence attributes, and timestamps.

The tables are defined in
[`schema.ts`](../backend/src/db/schema.ts). All graph queries live in
[`memory.repository.ts`](../backend/src/repositories/memory.repository.ts).

---

## Graph API

### `GET /api/v1/memory/graph`

Returns nodes and relationships for visualization.

Query parameters:

| Parameter | Default | Maximum | Meaning |
| --- | ---: | ---: | --- |
| `limit` | 500 | 1,000 | Maximum number of recent graph nodes |

Only relationships whose source and target nodes are both present in the
response are returned.

```json
{
  "objects": [
    {
      "id": "uuid",
      "type": "person",
      "name": "Rahul",
      "mention_count": 2,
      "attributes": {}
    }
  ],
  "relationships": [
    {
      "id": "uuid",
      "source_object_id": "uuid",
      "target_object_id": "uuid",
      "relationship_type": "met_at",
      "confidence": 0.93,
      "source_conversation_id": "uuid",
      "attributes": {
        "evidence": "met Rahul at Madras Cafe"
      }
    }
  ]
}
```

See [`api.md`](api.md) for the complete HTTP contract.

---

## Frontend visualization

The map uses:

- **Sigma.js** for WebGL graph rendering.
- **Graphology** for the client-side graph model.
- **ForceAtlas2** in a Web Worker for the organic brain-map layout.
- **React Sigma** for lifecycle, camera, events, and controls.

The implementation is in
[`ConnectionMap.tsx`](../frontend/src/components/ConnectionMap.tsx).

### Visual encoding

| Visual property | Meaning |
| --- | --- |
| Dot | One persistent entity |
| Dot color | Entity type |
| Dot size | Mention frequency |
| Line | Direct validated relationship |
| Line strength | Relationship confidence |
| Dimmed neighborhood | Outside the hovered or selected entity's direct connections |

Entity colors:

| Type | Color |
| --- | --- |
| Person | Cyan |
| Place | Lime |
| Project | Purple |
| Organization | Amber |
| Event | Rose |
| Object | Orange |
| Other | Slate |

### Supported interactions

- Pan and zoom.
- Fullscreen mode.
- Search and focus by entity name.
- Filter by entity type.
- Hover to highlight the immediate neighborhood.
- Click a node to view mention and connection counts.
- Navigate between directly connected entities from the detail panel.
- Refresh the persisted graph without reloading the application.

---

## Privacy and integrity

Connection data can reveal sensitive relationships and locations. Before any
public or multi-user deployment:

- Authentication and per-user authorization must protect every graph route.
- Queries must always be scoped to the authenticated user's graph.
- AI provider and retention settings must match the product privacy policy.
- Deleting an entry must remove or recompute graph claims supported only by that
  entry.
- Ambiguous names must not be silently merged.

Phase 1 remains an unauthenticated local environment and must not be exposed as a
public service.

---

## Known limitations and next steps

- Cross-conversation resolution currently uses conservative normalized
  type/name matching; user-facing merge and split tools are not implemented.
- A relationship currently exposes its persisted source conversation rather
  than a complete history of every supporting mention.
- Historic entries created before analysis schema `1.2.0` need re-analysis to
  gain richer direct relationships.
- The graph endpoint returns a bounded recent snapshot, not cursor-based graph
  traversal.
- Indirect-path explanations and temporal playback are future enhancements.

These limitations do not change the core guarantee: a rendered direct edge has
passed grounding, confidence, and Connection Matrix validation.

---

## Verification

Automated coverage includes:

- Every allowed and forbidden Connection Matrix combination.
- Forbidden node types.
- Confidence threshold enforcement.
- Duplicate and self-reference rejection.
- Explicit person-to-place extraction.
- Object reuse across conversations.
- Graph API node and edge output.
- Full backend integration behavior with PostgreSQL.

Run verification with:

```bash
npm run typecheck --workspace backend
npm run build --workspace frontend
npm test
```
