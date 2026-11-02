# Notes on this run

First full Drift Test: 30 tasks x 3 setups (alone, context7, whichlib), Claude Code's default
model on the owner's account (`claude-opus-5-5`), 2026-11-02. Verdict by the rules fixed in
advance (ADR in this repo's README, "Win rules"): **stop**. Every setup passed 29/30.

- **The run was resumed once.** It stopped silently after 26 runs, during
  `next-product-page / whichlib` (cause unknown; nothing was printed). It was continued with
  `--resume`, which reran only the missing runs. No result was edited by hand.
- **The three fails are the same environment problem, one per setup** (`prisma-seed` alone and
  context7, `prisma-todo-setup` whichlib). The agent rebuilt or reinstalled the `better-sqlite3`
  native module with a newer Node (NODE_MODULE_VERSION 137) than the one the checks ran on
  (Node 22.13, version 127), so the database driver failed to load during the check. That is not
  version drift. Counted as passes, every setup would be 30/30 and the verdict would be the same.
- **Why nothing drifted:** all ten majors in this task set were released before the model's
  training cutoff, and every task lets the agent run the type checker or tests while it works,
  so it corrects its own mistakes. The differences between setups are in cost, not in pass rate:
  per task, whichlib used about 11% fewer tokens and 13% less time than the agent alone, and
  Context7 about 23% more tokens and 17% more time.
- `../2026-11-02T10-29/` is the pilot run on the three zod tasks before this one (9/9 pass in
  every setup).
