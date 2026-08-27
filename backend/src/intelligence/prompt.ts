/**
 * The model-facing instructions.
 *
 * This file is *how* Lifelog asks a model to do its part. docs/algorithm.md is
 * *what* Lifelog does. They are deliberately separate: the algorithm survives a
 * model swap, this prompt may not.
 *
 * Kept short and asks for *minified* JSON. Free-tier latency is dominated by
 * completion tokens — pretty-printed replies routinely cost 30–90s.
 *
 * Models have no clock. Every prompt therefore opens with the current date and
 * time in the user's timezone, so "yesterday" / "next Monday" can be read
 * against a real instant. Lifelog still resolves the calendar in
 * `intelligence/temporal.ts` — the model must not invent ISO dates.
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

function clockPreamble(now: Date, timezone: string | null | undefined): string {
  return `CURRENT DATE AND TIME: ${formatCurrentClock(now, timezone)}
This is NOW. You have no clock of your own — treat that instant as today.`;
}

export function buildInstructions(now: Date, timezone: string | null = null): string {
  return `${clockPreamble(now, timezone)}

Extract structured life information from one user message. Return ONE LINE of minified JSON only — no markdown, no indentation, no prose.

Schema:
{"intent":LOG|PLAN|CAPTURE_TASK|SET_REMINDER|REFLECT|ASK|CORRECT|SMALL_TALK|UNKNOWN,"intent_confidence":0-1,"language":"en|mixed|…","summary":"≤20 words","entities":[{"id":"e1","kind":PERSON|PLACE|ORGANIZATION|OBJECT|TOPIC|EVENT_NAME|OTHER,"raw_kind":null,"name":"as written","relation":null,"confidence":0-1}],"items":[{"id":"i1","type":MEMORY|PAST_EVENT|PRESENT_FACT|FUTURE_EVENT|TASK|REMINDER|DECISION|FEELING,"title":"≤8 words","summary":"≤15 words","source_text":"exact substring","temporal":{"raw":"phrase|null"},"entity_ids":["e1"],"details":{},"confidence":0-1}],"missing_information":[],"follow_up":null}

Rules:
1. GROUND EVERYTHING. Copy source_text character-for-character. If you cannot, omit the item.
2. NEVER INVENT names, places, dates, times or feelings. Omitting beats inventing.
3. DO NOT COMPUTE ISO DATES. Copy the user's time phrase into temporal.raw only. Use CURRENT DATE AND TIME only to judge tense (yesterday vs tomorrow). Lifelog converts the phrase to a calendar date.
4. ONE FACT PER ITEM. Split multi-fact sentences.
5. TASK vs REMINDER. REMINDER only if the user asked to be reminded/alerted/pinged/notified.
6. MEMORY vs PAST_EVENT. PAST_EVENT = dated happening. MEMORY = experience worth keeping (people/place/feeling). Both may apply.
7. FEELING only when emotion is expressed — never inferred from neutral text.
8. Unknown kinds → kind OTHER + raw_kind. Never drop them.
9. Keep the user's spelling/script in name and source_text. Do not translate.
10. follow_up: at most one question, only if a missing detail blocks what the user asked (e.g. reminder with no time). Else null.
11. No life information → empty items. An empty result is a valid and correct answer.
12. Be brief. Minified JSON. Short titles.

details:
TASK {status:"OPEN",priority:LOW|NORMAL|HIGH|URGENT}
REMINDER {explicit:true,status:"OPEN"}
FEELING {emotion:"user's word",sentiment:POSITIVE|NEGATIVE|MIXED|NEUTRAL,intensity:0-1,about:null}
DECISION {alternatives:[]}
MEMORY {significance:0-1}
else {}`;
}

/**
 * Builds the user-role message.
 *
 * The current date and time are repeated here (not only in the system prompt)
 * because models often skip system context when reading the user turn.
 * Arithmetic stays in `intelligence/temporal.ts`.
 */
export function buildUserMessage(request: Pick<AnalysisRequest, 'text' | 'now' | 'timezone'>): string {
  return `${clockPreamble(request.now, request.timezone)}

USER MESSAGE:
"""
${request.text}
"""`;
}
