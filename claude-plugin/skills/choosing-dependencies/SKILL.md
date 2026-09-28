---
name: choosing-dependencies
description: Use before adding a new third-party library or package to a project, or when the user asks which library to use or to compare libraries. Picks with evidence from the whichlib MCP tools instead of memory.
---

# Choosing dependencies with whichlib

Training data is months old; library health changes weekly. Before you add a
dependency the project does not already use, check it.

1. Call `recommend_repos` with the need in plain words (for example
   "parse PDF files", "schema validation") and the project's language.
2. If the user or you already have candidates, call `compare_repos` with them
   as `owner/repo`.
3. Prefer tiers Strong or Solid. Read the verdict and flags: avoid archived
   repos, no license, or a license the project cannot ship.
4. Tell the user which library you picked and why in one line, quoting the
   score and verdict. If the top result does not fit the need, say so and
   pick the best fitting one.

Skip the check for libraries the project already depends on, and for the
language's standard library.
