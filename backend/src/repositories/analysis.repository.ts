/**
 * Analysis persistence.
 *
 * Writes one analysis and its children — segments, entities, items, the
 * item/entity join rows and any follow-up — inside a single transaction. Either
 * a complete interpretation lands or none of it does; a half-written analysis
 * would be indistinguishable from a real one when read back.
 *
 * The full analysis is also stored as JSONB on the parent row. The child tables
 * exist to make cross-conversation queries possible in later phases ("every
 * task involving Arun"); the JSONB column makes reading one conversation back a
 * single-row fetch. Storing both is a deliberate trade, recorded in
 * docs/decision.md.
 */
import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { aiInvocations, analyses, entities, followUps, itemEntities, items, segments } from '../db/schema.js';
import type { Analysis } from '../schemas/analysis.schema.js';
import type { ProviderAttempt } from '../ai/registry.js';

export interface PersistAnalysisInput {
  conversationId: string;
  analysis: Analysis;
  provider: string;
  model: string;
  degraded: boolean;
  latencyMs: number;
  attempts: ProviderAttempt[];
}

export interface PersistedAnalysis {
  analysisId: string;
  /** Local ids (`i1`, `e1`) mapped to database ids, for follow-on writes. */
  itemIds: Record<string, string>;
  entityIds: Record<string, string>;
}

/** Converts an ISO date/datetime string into a Date, tolerating date-only values. */
function toDate(value: string | null): Date | null {
  if (!value) return null;
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00.000Z` : value;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

export class AnalysisRepository {
  constructor(private readonly db: Database) {}

  async persist(input: PersistAnalysisInput): Promise<PersistedAnalysis> {
    const { analysis } = input;

    return this.db.transaction(async (tx) => {
      const [analysisRow] = await tx
        .insert(analyses)
        .values({
          conversationId: input.conversationId,
          schemaVersion: analysis.schema_version,
          intent: analysis.intent,
          intentConfidence: analysis.intent_confidence,
          summary: analysis.summary,
          provider: input.provider,
          model: input.model,
          degraded: input.degraded,
          latencyMs: input.latencyMs,
          analysis: analysis as unknown as Record<string, unknown>,
          warnings: analysis.warnings,
        })
        .returning({ id: analyses.id });

      if (!analysisRow) throw new Error('analysis insert returned no row');
      const analysisId = analysisRow.id;

      if (analysis.segments.length > 0) {
        await tx.insert(segments).values(
          analysis.segments.map((segment) => ({
            analysisId,
            conversationId: input.conversationId,
            position: segment.index,
            text: segment.text,
            spanStart: segment.span.start,
            spanEnd: segment.span.end,
          })),
        );
      }

      // Entities first: item rows reference them through the join table.
      const entityIdByLocalId = new Map<string, string>();
      const itemIdByLocalId = new Map<string, string>();
      if (analysis.entities.length > 0) {
        const entityRows = await tx
          .insert(entities)
          .values(
            analysis.entities.map((entity) => ({
              analysisId,
              conversationId: input.conversationId,
              localId: entity.id,
              kind: entity.kind,
              rawKind: entity.raw_kind,
              name: entity.name,
              normalizedName: entity.normalized_name,
              relation: entity.relation,
              aliases: entity.aliases,
              attributes: entity.attributes,
              mentions: entity.mentions,
              confidence: entity.confidence,
            })),
          )
          .returning({ id: entities.id, localId: entities.localId });

        for (const row of entityRows) entityIdByLocalId.set(row.localId, row.id);
      }

      if (analysis.items.length > 0) {
        const itemRows = await tx
          .insert(items)
          .values(
            analysis.items.map((item) => ({
              analysisId,
              conversationId: input.conversationId,
              localId: item.id,
              type: item.type,
              title: item.title,
              summary: item.summary,
              sourceText: item.source_text,
              spanStart: item.source_span?.start ?? null,
              spanEnd: item.source_span?.end ?? null,
              segmentPosition: item.segment_index,
              tense: item.temporal.tense,
              temporalRaw: item.temporal.raw,
              occurredAt: toDate(item.temporal.resolved),
              occurredEndAt: toDate(item.temporal.resolved_end),
              temporalPrecision: item.temporal.precision,
              recurrence: item.temporal.recurrence,
              details: item.details as Record<string, unknown>,
              confidence: item.confidence,
            })),
          )
          .returning({ id: items.id, localId: items.localId });

        for (const row of itemRows) itemIdByLocalId.set(row.localId, row.id);

        const joinRows = analysis.items.flatMap((item) => {
          const itemId = itemIdByLocalId.get(item.id);
          if (!itemId) return [];
          return item.entity_ids.flatMap((localEntityId) => {
            const entityId = entityIdByLocalId.get(localEntityId);
            return entityId ? [{ itemId, entityId, role: 'mentioned' }] : [];
          });
        });

        if (joinRows.length > 0) await tx.insert(itemEntities).values(joinRows);
      }

      if (analysis.follow_up) {
        await tx.insert(followUps).values({
          analysisId,
          conversationId: input.conversationId,
          question: analysis.follow_up.question,
          reason: analysis.follow_up.reason,
          missingFields: analysis.follow_up.missing_fields,
          blocking: analysis.follow_up.blocking,
        });
      }

      if (input.attempts.length > 0) {
        await tx.insert(aiInvocations).values(
          input.attempts.map((attempt) => ({
            conversationId: input.conversationId,
            provider: attempt.provider,
            model: attempt.model,
            status: attempt.status,
            attempt: attempt.attempt,
            latencyMs: attempt.latencyMs,
            // Only the error class is stored. Never the prompt or the response.
            errorCode: attempt.errorKind ?? null,
          })),
        );
      }

      return {
        analysisId,
        itemIds: Object.fromEntries(itemIdByLocalId),
        entityIds: Object.fromEntries(entityIdByLocalId),
      };
    });
  }

  /** Returns the stored analysis payload for a conversation, newest first. */
  async findLatestByConversation(conversationId: string): Promise<Analysis | null> {
    const [row] = await this.db
      .select({ analysis: analyses.analysis })
      .from(analyses)
      .where(eq(analyses.conversationId, conversationId))
      .orderBy(analyses.createdAt)
      .limit(1);

    return (row?.analysis as unknown as Analysis) ?? null;
  }

  /** Counts stored items of a given type. Used by tests and future reporting. */
  async countItemsByType(conversationId: string, type: string): Promise<number> {
    const rows = await this.db
      .select({ id: items.id })
      .from(items)
      .where(and(eq(items.conversationId, conversationId), eq(items.type, type)));

    return rows.length;
  }
}
