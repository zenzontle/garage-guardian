@~/.claude/AGENTS.md

## Before opening a pull request

Run `pnpm check` (formatting, lint rules and typecheck) and include the result in the PR description. Don't report work as done until it passes. CI also runs the tests and the build.

- For UI changes, check the change in the browser preview and attach a screenshot with `gh pr edit <n> --attach ./shot.jpg` (reference it in the body as `![alt](./shot.jpg)`; gh rewrites the links).
- If the repository has a `REVIEW.md`, review your own diff against it before pushing, with a general-purpose subagent (not a fork — it should start with a fresh context).
- If the diff touches a path in `.github/CODEOWNERS`, say so in the PR description; it needs a human merge.
- If a reviewer flags the same kind of issue repeatedly, fix the cause (a lint rule, a test, or this file), not just the instance.
