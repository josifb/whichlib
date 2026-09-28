// Pure helpers that define what "trending" means for this project:
// repos created within the period, ranked by stars. The dashboard page
// duplicates this logic inline (a file:// page cannot import modules);
// the tests here are the reference behaviour.

const PERIOD_DAYS = { day: 1, week: 7, month: 30 };

export const PERIODS = Object.keys(PERIOD_DAYS);

/** ISO timestamp (seconds precision, Z suffix) for the start of the period. */
export function periodStart(period, now = new Date()) {
  const days = PERIOD_DAYS[period];
  if (days === undefined) throw new Error(`unknown period: ${period}`);
  const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return start.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** GitHub search qualifier string, e.g. `created:>=2026-09-20T10:30:45Z language:"C#"`. */
export function buildSearchQuery({ period, language = null, now = new Date() }) {
  const parts = [`created:>=${periodStart(period, now)}`];
  if (language) {
    const needsQuotes = /[^A-Za-z0-9_-]/.test(language);
    parts.push(`language:${needsQuotes ? `"${language}"` : language}`);
  }
  return parts.join(' ');
}

/** Full Search API URL, sorted by stars descending. */
export function searchUrl(query, { perPage = 100, page = null } = {}) {
  const params = new URLSearchParams({ q: query, sort: 'stars', order: 'desc', per_page: String(perPage) });
  if (page) params.set('page', String(page));
  return `https://api.github.com/search/repositories?${params.toString()}`;
}
