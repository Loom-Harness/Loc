// Refuse to run the toolchain from a compiled `out/` older than its `src/`.
//
// `bin/cli.js` loads `out/`, never `src/`.  In a development checkout, a change
// made in `src/` without `npx tsc -b` is therefore never executed by anything
// that spawns the CLI — every e2e and behavioural leg — so the leg passes on
// the old code.  For a mutation proof that is the worst outcome: the seeded
// defect is invisible and the gate reads as blind, or the revert reads as a
// pass.  This check turns that into a loud refusal naming the newer file.
//
// Reference point: `tsc -b` touches `tsconfig.tsbuildinfo` on every build that
// sees a changed input, including one whose emit is byte-identical, so a source
// newer than it has not been compiled.  The check is inert outside a source
// checkout (no `src/` or no tsbuildinfo beside `out/`).
// `LOOM_ALLOW_STALE_BUILD=1` skips it.
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The first `src/` TypeScript file newer than the last build, or null. */
export function staleSource(repoRoot) {
  const src = path.join(repoRoot, "src");
  const info = path.join(repoRoot, "tsconfig.tsbuildinfo");
  let builtAt;
  try {
    if (!fs.statSync(src).isDirectory()) return null;
    builtAt = fs.statSync(info).mtimeMs;
  } catch {
    return null;
  }
  const stack = [src];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (/\.tsx?$/.test(e.name) && !e.name.endsWith(".d.ts")) {
        try {
          if (fs.statSync(p).mtimeMs > builtAt) return p;
        } catch {
          // vanished between readdir and stat: not a stale input
        }
      }
    }
  }
  return null;
}

/** Exit 1 with a fix line when `out/` is older than `src/`. */
export function assertFreshBuild(repoRoot = REPO_ROOT) {
  if (process.env.LOOM_ALLOW_STALE_BUILD === "1") return;
  const stale = staleSource(repoRoot);
  if (!stale) return;
  console.error(
    `ddd: ${path.relative(repoRoot, stale)} is newer than the compiled out/ — the CLI would run ` +
      "the old code.  Run `npx tsc -b` (or `npm run build`) first.  " +
      "Set LOOM_ALLOW_STALE_BUILD=1 to run the stale build anyway.",
  );
  process.exit(1);
}
