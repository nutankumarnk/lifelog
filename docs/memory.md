# Memory

Lifelog's memory philosophy: what is kept, what is authoritative, and why the
distinction between the two decides almost every other design question.

---

## The founding rule

> **The original conversation is the source of truth.
> Everything extracted from it is an interpretation.**

`conversations.raw_text` is written before analysis begins, byte for byte, and is
never edited, normalised, truncated or regenerated. If every other table were
dropped tomorrow, no user data would be lost — only derived opinions that can be
recomputed.

This is not a storage optimisation. It follows from what Lifelog is for.

A person's life record has a long half-life. Someone may read an entry back in
fifteen years, when the model that produced it is long obsolete and they no
longer remember the day. At that distance, **an error in an interpretation is
recoverable; an error in the record is not.** If the extraction says "met Arun
in Ahmedabad" and the original sentence is gone, there is nothing left to check
it against. So the sentence survives, always, and everything else is understood
to be a reading of it.

Three consequences run through the whole codebase:

1. **Write order.** The conversation is stored first. A failure there fails the
   request. A failure storing the analysis does not — the response returns with
   `persisted: false` and a warning, because losing words is unacceptable and
   losing an interpretation is merely annoying.
2. **Re-analysis is additive.** A better model produces a new `analyses` row, not
   an edit to an old one. Interpretations are versioned; the conversation is not.
3. **Grounding.** Every extraction must trace back to characters the user
   actually typed, because an interpretation that cannot point at its source is
   not an interpretation of anything.

---

## The layers of memory

### 1. The conversation — verbatim, permanent

What the user wrote, plus the context needed to read it later: when it was
written, in which timezone, in what language, from which client.

`occurred_at` matters more than it looks. It is the clock every relative phrase
was resolved against. Without it, "yesterday" is meaningless three years later,
and re-analysis could not reproduce the original resolution.

### 2. The analysis — one reading

One interpretation of one conversation, by one provider, at one moment. It
records which model produced it, whether the reading was degraded, how long it
took, and the complete validated payload as JSON.

A conversation may accumulate several analyses over its life. They do not
compete; the newest is simply the current best reading, and the older ones show
how Lifelog's understanding changed.

### 3. Segments — the pieces

The conversation split into sentences and clauses, with character offsets. Both
the unit an item is attached to and the proof that the split was faithful: the
offsets reconstruct the original exactly.

### 4. Items — the units of life information

Eight types, described in [`glossary.md`](glossary.md). Every item carries:

- **verbatim source text**, the real substring, not the model's copy of it
- **a character span** back into the conversation, when it could be located
- **the raw time phrase and its resolution**, separately
- **entity references**
- **calibrated confidence**, never above 0.95

An item is designed to be readable on its own — "I met Arun in Ahmedabad,
yesterday, with these people" — while remaining traceable to its origin.

### 5. Entities — the things a life is about

People, places, organisations, objects, topics, event names, and things Lifelog
has no category for. Names keep the user's spelling and script; a folded
`normalized_name` exists alongside for comparison.

Within one analysis, mentions of the same thing are merged and surface forms
become aliases. **Across conversations, they are not.** "Arun" in March and
"Arun" in June are two rows today. Cross-conversation identity is Phase 5, and
doing it prematurely would mean guessing that two people with the same name are
the same person — a mistake that silently merges two lives and is very hard to
undo. The `normalized_name` index exists so that resolution can be added without
a migration.

### 6. Temporal information — phrase and resolution, side by side

Both are always stored. `temporal_raw` holds "yesterday"; `occurred_at` holds
Lifelog's resolution of it. The resolution can be wrong. The phrase cannot.

When a phrase is genuinely ambiguous — "kal", "in a few days" — the resolution is
`null` and the phrase stands alone. **An unresolved date is a truthful record; a
guessed one is a fabrication with a timestamp.**

### 7. Relationships — mostly deferred

Today: items link to entities via `item_entities`, with a `role` column reserved
for typed relationships. Not today: person-to-person relationships, entity
timelines, causal or thematic links between memories. That is Phase 5, and the
schema is shaped to accept it — every item and entity carries `conversation_id`
directly, so cross-conversation queries do not need to join through `analyses`.

---

## What Lifelog deliberately does not remember

**Nothing across requests.** Each conversation is analysed independently. There
is no session, no accumulated context, no personalisation. Phase 1 is the reading
engine; recall and continuity are Phases 4 and 6.

**Nothing the user did not say.** No enrichment from external sources, no
inferred facts, no filled-in blanks. If it is not in the text, it is not in the
record.

**Nothing in the logs.** Conversation content never reaches a log line — only
length, word count and a hash. The most sensitive data in the system does not
belong in the least protected place. See
[`privacy-security.md`](privacy-security.md).

---

## Why not store only the extraction

It would be smaller, and it is what most extraction pipelines do. Three reasons
not to:

**Models change.** A better model next year will read the same sentence more
accurately — but only if the sentence still exists. Discarding it freezes the
quality of the record at the quality of today's model.

**Extraction loses tone.** "Finally finished the thing, absolutely wrecked" and
"Completed the task; feeling tired" carry the same items and are not the same
memory. The voice is in the original.

**Verification.** Without the source, a user reading a memory has no way to tell
whether Lifelog got it right, and no way to correct it.

## Why not store only the conversation

Also tempting — it is the true record, after all. But a life record that can only
be re-read chronologically is a text file. Structure is what makes it possible to
ask "when did I last see Arun", to be reminded at the right moment, and to
connect a decision to the event that prompted it. The structure is the product;
the text is the ground it stands on.

---

## Future memory architecture

Directional, not committed. See [`roadmap.md`](roadmap.md).

- **Phase 2 — Memory storage.** Read APIs over stored memories, and feeding a
  follow-up answer back into an existing conversation.
- **Phase 4 — Recall.** Answering `ASK` intent from stored data. Requires search:
  probably Postgres full-text first, embeddings later, both over the same tables.
- **Phase 5 — Relationships.** Cross-conversation entity identity, typed links,
  entity timelines. The `role` column and the `normalized_name` index are the
  seams.
- **Phase 6 — Personalisation.** Learning that this user's "the usual place"
  means one specific café. This is where a personal memory model becomes more
  valuable than a larger general one.
- **Phase 8 — Ownership.** Export, deletion, encryption at rest. A life record
  the user cannot take with them or delete is not really theirs.

Every one of those is additive. None requires changing what a conversation is,
which is the point of making the conversation the source of truth in the first
place.
