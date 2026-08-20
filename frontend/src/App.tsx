/**
 * Lifelog Phase 1 test console.
 *
 * A throwaway harness for exercising the backend by hand. It is not the Lifelog
 * product UI and should not grow into one — see docs/functionality.md.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { analyzeConversation, fetchHealth, LifelogApiError } from './api';
import { ResultPanel } from './components/ResultPanel';
import { TaskList } from './components/TaskList';
import { SAMPLES } from './samples';
import type { AnalyzeResponse, HealthResponse } from './types';

const MAX_CHARS = 20_000;

function HealthBadge({ health, error }: { health: HealthResponse | null; error: boolean }) {
  if (error) {
    return (
      <span className="health health--error" title="The backend is not reachable">
        <i />
        backend offline
      </span>
    );
  }
  if (!health) {
    return (
      <span className="health health--pending">
        <i />
        checking…
      </span>
    );
  }

  return (
    <span
      className={`health health--${health.status}`}
      title={`database: ${health.checks.database} · ai provider: ${health.checks.ai_provider}`}
    >
      <i />
      backend {health.status} · db {health.checks.database} · ai {health.checks.ai_provider}
    </span>
  );
}

export function App() {
  const [text, setText] = useState('');
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<{ title: string; detail: string; requestId?: string } | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthError, setHealthError] = useState(false);
  const [taskRefreshKey, setTaskRefreshKey] = useState(0);

  const abortRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchHealth(controller.signal)
      .then((value) => {
        setHealth(value);
        setHealthError(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) setHealthError(true);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!loading) {
      setElapsedMs(0);
      return;
    }
    const started = Date.now();
    const id = window.setInterval(() => setElapsedMs(Date.now() - started), 200);
    return () => window.clearInterval(id);
  }, [loading]);

  const submit = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);

    try {
      const response = await analyzeConversation(text, controller.signal);
      setResult(response);
      setTaskRefreshKey((key) => key + 1);
    } catch (caught) {
      if (controller.signal.aborted) return;

      if (caught instanceof LifelogApiError) {
        setError({
          title: caught.code.replace(/_/g, ' ').toLowerCase(),
          detail: caught.message,
          requestId: caught.requestId,
        });
      } else {
        setError({
          title: 'connection failed',
          detail: 'The backend did not respond. Check that it is running on port 4319.',
        });
      }
      setResult(null);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [text, loading]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      void submit();
    }
  };

  const useSample = (sample: string) => {
    setText(sample);
    textareaRef.current?.focus();
  };

  const overLimit = text.length > MAX_CHARS;

  return (
    <div className="app">
      <header className="masthead">
        <div className="masthead__brand">
          <h1>Lifelog</h1>
          <p>Phase 1 — conversation understanding test console</p>
        </div>
        <HealthBadge health={health} error={healthError} />
      </header>

      <main className="layout">
        <section className="panel panel--input" aria-label="Conversation input">
          <label className="label" htmlFor="conversation">
            Write something the way you would to a friend
          </label>
          <textarea
            id="conversation"
            ref={textareaRef}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="I met Arun yesterday in Ahmedabad and I need to send him the project files by Friday."
            rows={6}
            spellCheck={false}
          />

          <div className="controls">
            <span className={`counter${overLimit ? ' counter--over' : ''}`}>
              {text.length.toLocaleString()} / {MAX_CHARS.toLocaleString()}
            </span>
            <span className="hint">⌘/Ctrl + Enter</span>
            <button
              type="button"
              className="primary"
              onClick={() => void submit()}
              disabled={loading || !text.trim() || overLimit}
            >
              {loading ? 'Analyzing…' : 'Analyze'}
            </button>
          </div>

          <div className="samples">
            <span className="label">Try one</span>
            <div className="samples__list">
              {SAMPLES.map((sample) => (
                <button
                  key={sample.label}
                  type="button"
                  className="sample"
                  title={sample.hint}
                  onClick={() => useSample(sample.text)}
                >
                  {sample.label}
                </button>
              ))}
            </div>
          </div>
        </section>

        <div className="column">
          <section className="panel panel--output" aria-label="Analysis output" aria-busy={loading}>
            {loading ? (
              <div className="loading">
                <div className="skeleton skeleton--head" />
                <div className="skeleton" />
                <div className="skeleton skeleton--short" />
                <p className="muted">
                  Asking the AI model… {(elapsedMs / 1000).toFixed(1)}s
                  {elapsedMs > 4_000
                    ? ' — the free model is busy; Lifelog will use its offline engine if it does not answer.'
                    : ''}
                </p>
              </div>
            ) : error ? (
              <div className="errorbox" role="alert">
                <h3>{error.title}</h3>
                <p>{error.detail}</p>
                {error.requestId ? (
                  <p className="muted">
                    Request id <code>{error.requestId}</code>
                  </p>
                ) : null}
              </div>
            ) : result ? (
              <ResultPanel result={result} />
            ) : (
              <div className="empty empty--initial">
                <h3>Nothing analyzed yet</h3>
                <p>
                  Type a message or pick a sample. Lifelog will break it into people, places, events,
                  tasks, reminders, decisions and feelings — and show you the exact words each one
                  came from.
                </p>
              </div>
            )}
          </section>

          <TaskList refreshKey={taskRefreshKey} />
        </div>
      </main>

      <footer className="foot">
        <span>Temporary harness. Talks only to the backend API — no keys, no model, no database.</span>
      </footer>
    </div>
  );
}
