import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorker, ownToken } from '../src/worker.mjs';
import { fakeD1, fakeBurst } from './helpers.mjs';

const env = () => ({ DB: fakeD1(), BURST: fakeBurst(), IP_SALT: 's', GITHUB_TOKEN: 'x' });

test('CORS preflight', async () => {
  const res = await createWorker().fetch(new Request('https://w.test/api/trending', { method: 'OPTIONS' }), env());
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*');
  assert.match(res.headers.get('Access-Control-Allow-Headers'), /X-GitHub-Token/);
});

test('OPTIONS /mcp allows the MCP protocol headers', async () => {
  const res = await createWorker().fetch(new Request('https://w.test/mcp', { method: 'OPTIONS' }), env());
  assert.equal(res.status, 204);
  assert.match(res.headers.get('Access-Control-Allow-Headers'), /Mcp-Protocol-Version/);
});

test('routes: /api/* (with CORS), /mcp, and 404 for anything else (pages are static assets)', async () => {
  const worker = createWorker();
  const bad = await worker.fetch(new Request('https://w.test/api/compare?repos=a/b'), env());
  assert.equal(bad.status, 400);
  assert.equal(bad.headers.get('Access-Control-Allow-Origin'), '*');
  assert.match(bad.headers.get('Access-Control-Expose-Headers'), /X-RateLimit-Remaining/);
  assert.equal((await worker.fetch(new Request('https://w.test/mcp'), env())).status, 405);
  // Static assets serve pages before the Worker runs; a page path reaching it is a misroute.
  const root = await worker.fetch(new Request('https://w.test/'), env());
  assert.equal(root.status, 404);
  assert.deepEqual(await root.json(), { error: 'Not found.' });
  assert.equal((await worker.fetch(new Request('https://w.test/nope'), env())).status, 404);
});

test('POST /mcp initialize goes through the Worker, with CORS', async () => {
  const res = await createWorker().fetch(new Request('https://w.test/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } }),
  }), env());
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*');
  assert.equal((await res.json()).result.serverInfo.name, 'whichlib');
});

test('an unexpected throw is a 500 JSON error with CORS', async () => {
  const broken = new Proxy({}, { get() { throw new Error('boom'); } });
  const orig = console.error;
  console.error = () => {};
  try {
    const res = await createWorker().fetch(new Request('https://w.test/api/trending'), broken);
    assert.equal(res.status, 500);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*');
    assert.deepEqual(await res.json(), { error: 'Internal error.' });
  } finally { console.error = orig; }
});

test('the Worker hands the event write to ctx.waitUntil', async () => {
  const handed = [];
  const ctx = { waitUntil: (p) => handed.push(p) };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('offline'); }; // the call itself may fail upstream; it is counted before it runs
  const orig = console.error;
  console.error = () => {};
  try {
    const e = env();
    await createWorker().fetch(new Request('https://w.test/api/compare?repos=a/one,b/two'), e, ctx);
    assert.equal(handed.length, 1);
    await Promise.all(handed);
    assert.equal(e.DB.events().length, 1);
  } finally { globalThis.fetch = realFetch; console.error = orig; }
});

test('ownToken: optional Bearer/token prefix, blank and bare prefix are null', () => {
  const t = (v) => ownToken(new Request('https://w.test/', v === undefined ? {} : { headers: { 'X-GitHub-Token': v } }));
  assert.equal(t('abc'), 'abc');
  assert.equal(t('Bearer x'), 'x');
  assert.equal(t('token x'), 'x');
  assert.equal(t('  '), null);
  assert.equal(t(undefined), null);
  assert.equal(t('Bearer'), null);
});
