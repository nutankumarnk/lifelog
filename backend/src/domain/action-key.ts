/**
 * Identity of an obligation.
 *
 * Two messages describe the same task when they ask for the same action, about
 * the same thing, on the same day. "remind me call priya tomorrow at 5" and
 * "remind me to call Priya tomorrow" are one reminder, not two.
 *
 * The key is deliberately coarse: merging two near-identical reminders is a far
 * smaller failure than showing the user the same thing five times.
 */

/** Words that carry no meaning for identity. */
const FILLER = new Set([
  'a',
  'an',
  'the',
  'to',
  'i',
  'me',
  'my',
  'we',
  'us',
  'it',
  'is',
  'am',
  'are',
  'was',
  'were',
  'be',
  'do',
  'does',
  'did',
  'please',
  'pls',
  'need',
  'needs',
  'want',
  'wants',
  'have',
  'has',
  'must',
  'should',
  'gotta',
  'remind',
  'reminder',
  'reminds',
  'alert',
  'ping',
  'notify',
  'dont',
  'forget',
  'make',
  'sure',
  'at',
  'on',
  'in',
  'by',
  'for',
  'of',
  'and',
  'then',
  'also',
  'that',
  'this',
  'karna',
  'hai',
  'yaad',
  'dila',
  'dilana',
]);

/** Time words are captured by the resolved date instead. */
const TIME_WORDS =
  /\b(today|tonight|tomorrow|tommorrow|tommorow|yesterday|kal|aaj|parso|morning|afternoon|evening|night|monday|tuesday|wednesday|thursday|friday|saturday|sunday|am|pm|next|last|this|week|month|year)\b/gi;

/** Very light stemming so "packed"/"packing"/"pack" collapse together. */
function stem(word: string): string {
  return word
    .replace(/(ing|ed|es|s)$/i, '')
    .replace(/(.)\1+$/, '$1');
}

export interface ActionKeyInput {
  kind: 'TASK' | 'REMINDER';
  /** Prefer display_text, then source_text, then title. */
  text: string;
}

/**
 * Builds a stable identity string for one task or reminder.
 *
 * Only the action survives: the verb and what it acts on. Times are excluded on
 * purpose — "call Priya tomorrow" and "call Priya on Friday" are the same
 * obligation rescheduled, not two things to do. Entity names are not added
 * separately either, because they already appear in the text and entity
 * extraction is not stable enough to be part of an identity.
 */
export function buildActionKey(input: ActionKeyInput): string {
  const normalized = input.text
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(TIME_WORDS, ' ')
    .replace(/\d{1,2}(:\d{2})?\s*(am|pm)?/g, ' ')
    .replace(/[^a-z\u0900-\u097F\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(stem)
    .filter((word) => word.length > 1 && !FILLER.has(word))
    .sort()
    .join('-');

  return `${input.kind.toLowerCase()}|${normalized || 'unspecified'}`;
}
