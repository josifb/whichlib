-- One-time migration of the live whichlib-events database (fresh installs get the column from schema.sql).
-- Apply once, before deploying the collector or the hosted Worker that write it:
--   cd telemetry && npx wrangler d1 execute whichlib-events --remote --file migrations/2026-10-07-protocol-version.sql
-- Existing rows predate the field, so they stay null (unknown).
ALTER TABLE events ADD COLUMN protocol_version TEXT;
