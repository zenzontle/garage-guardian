@~/.claude/AGENTS.md

## Before opening a pull request

Run these and include the results in the PR description. Don't report work as done until they pass. Don't run the tests; CI runs them.

```sh
pnpm typecheck
pnpm exec eslint . --max-warnings 0
pnpm exec prettier --check .
```

- For UI changes, check the change in the browser preview and attach a screenshot with `gh pr edit <n> --attach ./shot.jpg` (reference it in the body as `![alt](./shot.jpg)`; gh rewrites the links).
- Review your own diff against `REVIEW.md` before pushing, with a general-purpose subagent (not a fork — it should start with a fresh context).
- If the diff touches a path in `.github/CODEOWNERS`, say so in the PR description; it needs a human merge.
- If a reviewer flags the same kind of issue repeatedly, fix the cause (a lint rule, a test, or this file), not just the instance.
