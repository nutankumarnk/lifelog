/**
 * Conversation segmentation.
 *
 * Splits raw text into the smallest pieces that can each stand alone as a unit
 * of life information. "I met Arun yesterday and I need to send him the deck"
 * is one sentence but two facts, so segmentation also splits on coordinating
 * conjunctions when both sides carry a verb.
 *
 * Every segment keeps its character offsets into the original text. Those
 * offsets are what later stages use to prove an extraction is grounded.
 *
 * Leaf module: no dependencies beyond the schema types.
 */
import type { Segment } from '../schemas/analysis.schema.js';

/** Abbreviations whose trailing period must not end a sentence. */
const ABBREVIATIONS = [
  'mr.',
  'mrs.',
  'ms.',
  'dr.',
  'prof.',
  'sr.',
  'jr.',
  'st.',
  'e.g.',
  'i.e.',
  'etc.',
  'vs.',
  'approx.',
  'no.',
];

function endsWithAbbreviation(text: string): boolean {
  const lower = text.toLowerCase().trimEnd();
  return ABBREVIATIONS.some((abbreviation) => lower.endsWith(abbreviation));
}

interface Piece {
  text: string;
  start: number;
  end: number;
}

/** First pass: sentence and line boundaries. */
function splitSentences(text: string): Piece[] {
  const pieces: Piece[] = [];
  let start = 0;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    const isTerminator = char === '.' || char === '!' || char === '?' || char === '\n';
    if (!isTerminator) continue;

    const candidate = text.slice(start, i + 1);

    if (char === '.') {
      if (endsWithAbbreviation(candidate)) continue;
      // Decimals and version numbers: "3.5 hours".
      const next = text[i + 1];
      const previous = text[i - 1];
      if (previous && next && /\d/.test(previous) && /\d/.test(next)) continue;
    }

    // Consume runs like "?!" and "..." as a single boundary.
    let end = i + 1;
    while (end < text.length && /[.!?\n]/.test(text[end]!)) end += 1;

    pieces.push({ text: text.slice(start, end), start, end });
    start = end;
    i = end - 1;
  }

  if (start < text.length) pieces.push({ text: text.slice(start), start, end: text.length });
  return pieces;
}

/** Conjunctions worth splitting on, when what follows looks like its own clause. */
const CLAUSE_SPLITTERS = /\b(?:,?\s+and\s+(?:i|we|then|also)\s|,?\s+but\s+(?:i|we)\s|;\s*|,?\s+also\s+i\s)/gi;

/** A fragment only becomes its own segment if it plausibly contains a predicate. */
function looksLikeClause(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.split(/\s+/).length < 3) return false;
  return /\b(?:need|have|has|must|should|will|am|is|are|was|were|met|saw|went|feel|felt|want|remind|plan|going|decided|finished|got|called|booked|bought|told|made|took)\b/i.test(
    trimmed,
  );
}

/** Second pass: break a long sentence at conjunctions that join real clauses. */
function splitClauses(piece: Piece): Piece[] {
  // Short sentences are already atomic; splitting them only adds noise.
  if (piece.text.trim().split(/\s+/).length < 8) return [piece];

  const pieces: Piece[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  CLAUSE_SPLITTERS.lastIndex = 0;

  while ((match = CLAUSE_SPLITTERS.exec(piece.text)) !== null) {
    const left = piece.text.slice(cursor, match.index);
    // Keep the subject pronoun that the splitter matched ("and I" -> "I ...").
    const tail = match[0].replace(/^[,;\s]*(?:and|but|also)?\s*/i, '');
    const rightStart = match.index + match[0].length - tail.length;
    const right = piece.text.slice(rightStart);

    if (looksLikeClause(left) && looksLikeClause(right)) {
      pieces.push({ text: left, start: piece.start + cursor, end: piece.start + match.index });
      cursor = rightStart;
    }
  }

  if (pieces.length === 0) return [piece];
  pieces.push({ text: piece.text.slice(cursor), start: piece.start + cursor, end: piece.end });
  return pieces;
}

/**
 * Splits a conversation into segments.
 *
 * Guarantees:
 *   - every segment's `span` indexes into the original text unmodified;
 *   - segments are non-overlapping and in reading order;
 *   - empty/whitespace-only fragments are dropped.
 */
export function segmentConversation(text: string): Segment[] {
  const segments: Segment[] = [];
  let index = 0;

  for (const sentence of splitSentences(text)) {
    for (const clause of splitClauses(sentence)) {
      const trimmedStart = clause.text.length - clause.text.trimStart().length;
      const trimmedEnd = clause.text.length - clause.text.trimEnd().length;
      const value = clause.text.trim();
      if (!value) continue;

      segments.push({
        index,
        text: value,
        span: { start: clause.start + trimmedStart, end: clause.end - trimmedEnd },
      });
      index += 1;
    }
  }

  // A conversation with no terminator at all is still one segment.
  if (segments.length === 0 && text.trim()) {
    const start = text.length - text.trimStart().length;
    segments.push({
      index: 0,
      text: text.trim(),
      span: { start, end: text.trimEnd().length },
    });
  }

  return segments;
}
