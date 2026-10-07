# Claude Code hooks

Wired in [`../settings.json`](../settings.json). They give Claude, locally and in the GitHub agent
jobs, the same checks CI runs, at the moment it edits. They are not git hooks (D11): nothing runs on
`git commit`, and humans are not affected.

| Hook | When | What it does | On failure |
|---|---|---|---|
| `session-start.sh` | Session starts (Claude Code on the web only) | `npm ci` so checks can run | — |
| `guard-bash.sh` | Before any shell command | Blocks pushing to `main`, force-push, `--no-verify`, printing `.env` files | Command refused with the reason |
| `protect-files.sh` | Before an edit | Blocks edits to `.env`, generated files (`routeTree.gen.ts`, MSW worker, `package-lock.json`, `drizzle/meta`) and merged migrations | Edit refused with what to do instead |
| `format-and-lint.sh` | After an edit | Prettier on the file; ESLint on `.ts/.tsx/.js` with the workspace config | Lint errors returned to Claude to fix |
| `typecheck-changed.sh` | Claude is about to finish its turn | `turbo run typecheck` on the workspaces with changed `.ts/.tsx` (skipped in CI, where agents run `npm run check`) | Type errors returned to Claude to fix |

All hooks use Node 22 (from Homebrew `node@22` or nvm when the default node differs) and do nothing
when `node_modules` is missing. Shared helpers live in `lib/common.sh`.

To test a hook by hand, pipe it the JSON Claude would send:

```sh
echo '{"tool_input":{"command":"git push origin main"}}' | .claude/hooks/guard-bash.sh; echo $?
```
