// MCP protocol details shared by the stdio server, the hosted Worker and the call-counter
// Worker (telemetry/ bundles this file): keep it free of imports so it stays Worker-safe.

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

const ENVELOPE_VERSION = 'io.modelcontextprotocol/protocolVersion';

/** A protocol version for the call counter: MCP revisions are dates (2026-07-28); anything else is unknown (null). */
export function normalizeProtocolVersion(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

/**
 * The MCP protocol version a tool call came in on, for the call counter, or null.
 * 2026-07-28 calls carry it in the request envelope; calls on a 2025 protocol version over
 * stdio have the version negotiated by initialize; on the hosted (stateless) endpoint they
 * send it as the MCP-Protocol-Version header.
 */
export function callProtocolVersion(mcpServer, ctx) {
  return ctx?.mcpReq?.envelope?.[ENVELOPE_VERSION]
    ?? mcpServer?.server?.getNegotiatedProtocolVersion?.()
    ?? ctx?.http?.req?.headers?.get?.('mcp-protocol-version')
    ?? null;
}
