# Roadmap

Where Lifelog is going, and where it is now.

Status labels: **PLANNED** · **IN PROGRESS** · **COMPLETED** · **CANCELLED** ·
**CHANGED**

The order below is dependency order, not a schedule. Nothing here carries a date,
because a phase is done when its definition of done is met.

---

## Phase 1 — Conversation Understanding · **COMPLETED**

Read a message, understand it as structured life information, store both.

Delivered: the analysis contract, the model-independent intelligence layer, the
AI provider abstraction with an offline fallback, PostgreSQL persistence, the
HTTP API, 153 tests covering the 20 required scenarios, a React test console, the
secrets subsystem, and this documentation system.

Explicitly not delivered: recall, cross-conversation identity, notifications,
authentication. See [`functionality.md`](functionality.md) for the exact line.

Definition of done and its verification: [`implementation.md`](implementation.md).

---

## Phase 2 — Memory Storage · **PLANNED**

Turn one-shot analysis into a memory that persists and can be read back.

- Read endpoints: list conversations, fetch one with its analysis
- Answer a follow-up question and merge the answer into the existing conversation
- Re-analyse a stored conversation with a newer model, additively
- Correction handling: `CORRECT` intent amends a previous record instead of
  creating a contradictory one

**Depends on:** Phase 1.
**Schema impact:** none expected. `follow_ups.answered_at` and multiple
`analyses` rows per conversation already exist for this.

## Phase 3 — Events, Tasks and Reminders · **PLANNED**

Make the extracted items actionable.

- Task lifecycle: complete, cancel, reopen
- A timeline view over `(type, occurred_at)`
- Reminder scheduling and delivery — the first background work in the project
- Timezone-correct resolution (Phase 1 stores the zone but computes in UTC)
- Recurrence expansion ("every Monday" becomes occurrences)

**Depends on:** Phase 2.
**Note:** this is where the task/reminder distinction stops being a data
modelling nicety and starts sending notifications to a real person. Revisit
[`decision.md` D-008](decision.md) before implementing delivery.
**Likely new infrastructure:** a job queue, which is the trigger to revisit
[D-011 (no Redis)](decision.md).

## Phase 4 — Memory Recall · **PLANNED**

Answer `ASK` intent, which Phase 1 detects and deliberately does not act on.

- Search over stored memories: Postgres full-text first, embeddings if it is not
  enough
- Question answering grounded in stored data, with citations back to the original
  conversation
- Temporal queries: "what did I do last March?"

**Depends on:** Phase 2.
**Principle to hold:** an answer must cite the conversation it came from. Recall
that cannot point at its source is the same failure grounding was built to
prevent, one layer up.

## Phase 5 — Memory Relationships · **PLANNED**

Connect memories to each other.

- Cross-conversation entity identity — "Arun" in March and "Arun" in June become
  one person
- Typed relationships via `item_entities.role` (participant, location, organiser)
- Entity timelines: everything involving one person or place
- Links between related memories

**Depends on:** Phase 4.
**Risk:** merging two people who share a name is very hard to undo. Identity
resolution must be reversible and should prefer leaving entities separate when
uncertain — the same asymmetry as grounding.
**Seams already in place:** the `normalized_name` index and the `role` column.

## Phase 6 — Personalisation · **PLANNED**

Learn this specific user's language.

- Per-user vocabulary: "the usual place", "mom", "the office"
- Learned entity aliases and relations
- Adapted follow-up behaviour based on what this user answers or ignores

**Depends on:** Phase 5.
**Note:** this is where a small model with a personal memory beats a large model
without one — and the point at which self-hosted inference becomes attractive
enough to reconsider the provider entirely.

## Phase 7 — Proactive Intelligence · **PLANNED**

Lifelog speaks first.

- Surfacing relevant memories at the right moment
- Patterns across time
- Suggestions the user did not ask for

**Depends on:** Phase 6.
**Caution:** every earlier phase is built on restraint — ask rarely, never invent,
never notify without being asked. This phase is in tension with all of it and
should be built slowly, opt-in, and reversible. A tool that becomes noisy stops
being used regardless of how good the insight was.

## Phase 8 — Authentication, Sync and Backup · **PLANNED**

Make it safe to hold real data.

- Accounts, authentication, per-user data isolation on every query
- Encryption at rest, including application-level encryption for `raw_text`
- Export and verifiable deletion
- Multi-device sync
- Key rotation and audit logging

**Depends on:** Phase 2 at minimum.
**Schema impact:** `conversations.user_id` already exists for exactly this, so
adding users does not require a destructive migration on the source of truth.
**Blocking:** Lifelog must not hold real personal data at scale before this ships.
See [`security-checklist.md`](security-checklist.md).

## Phase 9 — Production Infrastructure · **PLANNED**

- Containerised deployment, TLS termination
- Managed secret storage, replacing the local keys file
- Encrypted backups with tested restores
- Metrics, tracing and alerting (`ai_invocations` already holds the raw material)
- `npm audit` and the secret scanner as required CI checks
- Shared rate limiting across instances

**Depends on:** Phase 8.

---

## The mobile application

Not a numbered phase, because it is a client rather than a capability. It will
consume the same API the test console does — which is why the Phase 1 contract is
treated as important and why the React console is explicitly disposable.

Earliest sensible point: after Phase 3, when there is something worth carrying
around. It must not ship before Phase 8.

---

## Direction changes

None yet. When a phase changes shape or is cancelled, record it here with the
reason, and add a decision entry. Do not silently rewrite a phase — the fact that
the plan changed is itself information.

| Date | Change | Reason |
| --- | --- | --- |
| — | — | — |

---

## What is deliberately not planned

| Not planned | Why |
| --- | --- |
| Multi-user shared memories | Lifelog is a personal record. Sharing changes the privacy model completely and would need its own design from the ground up. |
| Social features | Same. |
| Training a model on user conversations | A life record is not a training corpus. If this is ever revisited, it requires explicit, revocable, per-user consent and a decision entry arguing the case. |
| Advertising or data monetisation | Incompatible with the product. |
| A general-purpose chatbot | The model is a component. Lifelog is not a conversation partner. |
