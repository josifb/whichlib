// Hosted tool calls in the call counter (the events table of whichlib-events, owned by telemetry/).
// One row per call that passed the limits: the tool, the whichlib version and the constant
// install id 'hosted' (never a per-user value: no IP, hash or token is stored), and the MCP protocol
// version of the call (null for the web API or when unknown).
import pkg from '../../whichlib/package.json' with { type: 'json' };

const INSERT = "INSERT INTO events (ts, tool, install_id, version, platform, node, source, protocol_version) VALUES (?, ?, 'hosted', ?, 'hosted', '', 'hosted', ?)";
const PROTOCOL_VERSION = /^\d{4}-\d{2}-\d{2}$/;

/** Best effort: a failed write is logged and never fails the tool call. */
export async function recordHostedCall(db, tool, { now = Date.now, version = pkg.version, protocolVersion = null } = {}) {
  if (!db) return;
  try {
    await db.prepare(INSERT).bind(new Date(now()).toISOString(), tool, version, PROTOCOL_VERSION.test(String(protocolVersion)) ? protocolVersion : null).run();
  } catch (err) {
    console.error('event write failed', err?.message);
  }
}
