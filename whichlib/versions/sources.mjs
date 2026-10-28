// Real sources for buildIndex: npm and PyPI version lists, files from GitHub
// at the last commit that touched them (links stay valid), GitHub releases.
// Plain fetch, no Node built-ins.

const encodePath = (path) => path.split('/').map(encodeURIComponent).join('/');

export function createSources({ token = null, fetchImpl = fetch } = {}) {
  const github = async (path) => {
    const res = await fetchImpl(`https://api.github.com${path}`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'whichlib', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
    if (!res.ok) throw new Error(`GitHub ${path} answered ${res.status}`);
    return res.json();
  };

  return {
    async versions(pkg, ecosystem) {
      if (ecosystem === 'npm') {
        const res = await fetchImpl(`https://registry.npmjs.org/${pkg.replace('/', '%2F')}`);
        if (!res.ok) throw new Error(`npm ${pkg} answered ${res.status}`);
        return Object.keys((await res.json()).versions ?? {});
      }
      if (ecosystem === 'pypi') {
        const res = await fetchImpl(`https://pypi.org/pypi/${encodeURIComponent(pkg)}/json`);
        if (!res.ok) throw new Error(`PyPI ${pkg} answered ${res.status}`);
        return Object.keys((await res.json()).releases ?? {});
      }
      throw new Error(`unknown ecosystem: ${ecosystem}`);
    },

    async file(repo, path) {
      const [commit] = await github(`/repos/${repo}/commits?path=${encodeURIComponent(path)}&per_page=1`);
      if (!commit) throw new Error(`GitHub ${repo}: no commit touches ${path}`);
      const res = await fetchImpl(`https://raw.githubusercontent.com/${repo}/${commit.sha}/${encodePath(path)}`);
      if (!res.ok) throw new Error(`GitHub ${repo}/${path} answered ${res.status}`);
      return { text: await res.text(), url: `https://github.com/${repo}/blob/${commit.sha.slice(0, 10)}/${encodePath(path)}` };
    },

    async releases(repo) {
      const out = [];
      for (let page = 1; ; page++) {
        const list = await github(`/repos/${repo}/releases?per_page=100&page=${page}`);
        out.push(...list.map((r) => ({ tag: r.tag_name, url: r.html_url, body: r.body ?? '', prerelease: r.prerelease || r.draft })));
        if (list.length < 100) return out;
      }
    },
  };
}
