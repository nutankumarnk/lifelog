/**
 * Tolerant JSON recovery for model output.
 *
 * Language models wrap JSON in prose, fence it in markdown, add trailing
 * commas, and occasionally stop mid-object. None of that is Lifelog's problem
 * to solve elsewhere, so all of the forgiveness lives here — and it stays
 * strictly syntactic. This module never invents a field or guesses a value;
 * repairing *meaning* is the intelligence layer's job.
 */

/**
 * Pulls the assistant text out of an OpenAI-compatible chat completion.
 *
 * Newer hosted models (Gemma 4, Gemini) often return `content` as an array of
 * parts, or put the visible answer next to a `reasoning` field. Treating
 * anything other than a string as empty made Lifelog throw away a real reply
 * and tell the user the model did not answer.
 */
export function extractChatText(payload: unknown): string {
  if (typeof payload === 'string') return payload;
  if (!payload || typeof payload !== 'object') return '';

  const root = payload as Record<string, unknown>;
  const choices = Array.isArray(root.choices) ? root.choices : [];
  const choice = (choices[0] && typeof choices[0] === 'object' ? choices[0] : {}) as Record<
    string,
    unknown
  >;
  const message = (
    choice.message && typeof choice.message === 'object' ? choice.message : {}
  ) as Record<string, unknown>;

  const parts = [
    coerceContent(message.content),
    coerceContent(choice.text),
    coerceContent(root.output_text),
  ].filter((part) => part.trim().length > 0);

  if (parts.length > 0) return parts[0]!;

  // Last resort: some reasoning hosts only populate these when content is empty.
  const reasoning = coerceContent(message.reasoning) || coerceContent(message.reasoning_content);
  return reasoning;
}

function coerceContent(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (!value) return '';

  if (Array.isArray(value)) {
    return value
      .map((part) => {
        if (typeof part === 'string') return part;
        if (!part || typeof part !== 'object') return '';
        const record = part as Record<string, unknown>;
        return coerceContent(record.text ?? record.content ?? record.output_text ?? '');
      })
      .join('');
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return coerceContent(record.text ?? record.content ?? record.output_text ?? '');
  }

  return '';
}

/** Removes ```json fences and any leading/trailing commentary. */
function stripFences(text: string): string {
  const fence = /```(?:json|JSON)?\s*([\s\S]*?)```/.exec(text);
  return (fence?.[1] ?? text).trim();
}

/**
 * Returns the first balanced `{...}` or `[...]` block, respecting string
 * literals and escapes so braces inside text do not confuse the scan.
 *
 * A stack is used rather than a single depth counter because objects and arrays
 * interleave, and a truncated response has to be closed in the right order.
 */
function extractBalanced(text: string): string | null {
  const startIndex = text.search(/[{[]/);
  if (startIndex === -1) return null;

  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (let i = startIndex; i < text.length; i += 1) {
    const char = text[i]!;

    if (escaped) {
      escaped = false;
      continue;
    }
    if (inString) {
      if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{' || char === '[') {
      stack.push(char === '{' ? '}' : ']');
      continue;
    }
    if (char === '}' || char === ']') {
      stack.pop();
      if (stack.length === 0) return text.slice(startIndex, i + 1);
    }
  }

  if (stack.length === 0) return null;

  // Truncated, most likely by a token limit. Close what is still open, in
  // reverse order, so a partially complete analysis is still usable. A trailing
  // fragment such as `"ti` is dropped rather than guessed at.
  let body = text.slice(startIndex);
  if (inString) body = `${body}"`;
  const suffix = [...stack].reverse().join('');
  return `${body}${suffix}`;
}

/** Removes trailing commas before a closing brace or bracket. */
function removeTrailingCommas(text: string): string {
  return text.replace(/,(\s*[}\]])/g, '$1');
}

export interface JsonParseResult {
  ok: boolean;
  value?: unknown;
  /** Which recovery steps were needed. Recorded as analysis warnings. */
  repairs: string[];
  error?: string;
}

/**
 * Parses model output into a JSON value, applying escalating repairs.
 * Returns `ok: false` rather than throwing so callers can decide on fallback.
 */
export function parseModelJson(text: string): JsonParseResult {
  const repairs: string[] = [];

  if (typeof text !== 'string' || text.trim() === '') {
    return { ok: false, repairs, error: 'empty model output' };
  }

  const attempts: Array<{ label: string; produce: (input: string) => string | null }> = [
    { label: 'direct', produce: (input) => input.trim() },
    { label: 'stripped-fences', produce: (input) => stripFences(input) },
    { label: 'balanced-extract', produce: (input) => extractBalanced(stripFences(input)) },
    {
      label: 'removed-trailing-commas',
      produce: (input) => {
        const balanced = extractBalanced(stripFences(input));
        return balanced ? removeTrailingCommas(balanced) : null;
      },
    },
  ];

  let lastError = 'unparseable model output';

  for (const attempt of attempts) {
    const candidate = attempt.produce(text);
    if (!candidate) continue;
    try {
      const value = JSON.parse(candidate) as unknown;
      if (attempt.label !== 'direct') repairs.push(attempt.label);
      return { ok: true, value, repairs };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  return { ok: false, repairs, error: lastError };
}
