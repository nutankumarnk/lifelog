/**
 * Clears all Lifelog data tables in the correct dependency order.
 * Usage: tsx src/db/clear.ts
 */
import postgres from 'postgres';
import { loadConfig } from '../config/env.js';

const config = loadConfig({ fresh: true });

async function clearDb(url: string, name: string) {
  console.log(`Clearing all tables in ${name}...`);
  const sql = postgres(url);
  try {
    await sql.unsafe(`
      TRUNCATE TABLE
        object_relationships,
        object_origins,
        memory_objects,
        action_item_links,
        action_item_sources,
        action_items,
        item_entities,
        items,
        entities,
        segments,
        follow_ups,
        ai_invocations,
        disagreements,
        pattern_weights,
        analyses,
        conversations
      RESTART IDENTITY CASCADE;
    `);
    console.log(`✓ All tables in ${name} cleared successfully.`);
  } finally {
    await sql.end();
  }
}

async function main() {
  const mainUrl = config.DATABASE_URL || config.databaseUrl;
  if (mainUrl) {
    await clearDb(mainUrl, 'Main Database');
  }

  const testUrl = config.TEST_DATABASE_URL;
  if (testUrl && testUrl !== mainUrl) {
    await clearDb(testUrl, 'Test Database');
  }
}

main().catch((err) => {
  console.error('Failed to clear database:', err.message);
  process.exit(1);
});
