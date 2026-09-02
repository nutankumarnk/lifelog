import { useEffect, useState } from 'react';
import { updateNote } from '../api';
import type { AnalyzeResponse, JournalEntry } from '../types';
import { ConnectionsPanel } from './ConnectionsPanel';
import { EventsPanel } from './EventsPanel';
import { ItemCard } from './ItemCard';

const MOOD_OPTIONS = [
  'Productive',
  'Reflective',
  'Excited',
  'Calm',
  'Nostalgic',
  'Focused',
  'Anxious',
  'Neutral',
];

export function ResultPanel({ result }: { result: AnalyzeResponse }) {
  const [showRaw, setShowRaw] = useState(false);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    events: true,
    connections: true,
    tasks: true,
    memories: true,
  });

  const { analysis, meta } = result;

  // Local state for journal editing
  const [currentJournal, setCurrentJournal] = useState<JournalEntry | undefined>(analysis.journal);
  const [isEditingJournal, setIsEditingJournal] = useState(false);
  const [editTitle, setEditTitle] = useState(analysis.journal?.title || '');
  const [editMood, setEditMood] = useState(analysis.journal?.mood || 'Neutral');
  const [editProse, setEditProse] = useState(analysis.journal?.polished_entry || analysis.summary || '');
  const [isSavingJournal, setIsSavingJournal] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    setCurrentJournal(analysis.journal);
    setEditTitle(analysis.journal?.title || '');
    setEditMood(analysis.journal?.mood || 'Neutral');
    setEditProse(analysis.journal?.polished_entry || analysis.summary || '');
    setIsEditingJournal(false);
    setSaveSuccess(false);
  }, [analysis.journal, analysis.summary]);

  const handleSaveJournal = async () => {
    if (!result.conversationId) return;
    setIsSavingJournal(true);
    try {
      const updated = await updateNote(result.conversationId, {
        title: editTitle,
        mood: editMood,
        polished_entry: editProse,
      });
      if (updated.journal) {
        setCurrentJournal(updated.journal);
      }
      setIsEditingJournal(false);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      console.error('Failed to update journal entry:', err);
    } finally {
      setIsSavingJournal(false);
    }
  };

  const toggleSection = (sectionKey: string) => {
    setOpenSections((prev) => ({ ...prev, [sectionKey]: !prev[sectionKey] }));
  };

  const eventItems = analysis.items.filter(
    (item) => item.type === 'PAST_EVENT' || item.type === 'FUTURE_EVENT',
  );
  const taskItems = analysis.items.filter((item) => item.type === 'TASK');
  const reminderItems = analysis.items.filter((item) => item.type === 'REMINDER');
  const memoryAndFeelingItems = analysis.items.filter(
    (item) =>
      item.type === 'MEMORY' ||
      item.type === 'FEELING' ||
      item.type === 'DECISION' ||
      item.type === 'PRESENT_FACT',
  );

  return (
    <section className="result" aria-label="Analysis result">
      <header className="result__head">
        <div>
          <span className="label">Detected Intent</span>
          <strong className="intent">
            {(analysis.intent ?? 'UNKNOWN').replace(/_/g, ' ').toLowerCase()}
          </strong>
          <span className="confidence">{Math.round((analysis.intent_confidence ?? 0) * 100)}%</span>
        </div>
        <div className="result__meta">
          <span title="Adapter">{meta.provider}</span>
          <span title="Model identifier">{(meta.model ?? '').replace(/:free$/, '') || meta.model}</span>
          <span>{meta.latency_ms} ms</span>
          <span title="Detected language">{analysis.language}</span>
        </div>
      </header>

      {/* Personalized Diary Entry Card with "I translated it this way" and Inline Editor */}
      {currentJournal ? (
        <div className="result__diary-preview">
          <div className="diary-preview__header">
            <div className="diary-preview__prompt-label">
              <span className="diary-preview__icon">✨</span>
              <span className="diary-preview__badge">I translated & phrased your diary entry this way</span>
            </div>
            <div className="diary-preview__header-actions">
              {currentJournal.mood && !isEditingJournal && (
                <span className="diary-preview__mood">
                  Mood: <strong>{currentJournal.mood}</strong>
                </span>
              )}
              {!isEditingJournal ? (
                <button
                  type="button"
                  className="diary-preview__edit-btn"
                  onClick={() => setIsEditingJournal(true)}
                >
                  ✏️ Edit Phrasing
                </button>
              ) : null}
            </div>
          </div>

          {saveSuccess && (
            <div className="diary-preview__success-badge">
              ✓ Successfully updated & saved to your personal diary!
            </div>
          )}

          {!isEditingJournal ? (
            <>
              <h3 className="diary-preview__title">{currentJournal.title || 'Personal Reflection'}</h3>
              <p className="diary-preview__prose">{currentJournal.polished_entry || analysis.summary}</p>
              {currentJournal.highlights && currentJournal.highlights.length > 0 && (
                <div className="diary-preview__highlights">
                  <span className="highlights-label">Key Highlights:</span>
                  <ul>
                    {currentJournal.highlights.map((h, i) => (
                      <li key={i}>{h}</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          ) : (
            <div className="diary-preview__edit-form">
              <div className="edit-form-group">
                <label>Diary Entry Title:</label>
                <input
                  type="text"
                  className="edit-form-input"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  placeholder="Give this entry a memorable title…"
                />
              </div>

              <div className="edit-form-group">
                <label>Mood / Emotional Tone:</label>
                <select
                  className="edit-form-select"
                  value={editMood}
                  onChange={(e) => setEditMood(e.target.value)}
                >
                  {MOOD_OPTIONS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>

              <div className="edit-form-group">
                <label>Polished Narrative Prose:</label>
                <textarea
                  className="edit-form-textarea"
                  rows={4}
                  value={editProse}
                  onChange={(e) => setEditProse(e.target.value)}
                  placeholder="Refine the wording of your diary entry…"
                />
              </div>

              <div className="edit-form-actions">
                <button
                  type="button"
                  className="edit-form-save-btn"
                  disabled={isSavingJournal || !editProse.trim()}
                  onClick={() => void handleSaveJournal()}
                >
                  {isSavingJournal ? 'Saving…' : '💾 Save to Diary'}
                </button>
                <button
                  type="button"
                  className="edit-form-cancel-btn"
                  onClick={() => {
                    setIsEditingJournal(false);
                    setEditTitle(currentJournal.title);
                    setEditMood(currentJournal.mood);
                    setEditProse(currentJournal.polished_entry);
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      ) : analysis.summary ? (
        <div className="result__summary-banner">
          <span className="summary-label">TL;DR Summary</span>
          <p className="summary-text">{analysis.summary}</p>
        </div>
      ) : null}

      {/* Token Usage Bar */}
      {meta.usage && (
        <div className="usage">
          <span className="label">Tokens this request</span>
          <strong>{meta.usage.total_tokens.toLocaleString()}</strong>
          <span className="usage__parts">
            {meta.usage.prompt_tokens.toLocaleString()} prompt ·{' '}
            {meta.usage.completion_tokens.toLocaleString()} completion
          </span>
          <span className={`usage__source usage__source--${meta.usage.source}`}>
            {meta.usage.source === 'estimated' ? 'estimated' : 'measured'}
          </span>
        </div>
      )}

      {/* Warnings / Degradation Notices */}
      {meta.degraded ? (
        <p className="notice notice--warn">
          <strong>The AI model did not answer.</strong> This reading came from Lifelog's offline
          engine, so it understands less of what you meant.
        </p>
      ) : (
        <p className="notice notice--ok">
          ✨ Successfully interpreted by AI model ({(meta.model ?? '').replace(/:free$/, '') || 'hosted'}).
        </p>
      )}

      {/* Follow Up Questions */}
      {analysis.follow_up && (
        <div className={`followup${analysis.follow_up.blocking ? ' followup--blocking' : ''}`}>
          <span className="label">Lifelog follow-up question</span>
          <p className="followup__question">{analysis.follow_up.question}</p>
          <p className="followup__reason">{analysis.follow_up.reason}</p>
        </div>
      )}

      {/* ========================================================================= */}
      {/* SECTION 1: EVENTS (PAST & UPCOMING)                                       */}
      {/* ========================================================================= */}
      <section className="result-section-box">
        <header
          className="result-section-box__head"
          onClick={() => toggleSection('events')}
        >
          <div className="result-section-box__title-group">
            <span className="section-icon">📅</span>
            <h3 className="result-section-box__title">Events Detected</h3>
            <span className="section-badge section-badge--events">
              {eventItems.length}
            </span>
          </div>
          <button type="button" className="section-toggle-btn">
            {openSections.events ? 'Collapse ▲' : 'Expand ▼'}
          </button>
        </header>

        {openSections.events && (
          <div className="result-section-box__body">
            <EventsPanel items={analysis.items} entities={analysis.entities} />
          </div>
        )}
      </section>

      {/* ========================================================================= */}
      {/* SECTION 2: CONNECTIONS & ENTITIES                                         */}
      {/* ========================================================================= */}
      <section className="result-section-box">
        <header
          className="result-section-box__head"
          onClick={() => toggleSection('connections')}
        >
          <div className="result-section-box__title-group">
            <span className="section-icon">👥</span>
            <h3 className="result-section-box__title">People, Places & Connections</h3>
            <span className="section-badge section-badge--connections">
              {analysis.entities.length}
            </span>
          </div>
          <button type="button" className="section-toggle-btn">
            {openSections.connections ? 'Collapse ▲' : 'Expand ▼'}
          </button>
        </header>

        {openSections.connections && (
          <div className="result-section-box__body">
            <ConnectionsPanel entities={analysis.entities} items={analysis.items} />
          </div>
        )}
      </section>

      {/* ========================================================================= */}
      {/* SECTION 3: TASKS & REMINDERS (ACTION ITEMS)                               */}
      {/* ========================================================================= */}
      <section className="result-section-box">
        <header
          className="result-section-box__head"
          onClick={() => toggleSection('tasks')}
        >
          <div className="result-section-box__title-group">
            <span className="section-icon">⚡</span>
            <h3 className="result-section-box__title">Tasks & Reminders Captured</h3>
            <span className="section-badge section-badge--tasks">
              {taskItems.length + reminderItems.length}
            </span>
          </div>
          <button type="button" className="section-toggle-btn">
            {openSections.tasks ? 'Collapse ▲' : 'Expand ▼'}
          </button>
        </header>

        {openSections.tasks && (
          <div className="result-section-box__body">
            {taskItems.length === 0 && reminderItems.length === 0 ? (
              <div className="section-empty-hint">
                <span>⚡</span>
                <p>No actionable tasks or scheduled reminders were requested in this message.</p>
              </div>
            ) : (
              <div className="action-items-extracted">
                {taskItems.length > 0 && (
                  <div className="action-subgroup">
                    <h4 className="action-subgroup__title">
                      <span>📌 To-Do Tasks</span>
                      <span className="count">{taskItems.length}</span>
                    </h4>
                    <div className="group__items">
                      {taskItems.map((item) => (
                        <ItemCard key={item.id} item={item} entities={analysis.entities} />
                      ))}
                    </div>
                  </div>
                )}

                {reminderItems.length > 0 && (
                  <div className="action-subgroup">
                    <h4 className="action-subgroup__title">
                      <span>⏰ Scheduled Reminders</span>
                      <span className="count">{reminderItems.length}</span>
                    </h4>
                    <div className="group__items">
                      {reminderItems.map((item) => (
                        <ItemCard key={item.id} item={item} entities={analysis.entities} />
                      ))}
                    </div>
                  </div>
                )}

                <div className="action-sync-notice">
                  ✓ Automatically synced to your global Task & Reminder lists below.
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* ========================================================================= */}
      {/* SECTION 4: MEMORIES, DECISIONS & FEELINGS                                  */}
      {/* ========================================================================= */}
      {memoryAndFeelingItems.length > 0 && (
        <section className="result-section-box">
          <header
            className="result-section-box__head"
            onClick={() => toggleSection('memories')}
          >
            <div className="result-section-box__title-group">
              <span className="section-icon">💭</span>
              <h3 className="result-section-box__title">Memories, Decisions & Feelings</h3>
              <span className="section-badge section-badge--memories">
                {memoryAndFeelingItems.length}
              </span>
            </div>
            <button type="button" className="section-toggle-btn">
              {openSections.memories ? 'Collapse ▲' : 'Expand ▼'}
            </button>
          </header>

          {openSections.memories && (
            <div className="result-section-box__body">
              <div className="group__items">
                {memoryAndFeelingItems.map((item) => (
                  <ItemCard key={item.id} item={item} entities={analysis.entities} />
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {/* Missing information notes */}
      {analysis.missing_information.length > 0 && (
        <section className="group">
          <h3 className="group__title">
            Missing information <span className="count">{analysis.missing_information.length}</span>
          </h3>
          <ul className="plain">
            {analysis.missing_information.map((entry) => (
              <li key={`${entry.field}-${entry.about_item_id ?? ''}`}>
                <code>{entry.field}</code> — {entry.reason}{' '}
                <span className="muted">({entry.importance.toLowerCase()})</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Pipeline notes */}
      {analysis.warnings.length > 0 && (
        <section className="group">
          <h3 className="group__title">
            Pipeline notes <span className="count">{analysis.warnings.length}</span>
          </h3>
          <ul className="plain">
            {analysis.warnings.map((warning, index) => (
              <li key={`${warning.code}-${index}`}>
                <code>{warning.code}</code> — {warning.message}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Raw JSON toggle */}
      <section className="group">
        <button type="button" className="toggle" onClick={() => setShowRaw((value) => !value)}>
          {showRaw ? 'Hide' : 'Show'} Full Raw Analysis JSON
        </button>
        {showRaw && (
          <pre className="json" aria-label="Raw API response">
            {JSON.stringify(result, null, 2)}
          </pre>
        )}
      </section>

      {/* Provenance footer */}
      <footer className="result__ids">
        <span>
          conversation <code>{result.conversationId}</code>
        </span>
        <span>
          analysis <code>{result.analysisId}</code>
        </span>
      </footer>
    </section>
  );
}
