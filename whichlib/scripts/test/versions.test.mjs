import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isNewerVersion, setPackageVersion } from '../versions.mjs';

const json = (file) => JSON.parse(readFileSync(file, 'utf8'));
const write = (file, value) => writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n');

function packageFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'whichlib-pkg-'));
  mkdirSync(join(dir, 'mcpb'));
  write(join(dir, 'package.json'), { name: 'whichlib', version: '0.1.1' });
  write(join(dir, 'package-lock.json'), { name: 'whichlib', version: '0.1.1', packages: { '': { name: 'whichlib', version: '0.1.1' }, 'node_modules/zod': { version: '4.6.5' } } });
  write(join(dir, 'server.json'), { name: 'io.github.josifb/whichlib', version: '0.1.1', packages: [{ identifier: 'whichlib', version: '0.1.1' }] });
  write(join(dir, 'mcpb', 'manifest.json'), { name: 'whichlib', version: '0.1.1' });
  return dir;
}


test('isNewerVersion: compares numeric parts, rejects non-semver', () => {
  assert.equal(isNewerVersion('0.1.2', '0.1.1'), true);
  assert.equal(isNewerVersion('0.2.0', '0.1.9'), true);
  assert.equal(isNewerVersion('0.1.10', '0.1.9'), true);
  assert.equal(isNewerVersion('0.1.1', '0.1.1'), false);
  assert.equal(isNewerVersion('0.1.0', '0.1.1'), false);
  assert.throws(() => isNewerVersion('v0.1.2', '0.1.1'), /x\.y\.z/);
  assert.throws(() => isNewerVersion('0.1', '0.1.1'), /x\.y\.z/);
});

test('setPackageVersion: updates package, lockfile root, server.json and bundle manifest only', () => {
  const dir = packageFixture();
  const changed = setPackageVersion(dir, '0.1.2');
  assert.deepEqual(changed.sort(), ['mcpb/manifest.json', 'package-lock.json', 'package.json', 'server.json']);
  assert.equal(json(join(dir, 'package.json')).version, '0.1.2');
  const lock = json(join(dir, 'package-lock.json'));
  assert.equal(lock.version, '0.1.2');
  assert.equal(lock.packages[''].version, '0.1.2');
  assert.equal(lock.packages['node_modules/zod'].version, '4.6.5');
  const server = json(join(dir, 'server.json'));
  assert.equal(server.version, '0.1.2');
  assert.equal(server.packages[0].version, '0.1.2');
  assert.equal(json(join(dir, 'mcpb', 'manifest.json')).version, '0.1.2');
});
