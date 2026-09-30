import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.mjs';
import { fakeD1, fakeBurst } from './helpers.mjs';

const env = () => ({ DB: fakeD1(), BURST: fakeBurst(), IP_SALT: 's', GITHUB_TOKEN: 'x' });

test('CORS preflight', async () => {
  const res = await worker.fetch(new Request('https://w.test/api/trending', { method: 'OPTIONS' }), env());
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*');
  assert.match(res.headers.get('Access-Control-Allow-Headers'), /X-GitHub-Token/);
});

test('routes: /api/* (with CORS), /mcp, / and 404', async () => {
  const bad = await worker.fetch(new Request('https://w.test/api/compare?repos=a/b'), env());
  assert.equal(bad.status, 400);
  assert.equal(bad.headers.get('Access-Control-Allow-Origin'), '*');
  assert.match(bad.headers.get('Access-Control-Expose-Headers'), /X-RateLimit-Remaining/);
  assert.equal((await worker.fetch(new Request('https://w.test/mcp'), env())).status, 405);
  assert.equal((await worker.fetch(new Request('https://w.test/'), env())).status, 200);
  assert.equal((await worker.fetch(new Request('https://w.test/nope'), env())).status, 404);
});
