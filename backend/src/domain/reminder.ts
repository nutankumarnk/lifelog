/**
 * Reminder domain module.
 *
 * Owns Reminder-specific details and grammatical display enrichment.
 * Does not decide whether something *is* a reminder — that stays in
 * `intelligence/classify.ts` (explicit marker rule).
 */
import type { Entity, Item } from '../schemas/analysis.schema.js';
import { formatReminderDisplay } from './display-text.js';

export interface ReminderEnrichContext {
  text: string;
  entities: Entity[];
}

/**
 * Enriches a REMINDER item: typed details + grammatical display fields.
 * Leaves `source_text` untouched.
 */
export function enrichReminder(item: Item, context: ReminderEnrichContext): Item {
  if (item.type !== 'REMINDER') return item;

  const basis = item.source_text?.trim() || item.summary?.trim() || item.title;
  const display = formatReminderDisplay(basis, context.entities);

  const triggerAt = item.temporal.resolved ?? item.details.trigger_at ?? null;

  return {
    ...item,
    title: display.title,
    summary: display.summary,
    details: {
      ...item.details,
      explicit: item.details.explicit ?? true,
      status: item.details.status ?? 'OPEN',
      trigger_at: triggerAt,
      display_text: display.displayText,
    },
  };
}
