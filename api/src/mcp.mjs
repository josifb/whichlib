// POST /mcp: remote MCP over Streamable HTTP, stateless (no session id),
// JSON responses. A new McpServer per request, as Cloudflare advises.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { formatResult } from '../../whichlib/mcp/tools.mjs';
import pkg from '../../whichlib/package.json' with { type: 'json' };
import { HostedError, HOSTED_DEFINITIONS } from './service.mjs';

const LOW_QUOTA = 10;
const MAX_BODY = 64 * 1024;

const rpcError = (status, code, message) => Response.json({ jsonrpc: '2.0', error: { code, message }, id: null }, { status });

function quotaNote(quota) {
  if (!quota || quota.remaining >= LOW_QUOTA) return '';
  const hours = Math.max(1, Math.ceil((quota.resetAt - Date.now()) / 3600_000));
  if (quota.remaining === 0) return `\n\nNote: this was your last free call today; the limit resets in ${hours} h.`;
  return `\n\nNote: ${quota.remaining} free call${quota.remaining === 1 ? '' : 's'} left today; the limit resets in ${hours} h.`;
}

export async function handleMcp(request, service, caller) {
  // Stateless: no server-to-client SSE stream (GET) and no sessions to end (DELETE).
  if (request.method !== 'POST') {
    return Response.json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed. Use POST.' }, id: null }, { status: 405, headers: { Allow: 'POST' } });
  }
  // Batches would run concurrently, each with its own subrequest budget (the Worker allows 50 in total);
  // MCP 2025-06-18 dropped batching anyway.
  const text = await request.text();
  if (text.length > MAX_BODY) return rpcError(413, -32600, 'Request body too large.');
  let parsedBody;
  try { parsedBody = JSON.parse(text); } catch { return rpcError(400, -32700, 'Parse error.'); }
  if (Array.isArray(parsedBody)) return rpcError(400, -32600, 'Batch requests are not supported; send one JSON-RPC message per POST.');
  const server = new McpServer({ name: 'whichlib', version: pkg.version });
  for (const { name, config } of HOSTED_DEFINITIONS) {
    server.registerTool(name, config, async (args) => {
      try {
        const { result, quota } = await service.call(name, args, caller);
        return { content: [{ type: 'text', text: formatResult(result) + quotaNote(quota) }], structuredContent: result };
      } catch (err) {
        if (!(err instanceof HostedError)) console.error('mcp error', err?.stack ?? err);
        return { isError: true, content: [{ type: 'text', text: err instanceof HostedError ? err.message : 'Internal error.' }] };
      }
    });
  }
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(request, { parsedBody });
}
