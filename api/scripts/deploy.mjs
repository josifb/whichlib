// npm run deploy: deploy the Worker, then run the MCP smoke test against whichlib.com
// (2025 handshake, and MCP 2026-07-28 auto and pinned). If the smoke test fails, the
// new version is live: roll back with `npx wrangler rollback` and investigate.
// Set GITHUB_TOKEN to send your own token (the smoke calls then skip the free-tier limit).
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const MCP_URL = 'https://whichlib.com/mcp';
const smoke = fileURLToPath(new URL('../../whichlib/mcp/smoke.mjs', import.meta.url));
const run = (command, args) => spawnSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32' }).status;

if (run('npx', ['wrangler', 'deploy']) !== 0) process.exit(1);
console.log(`\nSmoke test against ${MCP_URL}\n`);
if (run(process.execPath, [smoke, '--url', MCP_URL]) !== 0) {
  console.error('\nSMOKE TEST FAILED against the deployed Worker. Roll back with: npx wrangler rollback');
  process.exit(1);
}
