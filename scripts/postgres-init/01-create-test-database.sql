-- Runs once when the Postgres container initialises its data directory.
-- The integration test suite truncates tables between runs, so it uses its own
-- database rather than the development one.
SELECT 'CREATE DATABASE lifelog_test'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'lifelog_test')\gexec
