## Before opening a pull request

Run these and include the results in the PR description. Don't report work as done until they pass. Don't run the tests; CI runs them.

```sh
pnpm typecheck
pnpm exec eslint . --max-warnings 0
pnpm exec prettier --check .
```

- For UI changes, check the change in the browser preview and attach a screenshot with `gh pr edit <n> --attach ./shot.jpg` (reference it in the body as `![alt](./shot.jpg)`; gh rewrites the links).
- Review your own diff against `REVIEW.md` before pushing, preferably with a subagent that has fresh context.
- If the diff touches a path in `.github/CODEOWNERS`, say so in the PR description; it needs a human merge.
- If a reviewer flags the same kind of issue repeatedly, fix the cause (a lint rule, a test, or this file), not just the instance.

<!-- CODEGRAPH_START -->

## CodeGraph

In repositories indexed by CodeGraph (a `.codegraph/` directory exists at the repo root), reach for it BEFORE grep/find or reading files when you need to understand or locate code:

- **MCP tool** (when available): `codegraph_explore` answers most code questions in one call — the relevant symbols' verbatim source plus the call paths between them, including dynamic-dispatch hops grep can't follow. Name a file or symbol in the query to read its current line-numbered source. If it's listed but deferred, load it by name via tool search.
- **Shell** (always works): `codegraph explore "<symbol names or question>"` prints the same output.

If there is no `.codegraph/` directory, skip CodeGraph entirely — indexing is the user's decision.
<!-- CODEGRAPH_END -->
