-- One-time migration of the live whichlib-events database (fresh installs get the column from schema.sql).
-- Apply once: cd telemetry && npx wrangler d1 execute whichlib-events --remote --file migrations/2026-10-02-source.sql
-- Existing rows all came from the npm package, so the default labels them correctly.
ALTER TABLE events ADD COLUMN source TEXT NOT NULL DEFAULT 'npm';
