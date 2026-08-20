/**
 * The console's only channel to Lifelog.
 *
 * Everything goes through the backend HTTP API. There is no API key here, no
 * model call, no database access, and no extraction logic — if any of that
 * appears in this directory, the layering has been broken. See
 * docs/architecture.md.
 */
import type {
  ActionListResponse,
  ActionStatus,
  AnalyzeResponse,
  ApiError,
  HealthResponse,
} from './types';

/** Vite proxies these paths to the backend. See vite.config.ts. */
const BASE = '';

export class LifelogApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly requestId?: string;
  readonly details?: Array<{ path: string; message: string }>;

  constructor(status: number, payload: ApiError['error']) {
    super(payload.message);
    this.name = 'LifelogApiError';
    this.status = status;
    this.code = payload.code;
    this.requestId = payload.requestId;
    this.details = payload.details;
  }
}

async function parseError(response: Response): Promise<never> {
  const fallback: ApiError['error'] = {
    code: 'UNKNOWN',
    message: `Request failed with status ${response.status}.`,
  };
  const text = await response.text();
  try {
    const parsed = JSON.parse(text) as ApiError;
    throw new LifelogApiError(response.status, parsed.error ?? fallback);
  } catch (error) {
    if (error instanceof LifelogApiError) throw error;
    throw new LifelogApiError(response.status, fallback);
  }
}

async function parseJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new LifelogApiError(response.status, {
      code: 'UNKNOWN',
      message: 'The backend returned a response that could not be read.',
    });
  }
}

/** Must exceed the backend AI deadline so the browser does not abort first. */
const ANALYZE_TIMEOUT_MS = 90_000;

function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const timeout = AbortSignal.timeout(ms);
  if (!signal) return timeout;
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([signal, timeout]);
  return timeout;
}

export async function analyzeConversation(text: string, signal?: AbortSignal): Promise<AnalyzeResponse> {
  let response: Response;
  try {
    response = await fetch(`${BASE}/api/v1/conversations/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // The browser's clock is sent so relative dates resolve the way the user
      // means them, not the way the server's timezone would.
      body: JSON.stringify({
        text,
        occurred_at: new Date().toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        client: { app: 'lifelog-test-console', version: '1.0.0', platform: 'web' },
      }),
      signal: withTimeout(signal, ANALYZE_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof LifelogApiError) throw error;
    const aborted = error instanceof Error && error.name === 'AbortError';
    throw new LifelogApiError(aborted ? 504 : 0, {
      code: aborted ? 'AI_TIMEOUT' : 'UNKNOWN',
      message: aborted
        ? 'Analyzing that message took too long. Please try again.'
        : 'The backend did not respond. Check that it is running on port 4319.',
    });
  }

  if (!response.ok) await parseError(response);
  return parseJson<AnalyzeResponse>(response);
}

export async function fetchHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const response = await fetch(`${BASE}/health`, { signal });
  if (!response.ok && response.status !== 503) await parseError(response);
  return (await response.json()) as HealthResponse;
}

export async function fetchTasks(signal?: AbortSignal): Promise<ActionListResponse> {
  const response = await fetch(`${BASE}/api/v1/tasks`, { signal });
  if (!response.ok) await parseError(response);
  return (await response.json()) as ActionListResponse;
}

export async function fetchReminders(signal?: AbortSignal): Promise<ActionListResponse> {
  const response = await fetch(`${BASE}/api/v1/reminders`, { signal });
  if (!response.ok) await parseError(response);
  return (await response.json()) as ActionListResponse;
}

/** Tasks only. Reminders are never ticked off by the user. */
export async function updateTaskStatus(
  id: string,
  status: ActionStatus,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(`${BASE}/api/v1/tasks/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
    signal,
  });

  if (!response.ok) await parseError(response);
}
