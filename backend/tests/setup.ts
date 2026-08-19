/**
 * Vitest global setup.
 *
 * Forces NODE_ENV=test before any module reads configuration, so a test run can
 * never touch the development database.
 */
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'silent';
// Tests assert on Lifelog's own behaviour, not a hosted model's, so the offline
// provider is the default unless a test injects something else.
process.env.AI_PROVIDER = process.env.AI_PROVIDER ?? 'local';
