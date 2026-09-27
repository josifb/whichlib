# data branch

Daily snapshots written by the `snapshot` GitHub Actions workflow on `main`
of josifb/whichlib.

- `snapshots/YYYY-MM-DD.json`: one file per day, top 100 repos for 3 periods
  x 9 languages, enriched with npm / PyPI packages and weekly downloads.
- `registry-map.json`: repo -> package names cache, refreshed daily.

Do not edit by hand. Pull them locally with `npm run pull-data` in `whichlib/`
on `main`.
