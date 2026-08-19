/**
 * Tolerant JSON recovery for model output.
 *
 * Language models wrap JSON in prose, fence it in markdown, add trailing
 * commas, and occasionally stop mid-object. None of that is Lifelog's problem
 * to solve elsewhere, so all of the forgiveness lives here — and it stays
 * strictly syntactic. This module never invents a field or guesses a value;
 * repairing *meaning* is the intelligence layer's job.
 */

/** Removes ```json fences and any leading/trailing commentary. */
function stripFences(text: string): string {
  const fence = /```(?:json|JSON)?\s*([\s\S]*?)```/.exec(text);
  return (fence?.[1] ?? text).trim();
}

/**
 * Returns the first balanced `{...}` or `[...]` block, respecting string
 * literals and escapes so braces inside text do not confuse the scan.
 */
function extractBalanced(text: string): string | null {
  const startIndex = text.search(/[{[]/);
  if (startIndex === -1) return null;

  const opener = text[startIndex];
  const closer = opener === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = startIndex; i < text.length; i += 1) {
    const char = text[i];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === opener) depth += 1;
    else if (char === closer) {
      depth -= 1;
      if (depth === 0) return text.slice(startIndex, i + 1);
    }
  }

  // Unbalanced: the model was probably cut off by a token limit. Close what is
  // open so a partially-complete analysis is still usable.
  if (depth > 0) {
    const suffix = closer.repeat(depth);
    return `${text.slice(startIndex)}${inString ? '"' : ''}${suffix}`;
  }
  return null;
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
