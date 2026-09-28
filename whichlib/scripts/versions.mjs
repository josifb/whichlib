// Version bookkeeping shared by `npm run release` (local) and the release
// workflow. One version lives in several files; these keep them in step.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

function parts(version) {
  const m = SEMVER.exec(version);
  if (!m) throw new Error(`"${version}" is not a version of the form x.y.z`);
  return m.slice(1).map(Number);
}

export function isNewerVersion(candidate, current) {
  const a = parts(candidate);
  const b = parts(current);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

function updateJson(file, update) {
  const data = JSON.parse(readFileSync(file, 'utf8'));
  update(data);
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

/** Sets the version in the npm package, its lockfile, the MCP registry manifest and the MCPB manifest. */
export function setPackageVersion(pkgDir, version) {
  parts(version);
  updateJson(join(pkgDir, 'package.json'), (p) => { p.version = version; });
  updateJson(join(pkgDir, 'package-lock.json'), (l) => {
    l.version = version;
    if (l.packages?.['']) l.packages[''].version = version;
  });
  updateJson(join(pkgDir, 'server.json'), (s) => {
    s.version = version;
    for (const p of s.packages ?? []) p.version = version;
  });
  updateJson(join(pkgDir, 'mcpb', 'manifest.json'), (m) => { m.version = version; });
  return ['package.json', 'package-lock.json', 'server.json', 'mcpb/manifest.json'];
}

/**
 * Points the Claude Code plugin at whichlib@<version>. Only safe once npm has
 * that version: the plugin directory picks up new commits on its own.
 * Returns false when the plugin already pins this version.
 */
export function pinPlugin(pluginDir, version) {
  parts(version);
  const mcpFile = join(pluginDir, '.mcp.json');
  const before = readFileSync(mcpFile, 'utf8');
  if (before.includes(`whichlib@${version}"`)) return false;
  updateJson(mcpFile, (m) => {
    m.mcpServers.whichlib.args = m.mcpServers.whichlib.args.map((a) => (a.startsWith('whichlib@') ? `whichlib@${version}` : a));
  });
  updateJson(join(pluginDir, '.claude-plugin', 'plugin.json'), (p) => { p.version = version; });
  const readme = join(pluginDir, 'README.md');
  writeFileSync(readme, readFileSync(readme, 'utf8').replace(/whichlib@\d+\.\d+\.\d+/g, `whichlib@${version}`));
  return true;
}
