/**
 * The model-facing instructions.
 *
 * This file is *how* Lifelog asks a model to do its part. docs/algorithm.md is
 * *what* Lifelog does. They are deliberately separate: the algorithm survives a
 * model swap, this prompt may not.
 *
 * Token-Dense & Compact: Eliminates redundant preambles and keeps the JSON
 * schema and rules crisp to minimize input tokens while maximizing multi-item
 * extraction accuracy for tasks, reminders, and calendar events.
 */
import type { AnalysisRequest } from '../ai/provider.js';

/** IANA zone if valid, otherwise UTC. Invalid zones throw in Intl. */
export function resolveTimeZone(timezone: string | null | undefined): string {
  if (!timezone) return 'UTC';
  try {
    Intl.DateTimeFormat('en-GB', { timeZone: timezone }).format(new Date(0));
    return timezone;
  } catch {
    return 'UTC';
  }
}

/**
 * Human-readable clock for the model. Local to `timezone` so "today" matches
 * what the user means, not the server's UTC day.
 */
export function formatCurrentClock(now: Date, timezone: string | null | undefined): string {
  const zone = resolveTimeZone(timezone);
  const formatted = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'shortOffset',
  }).format(now);
  return `${formatted} (${zone})`;
}

export function buildInstructions(now: Date, timezone: string | null = null): string {
  return `NOW: ${formatCurrentClock(now, timezone)}

Extract structured life data & a natural 1st-person diary entry into ONE minified JSON line:
{"intent":"LOG"|"PLAN"|"CAPTURE_TASK"|"SET_REMINDER"|"REFLECT"|"ASK"|"CORRECT"|"SMALL_TALK"|"UNKNOWN","intent_confidence":0-1,"language":"en"|"mixed"|"…","summary":"≤15 words","journal":{"title":"≤8 words","polished_entry":"Clean natural 1st-person story ('I...'). No brackets/tags.","mood":"Productive"|"Reflective"|"Excited"|"Calm"|"Nostalgic"|"Focused"|"Anxious"|"Neutral","highlights":["key takeaway"]},"entities":[{"id":"e1","kind":"PERSON"|"PLACE"|"PROJECT"|"ORGANIZATION"|"OBJECT"|"TOPIC"|"EVENT_NAME"|"OTHER","raw_kind":null,"name":"exact","relation":null,"confidence":0-1}],"items":[{"id":"i1","type":"MEMORY"|"PAST_EVENT"|"PRESENT_FACT"|"FUTURE_EVENT"|"TASK"|"REMINDER"|"DECISION"|"FEELING","title":"≤8 words","summary":"≤15 words","source_text":"exact substring","temporal":{"raw":"phrase|null"},"entity_ids":["e1"],"details":{},"confidence":0-1}],"connections":[{"source_entity_id":"e1","target_entity_id":"e2","relationship_type":"met_with"|"knows"|"works_with"|"related_to"|"met_at"|"visited"|"lives_in"|"works_at"|"discussed"|"works_on"|"member_of"|"participated_in"|"belongs_to"|"located_at"|"happened_at"|"uses","evidence":"exact substring proving the direct relationship","confidence":0-1}],"missing_information":[],"follow_up":null}

Rules:
1. MULTI-ITEM EXTRACTION: When a message contains an event AND a task AND a reminder (e.g. "Meeting tomorrow at 10am, finish presentation tonight, remind me at 9am"), extract ALL of them as separate items: FUTURE_EVENT ("Meeting tomorrow at 10am"), TASK ("finish presentation tonight"), REMINDER ("remind me at 9am").
2. ITEM TYPES:
   - TASK: Action/todo to do or work on ("need to...", "have to...", "finish...", "buy...", "submit..."). details:{"status":"OPEN","priority":"LOW"|"NORMAL"|"HIGH"|"URGENT"}
   - REMINDER: User requests notification/alert ("remind me...", "ping me...", "alert me..."). details:{"explicit":true,"status":"OPEN"}
   - FUTURE_EVENT / PAST_EVENT: Dated calendar events, meetings, appointments, flights, dinners.
   - MEMORY / PRESENT_FACT: Experiences or standing facts. details:{"significance":0-1}
   - FEELING: Expressed emotion (never inferred). details:{"emotion":"word","sentiment":"POSITIVE"|"NEGATIVE"|"MIXED"|"NEUTRAL","intensity":0-1}
3. GROUNDING: Copy source_text character-for-character into items. NEVER invent names, places, dates, times or facts.
4. TEMPORAL: Copy time phrase into temporal.raw only (e.g. "tomorrow at 10am"). Do not compute ISO dates.
5. DIARY: journal.polished_entry must be one natural first-person paragraph ("I...") fixing grammar/slang without losing facts. Never output brackets or tags.
6. CONNECTION MAP: Emit only direct relationships explicitly supported by the text. Never connect two entities merely because both appear in the same message. Shared entities form indirect paths in the graph; do not invent a direct edge. Use entity ids from entities, an allowed relationship_type above, and an exact evidence substring. Put PERSON first for person relationships (PERSON→PLACE/PROJECT/ORGANIZATION/EVENT). Use met_at for a person meeting at a place and discussed for a person discussing a project or organization. Use works_on only when the text actually says the person works on the project. If evidence is weak, emit no connection.
7. Empty items if no life information. Empty connections if no direct relationship is supported. Minified JSON only.`;
}

/**
 * Builds the user-role message.
 *
 * Keeps payload compact by sending the user text cleanly wrapped in quotes.
 */
export function buildUserMessage(request: Pick<AnalysisRequest, 'text' | 'now' | 'timezone'>): string {
  return `"""
${request.text}
"""`;
}
