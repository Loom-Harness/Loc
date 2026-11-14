// The push preflight's sync-only gate (.claude/hooks/pre-push-merge-check.sh).
//
// A push whose only new commits are merges of origin/main re-runs the whole
// per-PR check set while changing nothing a reviewer reads; dozens of them at
// once starve the shared runner pool. The gate denies exactly that shape and
// lets through every push that carries something of its own, resolves a
// conflict with main, merges another PR's branch (a stack), or is marked
// deliberate with LOOM_ALLOW_SYNC=1.
//
// Each case builds a real bare `origin` + clone in a temp dir and feeds the
// hook the same JSON a PreToolUse(Bash) call delivers.

import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const HOOK = resolve(__dirname, "../../.claude/hooks/pre-push-merge-check.sh");
const hasTools =
  spawnSync("jq", ["--version"]).status === 0 &&
  spawnSync("git", ["merge-tree", "-h"]).status !== null;

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

// CI runners have no global git identity, so every git call (the merge
// included) carries one explicitly.
const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@t",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@t",
};

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: GIT_ENV,
  }).trim();
}

function commit(cwd: string, file: string, content: string, msg: string): void {
  writeFileSync(join(cwd, file), content);
  git(cwd, "add", file);
  git(cwd, "commit", "-q", "-m", msg);
}

/** origin with `main` (a.txt) and a pushed feature branch `feat` (b.txt). */
function setup(): { work: string; other: string } {
  const root = mkdtempSync(join(tmpdir(), "sync-gate-"));
  dirs.push(root);
  const origin = join(root, "origin.git");
  git(root, "init", "-q", "--bare", "-b", "main", origin);
  const work = join(root, "work");
  git(root, "clone", "-q", origin, work);
  git(work, "checkout", "-q", "-b", "main");
  commit(work, "a.txt", "a1\n", "base");
  git(work, "push", "-q", "-u", "origin", "main");
  git(work, "checkout", "-q", "-b", "feat");
  commit(work, "b.txt", "b1\n", "feature work");
  git(work, "push", "-q", "-u", "origin", "feat");
  // A second clone stands in for "everyone else" moving main.
  const other = join(root, "other");
  git(root, "clone", "-q", origin, other);
  return { work, other };
}

function advanceMain(other: string, file: string, content: string): void {
  git(other, "checkout", "-q", "main");
  git(other, "pull", "-q", "origin", "main");
  commit(other, file, content, `main moves: ${file}`);
  git(other, "push", "-q", "origin", "main");
}

function runHook(cwd: string, command = "git push"): string {
  const r = spawnSync("bash", [HOOK], {
    input: JSON.stringify({ tool_input: { command }, cwd }),
    encoding: "utf8",
    env: { ...process.env, LOOM_SKIP_PUSH_TYPECHECK: "1", LOOM_ALLOW_SYNC: "" },
  });
  return r.stdout;
}

const denied = (out: string): boolean => out.includes('"permissionDecision": "deny"');

/** Runs the hook with the typecheck gate live and its trace on; returns stderr. */
function traceHook(cwd: string): string {
  const r = spawnSync("bash", [HOOK], {
    input: JSON.stringify({ tool_input: { command: "git push" }, cwd }),
    encoding: "utf8",
    env: {
      ...process.env,
      LOOM_SKIP_PUSH_TYPECHECK: "",
      LOOM_SKIP_PUSH_CENSUS: "1",
      LOOM_ALLOW_SYNC: "",
      LOOM_PREFLIGHT_TRACE: "1",
    },
  });
  return r.stderr;
}

function commitAt(cwd: string, file: string, content: string, msg: string): void {
  mkdirSync(dirname(join(cwd, file)), { recursive: true });
  commit(cwd, file, content, msg);
}

describe.skipIf(!hasTools)("pre-push sync-only gate", () => {
  it("denies a push that only merges origin/main into a clean branch", () => {
    const { work, other } = setup();
    advanceMain(other, "c.txt", "c1\n");
    git(work, "fetch", "-q", "origin", "main");
    git(work, "merge", "-q", "--no-edit", "origin/main");
    const out = runHook(work);
    expect(denied(out)).toBe(true);
    expect(out).toContain("only merges origin/main");
    // A deny skips the whole Bash call; the reason says so, so a chained
    // `edit && commit && push` is not mistaken for a partial run.
    expect(out).toContain("Nothing in this Bash command ran");
  });

  it("allows the same sync when marked deliberate with LOOM_ALLOW_SYNC=1", () => {
    const { work, other } = setup();
    advanceMain(other, "c.txt", "c1\n");
    git(work, "fetch", "-q", "origin", "main");
    git(work, "merge", "-q", "--no-edit", "origin/main");
    expect(denied(runHook(work, "LOOM_ALLOW_SYNC=1 git push"))).toBe(false);
  });

  it("allows a sync that carries a commit of its own", () => {
    const { work, other } = setup();
    advanceMain(other, "c.txt", "c1\n");
    git(work, "fetch", "-q", "origin", "main");
    git(work, "merge", "-q", "--no-edit", "origin/main");
    commit(work, "b.txt", "b2\n", "more feature work");
    expect(denied(runHook(work))).toBe(false);
  });

  it("allows a sync that resolves a conflict between the old head and main", () => {
    const { work, other } = setup();
    advanceMain(other, "b.txt", "main's b\n");
    git(work, "fetch", "-q", "origin", "main");
    const merge = spawnSync("git", ["merge", "-q", "--no-edit", "origin/main"], {
      cwd: work,
      env: GIT_ENV,
    });
    expect(merge.status).toBe(1); // a real conflict, not an aborted merge
    writeFileSync(join(work, "b.txt"), "resolved\n");
    git(work, "add", "b.txt");
    git(work, "commit", "-q", "-m", "merge main, resolve b.txt");
    expect(denied(runHook(work))).toBe(false);
  });

  // A criss-cross (main merged the branch while the branch merged main) leaves
  // two merge bases. git resolves them into a virtual base and calls the old
  // head clean; GitHub's check does not, and can report a conflict. The gate
  // cannot tell, so it lets the sync through.
  it("allows a sync when the old head has several merge bases with main", () => {
    const { work, other } = setup();
    advanceMain(other, "c.txt", "c1\n");
    const a = git(other, "rev-parse", "HEAD");
    git(other, "fetch", "-q", "origin", "feat");
    git(other, "merge", "-q", "--no-edit", "origin/feat");
    git(other, "push", "-q", "origin", "main");
    git(work, "fetch", "-q", "origin", "main");
    git(work, "merge", "-q", "--no-edit", a);
    git(work, "push", "-q", "origin", "feat");
    git(work, "merge", "-q", "--no-edit", "origin/main");
    expect(git(work, "merge-base", "--all", "origin/main", "origin/feat").split("\n")).toHaveLength(
      2,
    );
    expect(denied(runHook(work))).toBe(false);
  });

  it("allows merging another PR's branch (a stack)", () => {
    const { work, other } = setup();
    git(other, "fetch", "-q", "origin");
    git(other, "checkout", "-q", "-b", "base-pr", "origin/main");
    commit(other, "d.txt", "d1\n", "the PR this one stacks on");
    git(other, "push", "-q", "origin", "base-pr");
    git(work, "fetch", "-q", "origin", "base-pr");
    git(work, "merge", "-q", "--no-edit", "origin/base-pr");
    expect(denied(runHook(work))).toBe(false);
  });

  // The words "git push" inside quoted text or a heredoc body are text, not a
  // push, so the hook must not judge the branch (here: a sync-only branch a
  // real push would be denied on).  A real push beside quoted text still is.
  describe("push detection ignores quoted text and heredoc bodies", () => {
    function syncOnly(): string {
      const { work, other } = setup();
      advanceMain(other, "c.txt", "c1\n");
      git(work, "fetch", "-q", "origin", "main");
      git(work, "merge", "-q", "--no-edit", "origin/main");
      return work;
    }

    it("ignores a push mentioned inside a double-quoted string", () => {
      expect(
        denied(runHook(syncOnly(), 'echo "the proxy refuses git push --delete" >> log.md')),
      ).toBe(false);
    });

    it("ignores a push mentioned inside a single-quoted string", () => {
      expect(
        denied(runHook(syncOnly(), "printf '%s\\n' 'never git push from here' > note.txt")),
      ).toBe(false);
    });

    it("ignores a push mentioned inside a heredoc body", () => {
      const cmd = "cat >> notes.md <<'EOF'\n- remember: git push only after prequeue\nEOF";
      expect(denied(runHook(syncOnly(), cmd))).toBe(false);
    });

    it("still gates a real push chained after quoted text", () => {
      expect(denied(runHook(syncOnly(), 'git commit -q --allow-empty -m "wip" ; git push'))).toBe(
        true,
      );
    });

    it("still gates a real push after a heredoc", () => {
      const cmd = "cat > a.txt <<'EOF'\nhello\nEOF\ngit push -u origin feat";
      expect(denied(runHook(syncOnly(), cmd))).toBe(true);
    });
  });

  it("allows an ordinary push with no merge", () => {
    const { work } = setup();
    commit(work, "b.txt", "b2\n", "more feature work");
    expect(denied(runHook(work))).toBe(false);
  });
});

// Which merged-tree gates a push gets: a branch that changes only prose skips
// the typecheck and the code censuses; anything else gets them all.
describe.skipIf(!hasTools)("pre-push gate selection", () => {
  /** A branch off main whose only commits touch `files`. */
  function branchTouching(files: string[]): string {
    const { work } = setup();
    git(work, "checkout", "-q", "-b", "topic", "origin/main");
    for (const f of files) commitAt(work, f, `${f}\n`, `touch ${f}`);
    return work;
  }

  it("treats a branch touching only docs/, Markdown and LICENSE as docs-only", () => {
    const work = branchTouching(["docs/guide.md", "README.md", "LICENSE-OUTPUT"]);
    expect(traceHook(work)).toContain("docs-only push");
  });

  it("gives a branch touching src/ the full gates", () => {
    const work = branchTouching(["docs/guide.md", "src/x.ts"]);
    const err = traceHook(work);
    expect(err).toContain("code push");
    expect(err).not.toContain("docs-only");
  });

  it("gives a non-Markdown file outside docs/ the full gates", () => {
    // The prose set is an allow-list: an unknown path counts as code.
    const work = branchTouching(["notes.txt"]);
    expect(traceHook(work)).toContain("code push");
  });
});

// Which dependency tree the merged-tree gates borrow. An agent worktree under
// `.claude/worktrees/` often holds only a vite cache stub in `node_modules` and
// resolves its deps from the main checkout; borrowing the stub fails `tsc` with
// TS2688 on a tree that is fine, so the hook takes the first `node_modules`
// that holds TypeScript and Node's types. A docs-only push resolves it too, and
// with the censuses skipped it stops right after, so no compiler runs here.
describe.skipIf(!hasTools)("pre-push dependency tree", () => {
  function installFakeDeps(dir: string): void {
    mkdirSync(join(dir, "node_modules/typescript"), { recursive: true });
    writeFileSync(join(dir, "node_modules/typescript/package.json"), "{}\n");
    mkdirSync(join(dir, "node_modules/@types/node"), { recursive: true });
  }

  /** An agent-style worktree of `work` with only a vite stub in node_modules. */
  function agentWorktree(work: string): string {
    const wt = join(work, ".claude/worktrees/agent-x");
    git(work, "worktree", "add", "-q", "-b", "topic", wt, "origin/main");
    mkdirSync(join(wt, "node_modules/.vite"), { recursive: true });
    commitAt(wt, "docs/guide.md", "guide\n", "docs");
    return wt;
  }

  it("borrows the main checkout's node_modules when the worktree only has a stub", () => {
    const { work } = setup();
    installFakeDeps(work);
    const err = traceHook(agentWorktree(work));
    expect(err).toContain(`borrowing node_modules from ${realpathSync(work)}/node_modules`);
  });

  it("prefers the pushing checkout's own node_modules when it resolves", () => {
    const { work } = setup();
    installFakeDeps(work);
    const wt = agentWorktree(work);
    installFakeDeps(wt);
    expect(traceHook(wt)).toContain(`borrowing node_modules from ${realpathSync(wt)}/node_modules`);
  });

  it("skips the gates when no node_modules resolves the toolchain", () => {
    const { work } = setup();
    expect(traceHook(agentWorktree(work))).toContain("no resolvable node_modules");
  });
});
