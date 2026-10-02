// The call counter Worker (telemetry/) has no test runner of its own; it is plain ESM, tested here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../../telemetry/worker.mjs';
import { fakeD1 } from './helpers.mjs';

const ID1 = '11111111-1111-4111-8111-111111111111';
const ID2 = '22222222-2222-4222-8222-222222222222';

async function seed(db) {
  const insert = (ts, tool, id, source) => db.prepare('INSERT INTO events (ts, tool, install_id, version, platform, node, source) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(ts, tool, id, '0.1.3', source === 'hosted' ? 'hosted' : 'linux-x64', source === 'hosted' ? '' : '22', source).run();
  await insert('2026-10-05T10:00:00Z', 'recommend_repos', ID1, 'npm');
  await insert('2026-10-05T11:00:00Z', 'compare_repos', ID1, 'npm');
  await insert('2026-10-06T10:00:00Z', 'recommend_repos', ID2, 'npm');
  await insert('2026-10-06T12:00:00Z', 'recommend_repos', 'hosted', 'hosted');
  await insert('2026-10-06T13:00:00Z', 'trending_repos', 'hosted', 'hosted');
}

const getStats = async (db) => (await worker.fetch(new Request('https://t.test/stats'), { DB: db })).json();

test('stats: installs and calls count npm rows only; hosted calls are their own number', async () => {
  const db = fakeD1();
  await seed(db);
  const s = await getStats(db);
  assert.equal(s.totals.installs, 2);
  assert.equal(s.totals.calls, 3);
  assert.equal(s.totals.hostedCalls, 2);
  assert.deepEqual(s.weekly.map(({ installs, calls, hostedCalls }) => ({ installs, calls, hostedCalls })), [{ installs: 2, calls: 3, hostedCalls: 2 }]);
});

test('stats: bySource and byTool cover all sources', async () => {
  const db = fakeD1();
  await seed(db);
  const s = await getStats(db);
  assert.deepEqual(s.bySource, [{ source: 'npm', calls: 3 }, { source: 'hosted', calls: 2 }]);
  assert.deepEqual(s.byTool, [{ tool: 'recommend_repos', calls: 3 }, { tool: 'compare_repos', calls: 1 }, { tool: 'trending_repos', calls: 1 }]);
});

test('stats: a week with only hosted calls shows 0 installs, 0 calls', async () => {
  const db = fakeD1();
  await db.prepare("INSERT INTO events (ts, tool, install_id, version, platform, node, source) VALUES ('2026-10-06T12:00:00Z', 'recommend_repos', 'hosted', '0.1.3', 'hosted', '', 'hosted')").run();
  const s = await getStats(db);
  assert.deepEqual(s.weekly.map(({ installs, calls, hostedCalls }) => ({ installs, calls, hostedCalls })), [{ installs: 0, calls: 0, hostedCalls: 1 }]);
  assert.equal(s.totals.installs, 0);
});

test('collector: an npm POST is stored with source npm (the client does not send a source)', async () => {
  const db = fakeD1();
  const res = await worker.fetch(new Request('https://t.test/', { method: 'POST', body: JSON.stringify({ tool: 'recommend_repos', installId: ID1, version: '0.1.3', platform: 'win32-x64', node: '22' }) }), { DB: db });
  assert.equal(res.status, 204);
  assert.deepEqual(db.events().map((e) => [e.install_id, e.source]), [[ID1, 'npm']]);
});

test('collector: a POST cannot claim to be hosted (install id must be a UUID)', async () => {
  const db = fakeD1();
  const res = await worker.fetch(new Request('https://t.test/', { method: 'POST', body: JSON.stringify({ tool: 'recommend_repos', installId: 'hosted', source: 'hosted' }) }), { DB: db });
  assert.equal(res.status, 202);
  assert.equal(db.events().length, 0);
});

test('stats: a D1 failure (e.g. the source column not migrated yet) is a 503, not a crash', async () => {
  const stmt = { all: async () => { throw new Error('no such column: source'); }, first: async () => { throw new Error('no such column: source'); } };
  const db = { prepare: () => stmt };
  const orig = console.error;
  const logged = [];
  console.error = (...a) => logged.push(a);
  try {
    const res = await worker.fetch(new Request('https://t.test/stats'), { DB: db });
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { error: 'stats unavailable' });
    assert.deepEqual(logged, [['stats failed', 'no such column: source']]);
  } finally { console.error = orig; }
});
