import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareVersions } from '../version.mjs';

test('versions: npm and PyPI releases in order, prereleases before their final, .post after', () => {
  const sorted = ['2.0.post1', '2.0.0', '2.0.0rc1', '2.0.0-beta.2', '2.0.0-alpha.1', '1.10.26', '2.0.0b3', '0.0.0-experimental-abc', '2.0.0-insiders.abc'].sort(compareVersions);
  assert.deepEqual(sorted, ['0.0.0-experimental-abc', '1.10.26', '2.0.0-insiders.abc', '2.0.0-alpha.1', '2.0.0-beta.2', '2.0.0b3', '2.0.0rc1', '2.0.0', '2.0.post1']);
  assert.equal(compareVersions('2.0', '2.0.0'), 0);
  assert.equal(compareVersions('4.0.0+build.5', '4.0.0'), 0);
});
