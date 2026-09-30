// POST /mcp: remote MCP over Streamable HTTP, stateless (no session id),
// JSON responses. A new McpServer per request, as Cloudflare advises.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { formatResult } from '../../whichlib/mcp/tools.mjs';
import pkg from '../../whichlib/package.json' with { type: 'json' };
import { HOSTED_DEFINITIONS } from './service.mjs';

const LOW_QUOTA = 10;

function quotaNote(quota) {
  if (!quota || quota.remaining >= LOW_QUOTA) return '';
  const hours = Math.max(1, Math.ceil((quota.resetAt - Date.now()) / 3600_000));
  return `\n\nNote: ${quota.remaining} free call${quota.remaining === 1 ? '' : 's'} left today; the limit resets in ${hours} h.`;
}

export async function handleMcp(request, service, caller) {
  // Stateless: no server-to-client SSE stream (GET) and no sessions to end (DELETE).
  if (request.method !== 'POST') {
    return Response.json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed. Use POST.' }, id: null }, { status: 405, headers: { Allow: 'POST' } });
  }
  const server = new McpServer({ name: 'whichlib', version: pkg.version });
  for (const { name, config } of HOSTED_DEFINITIONS) {
    server.registerTool(name, config, async (args) => {
      try {
        const { result, quota } = await service.call(name, args, caller);
        return { content: [{ type: 'text', text: formatResult(result) + quotaNote(quota) }], structuredContent: result };
      } catch (err) {
        if (!err?.status) console.error('mcp error', err?.stack ?? err);
        return { isError: true, content: [{ type: 'text', text: err?.status ? err.message : 'Internal error.' }] };
      }
    });
  }
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(request);
}
