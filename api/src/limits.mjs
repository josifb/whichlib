// Free-tier limits: 50 tool calls per user per UTC day (D1 counter) and a
// burst guard of 20 per minute (Workers rate-limit binding).

export const DAILY_LIMIT = 50;

const UPSERT = 'INSERT INTO daily_usage (user_hash, day, calls) VALUES (?, ?, 1) ON CONFLICT (user_hash, day) DO UPDATE SET calls = calls + 1 RETURNING calls';
const PRUNE = 'DELETE FROM daily_usage WHERE day < ?';

export function createDailyCounter(db, { limit = DAILY_LIMIT } = {}) {
  return {
    limit,
    /** Count one call for user on day; prune days before `yesterday`. Refused calls count too. */
    async hit(user, day, yesterday) {
      const [upserted] = await db.batch([db.prepare(UPSERT).bind(user, day), db.prepare(PRUNE).bind(yesterday)]);
      const calls = Number(upserted.results[0].calls);
      return { allowed: calls <= limit, calls, remaining: Math.max(0, limit - calls) };
    },
  };
}

/** True when the call may go ahead. Without a binding (e.g. a bare test env) nothing is limited. */
export async function checkBurst(binding, key) {
  if (!binding) return true;
  const { success } = await binding.limit({ key });
  return success;
}
