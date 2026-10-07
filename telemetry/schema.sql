CREATE TABLE IF NOT EXISTS events (ts TEXT NOT NULL, tool TEXT NOT NULL, install_id TEXT NOT NULL, version TEXT, platform TEXT, node TEXT, source TEXT NOT NULL DEFAULT 'npm', protocol_version TEXT);
CREATE INDEX IF NOT EXISTS events_ts ON events (ts);
CREATE INDEX IF NOT EXISTS events_install ON events (install_id);
