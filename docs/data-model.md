# Data Model

Eight tables. One idea governs all of them:

> **`conversations.raw_text` is the source of truth. Everything else is an
> interpretation.**

If every table except `conversations` were dropped, no user data would be lost —
only derived opinions that can be recomputed. That is why the raw text is written
first, never edited, and why re-analysis adds an `analyses` row instead of
replacing one.

Schema: [`backend/src/db/schema.ts`](../backend/src/db/schema.ts).
Migrations: `backend/drizzle/`. **Update this document whenever the schema
changes.**

---

## Shape

```
conversations  (source of truth, append-only)
    │
    ├──< analyses            one interpretation, by one provider, at one time
    │        │
    │        ├──< segments   the conversation split into pieces
    │        ├──< entities   people, places, organisations, unknowns
    │        ├──< items      the units of life information
    │        │       │
    │        │       └──< item_entities >──┐
    │        │                             │
    │        │        ┌────────────────────┘
    │        │        └─ entities
    │        └──< follow_ups
    │
    └──< ai_invocations      one row per model call, for observability
```

Every child of an analysis also carries `conversation_id` directly. That
denormalisation is deliberate: Phase 2 onward will query "all items for this
conversation" and "every entity named X" far more often than it will join through
`analyses`, and the redundancy is safe because both foreign keys cascade from the
same root.

---

## conversations

The immutable record of what the user actually said.

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | uuid PK | no | Random default |
| `user_id` | uuid | **yes** | Always null in Phase 1. Exists so Phase 8 can add users without a destructive migration. |
| `raw_text` | text | no | **Verbatim. Never edited, normalised or truncated.** |
| `char_count` | integer | no | Denormalised so length queries need no scan |
| `language` | varchar(32) | yes | Detected tag, or `mixed`. Written after analysis. |
| `occurred_at` | timestamptz | no | Client wall clock. The reference time every relative phrase was resolved against. |
| `timezone` | varchar(64) | yes | IANA zone. Stored, not yet applied to arithmetic. |
| `source` | varchar(32) | no | `api` today |
| `client_meta` | jsonb | no | Free-form client info. Never trusted. |
| `created_at` | timestamptz | no | |

**Indexes:** `created_at`; `(user_id, created_at)` for the timeline query Phase 8
will need.

`occurred_at` matters more than it looks: without it, "yesterday" is meaningless
three years later, and a re-analysis could not reproduce the original resolution.

## analyses

One reading of one conversation. A conversation may accumulate several over its
life; they do not compete, the newest is simply the current best reading.

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | uuid PK | no | |
| `conversation_id` | uuid FK → conversations | no | `ON DELETE CASCADE` |
| `schema_version` | varchar(16) | no | Which analysis contract produced this |
| `intent` | varchar(32) | no | |
| `intent_confidence` | double | no | Default 0.5 |
| `summary` | text | no | |
| `provider` | varchar(32) | no | `openrouter` / `local` / `mock` |
| `model` | varchar(128) | no | |
| `degraded` | boolean | no | A fallback provider answered |
| `latency_ms` | integer | no | |
| `analysis` | jsonb | no | **The whole validated payload.** Reading one conversation back needs a single row. |
| `warnings` | jsonb | no | What the pipeline overrode, dropped or repaired |
| `created_at` | timestamptz | no | |

**Indexes:** `conversation_id`, `intent`, `created_at`.

### Why store the analysis both as JSON and as rows

They answer different questions, and both are worth the duplication:

- **The JSON blob** reconstructs one analysis exactly, in one read, with no
  joins. It is also insurance: if a future schema change loses a nuance in the
  columns, the original payload is still there.
- **The child tables** answer questions *across* conversations — "every task due
  this week", "every mention of Arun" — which is the whole point of extracting
  structure and is impossible over blobs without scanning everything.

The blob is authoritative for a single analysis; the rows are a queryable
projection of it. They are written in the same transaction, so they cannot
disagree.

## segments

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | uuid PK | no | |
| `analysis_id` | uuid FK → analyses | no | Cascade |
| `conversation_id` | uuid FK → conversations | no | Cascade |
| `position` | integer | no | Order within the conversation |
| `text` | text | no | |
| `span_start` / `span_end` | integer | no | Character offsets into `raw_text` |
| `created_at` | timestamptz | no | |

**Indexes:** unique `(analysis_id, position)`; `conversation_id`.

The offsets are the proof that segmentation was faithful — the original can be
reconstructed from them exactly.

## entities

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | uuid PK | no | |
| `analysis_id` | uuid FK | no | Cascade |
| `conversation_id` | uuid FK | no | Cascade |
| `local_id` | varchar(32) | no | `e1`, `e2` — the id used inside the JSON payload |
| `kind` | varchar(32) | no | `PERSON`, `PLACE`, …, `OTHER` |
| `raw_kind` | varchar(64) | **yes** | The model's own label when `kind` had to widen to `OTHER`. **This is how a custom entity type survives.** |
| `name` | text | no | The user's spelling and script, untouched |
| `normalized_name` | text | no | Case/punctuation-folded, for comparison only |
| `relation` | varchar(64) | yes | "brother", "manager", "dentist" |
| `aliases` | jsonb | no | Other surface forms in this conversation |
| `attributes` | jsonb | no | Open bag for future enrichment |
| `mentions` | jsonb | no | Array of `{start, end}` spans |
| `confidence` | double | no | |
| `created_at` | timestamptz | no | |

**Indexes:** unique `(analysis_id, local_id)`; `normalized_name`; `kind`;
`conversation_id`.

The `normalized_name` index is the seam for Phase 5. Cross-conversation identity
does not exist yet — "Arun" in March and "Arun" in June are two rows — because
merging two people who share a name is very hard to undo. When resolution is
built, the index is already there.

## items

The units of life information.

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | uuid PK | no | |
| `analysis_id` | uuid FK | no | Cascade |
| `conversation_id` | uuid FK | no | Cascade |
| `local_id` | varchar(32) | no | `i1`, `i2` |
| `type` | varchar(32) | no | One of the eight item types |
| `title` | text | no | |
| `summary` | text | no | |
| `source_text` | text | no | **Verbatim substring. Proof the item is grounded.** |
| `span_start` / `span_end` | integer | **yes** | Null for a paraphrase that could not be located |
| `segment_position` | integer | yes | Which segment it came from |
| `tense` | varchar(16) | no | `PAST` / `PRESENT` / `FUTURE` / `UNSPECIFIED` |
| `temporal_raw` | text | yes | **What the user literally said**: "yesterday" |
| `occurred_at` | timestamptz | **yes** | Lifelog's resolution. Null when the phrase was ambiguous — resolution is allowed to fail. |
| `occurred_end_at` | timestamptz | yes | For ranges |
| `temporal_precision` | varchar(16) | no | `EXACT_TIME` … `NONE` |
| `recurrence` | text | yes | "every monday" — recorded, not yet expanded |
| `details` | jsonb | no | Type-specific: status, priority, emotion, sentiment, trigger_at, alternatives, significance |
| `confidence` | double | no | Calibrated, never above 0.95 |
| `created_at` | timestamptz | no | |

**Indexes:** unique `(analysis_id, local_id)`; `type`; `conversation_id`;
`occurred_at`; `(type, occurred_at)`.

That last composite index is the one Phase 3 lives on: "open tasks due this
week", "reminders to fire today".

**`temporal_raw` and `occurred_at` are both kept, always.** The resolution can be
wrong; the phrase never is. A null `occurred_at` next to a non-null
`temporal_raw` is a truthful record of an ambiguous phrase, not missing data.

`details` is JSON rather than columns because the fields are sparse and
type-specific — a `priority` column would be null for every feeling, and every
new item type would need a migration. The trade-off accepted is that these fields
are not indexable without an expression index; when a query needs one, add it.

## item_entities

Which entities take part in which item.

| Column | Type | Notes |
| --- | --- | --- |
| `item_id` | uuid FK → items | Cascade |
| `entity_id` | uuid FK → entities | Cascade |
| `role` | varchar(32) | Default `mentioned`. **Reserved for Phase 5** typed relationships (participant, location, organiser). |

Primary key `(item_id, entity_id)`; index on `entity_id` for the reverse lookup
("everything involving Arun").

## follow_ups

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | uuid PK | no | |
| `analysis_id` | uuid FK | no | Cascade |
| `conversation_id` | uuid FK | no | Cascade |
| `question` | text | no | |
| `reason` | text | no | Why it was worth asking |
| `missing_fields` | jsonb | no | |
| `blocking` | boolean | no | The user's intent cannot be honoured without an answer |
| `answered_at` | timestamptz | **yes** | Set when Phase 2 feeds an answer back |
| `created_at` | timestamptz | no | |

At most one row per analysis, by the follow-up rule in
[`algorithm.md`](algorithm.md). A table rather than a column because Phase 2 will
need answers, timestamps and possibly a thread.

## ai_invocations

One row per model call. Observability only; nothing reads it at runtime.

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | uuid PK | no | |
| `conversation_id` | uuid FK | yes | Cascade |
| `provider` / `model` | varchar | no | |
| `status` | varchar(16) | no | `ok` / `error` |
| `attempt` | integer | no | Which retry this was |
| `latency_ms` | integer | no | |
| `prompt_tokens` / `completion_tokens` | integer | yes | When the provider reports them |
| `error_code` | varchar(64) | yes | **Error class only. Never the prompt, never the key, never the response.** |
| `created_at` | timestamptz | no | |

**Indexes:** `created_at`, `status`.

---

## Conventions

**UUID primary keys**, generated by the database. Sequential integers would leak
volume and make future multi-device sync harder.

**`timestamptz` everywhere.** A life record spans timezones by nature; a naive
timestamp is a bug waiting to happen.

**Local ids alongside UUIDs.** `local_id` (`e1`, `i3`) joins items to entities
*inside* the JSON payload; the UUID is the database identity. Lifelog assigns
local ids itself and never trusts the model's numbering, because a duplicated or
dangling id silently corrupts links.

**Cascades from `conversations`.** Deleting a conversation removes every
interpretation of it. There is nothing meaningful left without the source.

**Nullability carries meaning.** A null `occurred_at` means "the phrase could not
be resolved", not "no data". A null `span_start` means "paraphrased, not quoted".
A null `raw_kind` means "the kind was recognised". Read them as statements.

**JSON where the shape is open** (`details`, `attributes`, `client_meta`,
`mentions`), columns where it is queried. Do not migrate a field into a column
until a real query needs it.

---

## Transactions

`AnalysisRepository.persist()` writes the analysis, its segments, entities,
items, item-entity links and follow-up **in one transaction**. A half-stored
interpretation — items without their entities — is worse than none, because it
looks complete.

The conversation is written in its own earlier transaction, on purpose. It must
survive even if everything after it fails.

---

## Migrations

Generated with `npm run db:generate`, applied with `npm run db:migrate`.

- Never hand-edit a migration that has already been applied.
- Prefer additive changes. A destructive one needs a decision record.
- Update this document in the same change.
- Two databases exist locally: `lifelog` and `lifelog_test`. The test suite
  truncates its tables between runs, which is why database-backed tests are
  serialised.
