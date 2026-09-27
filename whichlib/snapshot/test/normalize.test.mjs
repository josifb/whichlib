import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRepo } from '../src/normalize.mjs';

const raw = {
  id: 1388594776,
  full_name: 'zai-org/ZCode',
  html_url: 'https://github.com/zai-org/ZCode',
  description: "Z.ai's coding agent harness.",
  language: 'TypeScript',
  stargazers_count: 6864,
  forks_count: 2069,
  open_issues_count: 11,
  license: { key: 'apache-2.0', name: 'Apache License 2.0' },
  created_at: '2026-09-20T12:01:16Z',
  pushed_at: '2026-09-24T06:49:55Z',
  archived: false,
  topics: ['agents', 'cli'],
  owner: { login: 'zai-org', avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4' },
};

test('normalizeRepo: picks the fields the dashboard and scorer need', () => {
  assert.deepEqual(normalizeRepo(raw), {
    fullName: 'zai-org/ZCode',
    url: 'https://github.com/zai-org/ZCode',
    description: "Z.ai's coding agent harness.",
    language: 'TypeScript',
    stars: 6864,
    forks: 2069,
    openIssues: 11,
    license: 'apache-2.0',
    createdAt: '2026-09-20T12:01:16Z',
    pushedAt: '2026-09-24T06:49:55Z',
    archived: false,
    topics: ['agents', 'cli'],
  });
});

test('normalizeRepo: null description, license, language and missing topics get safe defaults', () => {
  const out = normalizeRepo({ ...raw, description: null, license: null, language: null, topics: undefined });
  assert.equal(out.description, '');
  assert.equal(out.license, null);
  assert.equal(out.language, null);
  assert.deepEqual(out.topics, []);
});
