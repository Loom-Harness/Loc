import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// `ddd diff --git <ref>`: the baseline is the entry `.ddd` as committed at
// <ref>.  Every tracked `.ddd` of that commit is extracted into a temporary
// directory at its repository path, so the old entry's `import`s resolve to
// the old files beside it — a multi-file project diffs as a whole.
// ---------------------------------------------------------------------------

/** A baseline checked out of git; `cleanup` removes the temporary tree. */
export interface GitBaseline {
  /** The entry `.ddd` inside the extracted tree. */
  entry: string;
  /** The entry's path relative to the repository root, `/`-separated. */
  repoPath: string;
  cleanup(): void;
}

function git(cwd: string, args: string[]): Buffer {
  return execFileSync("git", ["-C", cwd, ...args], {
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 1024 * 1024 * 1024,
  });
}

function gitFailure(err: unknown): string {
  const stderr = (err as { stderr?: Buffer | string }).stderr;
  const text = stderr ? stderr.toString().trim() : "";
  return text || (err instanceof Error ? err.message : String(err));
}

/** Extract `file`'s project as of `ref`.  Throws an `Error` whose message says
 *  what is wrong (not a repository, unknown ref, file absent at that ref). */
export function checkoutGitBaseline(file: string, ref: string): GitBaseline {
  const absolute = fs.realpathSync(path.resolve(file));
  let root: string;
  try {
    root = git(path.dirname(absolute), ["rev-parse", "--show-toplevel"]).toString().trim();
  } catch (err) {
    throw new Error(`--git needs ${file} inside a git repository: ${gitFailure(err)}`);
  }
  const repoPath = path.relative(fs.realpathSync(root), absolute).split(path.sep).join("/");
  try {
    git(root, ["cat-file", "-e", `${ref}:${repoPath}`]);
  } catch {
    throw new Error(`${repoPath} does not exist at ${ref} (or ${ref} is not a commit)`);
  }
  let archive: Buffer;
  try {
    archive = git(root, ["archive", "--format=tar", ref, "--", ":(glob)**/*.ddd"]);
  } catch (err) {
    throw new Error(`cannot read the .ddd files at ${ref}: ${gitFailure(err)}`);
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loom-diff-"));
  const cleanup = () => fs.rmSync(dir, { recursive: true, force: true });
  try {
    execFileSync("tar", ["-x", "-C", dir], { input: archive, stdio: ["pipe", "ignore", "pipe"] });
  } catch (err) {
    cleanup();
    throw new Error(`cannot extract the .ddd files at ${ref}: ${gitFailure(err)}`);
  }
  return { entry: path.join(dir, ...repoPath.split("/")), repoPath, cleanup };
}
