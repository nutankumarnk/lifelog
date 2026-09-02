/**
 * Shows the exact prompt Lifelog sent to the model, and the raw reply.
 * This is a test-console inspector — it is not part of the product UI.
 */
import { useState } from 'react';
import type { AiTrace } from '../types';

function pretty(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function AiExchange({ trace }: { trace: AiTrace }) {
  const [openRequest, setOpenRequest] = useState(true);
  const [openResponse, setOpenResponse] = useState(true);
  const system = trace.request.messages.find((message: { role: string; content: string }) => message.role === 'system')?.content ?? '';
  const user = trace.request.messages.find((message: { role: string; content: string }) => message.role === 'user')?.content ?? '';

  return (
    <section className="trace" aria-label="AI request and response">
      <header className="trace__head">
        <h3>AI exchange</h3>
        <span className="trace__meta">
          {trace.request.kind === 'hosted' ? 'hosted API' : 'offline engine'} · {trace.provider} ·{' '}
          {(trace.model ?? '').replace(/:free$/, '') || trace.model}
        </span>
      </header>

      <div className="trace__panel">
        <button type="button" className="toggle" onClick={() => setOpenRequest((value) => !value)}>
          {openRequest ? 'Hide' : 'Show'} sent to AI
        </button>
        {openRequest ? (
          <div className="trace__body">
            <p className="trace__label">System</p>
            <pre className="json json--trace" aria-label="System prompt sent to the AI">
              {system || '(empty)'}
            </pre>
            <p className="trace__label">User</p>
            <pre className="json json--trace" aria-label="User message sent to the AI">
              {user || '(empty)'}
            </pre>
          </div>
        ) : null}
      </div>

      <div className="trace__panel">
        <button type="button" className="toggle" onClick={() => setOpenResponse((value) => !value)}>
          {openResponse ? 'Hide' : 'Show'}{' '}
          {trace.request.kind === 'hosted' ? 'AI API response' : 'offline engine output'}
        </button>
        {openResponse ? (
          <div className="trace__body">
            {trace.request.kind === 'hosted' ? (
              <>
                {trace.response.raw_text.trim() ? (
                  <>
                    <p className="trace__label">Model message (from the API)</p>
                    <pre className="json json--trace" aria-label="Raw text from the AI API">
                      {trace.response.raw_text}
                    </pre>
                  </>
                ) : (
                  <p className="muted">The hosted model returned no message text.</p>
                )}
                {trace.response.parsed !== undefined ? (
                  <>
                    <p className="trace__label">JSON parsed from that message</p>
                    <pre className="json json--trace" aria-label="Parsed model JSON">
                      {pretty(trace.response.parsed)}
                    </pre>
                  </>
                ) : null}
              </>
            ) : (
              <>
                <p className="muted">
                  No AI API was called. There is no OpenRouter key, so this object was built here by
                  Lifelog&apos;s offline rule engine — it is not an API response.
                </p>
                {trace.response.parsed !== undefined ? (
                  <>
                    <p className="trace__label">Offline engine object (not from an API)</p>
                    <pre className="json json--trace" aria-label="Offline engine output">
                      {pretty(trace.response.parsed)}
                    </pre>
                  </>
                ) : (
                  <p className="muted">No engine output was recorded.</p>
                )}
              </>
            )}
          </div>
        ) : null}
      </div>

      {trace.attempts.length > 0 ? (
        <ul className="trace__attempts">
          {trace.attempts.map((attempt: any, index: number) => (
            <li key={`${attempt.provider}-${attempt.attempt}-${index}`}>
              <code>{attempt.status}</code> {attempt.provider} / {attempt.model} · {attempt.latency_ms}{' '}
              ms
              {attempt.error_kind ? ` · ${attempt.error_kind}` : ''}
              {attempt.error_message ? ` — ${attempt.error_message}` : ''}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
