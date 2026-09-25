# Agent workflow

nthstock is built by a team of Claude agents running on GitHub Actions. The owner approves plans
and merges PRs; everything in between is automatic.

## The loop

```
Owner labels an issue `plan:approved`
  └─► Planner ─► spec PR (label `spec`) + story issues (`agent:backlog`)
Owner merges the spec PR
  └─► stories move to `agent:ready` ─► Developer ─► PR (`agent:pr`, "Closes #N")
PR opened or updated
  └─► Reviewer ─┬─ no blocking findings ─► `ready-to-merge` ─► owner merges
                ├─ blocking findings ─► `agent:fix-needed` ─► Fixer pushes to the same PR ─► Reviewer again
                └─ bug outside the PR's scope ─► new `bug` issue (`agent:ready`) ─► Developer
CI red on an owner, agent or Dependabot PR
  └─► Fixer finds the root cause and pushes a fix to the same PR (3 attempts, then `needs-human`)
      └─ Dependabot bump the stack can't take ─► `@dependabot ignore this major version`
CI red on main
  └─► Fixer opens a `claude/fix-main-*` PR (never pushes to main) ─► Reviewer ─► owner merges
Hourly sweep
  └─► catches red PRs the events missed (Dependabot runs get no secrets; PRs red only because main was red)
Push to main makes an open PR conflict
  └─► Conflict resolver merges main INTO the PR branch ─┬─ clean ─► checks pass ─► push to PR
                                                        ├─ conflicts ─► Fixer resolves, checks pass ─► push to PR
                                                        └─ can't keep both sides ─► `needs-human`
```

`main` is never modified by agents: conflicts are always resolved on the PR branch by merging
`main` in (no rebase, no force-push), a pre-push hook blocks pushes to `main`, and branch
protection is the final guard. Dependabot PRs are skipped by the conflict resolver because
Dependabot rebases its own PRs, but their CI failures go to the Fixer.

| Agent | Workflow | Role definition |
|---|---|---|
| Planner | `.github/workflows/agent-planner.yml` | `.claude/agents/planner.md` |
| Developer | `.github/workflows/agent-developer.yml` | `.claude/agents/developer.md` |
| Reviewer | `.github/workflows/agent-reviewer.yml` | `.claude/agents/reviewer.md` |
| Fixer | `.github/workflows/agent-fixer.yml` | `.claude/agents/fixer.md` |
| Conflict resolver | `.github/workflows/agent-conflicts.yml` | `.claude/agents/fixer.md` (Merge conflicts) |
| (glue) | `agent-promote-stories.yml`, `agent-labels.yml` | — |

## Guardrails
- **Only the owner or the agents can start agents.** Every workflow checks that the label was added
  by the owner (`OWNER_LOGIN`, default `nareshpayani`) or the Claude app (`AGENT_BOT_LOGIN`,
  default `claude[bot]`), and the Reviewer only runs on PRs from this repo by those two authors.
  Strangers opening issues or PRs on this public repo cannot spend usage or inject prompts.
- **Loop limits:** after 3 CI-fix attempts on a PR it gets `needs-human`; only one fix-main PR is open at a time.
- **Loop limit:** after 3 agent reviews (`AGENT_MAX_REVIEW_ROUNDS`) a PR gets `needs-human` and agents stop.
- **Agents never merge, never push to `main`, never touch secrets or deploy.**
- **Cost caps:** `--max-turns` per agent, job timeouts, one run per issue/PR at a time.

## One-time setup (owner)
1. Run `claude setup-token` locally and save the token as the repo secret `CLAUDE_CODE_OAUTH_TOKEN`
   (Settings → Secrets and variables → Actions → New repository secret).
2. Make sure the Claude GitHub App is installed on the repo (it already is).
3. Actions → "Agent: Sync labels" → Run workflow (creates the labels).
4. Settings → Branches → add a rule for `main`: require a pull request, require status checks
   ("Lint, typecheck, test, build", "Dependency audit", "Secret scan"), block force pushes.

Optional repository variables: `OWNER_LOGIN`, `AGENT_BOT_LOGIN`, `AGENT_MAX_REVIEW_ROUNDS`,
`AGENT_MAX_CI_FIX_ATTEMPTS` (default 3).

## Everyday use
- **Plan something:** open an issue describing the phase step or feature, add `plan:approved`.
  Or Actions → "Agent: Planner" → Run workflow with a request.
- **Approve a spec:** review and merge the spec PR. Stories start automatically.
- **Report a bug:** open a Bug issue and add `agent:ready`.
- **Merge:** PRs labelled `ready-to-merge` with green CI are waiting for you.
- **Stop an agent:** remove its label, or cancel the run in the Actions tab.
