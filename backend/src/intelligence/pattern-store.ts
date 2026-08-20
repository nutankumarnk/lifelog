/**
 * Pattern weights + lexicon promotion (curated relearn).
 *
 * Updates runtime weights from disagreement journals. Does NOT rewrite
 * TypeScript source. Lexicon promotions are proposed, not auto-applied to files.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { DisagreementRecord } from './reconcile.js';

export interface PatternWeight {
  feature: string;
  label: string;
  weight: number;
  wins: number;
  losses: number;
}

export interface LexiconPromotionProposal {
  marker: string;
  listHint: 'REMINDER_MARKERS' | 'TASK_MARKERS' | 'OTHER';
  wins: number;
  note: string;
}

export interface PatternStoreSnapshot {
  updatedAt: string;
  weights: PatternWeight[];
  proposals: LexiconPromotionProposal[];
}

const DEFAULT_STORE: PatternStoreSnapshot = {
  updatedAt: new Date(0).toISOString(),
  weights: [],
  proposals: [],
};

/** In-memory cache for the current process. */
let memoryStore: PatternStoreSnapshot | null = null;

export function defaultPatternStorePath(repoRoot: string): string {
  return resolve(repoRoot, 'backend', 'data', 'pattern-weights.json');
}

export function loadPatternStore(path: string): PatternStoreSnapshot {
  if (memoryStore && memoryStore.updatedAt !== new Date(0).toISOString()) {
    return memoryStore;
  }
  if (!existsSync(path)) {
    memoryStore = { ...DEFAULT_STORE, weights: [], proposals: [] };
    return memoryStore;
  }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as PatternStoreSnapshot;
    memoryStore = {
      updatedAt: parsed.updatedAt || new Date().toISOString(),
      weights: Array.isArray(parsed.weights) ? parsed.weights : [],
      proposals: Array.isArray(parsed.proposals) ? parsed.proposals : [],
    };
    return memoryStore;
  } catch {
    memoryStore = { ...DEFAULT_STORE, weights: [], proposals: [] };
    return memoryStore;
  }
}

export function savePatternStore(path: string, store: PatternStoreSnapshot): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(store, null, 2));
  memoryStore = store;
}

/** Clears the in-memory cache (tests). */
export function resetPatternStoreCache(): void {
  memoryStore = null;
}

/**
 * Learns from one reconcile pass. AI wins on stance/intent bump weights;
 * algorithm wins decrease them. Lexicon proposals only when AI adds grounded markers.
 */
export function learnFromDisagreements(
  store: PatternStoreSnapshot,
  disagreements: DisagreementRecord[],
  options: { promoteAfterWins?: number } = {},
): PatternStoreSnapshot {
  const promoteAfter = options.promoteAfterWins ?? 3;
  const weights = [...store.weights];
  const proposals = [...store.proposals];

  const bump = (feature: string, label: string, deltaWin: boolean) => {
    let row = weights.find((w) => w.feature === feature && w.label === label);
    if (!row) {
      row = { feature, label, weight: 0.5, wins: 0, losses: 0 };
      weights.push(row);
    }
    if (deltaWin) {
      row.wins += 1;
      row.weight = Math.min(0.99, row.weight + 0.05);
    } else {
      row.losses += 1;
      row.weight = Math.max(0.01, row.weight - 0.05);
    }
  };

  for (const d of disagreements) {
    if (d.field === 'stance' || d.field === 'intent') {
      const label = String(d.aiValue ?? '');
      if (!label) continue;
      bump(d.field, label, d.winner === 'ai');
    }

    if (d.field.startsWith('item:') && d.winner === 'ai') {
      const aiValue = d.aiValue as { type?: string; source_text?: string } | null;
      const source = aiValue?.source_text?.toLowerCase() ?? '';
      if (aiValue?.type === 'REMINDER' && /remind|ping|alert|notify/.test(source)) {
        const marker = source.includes('remind me') ? 'remind me' : '';
        if (marker) {
          let proposal = proposals.find((p) => p.marker === marker && p.listHint === 'REMINDER_MARKERS');
          if (!proposal) {
            proposal = {
              marker,
              listHint: 'REMINDER_MARKERS',
              wins: 0,
              note: 'Proposed from teacher disagreements — review before editing lexicon.ts',
            };
            proposals.push(proposal);
          }
          proposal.wins += 1;
        }
      }
    }
  }

  // Mark ready-to-review proposals (still does not edit lexicon.ts).
  for (const proposal of proposals) {
    if (proposal.wins >= promoteAfter && !proposal.note.includes('READY')) {
      proposal.note = `READY_FOR_REVIEW after ${proposal.wins} wins — do not auto-edit lexicon.ts`;
    }
  }

  return {
    updatedAt: new Date().toISOString(),
    weights,
    proposals,
  };
}

/** Looks up a weight for optional stance biasing (0.5 default). */
export function getPatternWeight(store: PatternStoreSnapshot, feature: string, label: string): number {
  return store.weights.find((w) => w.feature === feature && w.label === label)?.weight ?? 0.5;
}
