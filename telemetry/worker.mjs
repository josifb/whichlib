// whichlib call counter: a Cloudflare Worker that receives the anonymous
// events the MCP server sends and writes them to Workers Analytics Engine.
// No IPs, no request bodies beyond the six fields, no cookies.
//
// Deploy: `npx wrangler deploy` in this folder (needs a free Cloudflare
// account), then set DEFAULT_ENDPOINT in whichlib/mcp/telemetry.mjs to the
// worker URL and publish a new whichlib version.
//
// Query (Cloudflare dashboard > Analytics Engine, or the SQL API):
//   weekly active installs:
//     SELECT toStartOfWeek(timestamp) AS week, COUNT(DISTINCT index1) AS installs
//     FROM whichlib_events GROUP BY week ORDER BY week
//   calls per install per week:
//     SELECT toStartOfWeek(timestamp) AS week, COUNT() / COUNT(DISTINCT index1)
//     FROM whichlib_events GROUP BY week ORDER BY week
//   calls by tool:
//     SELECT blob1 AS tool, COUNT() FROM whichlib_events GROUP BY tool

const TOOLS = new Set(['recommend_repos', 'compare_repos', 'trending_repos']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') return new Response('whichlib call counter', { status: 200 });
    let body;
    try { body = await request.json(); } catch { return new Response('bad json', { status: 400 }); }
    const { tool, installId, version = '', platform = '', node = '' } = body ?? {};
    if (!TOOLS.has(tool) || !UUID.test(String(installId))) return new Response('ignored', { status: 202 });
    env.WHICHLIB_EVENTS.writeDataPoint({
      blobs: [tool, String(version).slice(0, 20), String(platform).slice(0, 20), String(node).slice(0, 4)],
      doubles: [1],
      indexes: [installId],
    });
    return new Response(null, { status: 204 });
  },
};
