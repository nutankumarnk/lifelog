/**
 * Task domain module.
 *
 * Owns Task-specific details and grammatical display enrichment.
 * Never promotes a Task to Reminder — classify owns that distinction.
 */
import type { Entity, Item } from '../schemas/analysis.schema.js';
import { formatTaskDisplay } from './display-text.js';

export interface TaskEnrichContext {
  text: string;
  entities: Entity[];
}

/**
 * Enriches a TASK item: typed details + grammatical display fields.
 * Leaves `source_text` untouched.
 */
export function enrichTask(item: Item, context: TaskEnrichContext): Item {
  if (item.type !== 'TASK') return item;

  const basis = item.source_text?.trim() || item.summary?.trim() || item.title;
  const display = formatTaskDisplay(basis, context.entities);

  return {
    ...item,
    title: display.title,
    summary: display.summary,
    details: {
      ...item.details,
      status: item.details.status ?? 'OPEN',
      priority: item.details.priority ?? 'NORMAL',
      display_text: display.displayText,
    },
  };
}
