import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBreakingJudge } from '../breaking.mjs';
import { JevError, JEV_MODEL, JEV_URL } from '../../mcp/jev.mjs';

/** Fake TypeSafe: records requests, answers each question with p(entry text). */
function fakeFetch({ p = () => 0.5, status = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, init, body });
    const answers = Object.fromEntries(Object.entries(body.questions).map(([k, q]) => [k, { type: 'noul', noul: p(q.instructions.entry.text) }]));
    return { ok: status === 200, status, headers: { get: () => 'req_1' }, json: async () => ({ answers }) };
  };
  return { fetchImpl, calls };
}

const entry = (text, section = 'Changes') => ({ version: '4.0.0', section, text });

test('breaking judge: one Noul per entry on the pinned model, package in state, entry in instructions', async () => {
  const { fetchImpl, calls } = fakeFetch({ p: (t) => (t.includes('Removed') ? 0.9 : 0.1) });
  const judge = createBreakingJudge({ apiKey: 'k', fetchImpl });
  const ps = await judge('zod', [entry('Removed `z.bar()`'), entry('Faster parsing', 'Features')]);
  assert.deepEqual(ps, [0.9, 0.1]);
  assert.equal(judge.model, JEV_MODEL);
  assert.equal(calls.length, 1);
  const { url, init, body } = calls[0];
  assert.equal(url, JEV_URL);
  assert.equal(init.headers.Authorization, 'Bearer k');
  assert.equal(body.model, JEV_MODEL);
  assert.deepEqual(body.state, { package: 'zod' });
  assert.deepEqual(Object.keys(body.questions), ['e0', 'e1']);
  assert.equal(body.questions.e0.type, 'noul');
  assert.deepEqual(body.questions.e1.instructions.entry, { section: 'Features', text: 'Faster parsing' });
  assert.match(body.questions.e0.instructions.question, /change its own code, configuration or setup/);
});

test('breaking judge: 45 entries go out as 3 requests of at most 20, answers stay in order', async () => {
  const { fetchImpl, calls } = fakeFetch({ p: (t) => Number(t) / 100 });
  const entries = Array.from({ length: 45 }, (_, i) => entry(String(i)));
  const ps = await createBreakingJudge({ apiKey: 'k', fetchImpl })('vite', entries);
  assert.deepEqual(calls.map((c) => Object.keys(c.body.questions).length), [20, 20, 5]);
  assert.deepEqual(ps, entries.map((_, i) => i / 100));
});

test('breaking judge: long entries are cut to 1,500 characters', async () => {
  const { fetchImpl, calls } = fakeFetch();
  await createBreakingJudge({ apiKey: 'k', fetchImpl })('next', [entry('x'.repeat(5000))]);
  assert.equal(calls[0].body.questions.e0.instructions.entry.text.length, 1500);
});

test('breaking judge: a failed request throws JevError', async () => {
  const { fetchImpl } = fakeFetch({ status: 500 });
  const err = await createBreakingJudge({ apiKey: 'k', fetchImpl })('next', [entry('a')]).catch((e) => e);
  assert.ok(err instanceof JevError);
  assert.equal(err.status, 500);
});
