#!/usr/bin/env node
// Points the Claude Code plugin at whichlib@<version>. Run by the release
// workflow once npm serves that version. Prints "changed" or "unchanged".
// Usage (from whichlib/): node scripts/pin-plugin.mjs 0.1.2

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pinPlugin } from './versions.mjs';

const pluginDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'claude-plugin');
const version = process.argv[2];
if (!version) { console.error('Usage: node scripts/pin-plugin.mjs <x.y.z>'); process.exit(1); }
console.log(pinPlugin(pluginDir, version) ? 'changed' : 'unchanged');
