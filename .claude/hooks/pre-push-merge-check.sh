#!/usr/bin/env bash
# PreToolUse(Bash) hook — block a `git push` when the branch would not merge
# cleanly into origin/main, OR when it merges cleanly and the MERGED TREE does
# not typecheck. Upstream drift is caught before the push rather than as a
# stale/conflicted PR or a red `main` one merge later.
#
# Two gates, in order:
#
#   1. TEXTUAL — `git merge-tree --write-tree origin/main HEAD`. A definite
#      conflict denies.
#   2. SEMANTIC — on a clean merge, materialise the merged tree in a throwaway
#      worktree and run `npx tsc -b` + `node scripts/test-typecheck.mjs` there
#      (improvement-waves 4.1). Two branches can merge textually and still not
#      compile together — one renames a symbol the other starts using, one adds
#      a field the other's new test constructs without. `git merge-tree` cannot
#      see that, and neither can a green local `tsc` on the un-merged branch.
#      That is what the merge queue re-runs the combined tree to catch, hours
#      later and after a runner slot. `LOOM_SKIP_PUSH_TYPECHECK=1` opts out.
#
# Design: this hook is conservative in both gates. It denies only on a DEFINITE
# conflict or a gate that RAN and FAILED; on any uncertainty (not a git repo,
# no origin/main, fetch offline, git too old for `merge-tree --write-tree`, no
# `npx`, no borrowable `node_modules`, a worktree that will not create, a
# timeout) it FAILS OPEN — exits 0 and lets the push proceed — mirroring the
# biome-gate's "never block when the tool isn't available" stance. A deny is
# surfaced to Claude as a reason so it rebases onto origin/main first.
#
# Wired as PreToolUse(matcher: "Bash"); the push detection happens in-script
# (below) so it doesn't depend on a settings-level command matcher.
set -uo pipefail

# --- read the tool call ----------------------------------------------------
input="$(cat)"
command="$(printf '%s' "$input" | jq -r '.tool_input.command // ""' 2>/dev/null)" || exit 0

# Only act on a real `git … push` invocation; defer (allow) everything else.
# Matches `git push`, `git -C dir push`, `git --no-pager push`, and pushes
# inside compound commands / retry loops.  Read-only commands that merely
# mention "push" in a string are not git pushes and fall through.
if ! [[ "$command" =~ (^|[^[:alnum:]_/.])git([[:space:]]+-C[[:space:]]+[^[:space:]]+|[[:space:]]+-[^[:space:]]+)*[[:space:]]+push([[:space:]]|$) ]]; then
  exit 0
fi

# Evaluate the push in the repo it actually targets. `CLAUDE_PROJECT_DIR` is
# the SHARED checkout — a subagent pushing from a git worktree would be judged
# against whatever branch the shared checkout happens to sit on (observed as a
# false positive by five parallel worktree agents). The hook input's `cwd` is
# the invoking Bash call's working directory, so prefer it; an explicit
# `git -C <dir> push` overrides both (resolved relative to that cwd).
cwd="$(printf '%s' "$input" | jq -r '.cwd // ""' 2>/dev/null)"
cd "${cwd:-${CLAUDE_PROJECT_DIR:-.}}" 2>/dev/null || exit 0
if [[ "$command" =~ git[[:space:]]+-C[[:space:]]+([^[:space:]]+)[[:space:]] ]]; then
  cd "${BASH_REMATCH[1]}" 2>/dev/null || exit 0
fi
command -v git >/dev/null 2>&1 || exit 0
command -v jq  >/dev/null 2>&1 || exit 0
git rev-parse --git-dir >/dev/null 2>&1 || exit 0

# Don't gate a push of the trunk itself (nothing to merge it into).
branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null)" || exit 0
case "$branch" in main|master|HEAD|"") exit 0 ;; esac

# --- deny helper -----------------------------------------------------------
deny() {
  jq -n --arg r "$1" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: $r
    }
  }'
  exit 0
}

# --- typecheck the MERGED tree (improvement-waves 4.1) ----------------------
# Materialises `origin/main + HEAD` into a throwaway worktree and runs the two
# gates a merge can break with no textual conflict at all:
#
#   npx tsc -b                     — the toolchain build (test.yml's build step)
#   node scripts/test-typecheck.mjs — the `test/` typecheck gate (wave C4
#                                     packet 4b promoted it from a shrink-only
#                                     ratchet to an absolute gate)
#
# EVERY uncertainty allows the push: no `npx`, no `node_modules` to borrow, a
# worktree that will not create, a timeout, a missing script, or the opt-out
# `LOOM_SKIP_PUSH_TYPECHECK=1`.  It denies on exactly one thing — a gate that
# ran to completion on the merged tree and FAILED.
typecheck_merged() {
  local tree="$1"
  [ -n "${LOOM_SKIP_PUSH_TYPECHECK:-}" ] && return 0
  # A tree OID is 40 (sha1) or 64 (sha256) hex chars; anything else means
  # `merge-tree` printed something this script does not understand.
  [[ "$tree" =~ ^[0-9a-f]{40}([0-9a-f]{24})?$ ]] || return 0
  command -v npx >/dev/null 2>&1 || return 0
  [ -f "scripts/test-typecheck.mjs" ] || return 0

  local repo mods commit dir rc out
  repo="$(git rev-parse --show-toplevel 2>/dev/null)" || return 0
  # `npm install` in a throwaway tree would cost minutes and a network; borrow
  # the checkout's own dependency tree instead. No deps → nothing to check.
  mods="$repo/node_modules"
  [ -d "$mods" ] || return 0

  commit="$(git commit-tree "$tree" -p HEAD -m 'merge-preflight (throwaway)' 2>/dev/null)" || return 0
  [ -n "$commit" ] || return 0
  dir="$(mktemp -d 2>/dev/null)" || return 0
  # shellcheck disable=SC2064
  trap "git worktree remove --force '$dir' >/dev/null 2>&1; rm -rf '$dir'" RETURN
  git worktree add --detach --quiet "$dir" "$commit" >/dev/null 2>&1 || return 0
  ln -s "$(cd "$mods" && pwd)" "$dir/node_modules" 2>/dev/null || return 0

  # 15 minutes each: a cold composite build, then the `test/` typecheck. A
  # timeout is "we don't know", so it allows.
  out="$(cd "$dir" && timeout 900 npx tsc -b 2>&1)"; rc=$?
  [ "$rc" -eq 124 ] && return 0
  if [ "$rc" -ne 0 ]; then
    deny "git push blocked: '${branch}' merges cleanly into origin/main but the MERGED tree does not compile.
This is a semantic conflict — textually clean, still broken — the shape that turns a green PR into a red main.
Rebase onto origin/main, fix, and push again (or set LOOM_SKIP_PUSH_TYPECHECK=1 to bypass deliberately).
    npx tsc -b   on (origin/main + HEAD):
$(printf '%s' "$out" | tail -25)"
  fi

  out="$(cd "$dir" && timeout 900 node scripts/test-typecheck.mjs 2>&1)"; rc=$?
  [ "$rc" -eq 124 ] && return 0
  if [ "$rc" -ne 0 ]; then
    deny "git push blocked: '${branch}' merges cleanly into origin/main but the MERGED tree fails the test/ typecheck gate.
Your branch and origin/main are each green alone; together they are not.
Rebase onto origin/main, fix, and push again (or set LOOM_SKIP_PUSH_TYPECHECK=1 to bypass deliberately).
    node scripts/test-typecheck.mjs   on (origin/main + HEAD):
$(printf '%s' "$out" | tail -25)"
  fi
  return 0
}

# --- best-effort refresh of origin/main (offline → fail open) --------------
timeout 20 git fetch origin main --quiet >/dev/null 2>&1 || true
git rev-parse --verify --quiet origin/main >/dev/null 2>&1 || exit 0

# --- conflict dry-run ------------------------------------------------------
# `git merge-tree --write-tree` (git >= 2.38): exit 0 = clean, 1 = conflicts,
# >1 = usage/version error → fail open.
mt="$(git merge-tree --write-tree origin/main HEAD 2>/dev/null)"; rc=$?
[ "$rc" -gt 1 ] && exit 0          # error / unsupported → allow
if [ "$rc" -eq 0 ] && ! printf '%s' "$mt" | grep -q '^CONFLICT'; then
  # Clean textually — now check that the merged tree actually COMPILES.
  # `merge-tree --write-tree`'s first output line is the merged tree's OID.
  typecheck_merged "$(printf '%s' "$mt" | head -1)"
  exit 0
fi

# --- definite conflict → deny ----------------------------------------------
files="$(printf '%s' "$mt" | grep -iE '^CONFLICT' | sed 's/^/  - /' | head -20)"
deny "git push blocked: branch '${branch}' does not merge cleanly into origin/main.
Rebase onto the latest origin/main and resolve the conflict(s) before pushing:
    git fetch origin main && git rebase origin/main
Conflicting:
${files}"
