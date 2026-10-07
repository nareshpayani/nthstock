# Agent workflow

nthstock is built by a team of Claude agents running on GitHub Actions. The owner approves plans and
specs; everything else is automatic, including merging a PR once the Reviewer labels it
`ready-to-merge` and every check is green (ADR 0006). The owner still merges spec PRs and PRs that
change agent or CI config (`.github/`, `.claude/`, `CLAUDE.md`).

## The loop

```
Owner labels an issue `plan:approved`
  └─► Planner ─► spec PR (label `spec`) + story issues (`agent:backlog`)
Owner merges the spec PR
  └─► stories move to `agent:ready` ─► Developer ─► PR (`agent:pr`, "Closes #N")
PR opened or updated
  └─► Reviewer ─┬─ no blocking findings ─► `ready-to-merge` ─► all checks green ─► auto-merge (squash)
                │                                                     └─► linked issues closed with "Done in #PR";
                │                                                         epic closed when all its stories are
                │                           (spec PRs and agent/CI config changes: the owner merges)
                ├─ blocking findings ─► `agent:fix-needed` ─► Fixer pushes to the same PR ─► Reviewer again
                └─ bug outside the PR's scope ─► new `bug` issue (`agent:ready`) ─► Developer
CI red on an owner, agent or Dependabot PR
  └─► Fixer finds the root cause and pushes a fix to the same PR (3 attempts, then `needs-human`)
      └─ Dependabot bump the stack can't take ─► `@dependabot ignore this major version`
CI red on main (after a merge, or in a scheduled health run: 09:20 and 12:30 IST on weekdays, 20:00 IST daily)
  └─► Fixer opens a `claude/fix-main-*` PR (never pushes to main) ─► Reviewer ─► checks green ─► auto-merge
Hourly sweep
  └─► catches red PRs the events missed (Dependabot runs get no secrets; PRs red only because main was red)
Push to main makes an open PR conflict
  └─► Conflict resolver merges main INTO the PR branch ─┬─ clean ─► checks pass ─► push to PR ─► CI dispatched
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
| Auto-merge | `.github/workflows/agent-automerge.yml` | — |
| Issue closer | `.github/workflows/agent-close-issues.yml` | — |
| Issue keys | `.github/workflows/issue-keys.yml`, `tools/github/issueKey.sh` | — |
| PR title check | `.github/workflows/pr-title.yml` | — |
| (glue) | `agent-promote-stories.yml`, `agent-labels.yml` | — |

## Guardrails
- **Issue keys and PR titles (owner decision 2026-10-07):** every epic, story and bug is titled
  `NSTOCK-0001 : create login flow`, from one sequence starting at NSTOCK-0001. Agents create issues
  with `tools/github/issueKey.sh create`; `issue-keys.yml` keys issues people open from the templates
  and files each story under the epic it names, as a sub-issue. PR titles are
  `<type>(NSTOCK-0001): <subject>`; `pr-title.yml` fails any other title (Dependabot and PRs opened
  before 2026-10-08 are exempt). On 2026-10-07 every older issue was re-keyed: story T-181 is
  NSTOCK-0181 (T-001 to T-244 keep their number) and epic E1 to E21 are NSTOCK-0245 to NSTOCK-0265,
  so T-numbers in specs and old PRs still point at the right issue. New keys start at NSTOCK-0266.
- **Done means closed (owner decision 2026-09-28):** every PR lists the issues it completes as
  `Closes #N`, one per line; the Reviewer blocks a PR that is missing one. When the PR merges,
  `agent-close-issues.yml` comments "Done in #PR" on each linked story or bug, closes it as completed,
  ticks it in its epic's `- [ ] #N` checklist and closes the epic once all its stories (sub-issues
  and checklist lines) are closed. It also matches the NSTOCK key in the PR title
  (`feat(NSTOCK-0001): …`) and older T-numbers (`T-135 to T-140`, read as NSTOCK-0135 to NSTOCK-0140) to issue titles. Auto-merge dispatches
  it after each merge (merges made with the Actions token start no workflows), and a daily sweep
  re-checks the last 3 days of merges and every open epic.
- **Only the owner or the agents can start agents.** Every workflow checks that the label was added
  by the owner (`OWNER_LOGIN`, default `nareshpayani`) or the Claude app (`AGENT_BOT_LOGIN`,
  default `claude[bot]`), and the Reviewer only runs on PRs from this repo by those two authors.
  Strangers opening issues or PRs on this public repo cannot spend usage or inject prompts.
- **Loop limits:** after 3 CI-fix attempts on a PR it gets `needs-human`; only one fix-main PR is open at a time.
- **Loop limit:** after 3 agent reviews (`AGENT_MAX_REVIEW_ROUNDS`) a PR gets `needs-human` and agents stop.
- **Auto-merge (owner decision 2026-09-26, ADR 0006):** `agent-automerge.yml` squash-merges an open PR
  into `main` when the Reviewer has labelled it `ready-to-merge`, it is from the owner or an agent, not
  a draft or fork, mergeable, and every check on its head commit is green. It runs after CI and CodeQL
  finish, on label changes, and hourly. It skips spec PRs (the owner still approves specs), PRs that
  change `.github/**`, `.claude/**` or `CLAUDE.md` (the owner merges agent and CI config; see
  `.github/CODEOWNERS`), Dependabot PRs, and PRs labelled `needs-human`, `agent:fix-needed` or
  `do-not-merge`. To hold a PR, add `do-not-merge`. To turn auto-merge off, set the repository
  variable `AGENT_AUTOMERGE` to `false`. It merges one PR per run, because the other PRs' checks ran
  against the old `main`. After merging it starts CI, CodeQL, the conflict resolver and the label sync
  on `main`, because merges made with the Actions token don't trigger push workflows.
- **Agents never merge by hand, never push to `main`, never touch secrets or deploy.** Every agent job
  that can push installs a pre-push hook that refuses `main`, and the Fixer's `gh` access excludes
  `gh pr merge`.
- **Cost caps:** `--max-turns` per agent, job timeouts, one run per issue/PR at a time.

## One-time setup (owner)
1. Run `claude setup-token` locally and save the token as the repo secret `CLAUDE_CODE_OAUTH_TOKEN`
   (Settings → Secrets and variables → Actions → New repository secret).
2. Make sure the Claude GitHub App is installed on the repo (it already is).
3. Actions → "Agent: Sync labels" → Run workflow (creates the labels).
4. Settings → Branches → add a rule for `main`: require a pull request, block force pushes, and
   require these status checks (every `ci.yml` job, plus CodeQL): "Lint, typecheck, test, build",
   "Storybook build and a11y", "Playwright smoke (Chrome)", "Web vitals and render budgets (Chrome)",
   "Playwright golden path (api mode)", "Dependency audit", "Secret scan" and
   "Analyze JavaScript/TypeScript". Requiring an approving review would block auto-merge (ADR 0006).

Optional repository variables: `OWNER_LOGIN`, `AGENT_BOT_LOGIN`, `AGENT_MAX_REVIEW_ROUNDS`,
`AGENT_MAX_CI_FIX_ATTEMPTS` (default 3), `AGENT_AUTOMERGE` (default `true`).

## Everyday use
- **Plan something:** open an issue describing the phase step or feature, add `plan:approved`.
  Or Actions → "Agent: Planner" → Run workflow with a request.
- **Approve a spec:** review and merge the spec PR. Stories start automatically.
- **Report a bug:** open a Bug issue and add `agent:ready`.
- **Merge:** happens automatically once the Reviewer labels a PR `ready-to-merge` and checks are green.
  You merge spec PRs and PRs that change `.github/`, `.claude/` or `CLAUDE.md`. Add `do-not-merge`
  to hold any PR for your review.
- **Stop an agent:** remove its label, or cancel the run in the Actions tab.
