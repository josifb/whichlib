// whichlib call counter: a Cloudflare Worker that receives the anonymous
// events the MCP server sends and stores them in D1 (free SQLite).
// No IPs, no request bodies beyond the seven fields, no cookies.
//
// Deploy: `npx wrangler login`, `npx wrangler d1 create whichlib-events` (put the
// id in wrangler.toml), `npx wrangler d1 execute whichlib-events --remote --file schema.sql`,
// `npx wrangler deploy`. Then set DEFAULT_ENDPOINT in whichlib/mcp/telemetry.mjs.
//
// Read the numbers (npx wrangler d1 execute whichlib-events --remote --command "..."):
//   weekly active installs:
//     SELECT strftime('%Y-%W', ts) AS week, COUNT(DISTINCT install_id) AS installs, COUNT(*) AS calls
//     FROM events WHERE source = 'npm' GROUP BY week ORDER BY week
//   calls per install per week:
//     SELECT strftime('%Y-%W', ts) AS week, ROUND(1.0 * COUNT(*) / COUNT(DISTINCT install_id), 1)
//     FROM events WHERE source = 'npm' GROUP BY week ORDER BY week
//   hosted calls per week:
//     SELECT strftime('%Y-%W', ts) AS week, COUNT(*) FROM events WHERE source = 'hosted' GROUP BY week
//   calls by tool:
//     SELECT tool, COUNT(*) FROM events GROUP BY tool ORDER BY 2 DESC
// Or GET /stats on the worker for the same three, as JSON.

const TOOLS = new Set(['recommend_repos', 'compare_repos', 'trending_repos']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// MCP protocol versions are dates (2025-11-25, 2026-07-28); anything else is stored as unknown (null).
const PROTOCOL_VERSION = /^\d{4}-\d{2}-\d{2}$/;

// Schema lives in schema.sql and is applied once:
//   npx wrangler d1 execute whichlib-events --remote --file schema.sql

// installs and calls count the npm package only (source 'npm'), so calls per install stays meaningful;
// hosted calls (source 'hosted', one constant install id) are reported as their own number.
async function stats(db) {
  const weekly = await db.prepare("SELECT strftime('%Y-%W', ts) AS week, COUNT(DISTINCT CASE WHEN source = 'npm' THEN install_id END) AS installs, SUM(source = 'npm') AS calls, SUM(source = 'hosted') AS hostedCalls FROM events GROUP BY week ORDER BY week").all();
  const byTool = await db.prepare('SELECT tool, COUNT(*) AS calls FROM events GROUP BY tool ORDER BY calls DESC, tool').all();
  const byProtocolVersion = await db.prepare('SELECT protocol_version AS protocolVersion, COUNT(*) AS calls FROM events GROUP BY protocol_version ORDER BY calls DESC, protocol_version DESC').all();
  const bySource = await db.prepare('SELECT source, COUNT(*) AS calls FROM events GROUP BY source ORDER BY calls DESC, source').all();
  const totals = await db.prepare("SELECT COUNT(DISTINCT CASE WHEN source = 'npm' THEN install_id END) AS installs, COALESCE(SUM(source = 'npm'), 0) AS calls, COALESCE(SUM(source = 'hosted'), 0) AS hostedCalls, MIN(ts) AS since FROM events").first();
  return { totals, weekly: weekly.results, byTool: byTool.results, bySource: bySource.results, byProtocolVersion: byProtocolVersion.results };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/stats') {
      try {
        return Response.json(await stats(env.DB), { headers: { 'Cache-Control': 'public, max-age=300' } });
      } catch (err) {
        console.error('stats failed', err?.message);
        return Response.json({ error: 'stats unavailable' }, { status: 503 });
      }
    }
    if (request.method !== 'POST') return new Response('whichlib call counter. GET /stats for the numbers.', { status: 200 });

    let body;
    try { body = await request.json(); } catch { return new Response('bad json', { status: 400 }); }
    const { tool, installId, version = '', platform = '', node = '', protocolVersion = null } = body ?? {};
    if (!TOOLS.has(tool) || !UUID.test(String(installId))) return new Response('ignored', { status: 202 });

    await env.DB.prepare('INSERT INTO events (ts, tool, install_id, version, platform, node, protocol_version) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(new Date().toISOString(), tool, installId, String(version).slice(0, 20), String(platform).slice(0, 20), String(node).slice(0, 4), PROTOCOL_VERSION.test(String(protocolVersion)) ? protocolVersion : null)
      .run();
    return new Response(null, { status: 204 });
  },
};
