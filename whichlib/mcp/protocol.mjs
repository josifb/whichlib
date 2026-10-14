// MCP protocol details shared by the stdio server and the hosted Worker.

// The tool list changes only with a new release and is the same for every caller,
// so 2026-07-28 clients may cache it for an hour, shared caches included.
export const TOOLS_LIST_CACHE = { 'tools/list': { ttlMs: 3_600_000, cacheScope: 'public' } };

// What the server says about itself when a client connects (serverInfo), so clients
// that show servers can display the name, the website and the logo (whichlib.com/logo.*).
export const ICONS = [
  { src: 'https://whichlib.com/logo.png', mimeType: 'image/png', sizes: ['400x400'] },
  { src: 'https://whichlib.com/logo.svg', mimeType: 'image/svg+xml', sizes: ['any'] },
];
export function serverInfo(version) {
  return { name: 'whichlib', version, title: 'whichlib', websiteUrl: 'https://whichlib.com', icons: ICONS };
}

const ENVELOPE_VERSION ='io.modelcontextprotocol/protocolVersion';

/**
 * The MCP protocol version a tool call came in on, for the call counter, or null.
 * 2026-07-28 calls carry it in the request envelope; 2025-era calls on stdio have the
 * version negotiated by initialize; 2025-era calls to the hosted (stateless) endpoint
 * send it as the MCP-Protocol-Version header.
 */
export function callProtocolVersion(mcpServer, ctx) {
  return ctx?.mcpReq?.envelope?.[ENVELOPE_VERSION]
    ?? mcpServer?.server?.getNegotiatedProtocolVersion?.()
    ?? ctx?.http?.req?.headers?.get?.('mcp-protocol-version')
    ?? null;
}
