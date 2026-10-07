#!/usr/bin/env bash
# NSTOCK issue keys: every epic, story and bug is titled "NSTOCK-0001 : create login flow".
# Keys are one sequence across all issue types, starting at NSTOCK-0001, and never reused.
# Used by agents (Planner, Developer, Reviewer, Fixer) and by .github/workflows/issue-keys.yml,
# which keys issues people open from the templates. Needs gh, jq and GH_TOKEN (or gh auth).
#
#   issueKey.sh next                         print the next free key
#   issueKey.sh find NSTOCK-0001             print the issue number with that key
#   issueKey.sh create --type epic|story|bug --subject "create login flow" \
#               [--epic <issue number or key>] [--label l]... [--body-file f]
#                                            create a keyed issue (stories under --epic become
#                                            its sub-issues); prints "<number> <key>"
#   issueKey.sh assign <issue number>        key an existing issue that has no key yet and link
#                                            it to the epic named in its body; prints the key
#   issueKey.sh link <epic> <child>          make <child> a sub-issue of <epic> (numbers or keys)
#
# Set REPO=owner/name to target another repository (default: the current gh repo).
set -euo pipefail

REPO="${REPO:-${GITHUB_REPOSITORY:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}}"
PREFIX="NSTOCK"
KEY_RE="^${PREFIX}-[0-9]{4,} : "

die() { echo "issueKey.sh: $*" >&2; exit 1; }

# "<number>\t<title>" for every issue (not PR) in the repo. The REST list has no search-index lag,
# so an issue created a second ago is already counted.
all_issues() {
  gh api --paginate "repos/$REPO/issues?state=all&per_page=100" \
    --jq '.[] | select(.pull_request | not) | "\(.number)\t\(.title)"'
}

next_key() {
  local max
  max=$(all_issues | cut -f2 | grep -oE "^${PREFIX}-[0-9]{4,} : " | grep -oE '[0-9]+' \
    | sed 's/^0*//' | sort -n | tail -1 || true)
  printf '%s-%04d\n' "$PREFIX" "$(( ${max:-0} + 1 ))"
}

# Issue number for "#12", "12" or "NSTOCK-0001".
resolve() {
  local ref="$1" num
  case "$ref" in
    "$PREFIX"-*)
      num=$(all_issues | awk -F'\t' -v k="$ref : " 'index($2, k) == 1 { print $1; exit }')
      [ -n "$num" ] || die "no issue is titled $ref"
      echo "$num" ;;
    \#*) echo "${ref#\#}" ;;
    *[!0-9]* | '') die "not an issue number or key: $ref" ;;
    *) echo "$ref" ;;
  esac
}

# Strip any key-like prefix people or agents leave in a title ("NSTOCK-XXXX : ", "T-181 ", "[Epic] ").
clean_subject() {
  sed -E "s/^${PREFIX}-[0-9X]+ *: *//; s/^T-[0-9]{3} +//; s/^\[(epic|story|bug)\] *//I" <<< "$1"
}

link() { # epic child
  local epic child id body
  epic=$(resolve "$1"); child=$(resolve "$2")
  [ "$epic" != "$child" ] || die "an issue cannot be its own epic"
  id=$(gh api "repos/$REPO/issues/$child" --jq .id)
  gh api -X POST "repos/$REPO/issues/$epic/sub_issues" -F "sub_issue_id=$id" >/dev/null 2>&1 \
    || echo "issueKey.sh: #$child may already be a sub-issue of #$epic" >&2
  # Keep the epic's "- [ ] #N" checklist too: agent-close-issues.yml ticks it as stories close.
  body=$(gh issue view "$epic" --repo "$REPO" --json body --jq '.body // ""')
  if ! grep -qE "^- \[[ x]\] #$child\$" <<< "$body"; then
    if ! grep -q '^## Stories' <<< "$body"; then body="$body"$'\n\n## Stories\n'; fi
    gh issue edit "$epic" --repo "$REPO" --body "$body"$'\n'"- [ ] #$child" >/dev/null
  fi
  echo "#$child is under epic #$epic" >&2
}

# The epic a story or bug body names: the issue form's "### Epic" answer, or an "Epic: …" line.
epic_from_body() {
  awk '
    /^### Epic/ { grab = 1; next }
    grab && NF { print; exit }
    /^Epic: / { sub(/^Epic: */, ""); print; exit }
  ' | grep -oE "${PREFIX}-[0-9]{4,}|#[0-9]+" | head -1 || true
}

cmd="${1:-}"; shift || true
case "$cmd" in
  next) next_key ;;
  find) [ $# -eq 1 ] || die "usage: find NSTOCK-0001"; resolve "$1" ;;
  link) [ $# -eq 2 ] || die "usage: link <epic> <child>"; link "$1" "$2" ;;
  create)
    type="" subject="" epic="" body_file="" labels=()
    while [ $# -gt 0 ]; do
      case "$1" in
        --type) type="$2"; shift 2 ;;
        --subject) subject="$2"; shift 2 ;;
        --epic) epic="$2"; shift 2 ;;
        --label) labels+=(--label "$2"); shift 2 ;;
        --body-file) body_file="$2"; shift 2 ;;
        *) die "unknown option $1" ;;
      esac
    done
    case "$type" in epic|story|bug) ;; *) die "--type must be epic, story or bug" ;; esac
    [ -n "$subject" ] || die "--subject is required"
    [ "$type" != story ] || [ -n "$epic" ] || die "a story needs --epic"
    subject=$(clean_subject "$subject")
    body=""; [ -z "$body_file" ] || body=$(cat "$body_file")
    if [ -n "$epic" ]; then epic=$(resolve "$epic"); body="Epic: #$epic"$'\n\n'"$body"; fi
    key=$(next_key)
    url=$(gh issue create --repo "$REPO" --title "$key : $subject" --body "$body" \
      --label "$type" "${labels[@]}")
    num="${url##*/}"
    [ -z "$epic" ] || link "$epic" "$num"
    echo "$num $key" ;;
  assign)
    [ $# -eq 1 ] || die "usage: assign <issue number>"
    num=$(resolve "$1")
    info=$(gh issue view "$num" --repo "$REPO" --json title,body)
    title=$(jq -r .title <<< "$info")
    if grep -qE "$KEY_RE" <<< "$title"; then
      key="${title%% : *}"
      # Two issues opened at the same moment can get the same key; the later one is re-keyed.
      first=$(all_issues | awk -F'\t' -v k="$key : " 'index($2, k) == 1 { print $1 }' | sort -n | head -1)
      if [ "$first" = "$num" ]; then
        echo "$key"
      else
        title=$(clean_subject "$title")
        key=$(next_key)
        gh issue edit "$num" --repo "$REPO" --title "$key : $title" >/dev/null
        echo "$key"
      fi
    else
      key=$(next_key)
      gh issue edit "$num" --repo "$REPO" --title "$key : $(clean_subject "$title")" >/dev/null
      echo "$key"
    fi
    epic=$(jq -r '.body // ""' <<< "$info" | epic_from_body)
    [ -z "$epic" ] || link "$epic" "$num" ;;
  *) sed -n '2,19p' "$0" | sed 's/^# \{0,1\}//'; [ -z "$cmd" ] || exit 1 ;;
esac
