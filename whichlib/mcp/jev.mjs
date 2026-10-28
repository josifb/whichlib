// TypeSafe's Jev model: askNouls (the request code, shared with
// versions/breaking.mjs) and the fit judgment for recommend_repos: one Noul per
// candidate, "is this an installable library whose main purpose is the
// need?". Each question carries its own candidate (no distractors); the need
// sits in the shared state. Measured in the 2026-10-02 spike
// (mcp/eval/results/jev-2026-10-02-part2.md). Plain fetch and no Node
// built-ins: the hosted Worker imports this module.

export const JEV_URL = 'https://api.typesafe.ai/v1/systemone';
// Pinned: an alias such as jev-latest moves when a new release ships, and
// WEAK_FIT in tools.mjs was chosen against this version.
export const JEV_MODEL = 'jev-1.13.0';
const CHUNK = 20; // questions per request: ~3 requests for a typical pool of 40-60
const MAX_DESCRIPTION = 300;
const MAX_TOPICS = 10;

export class JevError extends Error {
  constructor(message, { status = null, requestId = null, cause = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'JevError';
    this.status = status;
    this.requestId = requestId;
  }
}

/** What Jev sees of a repository: public metadata only, trimmed. `need` is capped at 200 chars upstream by the tool's input schema (mcp/definitions.mjs). */
const card = (repo) => ({
  name: repo.fullName,
  description: String(repo.description ?? '').slice(0, MAX_DESCRIPTION),
  topics: (repo.topics ?? []).slice(0, MAX_TOPICS),
  language: repo.language ?? null,
});

export function fitQuestion(repo) {
  return {
    type: 'noul',
    instructions: {
      candidate: card(repo),
      question: 'Is `candidate` a library or framework a developer would add as a dependency, whose main purpose is `need` (in `language` when one is given)?',
    },
    criteria: {
      true: 'An installable library or framework whose primary purpose is the need',
      false: 'An application, end-user tool, service, curated list, tutorial, example collection, or a library whose main purpose is something else',
    },
  };
}

/**
 * Returns judgeFit(need, language, repos) -> Map(fullName -> probability 0-1).
 * Throws JevError on any failure, as askNouls does; it never retries or waits
 * (the caller falls back).
 */
export function createJevJudge({ apiKey, fetchImpl = fetch, model = JEV_MODEL, chunk = CHUNK, timeoutMs = 5000 }) {
  if (!apiKey) throw new Error('createJevJudge needs an apiKey');

  async function judgeFit(need, language, repos) {
    const questions = repos.map(fitQuestion);
    const ps = await askNouls({ apiKey, fetchImpl, model, chunk, timeoutMs, prefix: 'c', state: { need, language: language ?? 'any' }, questions });
    return new Map(repos.map((repo, i) => [repo.fullName, ps[i]]));
  }
  judgeFit.model = model;
  return judgeFit;
}

/**
 * Asks Jev a list of Noul questions sharing one state, `chunk` per request
 * (keys `${prefix}0`, `${prefix}1`, ...), and returns their probabilities in
 * order. Throws JevError on any failure (HTTP error, network error, bad body,
 * bad probability, or no answer within timeoutMs); never retries. The chunk
 * requests share an AbortController: the first failure aborts the others.
 */
export async function askNouls({ apiKey, fetchImpl = fetch, model = JEV_MODEL, chunk = CHUNK, timeoutMs = 5000, prefix = 'q', state, questions }) {
  const controller = new AbortController();

  async function ask(part) {
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(timeoutMs)]);
    let requestId = null;
    try {
      let res;
      try {
        res = await fetchImpl(JEV_URL, {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, state, questions: Object.fromEntries(part.map((q, i) => [`${prefix}${i}`, q])) }),
          signal,
        });
      } catch (cause) {
        if (signal.aborted) throw new JevError('TypeSafe request timed out', { cause });
        throw new JevError(`TypeSafe request failed: ${cause?.message ?? cause}`, { cause });
      }
      requestId = res.headers?.get?.('x-typesafe-request-id') ?? null;
      if (!res.ok) throw new JevError(`TypeSafe answered ${res.status}`, { status: res.status, requestId });
      let body;
      try {
        body = await res.json();
      } catch (cause) {
        if (signal.aborted) throw new JevError('TypeSafe request timed out', { requestId, cause });
        throw new JevError('TypeSafe answer was not valid JSON', { requestId, cause });
      }
      return part.map((_, i) => {
        const p = body?.answers?.[`${prefix}${i}`]?.noul;
        if (!(Number.isFinite(p) && p >= 0 && p <= 1)) throw new JevError('TypeSafe answer missing a probability', { requestId });
        return p;
      });
    } catch (err) {
      controller.abort(err); // stop the sibling requests, no wasted quota
      throw err;
    }
  }

  const parts = [];
  for (let i = 0; i < questions.length; i += chunk) parts.push(questions.slice(i, i + chunk));
  return (await Promise.all(parts.map(ask))).flat();
}
