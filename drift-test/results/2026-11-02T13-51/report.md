# Drift Test report

Run 2026-11-02T13:51:24.302Z to 2026-11-02T20:34:19.549Z. Model:claude-opus-5-5. 30 tasks, setups: alone, context7, whichlib.

Pass or fail is decided only by each task's type checker and tests. Errors (usage limit, failed install, agent crash before any edit) are not counted in pass rates.

## Pass rate per setup

| Setup | Passed | Pass rate | vs alone | vs Context7 | Errors | Avg tokens | Avg time |
|---|---|---|---|---|---|---|---|
| alone | 29/30 | 96.7% | — | 0 pts | 0 | 171358 | 52.1 s |
| context7 | 29/30 | 96.7% | 0 pts | — | 0 | 210193 | 61 s |
| whichlib | 29/30 | 96.7% | 0 pts | 0 pts | 0 | 151713 | 45.5 s |

## Verdict

**Stop and rethink.** whichlib is 0 pts vs agent alone and 0 pts vs Context7 (needs +20 pts vs agent alone and +10 pts vs Context7).

## Per task

| Task | Library | alone | context7 | whichlib |
|---|---|---|---|---|
| ai-support-chat | ai | pass | pass | pass |
| ai-tool-context | ai | pass | pass | pass |
| ai-usage-report | ai | pass | pass | pass |
| langchain-chat-memory | langchain | pass | pass | pass |
| langchain-summarize | langchain | pass | pass | pass |
| langchain-tool-agent | langchain | pass | pass | pass |
| next-admin-actions | next | pass | pass | pass |
| next-lint-script | next | pass | pass | pass |
| next-product-page | next | pass | pass | pass |
| prisma-blog-queries | prisma | pass | pass | pass |
| prisma-seed | prisma | fail | fail | pass |
| prisma-todo-setup | prisma | pass | pass | fail |
| pydantic-booking | pydantic | pass | pass | pass |
| pydantic-catalog | pydantic | pass | pass | pass |
| pydantic-settings-env | pydantic | pass | pass | pass |
| react-item-refs | react | pass | pass | pass |
| react-mount-app | react | pass | pass | pass |
| react-stopwatch | react | pass | pass | pass |
| sqlalchemy-active-users | sqlalchemy | pass | pass | pass |
| sqlalchemy-add-user | sqlalchemy | pass | pass | pass |
| sqlalchemy-order-report | sqlalchemy | pass | pass | pass |
| tailwind-brand-setup | tailwindcss | pass | pass | pass |
| tailwind-dark-toggle | tailwindcss | pass | pass | pass |
| tailwind-postcss-utility | tailwindcss | pass | pass | pass |
| vite-drop-console | vite | pass | pass | pass |
| vite-keep-names | vite | pass | pass | pass |
| vite-vendor-chunk | vite | pass | pass | pass |
| zod-order-errors | zod | pass | pass | pass |
| zod-server-config | zod | pass | pass | pass |
| zod-signup-form | zod | pass | pass | pass |

## Failures

- prisma-seed / alone: check failed: `npx prisma db seed` exited 1
- prisma-seed / context7: check failed: `npx prisma db seed` exited 1
- prisma-todo-setup / whichlib: check failed: `npx tsx --test drift-judge/*.test.ts` exited 1
