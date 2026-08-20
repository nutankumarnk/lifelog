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
  let payload: ApiError['error'] | null = null;
  try {
    payload = ((await response.json()) as ApiError).error;
  } catch {
    payload = null;
  }

  throw new LifelogApiError(
    response.status,
    payload ?? { code: 'UNKNOWN', message: `Request failed with status ${response.status}.` },
  );
}

export async function analyzeConversation(text: string, signal?: AbortSignal): Promise<AnalyzeResponse> {
  const response = await fetch(`${BASE}/api/v1/conversations/analyze`, {
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
    signal,
  });

  if (!response.ok) await parseError(response);
  return (await response.json()) as AnalyzeResponse;
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
