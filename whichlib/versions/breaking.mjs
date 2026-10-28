// Breaking-change judgment by TypeSafe's Jev model: one Noul per changelog
// entry, "must a project change its own code, configuration or setup to keep
// working?". Entries at THRESHOLD (build.mjs) or above count as breaking; the
// threshold was chosen for this question on the pinned JEV_MODEL. Node-free.

import { askNouls, JEV_MODEL } from '../mcp/jev.mjs';

const MAX_TEXT = 1500;

export function breakingQuestion(entry) {
  return {
    type: 'noul',
    instructions: {
      entry: { section: entry.section ?? '', text: entry.text.slice(0, MAX_TEXT) },
      question: 'Because of this changelog `entry` of `package`, must a project that uses `package` change its own code, configuration or setup to keep working as before?',
    },
    criteria: {
      true: 'A removed, renamed or changed API, option, default, file format, command or requirement that existing projects must adapt to',
      false: 'A new feature, bug fix, performance or internal change, docs, tests or dependency bump that existing projects need not act on',
    },
  };
}

/** Returns judge(pkg, entries) -> probabilities 0-1 in entry order; judge.model names the model. Throws JevError, never retries. */
export function createBreakingJudge({ apiKey, fetchImpl = fetch, model = JEV_MODEL, chunk, timeoutMs = 30000 }) {
  if (!apiKey) throw new Error('createBreakingJudge needs an apiKey');
  const judge = (pkg, entries) => askNouls({ apiKey, fetchImpl, model, chunk, timeoutMs, prefix: 'e', state: { package: pkg }, questions: entries.map(breakingQuestion) });
  judge.model = model;
  return judge;
}
