# Drift Test report

Run 2026-11-02T10:29:55.590Z to 2026-11-02T10:38:49.204Z. Model: claude-opus-5-5. 3 tasks, setups: alone, context7, whichlib.

Pass or fail is decided only by each task's type checker and tests. Errors (usage limit, failed install, agent crash before any edit) are not counted in pass rates.

## Pass rate per setup

| Setup | Passed | Pass rate | vs alone | vs Context7 | Errors | Avg tokens | Avg time |
|---|---|---|---|---|---|---|---|
| alone | 3/3 | 100% | — | 0 pts | 0 | 112473 | 39.1 s |
| context7 | 3/3 | 100% | 0 pts | — | 0 | 195924 | 54.8 s |
| whichlib | 3/3 | 100% | 0 pts | 0 pts | 0 | 106063 | 36.2 s |

## Verdict

**Stop and rethink.** whichlib is 0 pts vs agent alone and 0 pts vs Context7 (needs +20 pts vs agent alone and +10 pts vs Context7).

## Per task

| Task | Library | alone | context7 | whichlib |
|---|---|---|---|---|
| zod-order-errors | zod | pass | pass | pass |
| zod-server-config | zod | pass | pass | pass |
| zod-signup-form | zod | pass | pass | pass |
