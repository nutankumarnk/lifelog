/**
 * Lifelog's linguistic signal lists.
 *
 * A leaf module: pure data and pure predicates, no imports, no side effects.
 * Both the intelligence layer and the offline rule-engine provider read from
 * here, so a signal is defined once and behaves identically in both.
 *
 * These lists encode *Lifelog's* reading of language, not a model's. They are
 * part of the product (see docs/algorithm.md) and are expected to grow.
 */

/** Explicit request to be prompted later. The user must actually ask. */
export const REMINDER_MARKERS = [
  'remind me',
  'reminder to',
  'set a reminder',
  'set reminder',
  'give me a reminder',
  'alert me',
  'ping me',
  'notify me',
  'wake me',
  'nudge me',
  "don't let me forget",
  'dont let me forget',
  'yaad dila',
  'yaad dilana',
];

/** Obligation the user has taken on. Distinct from a reminder — see docs/algorithm.md. */
export const TASK_MARKERS = [
  'i need to',
  'i have to',
  'i must',
  'i should',
  'i gotta',
  'i got to',
  'need to',
  'have to',
  'has to',
  'must ',
  'should ',
  'todo',
  'to-do',
  'to do:',
  'make sure to',
  'make sure i',
  'do not forget to',
  "don't forget to",
  'dont forget to',
  'pending',
  'karna hai',
  'karna he',
];

export const DECISION_MARKERS = [
  'i decided',
  "i've decided",
  'ive decided',
  'i have decided',
  'we decided',
  'decided to',
  'decided that',
  'i chose',
  'i choose',
  'chose to',
  'going with',
  'settled on',
  'i will go with',
  'made up my mind',
  'final decision',
  'opted for',
  'opted to',
];

export const PLAN_MARKERS = [
  'i will',
  "i'll",
  'ill ',
  'i am going to',
  "i'm going to",
  'im going to',
  'going to',
  'planning to',
  'plan to',
  'we will',
  'we are going to',
  'scheduled for',
  'scheduled to',
  'booked',
  'appointment',
  'meeting with',
  'flight to',
  'flying to',
  'travelling to',
  'traveling to',
];

export const QUESTION_MARKERS = [
  'did i',
  'do i',
  'what did',
  'when did',
  'where did',
  'who did',
  'when is',
  'what is my',
  'what are my',
  'remind me what',
  'do you remember',
  'what was',
  'how many times',
];

export const CORRECTION_MARKERS = [
  'actually,',
  'actually it',
  'i meant',
  'correction',
  'sorry, i meant',
  'not tuesday',
  'scratch that',
  'i was wrong',
  'let me correct',
];

export const SMALL_TALK_PHRASES = [
  'hi',
  'hey',
  'hello',
  'yo',
  'good morning',
  'good evening',
  'good night',
  'thanks',
  'thank you',
  'ok',
  'okay',
  'cool',
  'lol',
  'hmm',
  'test',
  'testing',
];

/**
 * Emotion lexicon. `polarity` feeds sentiment, `intensity` is a prior that the
 * intelligence layer may adjust for intensifiers ("really", "so").
 */
export interface EmotionEntry {
  emotion: string;
  polarity: 'POSITIVE' | 'NEGATIVE' | 'MIXED';
  intensity: number;
  words: string[];
}

export const EMOTION_LEXICON: EmotionEntry[] = [
  {
    emotion: 'joy',
    polarity: 'POSITIVE',
    intensity: 0.7,
    words: ['happy', 'glad', 'delighted', 'joyful', 'thrilled', 'ecstatic', 'cheerful', 'khush'],
  },
  {
    emotion: 'excitement',
    polarity: 'POSITIVE',
    intensity: 0.75,
    words: ['excited', 'pumped', 'stoked', 'buzzing', 'can not wait', "can't wait", 'cant wait'],
  },
  {
    emotion: 'gratitude',
    polarity: 'POSITIVE',
    intensity: 0.6,
    words: ['grateful', 'thankful', 'blessed', 'appreciative'],
  },
  {
    emotion: 'pride',
    polarity: 'POSITIVE',
    intensity: 0.65,
    words: ['proud', 'accomplished', 'satisfied'],
  },
  {
    emotion: 'relief',
    polarity: 'POSITIVE',
    intensity: 0.55,
    words: ['relieved', 'relief', 'finally over'],
  },
  {
    emotion: 'calm',
    polarity: 'POSITIVE',
    intensity: 0.4,
    words: ['calm', 'peaceful', 'relaxed', 'content', 'at ease'],
  },
  {
    emotion: 'sadness',
    polarity: 'NEGATIVE',
    intensity: 0.7,
    words: ['sad', 'down', 'unhappy', 'heartbroken', 'depressed', 'miserable', 'blue', 'udaas'],
  },
  {
    emotion: 'anxiety',
    polarity: 'NEGATIVE',
    intensity: 0.7,
    words: ['anxious', 'nervous', 'worried', 'uneasy', 'panicky', 'on edge', 'scared', 'afraid'],
  },
  {
    emotion: 'stress',
    polarity: 'NEGATIVE',
    intensity: 0.7,
    words: ['stressed', 'stressed out', 'overwhelmed', 'burnt out', 'burned out', 'under pressure'],
  },
  {
    emotion: 'anger',
    polarity: 'NEGATIVE',
    intensity: 0.75,
    words: ['angry', 'furious', 'annoyed', 'irritated', 'frustrated', 'pissed', 'mad at'],
  },
  {
    emotion: 'fatigue',
    polarity: 'NEGATIVE',
    intensity: 0.5,
    words: ['tired', 'exhausted', 'drained', 'sleepy', 'worn out', 'thak'],
  },
  {
    emotion: 'loneliness',
    polarity: 'NEGATIVE',
    intensity: 0.65,
    words: ['lonely', 'alone', 'isolated', 'left out'],
  },
  {
    emotion: 'guilt',
    polarity: 'NEGATIVE',
    intensity: 0.6,
    words: ['guilty', 'ashamed', 'regret', 'embarrassed'],
  },
  {
    emotion: 'mixed',
    polarity: 'MIXED',
    intensity: 0.5,
    words: ['bittersweet', 'conflicted', 'torn', 'mixed feelings', 'weird about'],
  },
];

/** Phrases that introduce a felt state, used to catch emotions not in the lexicon. */
export const FEELING_FRAMES = [
  'i feel',
  'i felt',
  'im feeling',
  "i'm feeling",
  'i am feeling',
  'feeling',
  'it made me feel',
  'made me feel',
  'i was feeling',
  'left me',
];

/** Verbs that typically describe a lived experience worth remembering. */
export const EXPERIENCE_VERBS = [
  'met',
  'saw',
  'visited',
  'went',
  'travelled',
  'traveled',
  'ate',
  'tried',
  'watched',
  'attended',
  'celebrated',
  'played',
  'walked',
  'talked',
  'called',
  'spent',
  'stayed',
  'flew',
  'drove',
  'cooked',
  'learned',
  'finished',
  'started',
  'moved',
  'joined',
  'graduated',
  'married',
];

/** Prepositions that usually introduce a place. */
export const PLACE_PREPOSITIONS = ['in', 'at', 'to', 'from', 'near', 'around', 'inside', 'outside'];

/** Words that introduce a person. */
export const PERSON_PREPOSITIONS = ['with', 'met', 'saw', 'called', 'texted', 'and'];

/** Kinship and role words that describe a person without naming them. */
export const RELATION_WORDS = [
  'mother',
  'mom',
  'mum',
  'father',
  'dad',
  'brother',
  'sister',
  'wife',
  'husband',
  'son',
  'daughter',
  'friend',
  'boss',
  'manager',
  'colleague',
  'teacher',
  'doctor',
  'dentist',
  'landlord',
  'neighbour',
  'neighbor',
  'cousin',
  'uncle',
  'aunt',
  'grandmother',
  'grandfather',
  'partner',
  'girlfriend',
  'boyfriend',
  'client',
  'therapist',
];

/**
 * Tokens that look like proper nouns but almost never are. Without this the
 * capitalised-word heuristic invents an entity from every sentence opener.
 */
export const ENTITY_STOPWORDS = new Set([
  'i',
  'i%27m',
  "i'm",
  'im',
  'a',
  'an',
  'the',
  'and',
  'but',
  'or',
  'so',
  'then',
  'also',
  'my',
  'me',
  'we',
  'he',
  'she',
  'they',
  'it',
  'this',
  'that',
  'there',
  'here',
  'today',
  'tomorrow',
  'yesterday',
  'tonight',
  'now',
  'later',
  // Hinglish temporal words. Without these, "Kal" at the start of a sentence
  // is captured as a proper noun.
  'kal',
  'aaj',
  'parso',
  'abhi',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
  'ok',
  'okay',
  'yes',
  'no',
  'hi',
  'hey',
  'hello',
  'thanks',
  'need',
  'have',
  'will',
  'should',
  'must',
  'went',
  'met',
  'saw',
  'got',
  'was',
  'were',
  'am',
  'is',
  'are',
  'feel',
  'felt',
  'remind',
  'remember',
  'forgot',
  'lets',
  "let's",
  'if',
  'when',
  'what',
  'who',
  'where',
  'why',
  'how',
]);

/** Devanagari, Arabic, CJK, Cyrillic and Thai ranges, for language detection. */
export const NON_LATIN_SCRIPT = /[\u0900-\u097F\u0600-\u06FF\u4E00-\u9FFF\u3040-\u30FF\u0400-\u04FF\u0E00-\u0E7F]/;

/** Romanised Hindi/Hinglish markers. Latin script alone cannot reveal these. */
export const HINGLISH_MARKERS = [
  'hai',
  'hain',
  'nahi',
  'nahin',
  'kal',
  'aaj',
  'karna',
  'karunga',
  'mujhe',
  'mera',
  'meri',
  'tha',
  'thi',
  'gaya',
  'gayi',
  'yaad',
  'bahut',
  'thoda',
  'accha',
  'theek',
  'ke saath',
  'ki',
  'ko',
];

const WORD_CHARACTER = /[\p{L}\p{N}]/u;

/**
 * Case-insensitive phrase match that respects word boundaries.
 *
 * Plain substring matching is wrong here: the marker "do i" is contained in
 * "do it", which turned "might do it again" into an ASK. A boundary is only
 * required where the needle itself ends in a word character, so markers written
 * with a deliberate trailing space ("must ", "should ") keep working.
 */
function containsPhrase(lower: string, needle: string): boolean {
  if (!needle) return false;

  const needsLeftBoundary = WORD_CHARACTER.test(needle[0]!);
  const needsRightBoundary = WORD_CHARACTER.test(needle[needle.length - 1]!);

  let from = 0;
  for (;;) {
    const at = lower.indexOf(needle, from);
    if (at === -1) return false;

    const before = at > 0 ? lower[at - 1]! : '';
    const after = lower[at + needle.length] ?? '';
    const leftOk = !needsLeftBoundary || before === '' || !WORD_CHARACTER.test(before);
    const rightOk = !needsRightBoundary || after === '' || !WORD_CHARACTER.test(after);

    if (leftOk && rightOk) return true;
    from = at + 1;
  }
}

/** Case-insensitive containment test over a phrase list. */
export function containsAny(haystack: string, needles: readonly string[]): boolean {
  const lower = haystack.toLowerCase();
  return needles.some((needle) => containsPhrase(lower, needle));
}

/** Returns every phrase from `needles` present in `haystack`. */
export function matchesIn(haystack: string, needles: readonly string[]): string[] {
  const lower = haystack.toLowerCase();
  return needles.filter((needle) => containsPhrase(lower, needle));
}
