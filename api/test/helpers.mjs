// Test doubles for the Worker's bindings. fakeD1 runs the real SQL on
// node:sqlite so the counter queries are tested, not mocked.
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');

/** Minimal D1: prepare().bind().all()/first()/run() and batch(), over an in-memory SQLite. */
export function fakeD1() {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  const statement = (sql, params = []) => ({
    bind: (...p) => statement(sql, p),
    async all() { return { results: db.prepare(sql).all(...params) }; },
    async first() { return db.prepare(sql).get(...params) ?? null; },
    async run() { const r = db.prepare(sql).run(...params); return { meta: { changes: Number(r.changes) } }; },
  });
  return {
    prepare: (sql) => statement(sql),
    async batch(list) {
      db.exec('BEGIN');
      try {
        const out = [];
        for (const s of list) out.push(await s.all());
        db.exec('COMMIT');
        return out;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
    rows: () => db.prepare('SELECT user_hash, day, calls FROM daily_usage ORDER BY day').all().map((r) => ({ ...r })),
    exec: (sql) => db.exec(sql),
  };
}

/** Cache API stand-in (caches.default): honours the X-Expires header the cache module writes. */
export function fakeCacheApi(now = () => Date.now()) {
  const store = new Map();
  return {
    store,
    async match(request) {
      const hit = store.get(request.url);
      if (!hit || Number(hit.headers.get('X-Expires')) <= now()) return undefined;
      return new Response(hit.body, { headers: hit.headers });
    },
    async put(request, response) {
      store.set(request.url, { body: await response.text(), headers: new Headers(response.headers) });
    },
  };
}

/** Rate-limit binding stand-in: allows `limit` calls per key, records the keys. */
export function fakeBurst(limit = 20) {
  const counts = new Map();
  const keys = [];
  return {
    keys,
    async limit({ key }) {
      keys.push(key);
      counts.set(key, (counts.get(key) ?? 0) + 1);
      return { success: counts.get(key) <= limit };
    },
  };
}
