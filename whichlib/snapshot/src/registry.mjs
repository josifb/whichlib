// Maps a GitHub repo to its npm or PyPI package and fetches weekly downloads.
// A package only counts when the registry's own metadata links back to the
// repo; a matching name alone is never enough.

const USER_AGENT = 'whichlib/0.1 (+https://github.com/josifb/whichlib)';
export const NEGATIVE_TTL_MS = 7 * 86400000;

const REGISTRIES_BY_LANGUAGE = {
  JavaScript: ['npm'],
  TypeScript: ['npm'],
  Python: ['pypi'],
  'Jupyter Notebook': ['pypi'],
};

export function registriesFor(language) {
  return REGISTRIES_BY_LANGUAGE[language] ?? [];
}

export function candidateNames(fullName) {
  const [owner, repo] = fullName.toLowerCase().split('/');
  return { npm: [repo, `@${owner}/${repo}`], pypi: [repo] };
}

/** True when any of the given strings points at github.com/<fullName> (and not a longer name). */
export function urlsMentionRepo(urls, fullName) {
  const needle = `github.com/${fullName.toLowerCase()}`;
  for (const u of urls) {
    if (typeof u !== 'string') continue;
    const s = u.toLowerCase();
    let idx = s.indexOf(needle);
    while (idx !== -1) {
      const after = s.charAt(idx + needle.length);
      if (after === '' || after === '/' || after === '#' || after === '?' || s.startsWith('.git', idx + needle.length)) return true;
      idx = s.indexOf(needle, idx + 1);
    }
  }
  return false;
}

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

// npm wants scoped names as "@scope%2Fname": only the slash is encoded.
const npmPath = (name) => name.replace('/', '%2F');

const BACKOFF_MS = [3000, 10000, 30000];

/**
 * GET JSON; null on 404. On 429 or 5xx, waits (Retry-After header when
 * given, else 3 s / 10 s / 30 s) and retries up to three times. Throws on
 * other failures or when retries are exhausted.
 */
export async function getJson(url, fetchImpl, sleep = defaultSleep) {
  for (let attempt = 0; ; attempt += 1) {
    const res = await fetchImpl(url, { headers: { Accept: 'application/json', 'User-Agent': USER_AGENT } });
    if (res.status === 404) return null;
    if (res.ok) return res.json();
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= BACKOFF_MS.length) throw new Error(`${url} -> ${res.status}`);
    const retryAfter = Number(res.headers?.get?.('retry-after'));
    await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : BACKOFF_MS[attempt]);
  }
}

function npmUrls(meta) {
  const repo = meta.repository;
  const repoUrl = typeof repo === 'string' ? repo : repo?.url;
  // "github:acme/widget" shorthand -> normalise so the matcher sees github.com/acme/widget
  const normalised = typeof repoUrl === 'string' && repoUrl.startsWith('github:') ? `https://github.com/${repoUrl.slice(7)}` : repoUrl;
  return [normalised, meta.homepage, typeof meta.bugs === 'string' ? meta.bugs : meta.bugs?.url];
}

export async function findNpmPackage(fullName, fetchImpl) {
  for (const name of candidateNames(fullName).npm) {
    const meta = await getJson(`https://registry.npmjs.org/${npmPath(name)}`, fetchImpl);
    if (meta && urlsMentionRepo(npmUrls(meta), fullName)) return meta.name ?? name;
  }
  return null;
}

export async function findPypiPackage(fullName, fetchImpl) {
  for (const name of candidateNames(fullName).pypi) {
    const data = await getJson(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`, fetchImpl);
    const info = data?.info;
    if (!info) continue;
    const urls = [info.home_page, info.download_url, ...Object.values(info.project_urls ?? {})];
    if (urlsMentionRepo(urls, fullName)) return info.name ?? name;
  }
  return null;
}

export async function npmWeeklyDownloads(name, fetchImpl) {
  const data = await getJson(`https://api.npmjs.org/downloads/point/last-week/${npmPath(name)}`, fetchImpl);
  return typeof data?.downloads === 'number' ? data.downloads : null;
}

export async function pypiWeeklyDownloads(name, fetchImpl) {
  const data = await getJson(`https://pypistats.org/api/packages/${encodeURIComponent(name)}/recent`, fetchImpl);
  return typeof data?.data?.last_week === 'number' ? data.data.last_week : null;
}

const FINDERS = { npm: findNpmPackage, pypi: findPypiPackage };
const DOWNLOADS = { npm: npmWeeklyDownloads, pypi: pypiWeeklyDownloads };

/**
 * Resolve the packages for one repo, using and updating `cache`
 * (fullName -> { npm?: name|null, pypi?: name|null, checkedAt }).
 * Positives are kept forever; negatives are re-checked after NEGATIVE_TTL_MS.
 * @returns {Promise<Array<{registry: string, name: string, weeklyDownloads: number|null}>>}
 */
export async function resolvePackages(repo, { fetchImpl = fetch, cache, now = Date.now() }) {
  const registries = registriesFor(repo.language);
  if (registries.length === 0) return [];

  const entry = cache[repo.fullName] ?? {};
  const stale = !entry.checkedAt || now - Date.parse(entry.checkedAt) > NEGATIVE_TTL_MS;
  let touched = false;

  for (const registry of registries) {
    const known = entry[registry];
    if (known || (known === null && !stale)) continue;
    entry[registry] = await FINDERS[registry](repo.fullName, fetchImpl);
    touched = true;
  }
  if (touched) {
    entry.checkedAt = new Date(now).toISOString();
    cache[repo.fullName] = entry;
  }

  const out = [];
  for (const registry of registries) {
    const name = entry[registry];
    if (!name) continue;
    // A failed download lookup must not lose the mapping: record the package with unknown downloads.
    let weeklyDownloads = null;
    try { weeklyDownloads = await DOWNLOADS[registry](name, fetchImpl); } catch { weeklyDownloads = null; }
    out.push({ registry, name, weeklyDownloads });
  }
  return out;
}
