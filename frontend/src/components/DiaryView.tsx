import { useCallback, useEffect, useState } from 'react';
import { deleteNote, fetchNoteDetail, fetchNotes, updateNote } from '../api';
import type { NoteDetail, NoteEntry, NotePagination } from '../types';

interface DiaryViewProps {
  onSwitchToLive?: () => void;
}

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

const MOOD_MAP: Record<string, { icon: string; bg: string; text: string; border: string }> = {
  Productive: { icon: '⚡', bg: 'rgba(251, 191, 36, 0.12)', text: '#fbbf24', border: 'rgba(251, 191, 36, 0.3)' },
  Reflective: { icon: '💭', bg: 'rgba(192, 132, 252, 0.12)', text: '#d8b4fe', border: 'rgba(192, 132, 252, 0.3)' },
  Excited: { icon: '🌟', bg: 'rgba(74, 222, 128, 0.12)', text: '#4ade80', border: 'rgba(74, 222, 128, 0.3)' },
  Calm: { icon: '🌿', bg: 'rgba(94, 234, 212, 0.12)', text: '#5eead4', border: 'rgba(94, 234, 212, 0.3)' },
  Nostalgic: { icon: '⏳', bg: 'rgba(244, 114, 182, 0.12)', text: '#f472b6', border: 'rgba(244, 114, 182, 0.3)' },
  Anxious: { icon: '🌧️', bg: 'rgba(248, 113, 113, 0.12)', text: '#f87171', border: 'rgba(248, 113, 113, 0.3)' },
  Focused: { icon: '🎯', bg: 'rgba(125, 211, 252, 0.12)', text: '#7dd3fc', border: 'rgba(125, 211, 252, 0.3)' },
  Neutral: { icon: '📝', bg: 'rgba(148, 163, 184, 0.12)', text: '#cbd5e1', border: 'rgba(148, 163, 184, 0.3)' },
};

export function DiaryView({ onSwitchToLive }: DiaryViewProps) {
  const [notes, setNotes] = useState<NoteEntry[]>([]);
  const [pagination, setPagination] = useState<NotePagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selectedNoteDetail, setSelectedNoteDetail] = useState<NoteDetail | null>(null);
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);
  const [showOriginalMap, setShowOriginalMap] = useState<Record<string, boolean>>({});
  const [currentPage, setCurrentPage] = useState(1);

  // Note editing state
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editMood, setEditMood] = useState('Neutral');
  const [editProse, setEditProse] = useState('');
  const [isSavingId, setIsSavingId] = useState<string | null>(null);
  const [deletingNoteId, setDeletingNoteId] = useState<string | null>(null);

  const loadNotes = useCallback(async (page: number, querySearch?: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchNotes({ page, limit: 15, search: querySearch || undefined });
      setNotes(res.notes);
      setPagination(res.pagination);
      setCurrentPage(page);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load journal entries');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadNotes(1, search);
  }, [loadNotes, search]);

  const toggleOriginal = (noteId: string) => {
    setShowOriginalMap((prev) => ({ ...prev, [noteId]: !prev[noteId] }));
  };

  const startEditing = (entry: NoteEntry) => {
    setEditingNoteId(entry.id);
    setEditTitle(entry.journal?.title || 'Personal Journal Entry');
    setEditMood(entry.journal?.mood || 'Neutral');
    setEditProse(entry.journal?.polished_entry || entry.original_text);
  };

  const cancelEditing = () => {
    setEditingNoteId(null);
  };

  const saveEditing = async (noteId: string) => {
    setIsSavingId(noteId);
    try {
      const updated = await updateNote(noteId, {
        title: editTitle,
        mood: editMood,
        polished_entry: editProse,
      });

      setNotes((prevNotes) =>
        prevNotes.map((n) => (n.id === noteId ? { ...n, journal: updated.journal } : n)),
      );
      setEditingNoteId(null);
    } catch (err) {
      console.error('Failed to save edited diary entry:', err);
    } finally {
      setIsSavingId(null);
    }
  };

  const viewNoteDetails = async (noteId: string) => {
    if (selectedNoteDetail?.id === noteId) {
      setSelectedNoteDetail(null);
      return;
    }
    setDetailLoadingId(noteId);
    try {
      const detail = await fetchNoteDetail(noteId);
      setSelectedNoteDetail(detail);
    } catch (err) {
      console.error('Failed to load note detail:', err);
    } finally {
      setDetailLoadingId(null);
    }
  };

  const removeNote = async (entry: NoteEntry) => {
    const title = entry.journal?.title || 'this journal entry';
    if (!window.confirm(`Delete “${title}”? This cannot be undone.`)) return;

    setDeletingNoteId(entry.id);
    setError(null);
    try {
      await deleteNote(entry.id);
      if (selectedNoteDetail?.id === entry.id) setSelectedNoteDetail(null);
      if (editingNoteId === entry.id) setEditingNoteId(null);

      const remainingOnPage = notes.length - 1;
      const nextPage = remainingOnPage === 0 && currentPage > 1 ? currentPage - 1 : currentPage;
      await loadNotes(nextPage, search);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete journal entry');
    } finally {
      setDeletingNoteId(null);
    }
  };

  // Group notes by calendar date
  const groupedNotes = notes.reduce<Record<string, NoteEntry[]>>((acc, note) => {
    const date = new Date(note.occurred_at || note.created_at);
    const dateKey = Number.isNaN(date.getTime())
      ? 'Unknown Date'
      : date.toLocaleDateString(undefined, {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        });
    if (!acc[dateKey]) acc[dateKey] = [];
    acc[dateKey].push(note);
    return acc;
  }, {});

  const formatTime = (isoString: string) => {
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="diary-container">
      {/* Diary Header */}
      <header className="diary-header">
        <div className="diary-header__title-area">
          <div className="diary-header__icon">📖</div>
          <div>
            <h2 className="diary-header__title">Personal Journal & Diary</h2>
            <p className="diary-header__subtitle">
              Personalized, grammar-polished entries with full timestamps and grounded life records.
            </p>
          </div>
        </div>

        <div className="diary-header__actions">
          <input
            type="text"
            className="diary-search-input"
            placeholder="Search diary entries…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button
            type="button"
            className="diary-refresh-btn"
            onClick={() => void loadNotes(currentPage, search)}
            title="Refresh diary entries"
          >
            🔄 Refresh
          </button>
        </div>
      </header>

      {/* Diary Content */}
      <div className="diary-book">
        {loading && notes.length === 0 ? (
          <div className="diary-loading">
            <div className="diary-loading__spinner" />
            <p>Flipping through your journal pages…</p>
          </div>
        ) : error ? (
          <div className="diary-error">
            <h3>Could not open journal</h3>
            <p>{error}</p>
            <button type="button" className="primary" onClick={() => void loadNotes(1)}>
              Retry
            </button>
          </div>
        ) : notes.length === 0 ? (
          <div className="diary-empty-book">
            <div className="diary-empty-book__icon">📜</div>
            <h3>Your Diary is Empty</h3>
            <p>
              Write or speak something in the Live Analysis console. Lifelog will correct grammar,
              generate a personalized diary entry, and log your thoughts with exact timestamps.
            </p>
            {onSwitchToLive && (
              <button type="button" className="primary" onClick={onSwitchToLive}>
                ✍️ Write First Entry
              </button>
            )}
          </div>
        ) : (
          <div className="diary-pages">
            {Object.entries(groupedNotes).map(([dateStr, entries]) => (
              <section key={dateStr} className="diary-day-group">
                <div className="diary-day-ribbon">
                  <span className="diary-day-ribbon__icon">📅</span>
                  <span className="diary-day-ribbon__text">{dateStr}</span>
                  <span className="diary-day-ribbon__count">
                    {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
                  </span>
                </div>

                <div className="diary-day-entries">
                  {entries.map((entry) => {
                    const isExpanded = selectedNoteDetail?.id === entry.id;
                    const isEditing = editingNoteId === entry.id;
                    const isLoadingDetail = detailLoadingId === entry.id;
                    const isSaving = isSavingId === entry.id;
                    const isDeleting = deletingNoteId === entry.id;
                    const isShowingOriginal = showOriginalMap[entry.id];
                    const journal = entry.journal;
                    const moodConfig = MOOD_MAP[journal?.mood || 'Neutral'] || MOOD_MAP.Neutral;
                    const entryTime = formatTime(entry.occurred_at || entry.created_at);

                    return (
                      <article
                        key={entry.id}
                        className={`diary-entry-card ${isExpanded ? 'diary-entry-card--expanded' : ''} ${
                          isEditing ? 'diary-entry-card--editing' : ''
                        }`}
                      >
                        <div className="diary-entry-card__margin">
                          <span className="diary-entry-time">{entryTime}</span>
                          <span className="diary-entry-source-badge">{entry.source}</span>
                        </div>

                        <div className="diary-entry-card__body">
                          {isEditing ? (
                            /* Inline Edit Mode */
                            <div className="diary-inline-edit-form">
                              <div className="edit-form-group">
                                <label>Entry Title:</label>
                                <input
                                  type="text"
                                  className="edit-form-input"
                                  value={editTitle}
                                  onChange={(e) => setEditTitle(e.target.value)}
                                  placeholder="Entry headline…"
                                />
                              </div>

                              <div className="edit-form-group">
                                <label>Mood / Tone:</label>
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
                                  placeholder="Polished first-person diary entry…"
                                />
                              </div>

                              <div className="edit-form-actions">
                                <button
                                  type="button"
                                  className="edit-form-save-btn"
                                  disabled={isSaving || !editProse.trim()}
                                  onClick={() => void saveEditing(entry.id)}
                                >
                                  {isSaving ? 'Saving…' : '💾 Save Changes'}
                                </button>
                                <button
                                  type="button"
                                  className="edit-form-cancel-btn"
                                  onClick={cancelEditing}
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            /* Standard View Mode */
                            <>
                              {/* Entry Title and Mood Banner */}
                              <div className="diary-entry-card__header">
                                <h3 className="diary-entry-title">
                                  {journal?.title || 'Personal Journal Entry'}
                                </h3>
                                <div className="diary-entry-actions">
                                  {journal?.mood && (
                                    <span
                                      className="diary-mood-pill"
                                      style={{
                                        background: moodConfig.bg,
                                        color: moodConfig.text,
                                        borderColor: moodConfig.border,
                                      }}
                                    >
                                      {moodConfig.icon} {journal.mood}
                                    </span>
                                  )}
                                  <button
                                    type="button"
                                    className="diary-edit-icon-btn"
                                    onClick={() => startEditing(entry)}
                                    disabled={isDeleting}
                                    title="Edit this journal entry"
                                  >
                                    ✏️ Edit
                                  </button>
                                  <button
                                    type="button"
                                    className="diary-delete-icon-btn"
                                    onClick={() => void removeNote(entry)}
                                    disabled={isDeleting}
                                    title="Delete this journal entry"
                                  >
                                    {isDeleting ? 'Deleting…' : '🗑 Delete'}
                                  </button>
                                </div>
                              </div>

                              {/* Polished Journal Narrative (Grammar Refined) */}
                              <div className="diary-entry-narrative">
                                <p>{journal?.polished_entry || entry.original_text}</p>
                              </div>

                              {/* Highlights bullet points */}
                              {journal?.highlights && journal.highlights.length > 0 && (
                                <div className="diary-highlights-box">
                                  <span className="highlights-tag">Key Highlights:</span>
                                  <ul className="highlights-list">
                                    {journal.highlights.map((highlight, idx) => (
                                      <li key={idx}>{highlight}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </>
                          )}

                          {/* Collapsible Original Spoken Words */}
                          <div className="diary-original-section">
                            <button
                              type="button"
                              className="diary-toggle-raw-btn"
                              onClick={() => toggleOriginal(entry.id)}
                            >
                              {isShowingOriginal
                                ? '▲ Hide Original Spoken Words'
                                : '▼ View Original Words as Spoken'}
                            </button>
                            {isShowingOriginal && (
                              <div className="diary-original-quote">
                                <span className="quote-label">Original transcript at {entryTime}:</span>
                                <p>“{entry.original_text}”</p>
                              </div>
                            )}
                          </div>

                          {/* Action footer */}
                          <div className="diary-entry-footer">
                            <button
                              type="button"
                              className="diary-inspect-btn"
                              onClick={() => void viewNoteDetails(entry.id)}
                            >
                              {isLoadingDetail
                                ? 'Reading memory graph…'
                                : isExpanded
                                  ? 'Hide Extracted Details ▲'
                                  : 'Inspect Extracted Events & Objects ▼'}
                            </button>
                            <span className="diary-entry-id">id: {entry.id.slice(0, 8)}…</span>
                          </div>

                          {/* Expanded Detail Panel */}
                          {isExpanded && selectedNoteDetail && (
                            <div className="diary-detail-panel">
                              <h4 className="diary-detail-title">
                                🔍 Extracted Graph & Intelligence for this Entry
                              </h4>

                              {selectedNoteDetail.objects && selectedNoteDetail.objects.length > 0 ? (
                                <div className="diary-objects-grid">
                                  {selectedNoteDetail.objects.map((obj) => (
                                    <div
                                      key={obj.id}
                                      className={`diary-obj-card diary-obj-card--${obj.type.toLowerCase()}`}
                                    >
                                      <div className="diary-obj-card__head">
                                        <span className="diary-obj-card__type">
                                          {obj.type === 'entity'
                                            ? obj.kind || 'ENTITY'
                                            : obj.type.replace(/_/g, ' ')}
                                        </span>
                                        <span className="diary-obj-card__conf">
                                          {Math.round((obj.confidence ?? 0.8) * 100)}%
                                        </span>
                                      </div>
                                      <h5 className="diary-obj-card__name">{obj.name}</h5>
                                      {obj.summary && (
                                        <p className="diary-obj-card__summary">{obj.summary}</p>
                                      )}
                                      {obj.source_text && (
                                        <span className="diary-obj-card__source">
                                          “{obj.source_text}”
                                        </span>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <p className="diary-detail-none">
                                  No distinct structured objects recorded for this entry.
                                </p>
                              )}

                              {selectedNoteDetail.relationships &&
                                selectedNoteDetail.relationships.length > 0 && (
                                  <div className="diary-relationships">
                                    <h5>Identified Connections:</h5>
                                    <ul className="diary-rel-list">
                                      {selectedNoteDetail.relationships.map((rel, idx) => (
                                        <li key={idx} className="diary-rel-item">
                                          <strong>{rel.source_object}</strong>
                                          <span className="diary-rel-arrow">
                                            {' '}
                                            ➔ ({rel.relationship_type}) ➔{' '}
                                          </span>
                                          <strong>{rel.target_object}</strong>
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                            </div>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            ))}

            {/* Pagination Controls */}
            {pagination && pagination.total_pages > 1 && (
              <div className="diary-pagination">
                <button
                  type="button"
                  className="diary-page-btn"
                  disabled={currentPage <= 1}
                  onClick={() => void loadNotes(currentPage - 1, search)}
                >
                  ◀ Newer Entries
                </button>
                <span className="diary-page-indicator">
                  Page {currentPage} of {pagination.total_pages} ({pagination.total} total notes)
                </span>
                <button
                  type="button"
                  className="diary-page-btn"
                  disabled={currentPage >= pagination.total_pages}
                  onClick={() => void loadNotes(currentPage + 1, search)}
                >
                  Older Entries ▶
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
