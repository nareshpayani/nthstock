# Agent workflow

nthstock is built by a team of Claude Code agents running on GitHub Actions. The owner approves plans and
specs; everything else is automatic, including merging a PR once the Reviewer labels it
`ready-to-merge` and every check is green (ADR 0006). The owner still merges spec PRs, PRs that
change agent or CI config (`.github/`, `.claude/`, `CLAUDE.md`). Releases need no PR: an agent promotes `develop` to production when the owner asks.

Branches (ADR 0010): every PR targets `develop`, the default branch and the development environment.
`production` is the live site and moves only through Promote to production, which checks develop is
fully tested first (ADR 0011, [runbooks/environments.md](runbooks/environments.md)).

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
  └─► Fixer finds the root cause and pushes a fix to the same PR, again on every red run until CI is green
      └─ no progress (same failure on 5 commits in a row, or a run that pushes nothing) ─► `needs-human`
      └─ Dependabot bump the stack can't take ─► `@dependabot ignore this major version`
CI red on develop (after a merge, or in a scheduled health run: 09:20 and 12:30 IST on weekdays, 20:00 IST daily)
  └─► Fixer opens an `agent/fix-develop-*` PR (never pushes to develop) ─► Reviewer ─► checks green ─► auto-merge
Green CI on develop
  └─► Web hosting deploys the development environment and smoke-tests it
Owner asks for a release
  └─► Promote to production (develop CI green + dev smoke test) ─► green CI on production ─► live deploy, smoke-tested
Hourly sweep
  └─► catches red PRs the events missed (Dependabot runs get no secrets; PRs red only because develop was red)
Push to develop makes an open PR conflict
  └─► Merge conflict resolver merges develop INTO the PR branch ─┬─ clean ─► checks pass ─► push to PR ─► CI dispatched
                                                                 ├─ conflicts ─► resolves them, checks pass ─► push to PR
                                                                 └─ can't keep both sides ─► `needs-human`
```

`develop` and `production` are never pushed to by agents: conflicts are always resolved on the PR branch by
merging its base in (no rebase, no force-push), a pre-push hook blocks pushes to either, and branch
protection is the final guard; only the promotion workflow moves `production`. Dependabot PRs are skipped by the merge conflict resolver because
Dependabot rebases its own PRs, but their CI failures go to the Fixer.

Names follow one scheme (ADR 0014): workflow files are `<area>-<what it does>.yml` and their
display names `<Area>: <What it does>`, so the Actions sidebar groups them. **Agent** means an LLM
agent (Claude Code through `claude-code-action`, with a role file in `.claude/agents/`); everything
else is plain scripted automation. The full pipeline map is [ci-cd.md](ci-cd.md).

| Name (short name) | Kind | Workflow | Role definition |
|---|---|---|---|
| Agent: Spec planner (Planner) | agent | `.github/workflows/agent-spec-planner.yml` | `.claude/agents/spec-planner.md` |
| Agent: Story developer (Developer) | agent | `.github/workflows/agent-story-developer.yml` | `.claude/agents/story-developer.md` |
| Agent: PR reviewer (Reviewer) | agent | `.github/workflows/agent-pr-reviewer.yml` | `.claude/agents/pr-reviewer.md` |
| Review specialists, report-only, called by the PR reviewer | agent | `.github/workflows/agent-pr-reviewer.yml` | `.claude/agents/frontend-reviewer.md`, `ux-design-reviewer.md`, `security-reviewer.md`, `database-reviewer.md`, `error-handling-reviewer.md`, `test-coverage-reviewer.md` |
| Agent: PR fixer (Fixer): review findings, red CI, red develop | agent | `.github/workflows/agent-pr-fixer.yml` | `.claude/agents/pr-fixer.md` |
| Agent: Merge conflict resolver | agent | `.github/workflows/agent-merge-conflict-resolver.yml` | `.claude/agents/merge-conflict-resolver.md` |
| E2E test author (the way the Developer and Fixer write Playwright specs; no workflow) | agent | — | `.claude/agents/e2e-test-author.md` |
| PR: Auto-merge | automation | `.github/workflows/pr-auto-merge.yml` | — |
| PR: Title check | automation | `.github/workflows/pr-title-check.yml` | — |
| PR: Screenshots | automation | `.github/workflows/pr-screenshots.yml` | — |
| Issues: Assign NSTOCK key | automation | `.github/workflows/issues-assign-keys.yml`, `tools/github/issueKey.sh` | — |
| Issues: Release spec stories (merged spec → `agent:ready`) | automation | `.github/workflows/issues-release-spec-stories.yml` | — |
| Issues: Close completed | automation | `.github/workflows/issues-close-completed.yml` | — |
| Repo: Sync labels | automation | `.github/workflows/repo-sync-labels.yml` | — |
| Repo: Delete merged branches (daily sweep for auto-merges) | automation | `.github/workflows/repo-delete-merged-branches.yml` | — |
| CI, Security: CodeQL, Deploy: Web hosting, Release: Promote to production | pipeline | see [ci-cd.md](ci-cd.md) | — |

Renamed on 2026-10-25 (ADR 0014): the "Resolve conflicts" workflow and the Fixer's merge-conflict
section became the Merge conflict resolver with its own role; `planner`, `developer`, `reviewer`,
`fixer` became `spec-planner`, `story-developer`, `pr-reviewer`, `pr-fixer`;
`silent-failure-hunter`, `test-gap-analyzer` and `e2e-author` became `error-handling-reviewer`,
`test-coverage-reviewer` and `e2e-test-author`; the label `agent:conflict` became
`agent:merge-conflict`.

## Guardrails
- **Issue keys and PR titles (owner decision 2026-10-07):** every epic, story and bug is titled
  `NSTOCK-0001 : create login flow`, from one sequence starting at NSTOCK-0001. Agents create issues
  with `tools/github/issueKey.sh create`; `issues-assign-keys.yml` keys issues people open from the templates
  and files each story under the epic it names, as a sub-issue. PR titles are
  `<type>(NSTOCK-0001): <subject>`; `pr-title-check.yml` fails any other title (Dependabot and PRs opened
  before 2026-10-08 are exempt). On 2026-10-07 every older issue was re-keyed: story T-181 is
  NSTOCK-0181 (T-001 to T-244 keep their number) and epic E1 to E21 are NSTOCK-0245 to NSTOCK-0265,
  so T-numbers in specs and old PRs still point at the right issue. New keys start at NSTOCK-0266.
- **Done means closed (owner decision 2026-09-28):** every PR lists the issues it completes as
  `Closes #N`, one per line; the Reviewer blocks a PR that is missing one. When the PR merges,
  `issues-close-completed.yml` comments "Done in #PR" on each linked story or bug, closes it as completed,
  ticks it in its epic's `- [ ] #N` checklist and closes the epic once all its stories (sub-issues
  and checklist lines) are closed. It also matches the NSTOCK key in the PR title
  (`feat(NSTOCK-0001): …`) and older T-numbers (`T-135 to T-140`, read as NSTOCK-0135 to NSTOCK-0140) to issue titles. Auto-merge dispatches
  it after each merge (merges made with the Actions token start no workflows), and a daily sweep
  re-checks the last 3 days of merges and every open epic.
- **Only the owner or the agents can start agents.** Every workflow checks that the label was added
  by the owner (`OWNER_LOGIN`, default `nareshpayani`) or the Claude app (`AGENT_BOT_LOGIN`,
  default `claude[bot]`), and the Reviewer only runs on PRs from this repo by those two authors.
  Strangers opening issues or PRs on this public repo cannot spend usage or inject prompts.
- **Attribution (owner decision 2026-10-21):** agent commits are authored as the owner: every
  `claude-code-action` step sets `bot_name`/`bot_id` to `OWNER_LOGIN`/`OWNER_ID`, the merge
  conflict resolver's clean merge uses the same identity, and `.claude/settings.json` turns off the
  `Co-Authored-By` trailer and PR footer. Agent branches are `agent/issue-*` and `agent/fix-develop-*`.
  GitHub still shows the account that *posts* (the app as `claude[bot]`, the Actions token as
  `github-actions[bot]`) on comments, labels and the PR author; only a personal token would change that.
- **No attempt or round limits (owner decision 2026-10-25):** the Fixer keeps fixing and the Reviewer
  re-reviews every push until the PR is green and approved. Only one fix-develop PR is open at a time.
- **No-progress safeguard:** so an identical loop cannot drain the plan quota, a PR gets `needs-human`
  when CI fails in exactly the same jobs and steps on the last `AGENT_NO_PROGRESS_RUNS` (default 5)
  commits, when a CI-fix run ends without pushing anything, or when the Reviewer sees the same
  blocking finding unresolved in 3 reviews in a row. Removing `needs-human` lets the agents carry on.
- **Auto-merge (owner decision 2026-09-26, ADR 0006):** `pr-auto-merge.yml` squash-merges an open PR
  into `develop` when the Reviewer has labelled it `ready-to-merge`, it is from the owner or an agent, not
  a draft or fork, mergeable, its **CI result** check passed and every other check on its head
  commit is green. It runs after CI and Security: CodeQL finish, on label changes, and hourly. It skips spec PRs (the owner still approves specs), PRs that
  change `.github/**`, `.claude/**` or `CLAUDE.md` (the owner merges agent and CI config; see
  `.github/CODEOWNERS`), Dependabot PRs, and PRs labelled `needs-human`, `agent:fix-needed` or
  `do-not-merge`. To hold a PR, add `do-not-merge`. To turn auto-merge off, set the repository
  variable `AGENT_AUTOMERGE` to `false`. It merges one PR per run, because the other PRs' checks ran
  against the old `develop`. After merging it starts CI, Security: CodeQL, the merge conflict resolver and the label
  sync on `develop`, because merges made with the Actions token don't trigger push workflows. It
  only merges into `develop`.
- **Environments (ADR 0010):** every green CI run on `develop` deploys to the **development**
  environment (the Firebase `dev` channel); every green CI run on `production` deploys to **production**,
  the live site (`docs/runbooks/environments.md`).
- **Releases (ADR 0011):** when the owner asks for a release, an agent follows
  `docs/runbooks/release.md` (the `release` skill): it runs Promote to production, which refuses
  unless develop's head has green CI and passed the development smoke test, then moves `production`
  to it; the agent watches the smoke-tested live deploy and rolls back on failure. No release PR.
- **Agents never merge by hand, never push to `develop` or `production`, never touch secrets, and
  deploy only through the release flow.** Every agent job that can push installs a pre-push hook that
  refuses `develop` and `production`, and the Fixer's `gh` access excludes `gh pr merge`.
- **Cost caps:** the no-progress safeguard, job timeouts (the Reviewer, Fixer and merge conflict resolver have
  no `--max-turns`, so a long fix is never cut off), one run per issue/PR at a time.

## One-time setup (owner)
1. Run `claude setup-token` locally and save the token as the repo secret `CLAUDE_CODE_OAUTH_TOKEN`
   (Settings → Secrets and variables → Actions → New repository secret). It needs the Claude Code
   CLI (`curl -fsSL https://claude.ai/install.sh | bash`, then a new terminal) and a Claude
   subscription. Press `c` to copy the sign-in link, authorize in the browser, paste the code back
   into the terminal, and copy the `sk-ant-oat01-…` token it prints. The token lasts a year; repeat
   this step when it expires. Set 2026-10-07.
2. Make sure the Claude GitHub App is installed on the repo (it already is).
3. Actions → "Repo: Sync labels" → Run workflow (creates the labels, and renames old ones).
4. Make `develop` the default branch, rename `main` to `production`, add `PROMOTE_TOKEN`, and
   protect both branches ([runbooks/environments.md](runbooks/environments.md)). Settings → Rules →
   a ruleset for `develop`: require a pull request, squash merge only, block force pushes and
   deletion, and require two status checks: **CI result** and **PR title has an NSTOCK key**
   ([ci-cd.md](ci-cd.md#branch-rules)). CI result already stands for every CI job, including the
   ones change detection skips, so the list never needs updating when a job is added. Requiring an
   approving review would block auto-merge (ADR 0006).

Optional repository variables: `OWNER_LOGIN`, `OWNER_ID` (default `15100692`, the owner's GitHub user id), `AGENT_BOT_LOGIN`,
`AGENT_NO_PROGRESS_RUNS` (default 5), `AGENT_AUTOMERGE` (default `true`).

## Everyday use
- **Plan something:** open an issue describing the phase step or feature, add `plan:approved`.
  Or Actions → "Agent: Spec planner" → Run workflow with a request.
- **Approve a spec:** review and merge the spec PR. Stories start automatically.
- **Report a bug:** open a Bug issue and add `agent:ready`.
- **Merge:** happens automatically once the Reviewer labels a PR `ready-to-merge` and checks are green.
  You merge spec PRs and PRs that change `.github/`, `.claude/` or `CLAUDE.md`. Add `do-not-merge`
  to hold any PR for your review.
- **Stop an agent:** remove its label, or cancel the run in the Actions tab.
