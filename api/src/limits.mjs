// Free-tier limits: 50 tool calls per user per UTC day (D1 counter) and a
// burst guard of 20 per minute (Workers rate-limit binding).
import { utcDay } from './identity.mjs';

export const DAILY_LIMIT = 50;
/** Calls per minute per user; must match wrangler.toml ratelimits.simple.limit. */
export const BURST_LIMIT = 20;

const DAY_MS = 86_400_000;
const UPSERT = 'INSERT INTO daily_usage (user_hash, day, calls) VALUES (?, ?, 1) ON CONFLICT (user_hash, day) DO UPDATE SET calls = calls + 1 RETURNING calls';
const PRUNE = 'DELETE FROM daily_usage WHERE day < ?';
const REFUND = 'UPDATE daily_usage SET calls = calls - 1 WHERE user_hash = ? AND day = ? AND calls > 0';

export function createDailyCounter(db, { limit = DAILY_LIMIT } = {}) {
  // Users already over the limit today: refused from memory, so a hammering client costs no D1 writes.
  // Per isolate; another isolate finds out with its own first refused query.
  let overDay = null;
  const over = new Set();
  return {
    limit,
    /** Count one call for user on day. On that user's first call of the day, also prune rows older than yesterday. Refused calls count too. */
    async hit(user, day) {
      if (day !== overDay) { over.clear(); overDay = day; }
      if (over.has(user)) return { allowed: false, calls: limit + 1, remaining: 0 };
      const { results } = await db.prepare(UPSERT).bind(user, day).all();
      const calls = Number(results[0].calls);
      if (calls === 1) {
        const yesterday = utcDay(Date.parse(day) - DAY_MS);
        await db.prepare(PRUNE).bind(yesterday).run();
      }
      if (calls > limit) over.add(user);
      return { allowed: calls <= limit, calls, remaining: Math.max(0, limit - calls) };
    },
    /** Give back one count (the call failed through no fault of the user). */
    async refund(user, day) {
      await db.prepare(REFUND).bind(user, day).run();
    },
  };
}

/** True when the call may go ahead. Without a binding (e.g. a bare test env) nothing is limited. */
export async function checkBurst(binding, key) {
  if (!binding) return true;
  const { success } = await binding.limit({ key });
  return success;
}
