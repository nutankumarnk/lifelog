/**
 * AI teacher prompts — gap-filling only, not a blank-slate re-extract.
 */
import type { AnalysisGap, Item, Stance } from '../schemas/analysis.schema.js';

export function buildTeacherInstructions(): string {
  return `You assist Lifelog's algorithm. You do NOT replace it.
Return ONE LINE of minified JSON only — no markdown, no prose, no thinking.

You receive: (1) the user's text (2) the algorithm DRAFT (3) GAPS to fill.
Only answer the gaps. Do not invent names/places/feelings. Do not compute dates.
Every new item needs source_text copied exactly from the user text.
Expressed emotion only if the user wrote an emotion word.
Inferred emotional_impact must set inferred:true and basis_spans from the text.
If unsure, omit — empty patches are valid.

Output schema:
{"patches":[{"op":"add_item"|"set_stance"|"set_intent"|"add_entity"|"add_impact"|"noop","payload":{}}],"notes":[]}`;
}

export interface TeacherDraft {
  intent: string;
  stance: Stance;
  confidence: number;
  entities: Array<{ id: string; name: string; kind: string }>;
  items: Array<{ id: string; type: string; source_text: string; title: string }>;
  gaps: AnalysisGap[];
}

export function buildTeacherUserMessage(input: {
  text: string;
  now: Date;
  timezone: string | null;
  draft: TeacherDraft;
}): string {
  const isoDate = input.now.toISOString().slice(0, 10);
  const isoTime = input.now.toISOString().slice(11, 16);
  const gapLines = input.draft.gaps.map((gap, i) => `${i + 1}. [${gap.code}] ${gap.message}`).join('\n');

  return `Reference time: ${isoDate} ${isoTime} UTC${input.timezone ? ` (${input.timezone})` : ''}

USER TEXT:
"""
${input.text}
"""

ALGORITHM DRAFT:
${JSON.stringify({
    intent: input.draft.intent,
    stance: input.draft.stance,
    confidence: input.draft.confidence,
    entities: input.draft.entities,
    items: input.draft.items,
    gaps: input.draft.gaps.map((g) => g.code),
  })}

GAPS TO FILL:
${gapLines || '(none — reply {"patches":[{"op":"noop","payload":{}}],"notes":[]})'}`;
}

/** Compact draft view for the teacher. */
export function toTeacherDraft(input: {
  intent: string;
  stance: Stance;
  confidence: number;
  entities: Array<{ id: string; name: string; kind: string }>;
  items: Item[];
  gaps: AnalysisGap[];
}): TeacherDraft {
  return {
    intent: input.intent,
    stance: input.stance,
    confidence: input.confidence,
    entities: input.entities,
    items: input.items.map((item) => ({
      id: item.id,
      type: item.type,
      source_text: item.source_text,
      title: item.title,
    })),
    gaps: input.gaps,
  };
}
