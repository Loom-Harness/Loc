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
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const HOOK = resolve(__dirname, "../../.claude/hooks/pre-push-merge-check.sh");
const hasTools =
  spawnSync("jq", ["--version"]).status === 0 &&
  spawnSync("git", ["merge-tree", "-h"]).status !== null;

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t",
    },
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

describe.skipIf(!hasTools)("pre-push sync-only gate", () => {
  it("denies a push that only merges origin/main into a clean branch", () => {
    const { work, other } = setup();
    advanceMain(other, "c.txt", "c1\n");
    git(work, "fetch", "-q", "origin", "main");
    git(work, "merge", "-q", "--no-edit", "origin/main");
    const out = runHook(work);
    expect(denied(out)).toBe(true);
    expect(out).toContain("only merges origin/main");
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
    spawnSync("git", ["merge", "-q", "--no-edit", "origin/main"], { cwd: work });
    writeFileSync(join(work, "b.txt"), "resolved\n");
    git(work, "add", "b.txt");
    git(work, "commit", "-q", "--no-edit");
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

  it("allows an ordinary push with no merge", () => {
    const { work } = setup();
    commit(work, "b.txt", "b2\n", "more feature work");
    expect(denied(runHook(work))).toBe(false);
  });
});
