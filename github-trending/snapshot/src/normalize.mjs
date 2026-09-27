/** Reduce a raw Search API repository item to the fields we store and score. */
export function normalizeRepo(item) {
  return {
    fullName: item.full_name,
    url: item.html_url,
    description: item.description ?? '',
    language: item.language ?? null,
    stars: item.stargazers_count,
    forks: item.forks_count,
    openIssues: item.open_issues_count,
    license: item.license?.key ?? null,
    createdAt: item.created_at,
    pushedAt: item.pushed_at,
    archived: Boolean(item.archived),
    topics: Array.isArray(item.topics) ? item.topics : [],
  };
}
