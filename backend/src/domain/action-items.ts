/**
 * Routes REMINDER / TASK items through their domain modules.
 */
import type { Entity, Item } from '../schemas/analysis.schema.js';
import { enrichReminder } from './reminder.js';
import { enrichTask } from './task.js';

export interface ActionItemContext {
  text: string;
  entities: Entity[];
}

/** Applies Reminder and Task display enrichment. Other types pass through. */
export function enrichActionItems(items: Item[], context: ActionItemContext): Item[] {
  return items.map((item) => {
    if (item.type === 'REMINDER') return enrichReminder(item, context);
    if (item.type === 'TASK') return enrichTask(item, context);
    return item;
  });
}
