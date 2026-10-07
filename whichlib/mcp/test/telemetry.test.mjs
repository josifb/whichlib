import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTelemetry, telemetryEnabled, loadInstallId } from '../telemetry.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'whichlib-tel-'));

test('telemetryEnabled: off without an endpoint, off on opt-out variables, on otherwise', () => {
  assert.equal(telemetryEnabled({}, null), false);
  assert.equal(telemetryEnabled({}, 'https://t.example/e'), true);
  assert.equal(telemetryEnabled({ WHICHLIB_TELEMETRY_URL: 'https://t.example/e' }, null), true);
  assert.equal(telemetryEnabled({ WHICHLIB_TELEMETRY: 'off' }, 'https://t.example/e'), false);
  assert.equal(telemetryEnabled({ WHICHLIB_TELEMETRY: 'OFF' }, 'https://t.example/e'), false);
  assert.equal(telemetryEnabled({ DO_NOT_TRACK: '1' }, 'https://t.example/e'), false);
});

test('loadInstallId: creates a UUID once and returns the same one afterwards', () => {
  const dir = tmp();
  const a = loadInstallId(dir);
  const b = loadInstallId(dir);
  assert.match(a, /^[0-9a-f-]{36}$/);
  assert.equal(a, b);
  assert.equal(readFileSync(join(dir, 'install-id'), 'utf8').trim(), a);
});

test('record: posts only tool, install id, version, platform, node, protocol version and timestamp', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return { ok: true }; };
  const t = createTelemetry({ version: '0.1.0', env: {}, endpoint: 'https://t.example/e', fetchImpl, dir: tmp() });
  assert.equal(t.enabled, true);
  assert.equal(await t.record('recommend_repos'), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://t.example/e');
  assert.equal(calls[0].init.method, 'POST');
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(Object.keys(body).sort(), ['installId', 'node', 'platform', 'protocolVersion', 'tool', 'ts', 'version']);
  assert.equal(body.protocolVersion, null);
  assert.equal(body.tool, 'recommend_repos');
  assert.equal(body.installId, t.installId);
  assert.equal(body.version, '0.1.0');
});

test('record: disabled telemetry sends nothing and resolves false', async () => {
  let n = 0;
  const t = createTelemetry({ version: '0.1.0', env: { WHICHLIB_TELEMETRY: 'off' }, endpoint: 'https://t.example/e', fetchImpl: async () => { n += 1; return { ok: true }; }, dir: tmp() });
  assert.equal(t.enabled, false);
  assert.equal(t.installId, null);
  assert.equal(await t.record('compare_repos'), false);
  assert.equal(n, 0);
});

test('record: network failures are swallowed', async () => {
  const t = createTelemetry({ version: '0.1.0', env: {}, endpoint: 'https://t.example/e', fetchImpl: async () => { throw new TypeError('fetch failed'); }, dir: tmp() });
  assert.equal(await t.record('trending_repos'), false);
});

test('record: sends the protocol version of the call, capped at 20 characters', async () => {
  const bodies = [];
  const fetchImpl = async (url, init) => { bodies.push(JSON.parse(init.body)); return { ok: true }; };
  const t = createTelemetry({ version: '0.2.0', env: {}, endpoint: 'https://t.example/e', fetchImpl, dir: tmp() });
  await t.record('compare_repos', { protocolVersion: '2026-07-28' });
  await t.record('compare_repos', { protocolVersion: 'x'.repeat(50) });
  assert.equal(bodies[0].protocolVersion, '2026-07-28');
  assert.equal(bodies[1].protocolVersion.length, 20);
});
