import { defineConfig } from 'drizzle-kit';
import { loadConfig } from './src/config/env.js';

const config = loadConfig({ fresh: true });

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: config.databaseUrl ?? 'postgres://lifelog:lifelog@127.0.0.1:5434/lifelog',
  },
  verbose: true,
  strict: true,
});
