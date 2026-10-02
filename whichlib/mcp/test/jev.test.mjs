import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createJevJudge, fitQuestion, JevError, JEV_MODEL, JEV_URL } from '../jev.mjs';

const repo = (fullName, extra = {}) => ({ fullName, description: `${fullName} does pdf parsing`, topics: ['pdf'], language: 'Python', ...extra });

/** Fake fetch: records requests, answers every question with `p(name)`. */
function fakeFetch({ p = () => 0.9, status = 200, requestId = 'req_1' } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, init, body });
    const answers = Object.fromEntries(Object.entries(body.questions).map(([k, q]) => [k, { type: 'noul', noul: p(q.instructions.candidate.name) }]));
    return {
      ok: status === 200, status,
      headers: { get: (h) => (h === 'x-typesafe-request-id' ? requestId : null) },
      json: async () => ({ model: JEV_MODEL, answers, usage: { input_tokens: 100, output_tokens: 1 } }),
    };
  };
  return { fetchImpl, calls };
}

test('jev: model is pinned to a version, not an alias', () => {
  assert.match(JEV_MODEL, /^jev-\d+\.\d+\.\d+$/);
});

test('jev: one Noul per candidate, candidate in instructions, need and language in state', async () => {
  const { fetchImpl, calls } = fakeFetch();
  const judge = createJevJudge({ apiKey: 'k', fetchImpl });
  await judge('pdf parser', 'Python', [repo('a/one'), repo('b/two')]);
  assert.equal(calls.length, 1);
  const { url, init, body } = calls[0];
  assert.equal(url, JEV_URL);
  assert.equal(init.method, 'POST');
  assert.equal(init.headers.Authorization, 'Bearer k');
  assert.equal(body.model, JEV_MODEL);
  assert.deepEqual(body.state, { need: 'pdf parser', language: 'Python' });
  assert.deepEqual(Object.keys(body.questions), ['c0', 'c1']);
  assert.equal(body.questions.c0.type, 'noul');
  assert.equal(body.questions.c0.instructions.candidate.name, 'a/one');
  assert.match(body.questions.c0.instructions.question, /`candidate`.*`need`/);
  assert.ok(body.questions.c0.criteria.true && body.questions.c0.criteria.false);
});

test('jev: language null is sent as "any"', async () => {
  const { fetchImpl, calls } = fakeFetch();
  await createJevJudge({ apiKey: 'k', fetchImpl })('orm', null, [repo('a/one')]);
  assert.equal(calls[0].body.state.language, 'any');
});

test('jev: returns a Map fullName -> probability', async () => {
  const { fetchImpl } = fakeFetch({ p: (name) => (name === 'a/one' ? 0.93 : 0.04) });
  const out = await createJevJudge({ apiKey: 'k', fetchImpl })('pdf parser', 'Python', [repo('a/one'), repo('b/two')]);
  assert.deepEqual([...out], [['a/one', 0.93], ['b/two', 0.04]]);
});

test('jev: 45 candidates go out as 3 requests of at most 20', async () => {
  const { fetchImpl, calls } = fakeFetch();
  const repos = Array.from({ length: 45 }, (_, i) => repo(`o/r${i}`));
  const out = await createJevJudge({ apiKey: 'k', fetchImpl })('orm', 'Python', repos);
  assert.deepEqual(calls.map((c) => Object.keys(c.body.questions).length), [20, 20, 5]);
  assert.equal(out.size, 45);
});

test('jev: no candidates, no request', async () => {
  const { fetchImpl, calls } = fakeFetch();
  const out = await createJevJudge({ apiKey: 'k', fetchImpl })('orm', 'Python', []);
  assert.equal(calls.length, 0);
  assert.equal(out.size, 0);
});

test('jev: long descriptions and topic lists are trimmed (state budget, less room for injected text)', () => {
  const q = fitQuestion(repo('a/one', { description: 'x'.repeat(1000), topics: Array.from({ length: 30 }, (_, i) => `t${i}`) }));
  assert.equal(q.instructions.candidate.description.length, 300);
  assert.equal(q.instructions.candidate.topics.length, 10);
});

test('jev: a non-200 answer throws JevError with status and request id, no retry', async () => {
  const { fetchImpl, calls } = fakeFetch({ status: 429, requestId: 'req_42' });
  const err = await createJevJudge({ apiKey: 'k', fetchImpl })('orm', 'Python', [repo('a/one')]).catch((e) => e);
  assert.ok(err instanceof JevError);
  assert.equal(err.status, 429);
  assert.equal(err.requestId, 'req_42');
  assert.equal(calls.length, 1);
});

test('jev: an answer without a number throws JevError', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ answers: {} }) });
  const err = await createJevJudge({ apiKey: 'k', fetchImpl })('orm', 'Python', [repo('a/one')]).catch((e) => e);
  assert.ok(err instanceof JevError);
});

test('jev: the judge carries its model name', () => {
  assert.equal(createJevJudge({ apiKey: 'k', fetchImpl: async () => ({}) }).model, JEV_MODEL);
});

/** Fetch that never answers; rejects with the signal's reason when aborted. The interval keeps the event loop alive (AbortSignal.timeout timers are unref'd). */
const hangingFetch = (signals = []) => (url, init) => new Promise((_, reject) => {
  signals.push(init.signal);
  const keepAlive = setInterval(() => {}, 1000);
  init.signal.addEventListener('abort', () => { clearInterval(keepAlive); reject(init.signal.reason); });
});

test('jev: a request that never answers times out as a JevError', async () => {
  const judge = createJevJudge({ apiKey: 'k', fetchImpl: hangingFetch(), timeoutMs: 20 });
  const err = await judge('orm', 'Python', [repo('a/one')]).catch((e) => e);
  assert.ok(err instanceof JevError);
  assert.match(err.message, /timed out/);
  assert.equal(err.status, null);
});

test('jev: the first chunk failure aborts the sibling requests', async () => {
  const signals = [];
  let n = 0;
  const fetchImpl = (url, init) => {
    if (n++ === 0) {
      signals.push(init.signal);
      return Promise.resolve({ ok: false, status: 500, headers: { get: () => null }, json: async () => ({}) });
    }
    return hangingFetch(signals)(url, init);
  };
  const judge = createJevJudge({ apiKey: 'k', fetchImpl, chunk: 1 });
  const err = await judge('orm', 'Python', [repo('a/one'), repo('b/two')]).catch((e) => e);
  assert.ok(err instanceof JevError);
  assert.equal(err.status, 500);
  assert.equal(signals.length, 2);
  assert.equal(signals[1].aborted, true);
});

test('jev: a network TypeError becomes a JevError with the cause', async () => {
  const fetchImpl = async () => { throw new TypeError('fetch failed'); };
  const err = await createJevJudge({ apiKey: 'k', fetchImpl })('orm', 'Python', [repo('a/one')]).catch((e) => e);
  assert.ok(err instanceof JevError);
  assert.ok(err.cause instanceof TypeError);
});

test('jev: an unparseable body becomes a JevError', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, headers: { get: () => 'req_7' }, json: async () => { throw new SyntaxError('bad json'); } });
  const err = await createJevJudge({ apiKey: 'k', fetchImpl })('orm', 'Python', [repo('a/one')]).catch((e) => e);
  assert.ok(err instanceof JevError);
  assert.ok(err.cause instanceof SyntaxError);
  assert.equal(err.requestId, 'req_7');
});

test('jev: a probability outside 0..1 or NaN throws JevError', async () => {
  for (const bad of [NaN, 1.5, -0.1, Infinity]) {
    const { fetchImpl } = fakeFetch({ p: () => bad });
    const err = await createJevJudge({ apiKey: 'k', fetchImpl })('orm', 'Python', [repo('a/one')]).catch((e) => e);
    assert.ok(err instanceof JevError, String(bad));
  }
});

test('jev: a missing apiKey fails at construction', () => {
  assert.throws(() => createJevJudge({ fetchImpl: async () => ({}) }), /needs an apiKey/);
  assert.throws(() => createJevJudge({ apiKey: '' }), /needs an apiKey/);
});

test('jev: a partial answer (one candidate missing) throws JevError', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ answers: { c0: { noul: 0.9 } } }) });
  const err = await createJevJudge({ apiKey: 'k', fetchImpl })('orm', 'Python', [repo('a/one'), repo('b/two')]).catch((e) => e);
  assert.ok(err instanceof JevError);
});
