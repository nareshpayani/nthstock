# 0006. Auto-merge and self-healing CI

- Status: Accepted
- Date: 2026-09-28
- Amends: [0003](0003-agent-team-on-github-actions.md) (the owner no longer merges every PR by hand)

## Context

ADR 0003 has the owner merge every PR. On 2026-09-26 the owner decided that, "for now", green agent
PRs should merge without waiting for a manual merge. Once PRs merge on their own, open PRs fall behind
`main` and conflict more often, and a break on `main` needs someone to notice it: CI only runs when
code changes, and some failures depend on the time of day (market hours) rather than on a commit.
ADR 0003's amendment text recorded only the first part; this ADR records the whole mechanism.

## Decision

**Auto-merge** (`agent-automerge.yml`, owner decision 2026-09-26). A PR is squash-merged into `main`
when all of these hold: the Reviewer has labelled it `ready-to-merge`; it is from the owner or an
agent, not a draft or a fork; it is mergeable; every check on its head commit is green; and it has no
`spec`, `needs-human`, `agent:fix-needed` or `do-not-merge` label. It runs after CI and CodeQL, on
label changes and hourly, and merges one PR per run. After a merge it dispatches CI, CodeQL, the
conflict resolver and the label sync on `main`, because merges made with `GITHUB_TOKEN` start no
push workflows. `AGENT_AUTOMERGE=false` turns it off.

**What still needs the owner.** Spec PRs, because merging a spec is what approves it, and any PR that
changes `.github/**`, `.claude/**` or `CLAUDE.md`, because those decide what the agents may do.
`.github/CODEOWNERS` names the owner for them and for `docs/adr/`. Agents never merge by hand.

**Conflict resolver** (`agent-conflicts.yml`). On every push to `main`, open owner and agent PRs that
no longer merge cleanly get `main` merged into their branch (never a rebase, force-push or push to
`main`). A clean merge is pushed after `npm run check` passes, and CI is dispatched on the branch;
a real conflict goes to the Fixer; one that cannot keep both sides gets `needs-human`.

**Fixer heals red CI** (`agent-fixer.yml`). Red CI on a PR is fixed on that PR's branch (3 attempts,
then `needs-human`). Red CI on `main`, from a push, a post-merge dispatch or a scheduled health run,
makes the Fixer open one `claude/fix-main-*` PR, which then goes through review and auto-merge.

**Scheduled health checks** (`ci.yml`). Full CI runs on `main` at 09:20 and 12:30 IST on weekdays
(NSE open) and 20:00 IST daily (market closed), so time-dependent breakage is caught.

**No separate watchdog.** A 2-hourly watchdog (`agent-watchdog.yml`, #233) was added and then removed
the same day by owner decision (2026-09-28): it overlapped the scheduled health runs and could open a
second fix for the same breakage. The Fixer is the only healer for `main`.

## Consequences

- PRs merge within minutes of going green, so fewer go stale or conflict.
- The owner reviews after the fact, or holds a PR with `do-not-merge`. A mistake the Reviewer and CI
  both miss reaches `main`; the scheduled health runs shorten how long it stays there.
- If `main`'s branch protection requires an approving review, auto-merge fails until that is relaxed.
- Agent and CI config changes, and specs, still wait for the owner.
- Scheduled runs spend Actions minutes and, when red, Claude usage.
