// Anonymous call counting. The whole product bet is "do agents call this
// tool", so we count tool calls per anonymous install. Nothing else.
//
// What is sent: tool name, a random install id, whichlib version, platform,
// Node major version, the MCP protocol version of the call. Never the query, repo names, results, user names, paths
// or IP-derived data (the collector does not store IPs).
//
// Off when: WHICHLIB_TELEMETRY=off, DO_NOT_TRACK=1, or no endpoint is
// configured (WHICHLIB_TELEMETRY_URL or the built-in default below).
// Sending is fire-and-forget with a 2 s timeout and never affects a tool call.

import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// The collector: a Cloudflare Worker writing to D1 (see telemetry/ at the
// repository root). GET <endpoint>/stats shows the aggregate numbers publicly.
export const DEFAULT_ENDPOINT = 'https://whichlib-telemetry.todorovskijosif.workers.dev';

export function telemetryEnabled(env = process.env, endpoint = DEFAULT_ENDPOINT) {
  if (!endpoint && !env.WHICHLIB_TELEMETRY_URL) return false;
  if (String(env.WHICHLIB_TELEMETRY ?? '').toLowerCase() === 'off') return false;
  if (String(env.DO_NOT_TRACK ?? '') === '1') return false;
  return true;
}

/** A random id per machine, kept in ~/.whichlib/install-id. Per-process if that is not writable. */
export function loadInstallId(dir = join(homedir(), '.whichlib')) {
  const file = join(dir, 'install-id');
  try {
    const existing = readFileSync(file, 'utf8').trim();
    if (/^[0-9a-f-]{36}$/.test(existing)) return existing;
  } catch { /* first run */ }
  const id = randomUUID();
  try { mkdirSync(dir, { recursive: true }); writeFileSync(file, `${id}\n`); } catch { /* read-only home */ }
  return id;
}

export function createTelemetry({ version, env = process.env, endpoint = env.WHICHLIB_TELEMETRY_URL || DEFAULT_ENDPOINT, fetchImpl = fetch, installId = null, dir } = {}) {
  const enabled = telemetryEnabled(env, endpoint);
  const id = enabled ? (installId ?? loadInstallId(dir)) : null;
  const platform = `${process.platform}-${process.arch}`;
  const node = process.versions.node.split('.')[0];

  return {
    enabled,
    endpoint: enabled ? endpoint : null,
    installId: id,
    /** Fire-and-forget. Returns the promise only so tests can await it. */
    record(tool, { protocolVersion = null } = {}) {
      if (!enabled) return Promise.resolve(false);
      const body = JSON.stringify({ tool, installId: id, version, platform, node, protocolVersion: protocolVersion == null ? null : String(protocolVersion).slice(0, 20), ts: new Date().toISOString() });
      return fetchImpl(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(2000) })
        .then((res) => Boolean(res && res.ok))
        .catch(() => false);
    },
  };
}
