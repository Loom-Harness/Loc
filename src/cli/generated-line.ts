// The generated line — `generate system --merge` / `--check`.
//
// Git is the record of what was generated.  `--merge` renders the model into a
// commit whose tree holds only the output folder, pristine (every generated
// file and every hatch stub), and merges that commit into the current branch
// with an ordinary `git merge`.  The previous generation is therefore the
// merge base: a user's edit to a generated file survives a model change, a
// new hook's stub lands in the user's hatch file, and a renamed or re-signed
// hook surfaces as a conflict in that file.
//
// A generated commit is an ordinary commit in the branch's own history,
// found by its trailers:
//
//     Generated-from: <the source commit (HEAD) it was rendered from>
//     Generated-into: <the output directory, relative to the repository root>
//
// Its parents are the generated commits the branch already contains (the
// independent set), so two branches that each regenerated merge into one
// line.  There is no named branch, no ref, no hook and no state outside the
// commits themselves; `git merge --abort` undoes a merge that stopped.

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type ignore from "ignore";

const FROM = "Generated-from";
const INTO = "Generated-into";

export class GeneratedLineError extends Error {}

interface GitResult {
  status: number;
  stdout: string;
  stderr: string;
}

function git(cwd: string, args: string[], env: NodeJS.ProcessEnv = {}): GitResult {
  const r = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...env },
    maxBuffer: 256 * 1024 * 1024,
  });
  if (r.error) throw new GeneratedLineError(`git could not run: ${r.error.message}`);
  return { status: r.status ?? 1, stdout: r.stdout, stderr: r.stderr };
}

function gitOk(cwd: string, args: string[], env: NodeJS.ProcessEnv = {}): string {
  const r = git(cwd, args, env);
  if (r.status !== 0) {
    throw new GeneratedLineError(`git ${args[0]} failed: ${(r.stderr || r.stdout).trim()}`);
  }
  return r.stdout.trim();
}

/** Where the output directory sits in the repository. */
export interface Placement {
  /** Repository root (the work tree's top level). */
  root: string;
  /** The output directory relative to `root`, forward slashes, no trailing slash. */
  prefix: string;
}

/** Locate the repository that holds `outDir` (which may not exist yet). */
export function placement(outDir: string): Placement {
  const abs = path.resolve(outDir);
  let probe = abs;
  while (!fs.existsSync(probe)) probe = path.dirname(probe);
  const top = git(probe, ["rev-parse", "--show-toplevel"]);
  if (top.status !== 0) {
    throw new GeneratedLineError(
      `${outDir} is not inside a git work tree; --merge and --check record generations as commits`,
    );
  }
  const root = fs.realpathSync(top.stdout.trim());
  const rel = path.relative(root, fs.realpathSync(probe));
  const prefix = path.join(rel, path.relative(probe, abs)).split(path.sep).join("/");
  if (prefix === "" || prefix.startsWith("..")) {
    throw new GeneratedLineError(
      `${outDir} must be a directory inside the repository, not its root`,
    );
  }
  return { root, prefix };
}

/** The tree object of `tree` (path → content) placed under `prefix`. */
function writeTree(p: Placement, tree: ReadonlyMap<string, string>): string {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "generated-line-"));
  try {
    const work = path.join(scratch, "work");
    for (const [rel, content] of tree) {
      const full = path.join(work, p.prefix, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, "utf8");
    }
    const env = { GIT_INDEX_FILE: path.join(scratch, "index") };
    // `-f`: a generated `.gitignore` must not hide another generated file.
    gitOk(p.root, ["--work-tree", work, "add", "-A", "-f", "--", "."], env);
    return gitOk(p.root, ["write-tree"], env);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

/** The generated commits for `prefix` that HEAD contains and no other one of
 *  them does — the parents of the next generated commit. */
function latestGenerated(p: Placement): string[] {
  const listed = git(p.root, [
    "rev-list",
    "HEAD",
    "--all-match",
    `--grep=^${FROM}: `,
    `--grep=^${INTO}: ${escapeRegex(p.prefix)}$`,
  ]);
  if (listed.status !== 0) return [];
  const shas = listed.stdout.split("\n").filter(Boolean);
  if (shas.length <= 1) return shas;
  return gitOk(p.root, ["merge-base", "--independent", ...shas])
    .split("\n")
    .filter(Boolean);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function treeOf(root: string, commit: string): string {
  return gitOk(root, ["rev-parse", `${commit}^{tree}`]);
}

function headCommit(root: string): string {
  const r = git(root, ["rev-parse", "--verify", "HEAD"]);
  if (r.status !== 0) {
    throw new GeneratedLineError(
      "the branch has no commit yet; commit the model first (`git add` + `git commit`)",
    );
  }
  return r.stdout.trim();
}

/** Uncommitted changes to the model's own files (`sources`, absolute). */
function dirtySources(root: string, sources: readonly string[]): string[] {
  if (sources.length === 0) return [];
  const r = gitOk(root, ["status", "--porcelain", "--", ...sources]);
  return r
    .split("\n")
    .filter(Boolean)
    .map((l) => l.slice(3));
}

export interface CheckResult {
  upToDate: boolean;
  reason?: string;
}

/** `--check`: does HEAD's latest generated commit hold exactly what the model
 *  renders now?  Writes no file and no ref. */
export function checkGenerated(outDir: string, tree: ReadonlyMap<string, string>): CheckResult {
  const p = placement(outDir);
  headCommit(p.root);
  const latest = latestGenerated(p);
  if (latest.length === 0) {
    return {
      upToDate: false,
      reason: `no generated commit for ${p.prefix} in this branch's history`,
    };
  }
  if (latest.length > 1) {
    return {
      upToDate: false,
      reason: `${latest.length} generated lines meet in this branch (a branch merge); regenerate to join them`,
    };
  }
  if (treeOf(p.root, latest[0]!) !== writeTree(p, tree)) {
    return {
      upToDate: false,
      reason: `the model renders a different ${p.prefix}/ than the last generated commit (${latest[0]!.slice(0, 12)})`,
    };
  }
  return { upToDate: true };
}

export interface MergeResult {
  /** The generated commit merged (or already contained). */
  generated: string;
  /** A new generated commit was made (false: the model renders what the last
   *  one holds). */
  created: boolean;
  /** Paths left in conflict; empty when the merge committed. */
  conflicts: string[];
  /** The branch already contained the generated commit. */
  alreadyMerged: boolean;
}

/** `--merge`: commit the pristine output on the generated line and merge it
 *  into the current branch. */
export function mergeGenerated(
  outDir: string,
  tree: ReadonlyMap<string, string>,
  opts: {
    /** The model's files (entry + imports + migrations), absolute. */
    sources: readonly string[];
    /** Hatch paths (output-relative) — a hatch the branch had and the work
     *  tree lacks is pending and refuses the run, as in-place generation. */
    hatchPaths: readonly string[];
    /** The output's `.loomignore`: a pinned path keeps the branch's version. */
    ignore: ignore.Ignore;
    version: string;
  },
): MergeResult {
  const p = placement(outDir);
  const head = headCommit(p.root);
  const dirty = dirtySources(p.root, opts.sources);
  if (dirty.length > 0) {
    throw new GeneratedLineError(
      `commit the model first — a generated commit names the source commit it was rendered from. Uncommitted: ${dirty.join(", ")}`,
    );
  }
  const latest = latestGenerated(p);

  // A hatch file the branch's last generation carried and the work tree no
  // longer has was deleted by the user: pending, exactly as in-place.
  const missing = opts.hatchPaths.filter((h) => {
    if (opts.ignore.ignores(h) || fs.existsSync(path.join(p.root, p.prefix, h))) return false;
    return latest.some(
      (c) => git(p.root, ["cat-file", "-e", `${c}:${p.prefix}/${h}`]).status === 0,
    );
  });
  if (missing.length > 0) {
    throw new GeneratedLineError(
      `escape-hatch file(s) the model calls for were deleted: ${missing.join(", ")}. Run \`ddd scaffold\` to write them, commit, then generate again.`,
    );
  }

  const newTree = writeTree(p, tree);
  let generated: string;
  let created = false;
  if (latest.length === 1 && treeOf(p.root, latest[0]!) === newTree) {
    generated = latest[0]!;
  } else {
    const message = [
      `Generate ${p.prefix}/ from ${head.slice(0, 12)}`,
      "",
      `Rendered by the generator ${opts.version}.`,
      "",
      `${FROM}: ${head}`,
      `${INTO}: ${p.prefix}`,
      "",
    ].join("\n");
    generated = gitOk(p.root, [
      "commit-tree",
      newTree,
      ...latest.flatMap((c) => ["-p", c]),
      "-m",
      message,
    ]);
    created = true;
  }

  if (git(p.root, ["merge-base", "--is-ancestor", generated, "HEAD"]).status === 0) {
    return { generated, created, conflicts: [], alreadyMerged: true };
  }
  const merge = git(p.root, [
    "merge",
    "--no-ff",
    "--no-commit",
    "--allow-unrelated-histories",
    "-m",
    `Merge generated ${p.prefix}/`,
    generated,
  ]);
  const unmerged = gitOk(p.root, ["diff", "--name-only", "--diff-filter=U"])
    .split("\n")
    .filter(Boolean);
  if (merge.status !== 0 && unmerged.length === 0) {
    // git refused before merging (e.g. local changes it would overwrite).
    throw new GeneratedLineError((merge.stderr || merge.stdout).trim());
  }
  // `.loomignore`: a pinned path keeps the branch's version (a fork).
  restorePinned(p, head, opts.ignore);
  const conflicts = gitOk(p.root, ["diff", "--name-only", "--diff-filter=U"])
    .split("\n")
    .filter(Boolean);
  if (conflicts.length === 0) gitOk(p.root, ["commit", "--no-edit"]);
  return { generated, created, conflicts, alreadyMerged: false };
}

/** Put every `.loomignore`d output path back to its version at `head`. */
function restorePinned(p: Placement, head: string, ig: ignore.Ignore): void {
  const changed = gitOk(p.root, ["diff", "--name-only", "--cached", head, "--", p.prefix])
    .split("\n")
    .concat(gitOk(p.root, ["diff", "--name-only", "--diff-filter=U"]).split("\n"))
    .filter(Boolean);
  for (const file of new Set(changed)) {
    const rel = file.slice(p.prefix.length + 1);
    if (!ig.ignores(rel)) continue;
    if (git(p.root, ["cat-file", "-e", `${head}:${file}`]).status === 0) {
      gitOk(p.root, ["checkout", head, "--", file]);
    } else {
      gitOk(p.root, ["rm", "-q", "-f", "--", file]);
    }
  }
}

/** The source files' absolute paths, deduplicated. */
export function sourceFiles(files: Iterable<string>): string[] {
  return [...new Set([...files].map((f) => path.resolve(f)))];
}
