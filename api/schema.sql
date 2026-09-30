-- Per-day call counters for the hosted free tier. user_hash = SHA-256(ip | IP_SALT | UTC day);
-- the raw IP is never stored. Rows older than yesterday are deleted on every write.
CREATE TABLE IF NOT EXISTS daily_usage (user_hash TEXT NOT NULL, day TEXT NOT NULL, calls INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_hash, day));
