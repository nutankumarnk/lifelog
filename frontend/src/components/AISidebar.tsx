import { useEffect, useRef, useState } from 'react';
import type { AnalyzeResponse } from '../types';

interface AISidebarProps {
  result: AnalyzeResponse;
  onClose: () => void;
}

function pretty(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function AISidebar({ result, onClose }: AISidebarProps) {
  const sidebarRef = useRef<HTMLDivElement>(null);
  const [activeStep, setActiveStep] = useState<number | 'all'>('all');
  const [copiedSection, setCopiedSection] = useState<string | null>(null);

  // Close on Escape key
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  // Close on backdrop click
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  const copyToClipboard = async (text: string, sectionKey: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedSection(sectionKey);
      setTimeout(() => setCopiedSection(null), 2000);
    } catch {
      // Fallback or ignore
    }
  };

  const { analysis, meta } = result;
  const exchange = meta.ai_exchange;
  const reqData = exchange?.request as Record<string, unknown> | undefined;

  const systemInstructions =
    (reqData?.system_instructions as string | undefined) ||
    (reqData?.instructions as string | undefined) ||
    '';

  const userMessage =
    (reqData?.user_message as string | undefined) ||
    (reqData?.userMessage as string | undefined) ||
    '';

  const rawPayload = reqData?.chat_payload ?? reqData ?? exchange?.request;

  return (
    <div className="ai-sidebar-backdrop" onClick={handleBackdropClick}>
      <aside className="ai-sidebar" ref={sidebarRef} aria-label="AI exchange details">
        {/* Header */}
        <header className="ai-sidebar__header">
          <div className="ai-sidebar__header-info">
            <div className="ai-sidebar__title-row">
              <span className="ai-sidebar__badge-icon">🧠</span>
              <h2 className="ai-sidebar__title">AI Intelligence & Pipeline Inspector</h2>
            </div>
            <p className="ai-sidebar__subtitle">
              Step-by-step trace of the prompt, system instructions, and raw AI response
            </p>
          </div>
          <button className="ai-sidebar__close" onClick={onClose} aria-label="Close sidebar">
            ✕
          </button>
        </header>

        {/* Step Navigation Filters */}
        <div className="ai-sidebar__step-nav">
          <button
            type="button"
            className={`step-filter-btn ${activeStep === 'all' ? 'step-filter-btn--active' : ''}`}
            onClick={() => setActiveStep('all')}
          >
            All Steps
          </button>
          <button
            type="button"
            className={`step-filter-btn ${activeStep === 1 ? 'step-filter-btn--active' : ''}`}
            onClick={() => setActiveStep(1)}
          >
            1. Instructions
          </button>
          <button
            type="button"
            className={`step-filter-btn ${activeStep === 2 ? 'step-filter-btn--active' : ''}`}
            onClick={() => setActiveStep(2)}
          >
            2. Prompt & Payload
          </button>
          <button
            type="button"
            className={`step-filter-btn ${activeStep === 3 ? 'step-filter-btn--active' : ''}`}
            onClick={() => setActiveStep(3)}
          >
            3. Raw AI Response
          </button>
          <button
            type="button"
            className={`step-filter-btn ${activeStep === 4 ? 'step-filter-btn--active' : ''}`}
            onClick={() => setActiveStep(4)}
          >
            4. Parsed Journal
          </button>
        </div>

        <div className="ai-sidebar__body">
          {/* Metadata Bar */}
          <section className="ai-sidebar__section ai-sidebar__section--meta">
            <div className="ai-sidebar__meta-grid">
              <div className="ai-sidebar__meta-item">
                <span className="ai-sidebar__meta-label">Provider</span>
                <strong className="ai-sidebar__meta-value">{meta.provider}</strong>
              </div>
              <div className="ai-sidebar__meta-item">
                <span className="ai-sidebar__meta-label">Model</span>
                <strong className="ai-sidebar__meta-value">
                  {(meta.model ?? '').replace(/:free$/, '') || 'offline-engine'}
                </strong>
              </div>
              <div className="ai-sidebar__meta-item">
                <span className="ai-sidebar__meta-label">Latency</span>
                <strong className="ai-sidebar__meta-value">{meta.latency_ms} ms</strong>
              </div>
              <div className="ai-sidebar__meta-item">
                <span className="ai-sidebar__meta-label">Status</span>
                <strong
                  className={`ai-sidebar__meta-value ${
                    meta.degraded ? 'text-amber' : 'text-green'
                  }`}
                >
                  {meta.degraded ? '⚠️ Offline Fallback' : '✨ Hosted Model Active'}
                </strong>
              </div>
              {meta.usage && (
                <>
                  <div className="ai-sidebar__meta-item">
                    <span className="ai-sidebar__meta-label">Prompt Tokens</span>
                    <span className="ai-sidebar__meta-value">
                      {meta.usage.prompt_tokens.toLocaleString()}
                    </span>
                  </div>
                  <div className="ai-sidebar__meta-item">
                    <span className="ai-sidebar__meta-label">Output Tokens</span>
                    <span className="ai-sidebar__meta-value">
                      {meta.usage.completion_tokens.toLocaleString()}
                    </span>
                  </div>
                  <div className="ai-sidebar__meta-item">
                    <span className="ai-sidebar__meta-label">Total Tokens</span>
                    <span className="ai-sidebar__meta-value">
                      {meta.usage.total_tokens.toLocaleString()}
                    </span>
                  </div>
                  <div className="ai-sidebar__meta-item">
                    <span className="ai-sidebar__meta-label">Usage Source</span>
                    <span className="ai-sidebar__meta-value">{meta.usage.source}</span>
                  </div>
                </>
              )}
            </div>
          </section>

          {/* STEP 1: System Instructions & Grounding Rules */}
          {(activeStep === 'all' || activeStep === 1) && (
            <section className="ai-step-card">
              <div className="ai-step-card__header">
                <div className="ai-step-card__title-group">
                  <span className="ai-step-number">Step 1</span>
                  <div>
                    <h3 className="ai-step-title">System Instructions & Extraction Guidelines</h3>
                    <p className="ai-step-desc">
                      The core rules, JSON schema, and personalized diary instructions given to the AI model.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  className="ai-copy-btn"
                  onClick={() =>
                    copyToClipboard(systemInstructions || 'No instructions captured', 'step1')
                  }
                >
                  {copiedSection === 'step1' ? '✓ Copied' : '📋 Copy Prompt'}
                </button>
              </div>

              <div className="ai-step-card__content">
                {systemInstructions ? (
                  <pre className="ai-code-block ai-code-block--instructions">
                    {systemInstructions}
                  </pre>
                ) : (
                  <p className="ai-step-empty">
                    Using deterministic offline extraction rules.
                  </p>
                )}
              </div>
            </section>
          )}

          {/* STEP 2: What We Shared with the AI (Prompt & HTTP Payload) */}
          {(activeStep === 'all' || activeStep === 2) && (
            <section className="ai-step-card">
              <div className="ai-step-card__header">
                <div className="ai-step-card__title-group">
                  <span className="ai-step-number">Step 2</span>
                  <div>
                    <h3 className="ai-step-title">User Message & Request Payload</h3>
                    <p className="ai-step-desc">
                      The exact timestamp clock-preamble, formatted user turn, and HTTP request body.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  className="ai-copy-btn"
                  onClick={() => copyToClipboard(pretty(rawPayload), 'step2')}
                >
                  {copiedSection === 'step2' ? '✓ Copied' : '📋 Copy Payload'}
                </button>
              </div>

              <div className="ai-step-card__content">
                {userMessage && (
                  <div className="ai-subgroup">
                    <span className="ai-subgroup-label">Grounded User Message (with Clock Context):</span>
                    <pre className="ai-code-block">{userMessage}</pre>
                  </div>
                )}

                <div className="ai-subgroup">
                  <span className="ai-subgroup-label">Complete HTTP JSON Request Body:</span>
                  <pre className="ai-code-block">{pretty(rawPayload)}</pre>
                </div>
              </div>
            </section>
          )}

          {/* STEP 3: Raw Response from AI Model */}
          {(activeStep === 'all' || activeStep === 3) && (
            <section className="ai-step-card">
              <div className="ai-step-card__header">
                <div className="ai-step-card__title-group">
                  <span className="ai-step-number ai-step-number--response">Step 3</span>
                  <div>
                    <h3 className="ai-step-title">Raw Response Output from AI</h3>
                    <p className="ai-step-desc">
                      The unadulterated JSON completion received directly from the model host.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  className="ai-copy-btn"
                  onClick={() =>
                    copyToClipboard(
                      pretty(exchange?.response ?? analysis),
                      'step3',
                    )
                  }
                >
                  {copiedSection === 'step3' ? '✓ Copied' : '📋 Copy Response'}
                </button>
              </div>

              <div className="ai-step-card__content">
                {exchange?.response ? (
                  <pre className="ai-code-block ai-code-block--response">
                    {pretty(exchange.response)}
                  </pre>
                ) : (
                  <pre className="ai-code-block ai-code-block--response">
                    {pretty(analysis)}
                  </pre>
                )}
              </div>
            </section>
          )}

          {/* STEP 4: Calibrated & Structured Knowledge Result */}
          {(activeStep === 'all' || activeStep === 4) && (
            <section className="ai-step-card">
              <div className="ai-step-card__header">
                <div className="ai-step-card__title-group">
                  <span className="ai-step-number ai-step-number--success">Step 4</span>
                  <div>
                    <h3 className="ai-step-title">Personalized Journal & Extracted Intelligence</h3>
                    <p className="ai-step-desc">
                      The parsed diary narrative, detected mood, and ground-truth life records stored in database.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  className="ai-copy-btn"
                  onClick={() => copyToClipboard(pretty(analysis), 'step4')}
                >
                  {copiedSection === 'step4' ? '✓ Copied' : '📋 Copy Stored Data'}
                </button>
              </div>

              <div className="ai-step-card__content">
                {analysis.journal && (
                  <div className="ai-journal-preview-card">
                    <div className="ai-journal-preview-head">
                      <span className="journal-tag">📖 Stored Diary Entry</span>
                      <span className="journal-mood-tag">Mood: {analysis.journal.mood}</span>
                    </div>
                    <h4 className="journal-title">{analysis.journal.title}</h4>
                    <p className="journal-prose">{analysis.journal.polished_entry}</p>
                  </div>
                )}

                <div className="ai-subgroup">
                  <span className="ai-subgroup-label">Structured JSON Schema (Analysis):</span>
                  <pre className="ai-code-block">{pretty(analysis)}</pre>
                </div>
              </div>
            </section>
          )}
        </div>
      </aside>
    </div>
  );
}
