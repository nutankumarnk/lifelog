/**
 * Temporal interpretation.
 *
 * Lifelog resolves time itself rather than trusting a model to do date
 * arithmetic — models are unreliable at it, and a wrong date silently corrupts
 * memory. The model may *report* the phrase it saw ("next Friday"); this module
 * decides what calendar point that phrase means.
 *
 * The raw phrase is always preserved alongside the resolution, because the
 * phrase is what the user actually said and can never be wrong.
 *
 * Leaf module: pure functions over `(phrase, referenceDate)`.
 */
import type { Temporal, TemporalPrecision, Tense } from '../schemas/analysis.schema.js';

const DAY_MS = 86_400_000;

const WEEKDAYS: Record<string, number> = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  tues: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thu: 4,
  thurs: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
};

const MONTHS: Record<string, number> = {
  january: 0,
  jan: 0,
  february: 1,
  feb: 1,
  march: 2,
  mar: 2,
  april: 3,
  apr: 3,
  may: 4,
  june: 5,
  jun: 5,
  july: 6,
  jul: 6,
  august: 7,
  aug: 7,
  september: 8,
  sep: 8,
  sept: 8,
  october: 9,
  oct: 9,
  november: 10,
  nov: 10,
  december: 11,
  dec: 11,
};

/**
 * Every temporal expression Lifelog recognises, longest first so that
 * "day after tomorrow" wins over "tomorrow".
 */
const TEMPORAL_PATTERNS: RegExp[] = [
  /\b\d{4}-\d{2}-\d{2}(?:[T ]\d{1,2}:\d{2})?\b/i,
  /\bday after tomorrow\b/i,
  /\bday before yesterday\b/i,
  /\bthe day after tomorrow\b/i,
  /\b(?:next|last|this|coming|past|previous)\s+(?:week|month|year|weekend|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)\b/i,
  /\b(?:in|after)\s+\d+\s+(?:minute|minutes|hour|hours|day|days|week|weeks|month|months|year|years)\b/i,
  /\b\d+\s+(?:minute|minutes|hour|hours|day|days|week|weeks|month|months|year|years)\s+ago\b/i,
  /\b(?:every|each)\s+(?:day|morning|evening|night|week|month|year|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  /\b(?:on|by|before|after|until|till)\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  /\b(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s*\d{4})?\b/i,
  /\b\d{1,2}(?:st|nd|rd|th)?\s+(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)(?:,?\s*\d{4})?\b/i,
  /\b\d{1,2}\s*(?::\s*\d{2})?\s*(?:am|pm)\b/i,
  /\b\d{1,2}:\d{2}\b/,
  /\b(?:tomorrow|yesterday|today|tonight|tomorrow morning|this morning|this afternoon|this evening|last night)\b/i,
  /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  /\b(?:this|next|last)\s+(?:january|february|march|april|may|june|july|august|september|october|november|december)\b/i,
  /\b(?:kal|aaj|parso)\b/i, // Hinglish: yesterday/tomorrow, today, day before/after.
  /\b(?:right now|currently|these days|nowadays|at the moment|recently|lately|soon|later)\b/i,
  /\b(?:in the morning|in the evening|at night|over the weekend)\b/i,
];

export interface TemporalMatch {
  phrase: string;
  start: number;
  end: number;
}

/** Finds every temporal phrase in the text, de-overlapped, in reading order. */
export function findTemporalPhrases(text: string): TemporalMatch[] {
  const matches: TemporalMatch[] = [];

  for (const pattern of TEMPORAL_PATTERNS) {
    const global = new RegExp(pattern.source, `${pattern.flags.replace('g', '')}g`);
    let match: RegExpExecArray | null;
    while ((match = global.exec(text)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      // Longest-first ordering means an earlier pattern already covered this span.
      const overlaps = matches.some((existing) => start < existing.end && end > existing.start);
      if (!overlaps) matches.push({ phrase: match[0], start, end });
      if (match[0].length === 0) global.lastIndex += 1;
    }
  }

  return matches.sort((a, b) => a.start - b.start);
}

function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setUTCHours(0, 0, 0, 0);
  return copy;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function withTime(date: Date, hours: number, minutes: number): Date {
  const copy = startOfDay(date);
  copy.setUTCHours(hours, minutes, 0, 0);
  return copy;
}

interface Resolution {
  resolved: string | null;
  resolvedEnd: string | null;
  precision: TemporalPrecision;
  tense: Tense;
  recurrence: string | null;
  confidence: number;
}

const UNRESOLVED: Resolution = {
  resolved: null,
  resolvedEnd: null,
  precision: 'NONE',
  tense: 'UNSPECIFIED',
  recurrence: null,
  confidence: 0,
};

/**
 * Resolves one temporal phrase against a reference time.
 *
 * Deliberately conservative: an ambiguous phrase resolves to `null` with a
 * `RELATIVE` precision rather than to a confidently wrong date. Fabricating a
 * date is worse than admitting the phrase is vague — see docs/algorithm.md.
 */
export function resolvePhrase(phrase: string, now: Date): Resolution {
  const text = phrase.trim().toLowerCase();
  const today = startOfDay(now);

  // --- Absolute ISO dates -------------------------------------------------
  const iso = /^(\d{4}-\d{2}-\d{2})(?:[t ](\d{1,2}):(\d{2}))?$/i.exec(text);
  if (iso?.[1]) {
    const hasTime = iso[2] !== undefined;
    const date = new Date(`${iso[1]}T${hasTime ? `${iso[2]!.padStart(2, '0')}:${iso[3]}` : '00:00'}:00Z`);
    return {
      resolved: hasTime ? date.toISOString() : toIsoDate(date),
      resolvedEnd: null,
      precision: hasTime ? 'EXACT_TIME' : 'DAY',
      tense: date.getTime() < today.getTime() ? 'PAST' : date.getTime() > today.getTime() ? 'FUTURE' : 'PRESENT',
      recurrence: null,
      confidence: 0.98,
    };
  }

  // --- Recurrence ---------------------------------------------------------
  const recurring = /^(?:every|each)\s+(.+)$/.exec(text);
  if (recurring?.[1]) {
    return {
      resolved: null,
      resolvedEnd: null,
      precision: 'RECURRING',
      tense: 'FUTURE',
      recurrence: recurring[1],
      confidence: 0.8,
    };
  }

  // --- Simple day words ---------------------------------------------------
  const dayWords: Record<string, { offset: number; tense: Tense; precision: TemporalPrecision }> = {
    today: { offset: 0, tense: 'PRESENT', precision: 'DAY' },
    aaj: { offset: 0, tense: 'PRESENT', precision: 'DAY' },
    tonight: { offset: 0, tense: 'PRESENT', precision: 'DAY' },
    'this morning': { offset: 0, tense: 'PRESENT', precision: 'DAY' },
    'this afternoon': { offset: 0, tense: 'PRESENT', precision: 'DAY' },
    'this evening': { offset: 0, tense: 'PRESENT', precision: 'DAY' },
    yesterday: { offset: -1, tense: 'PAST', precision: 'DAY' },
    'last night': { offset: -1, tense: 'PAST', precision: 'DAY' },
    tomorrow: { offset: 1, tense: 'FUTURE', precision: 'DAY' },
    'tomorrow morning': { offset: 1, tense: 'FUTURE', precision: 'DAY' },
    'day after tomorrow': { offset: 2, tense: 'FUTURE', precision: 'DAY' },
    'the day after tomorrow': { offset: 2, tense: 'FUTURE', precision: 'DAY' },
    'day before yesterday': { offset: -2, tense: 'PAST', precision: 'DAY' },
  };
  const dayWord = dayWords[text];
  if (dayWord) {
    return {
      resolved: toIsoDate(addDays(today, dayWord.offset)),
      resolvedEnd: null,
      precision: dayWord.precision,
      tense: dayWord.tense,
      recurrence: null,
      confidence: 0.95,
    };
  }

  // "kal" means both yesterday and tomorrow in Hindi; tense comes from context,
  // so Lifelog refuses to pick a date rather than guessing wrong.
  if (text === 'kal') {
    return { ...UNRESOLVED, precision: 'RELATIVE', confidence: 0.3 };
  }
  if (text === 'parso') {
    return { ...UNRESOLVED, precision: 'RELATIVE', confidence: 0.3 };
  }

  // --- "in N units" / "N units ago" --------------------------------------
  const relative = /^(?:in|after)\s+(\d+)\s+(minute|minutes|hour|hours|day|days|week|weeks|month|months|year|years)$/.exec(text);
  const ago = /^(\d+)\s+(minute|minutes|hour|hours|day|days|week|weeks|month|months|year|years)\s+ago$/.exec(text);
  const offsetMatch = relative ?? ago;
  if (offsetMatch?.[1] && offsetMatch[2]) {
    const sign = ago ? -1 : 1;
    const amount = Number.parseInt(offsetMatch[1], 10) * sign;
    const unit = offsetMatch[2].replace(/s$/, '');
    const base = new Date(now);

    if (unit === 'minute' || unit === 'hour') {
      const ms = unit === 'minute' ? 60_000 : 3_600_000;
      const at = new Date(base.getTime() + amount * ms);
      return {
        resolved: at.toISOString(),
        resolvedEnd: null,
        precision: 'EXACT_TIME',
        tense: sign > 0 ? 'FUTURE' : 'PAST',
        recurrence: null,
        confidence: 0.9,
      };
    }
    const days = unit === 'day' ? amount : unit === 'week' ? amount * 7 : unit === 'month' ? amount * 30 : amount * 365;
    return {
      resolved: toIsoDate(addDays(today, days)),
      resolvedEnd: null,
      precision: unit === 'day' || unit === 'week' ? 'DAY' : unit === 'month' ? 'MONTH' : 'YEAR',
      tense: sign > 0 ? 'FUTURE' : 'PAST',
      recurrence: null,
      confidence: unit === 'day' || unit === 'week' ? 0.9 : 0.6,
    };
  }

  // --- next/last/this + week|month|year|weekend --------------------------
  const period = /^(next|last|this|coming|past|previous)\s+(week|month|year|weekend)$/.exec(text);
  if (period?.[1] && period[2]) {
    const direction = period[1] === 'next' || period[1] === 'coming' ? 1 : period[1] === 'this' ? 0 : -1;
    const unit = period[2];
    const tense: Tense = direction > 0 ? 'FUTURE' : direction < 0 ? 'PAST' : 'PRESENT';

    if (unit === 'week' || unit === 'weekend') {
      const target = addDays(today, direction * 7);
      return {
        resolved: toIsoDate(target),
        resolvedEnd: toIsoDate(addDays(target, unit === 'weekend' ? 1 : 6)),
        precision: 'WEEK',
        tense,
        recurrence: null,
        confidence: 0.6,
      };
    }
    if (unit === 'month') {
      const target = new Date(today);
      target.setUTCMonth(target.getUTCMonth() + direction, 1);
      return {
        resolved: toIsoDate(target),
        resolvedEnd: null,
        precision: 'MONTH',
        tense,
        recurrence: null,
        confidence: 0.6,
      };
    }
    const target = new Date(today);
    target.setUTCFullYear(target.getUTCFullYear() + direction, 0, 1);
    return {
      resolved: toIsoDate(target),
      resolvedEnd: null,
      precision: 'YEAR',
      tense,
      recurrence: null,
      confidence: 0.6,
    };
  }

  // --- Weekdays, with or without a modifier ------------------------------
  const weekday = /^(?:(next|last|this|coming|past|previous|on|by|before|after|until|till)\s+)?([a-z]+)$/.exec(text);
  if (weekday?.[2] && weekday[2] in WEEKDAYS) {
    const modifier = weekday[1];
    const targetDow = WEEKDAYS[weekday[2]]!;
    const currentDow = today.getUTCDay();
    const backwards = modifier === 'last' || modifier === 'past' || modifier === 'previous';

    let delta: number;
    if (backwards) {
      delta = -(((currentDow - targetDow + 7) % 7) || 7);
    } else {
      // Bare and "next"/"on" weekdays both mean the upcoming one. Same-day
      // mentions resolve to today rather than a week out.
      delta = (targetDow - currentDow + 7) % 7;
      if (delta === 0 && modifier === 'next') delta = 7;
    }

    return {
      resolved: toIsoDate(addDays(today, delta)),
      resolvedEnd: null,
      precision: 'DAY',
      tense: backwards ? 'PAST' : delta === 0 ? 'PRESENT' : 'FUTURE',
      recurrence: null,
      // A bare weekday is genuinely ambiguous about which week is meant.
      confidence: modifier ? 0.8 : 0.6,
    };
  }

  // --- Month + day, either order -----------------------------------------
  const monthFirst = /^([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?$/.exec(text);
  const dayFirst = /^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)(?:,?\s*(\d{4}))?$/.exec(text);
  const monthName = monthFirst?.[1] ?? dayFirst?.[2];
  const dayNumber = monthFirst?.[2] ?? dayFirst?.[1];
  const yearNumber = monthFirst?.[3] ?? dayFirst?.[3];

  if (monthName && dayNumber && monthName in MONTHS) {
    const month = MONTHS[monthName]!;
    const day = Number.parseInt(dayNumber, 10);
    if (day >= 1 && day <= 31) {
      const year = yearNumber ? Number.parseInt(yearNumber, 10) : today.getUTCFullYear();
      const candidate = new Date(Date.UTC(year, month, day));
      return {
        resolved: toIsoDate(candidate),
        resolvedEnd: null,
        precision: 'DAY',
        tense:
          candidate.getTime() < today.getTime()
            ? 'PAST'
            : candidate.getTime() > today.getTime()
              ? 'FUTURE'
              : 'PRESENT',
        recurrence: null,
        confidence: yearNumber ? 0.95 : 0.75,
      };
    }
  }

  // --- Clock times --------------------------------------------------------
  const clock = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/.exec(text);
  if (clock?.[1] && (clock[2] !== undefined || clock[3] !== undefined)) {
    let hours = Number.parseInt(clock[1], 10);
    const minutes = clock[2] ? Number.parseInt(clock[2], 10) : 0;
    const meridiem = clock[3];
    if (meridiem === 'pm' && hours < 12) hours += 12;
    if (meridiem === 'am' && hours === 12) hours = 0;
    if (hours <= 23 && minutes <= 59) {
      let at = withTime(today, hours, minutes);
      // A bare clock time with no date means the next occurrence.
      if (at.getTime() < now.getTime()) at = addDays(at, 1);
      return {
        resolved: at.toISOString(),
        resolvedEnd: null,
        precision: 'EXACT_TIME',
        tense: 'FUTURE',
        recurrence: null,
        confidence: 0.7,
      };
    }
  }

  // --- Vague markers ------------------------------------------------------
  const vaguePast = ['recently', 'lately', 'the other day', 'a while ago'];
  const vagueFuture = ['soon', 'later', 'sometime', 'eventually'];
  const vaguePresent = ['right now', 'currently', 'these days', 'nowadays', 'at the moment'];

  if (vaguePast.includes(text)) return { ...UNRESOLVED, precision: 'RELATIVE', tense: 'PAST', confidence: 0.4 };
  if (vagueFuture.includes(text)) return { ...UNRESOLVED, precision: 'RELATIVE', tense: 'FUTURE', confidence: 0.4 };
  if (vaguePresent.includes(text)) return { ...UNRESOLVED, precision: 'RELATIVE', tense: 'PRESENT', confidence: 0.5 };

  return { ...UNRESOLVED, precision: 'RELATIVE', confidence: 0.2 };
}

/**
 * Builds the `Temporal` block for a piece of text.
 *
 * When several phrases appear ("I met him yesterday and we're meeting again
 * next Friday"), the caller normally splits first; if not, the first phrase
 * wins and the rest are reported by `findTemporalPhrases`.
 */
export function interpretTemporal(
  text: string,
  now: Date,
  timezone: string | null = null,
): Temporal {
  const matches = findTemporalPhrases(text);
  const first = matches[0];

  if (!first) {
    return {
      tense: 'UNSPECIFIED',
      raw: null,
      resolved: null,
      resolved_end: null,
      precision: 'NONE',
      recurrence: null,
      timezone,
      confidence: 0,
    };
  }

  const resolution = resolvePhrase(first.phrase, now);
  return {
    tense: resolution.tense,
    raw: first.phrase,
    resolved: resolution.resolved,
    resolved_end: resolution.resolvedEnd,
    precision: resolution.precision,
    recurrence: resolution.recurrence,
    timezone,
    confidence: resolution.confidence,
  };
}

/**
 * Infers tense from verb morphology when no temporal phrase is present.
 * Weak on purpose — it only nudges classification, never sets a date.
 */
export function inferTenseFromGrammar(text: string): Tense {
  const lower = text.toLowerCase();
  if (/\b(will|shall|gonna|going to|am going to|planning to|plan to)\b/.test(lower)) return 'FUTURE';
  if (/\b(was|were|had|did|went|met|saw|ate|got|came|took|made|felt|finished|visited|attended)\b/.test(lower)) {
    return 'PAST';
  }
  if (/\b\w+ed\b/.test(lower) && !/\b(need|needed)\b/.test(lower)) return 'PAST';
  if (/\b(am|is|are|have|has|feel|feeling|currently|now)\b/.test(lower)) return 'PRESENT';
  return 'UNSPECIFIED';
}
