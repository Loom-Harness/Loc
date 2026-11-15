#!/usr/bin/env node
// Pre-merge-queue check for a train: materialise origin/main merged with HEAD
// in a throwaway worktree and run, on that merged tree, the merge-queue gates
// the diff can break.  Every queue gate is named (scripts/prequeue-gates.mjs);
// the ones not run are printed with the reason, so a green prequeue says
// exactly what it proved and what is left to the queue.
//
//   npm run prequeue [-- --heavy] [-- --runtime] [-- --quick] [-- --plan] [-- --keep]

import { spawn, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { pullRequestPaths, QUEUE_GATES, reaches } from "./prequeue-gates.mjs";

// `--quick` swaps the whole fast suite for the whole-tree censuses: the
// `*census*` / `*ratchet*` files plus the gates outside that glob that most
// often eject trains (the diagnostic catalog, the unsupported register, the
// api-caller census).  The typing differential lives in the corpus project.
const EXTRA_CENSUSES = [
  "test/system/typing-differential.test.ts",
  "test/system/diagnostic-catalog.test.ts",
  "test/system/unsupported-register.test.ts",
  "test/ir/api-caller-census.test.ts",
];
const CENSUS_SLOW =
  /diagnostic-firing-census|openapi-component-uniqueness-census|\/ddd-source-census/;

// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  const mins = (tier) =>
    QUEUE_GATES.filter((g) => g.tier === tier)
      .flatMap((g) => g.cmds)
      .reduce((n, c) => n + c.minutes, 0);
  console.log(`Usage: npm run prequeue [-- flags]

Runs the merge-queue gates on (origin/main + HEAD) in a throwaway worktree.
Every queue gate is listed; the ones not run are printed with the reason.

  (default)   fast tier, ~${Math.round(mins("fast"))} min on 4 cores: tsc -b, test/ typecheck, lint,
              the whole vitest suite (unit + mocked + corpus), langium-generated,
              actionlint when workflows changed
  --heavy     also the generated-project builds + behavioural legs the diff
              reaches (all of them: ~${Math.round(mins("heavy"))} min, run one at a time)
  --runtime   also the docker runtime legs the diff reaches (all of them:
              ~${Math.round(mins("runtime"))} min)
  --quick     swap the vitest suite for the whole-tree censuses (~2 min);
              the suite is then listed as NOT run
  --all-censuses  with --quick, include the three slow corpus-wide censuses
  --plan      print what would run and what would not, run nothing
  --keep      keep the worktree for inspection
  --help      this text

"The diff reaches a gate" is the gate workflow's own pull_request paths filter.
The merge queue runs every gate on every group regardless.

Exit status is non-zero if any step failed.`);
  process.exit(0);
}
const HEAVY = args.includes("--heavy");
const RUNTIME = args.includes("--runtime");
const QUICK = args.includes("--quick");
const ALL = args.includes("--all-censuses");
const PLAN = args.includes("--plan");
const KEEP = args.includes("--keep");

const sh = (cmd, opts = {}) => spawnSync("bash", ["-c", cmd], { encoding: "utf8", ...opts });
const git = (cwd, ...a) => spawnSync("git", a, { cwd, encoding: "utf8" });
const repo = git(process.cwd(), "rev-parse", "--show-toplevel").stdout.trim();
if (!repo) {
  console.error("prequeue: not inside a git repository");
  process.exit(2);
}

/** What this machine can run; a gate needing something absent is not run. */
function available() {
  const has = (cmd) => sh(`command -v ${cmd}`).status === 0;
  const docker = sh("docker info", { stdio: "ignore" }).status === 0;
  return {
    docker,
    "hex-mirror": docker,
    dotnet: has("dotnet") || docker,
    uv: has("uv"),
    flutter: has("flutter"),
  };
}

/** Each queue gate's commands with a run / not-run verdict and its reason. */
function plan(changed, have) {
  const rows = [];
  for (const g of QUEUE_GATES) {
    const filter = pullRequestPaths(
      readFileSync(path.join(repo, ".github/workflows", g.workflow), "utf8"),
    );
    const reached = reaches(filter, changed);
    const why = (reason) => ({ run: false, reason });
    let verdict;
    if (g.manual) verdict = why(`manual: ${g.manual}`);
    else if (!reached && g.tier !== "fast")
      verdict = why(`the diff does not reach ${g.workflow}'s pull_request paths`);
    else if (g.tier === "heavy" && !HEAVY) verdict = why("heavy tier: pass --heavy");
    else if (g.tier === "runtime" && !RUNTIME) verdict = why("runtime tier: pass --runtime");
    else verdict = { run: true };
    const cmds = g.cmds.length ? g.cmds : [{ label: g.check, cmd: "", minutes: 0 }];
    for (const c of cmds) {
      let v = verdict;
      if (v.run && g.workflow === "test.yml" && QUICK && c.cmd.startsWith("npx vitest run"))
        v = why("--quick: the whole-tree censuses ran instead");
      const missing = (c.needs ?? []).filter((n) => !have[n]);
      if (v.run && missing.length) v = why(`needs ${missing.join(", ")} (not available here)`);
      rows.push({ gate: g, cmd: c, ...v });
    }
  }
  return rows;
}

let wt = null;
let cleaned = false;
function cleanup() {
  if (cleaned || !wt) return;
  cleaned = true;
  if (KEEP) {
    console.log(`\nprequeue: worktree kept at ${wt}\n  remove: git worktree remove --force ${wt}`);
    return;
  }
  git(repo, "worktree", "remove", "--force", wt);
  rmSync(wt, { recursive: true, force: true });
  git(repo, "worktree", "prune");
}
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig, () => {
    cleanup();
    process.exit(130);
  });
}
process.on("exit", cleanup);

const fmt = (ms) => `${(ms / 1000).toFixed(0)}s`;

function run(label, cmd, env = {}) {
  console.log(`\n=== ${label}\n$ ${cmd}`);
  const t0 = Date.now();
  return new Promise((resolve) => {
    const p = spawn("bash", ["-c", cmd], {
      cwd: wt,
      stdio: "inherit",
      env: { ...process.env, ...env },
    });
    p.on("exit", (code) => resolve({ label, ok: code === 0, code, ms: Date.now() - t0 }));
  });
}

function printPlan(rows, changed) {
  console.log(`\n=== prequeue plan (${changed.length} changed files vs origin/main)`);
  const mins = rows.filter((r) => r.run).reduce((n, r) => n + r.cmd.minutes, 0);
  for (const r of rows.filter((r) => r.run))
    console.log(
      `  RUN   ~${String(r.cmd.minutes).padStart(4)}m  [${r.gate.workflow}] ${r.cmd.label}`,
    );
  console.log(`  (about ${Math.round(mins)} min on 4 cores)`);
}

function printNotRun(rows) {
  const skipped = rows.filter((r) => !r.run);
  console.log(
    `\n=== queue gates NOT run here (${skipped.length} commands) — the merge queue still runs them`,
  );
  const groups = new Map();
  for (const r of skipped) {
    const k = `${r.gate.workflow}\u0000${r.reason}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  for (const rs of groups.values()) {
    const { gate, reason } = rs[0];
    const spell = (c) =>
      `${Object.entries(c.env ?? {})
        .map(([k, v]) => `${k}=${v} `)
        .join("")}${c.cmd}`;
    const cmds = rs.filter((r) => r.cmd.cmd).map((r) => spell(r.cmd));
    const shown = cmds.length > 2 ? `${cmds[0]}  (+${cmds.length - 1} more legs)` : cmds.join("; ");
    console.log(`  SKIP  [${gate.workflow}] ${reason}${shown ? `\n          $ ${shown}` : ""}`);
  }
}

async function main() {
  const fetched = git(repo, "fetch", "origin", "main", "--quiet");
  if (fetched.status !== 0)
    console.warn("prequeue: warning — fetch origin main failed; using the local origin/main ref");
  const head = git(repo, "rev-parse", "HEAD").stdout.trim();
  if (git(repo, "rev-parse", "--verify", "--quiet", "origin/main").status !== 0) {
    console.error("prequeue: no origin/main");
    process.exit(2);
  }
  const changed = git(repo, "diff", "--name-only", "origin/main...HEAD")
    .stdout.split("\n")
    .filter(Boolean);
  const rows = plan(changed, available());
  printPlan(rows, changed);
  if (PLAN) {
    printNotRun(rows);
    return;
  }

  wt = mkdtempSync(path.join(tmpdir(), "prequeue-"));
  const add = git(repo, "worktree", "add", "--detach", wt, "origin/main");
  if (add.status !== 0) {
    console.error(`prequeue: worktree add failed\n${add.stderr}`);
    process.exit(2);
  }
  const merged = git(wt, "merge", "--no-edit", "-m", "prequeue merge", head);
  if (merged.status !== 0) {
    const files = git(wt, "diff", "--name-only", "--diff-filter=U").stdout.trim();
    console.error(
      `prequeue: HEAD (${head.slice(0, 9)}) does not merge cleanly into origin/main. Conflicts:\n${files}\nRebase or merge origin/main first.`,
    );
    git(wt, "merge", "--abort");
    process.exit(1);
  }
  console.log(`prequeue: origin/main + ${head.slice(0, 9)} merged in ${wt}`);

  for (const d of ["node_modules", "web/node_modules"]) {
    const src = path.join(repo, d);
    if (existsSync(src) && !existsSync(path.join(wt, d))) symlinkSync(src, path.join(wt, d));
  }

  const results = [];
  const initDst = path.join(homedir(), ".gradle", "init.d", "java-werror.gradle");
  let initInstalled = null;
  try {
    for (const r of rows.filter((x) => x.run)) {
      const c = r.cmd;
      if (c.javaWerror && !existsSync(initDst)) {
        // javac -Xlint:all -Werror, as CI: the gradle init script, installed for
        // the run and removed afterwards (init.d applies to every Gradle build).
        mkdirSync(path.dirname(initDst), { recursive: true });
        copyFileSync(path.join(wt, "test/e2e/support/java-werror.init.gradle"), initDst);
        initInstalled = initDst;
      }
      results.push(await run(c.label, c.cmd, c.env));
      // The suite depends on the build; a red typecheck makes the rest noise.
      if (c.label === "tsc -b" && !results.at(-1).ok) break;
    }
    if (QUICK) {
      const files = sh(
        `ls test/system/*census*.test.ts test/system/*ratchet*.test.ts ${EXTRA_CENSUSES.join(" ")} 2>/dev/null | sort -u`,
        { cwd: wt },
      )
        .stdout.split("\n")
        .filter((f) => f && (ALL || !CENSUS_SLOW.test(f)));
      results.push(
        await run(
          `censuses (${files.length} files${ALL ? ", incl. slow" : ""})`,
          `npx vitest run --testTimeout=120000 ${files.join(" ")}`,
        ),
      );
    }
  } finally {
    if (initInstalled) rmSync(initInstalled, { force: true });
  }

  printNotRun(rows);
  console.log("\n=== prequeue summary");
  for (const r of results)
    console.log(
      `  ${r.ok ? "PASS" : "FAIL"}  ${fmt(r.ms).padStart(5)}  ${r.label}${r.ok ? "" : `  (exit ${r.code})`}`,
    );
  const failed = results.filter((r) => !r.ok);
  const notRun = rows.filter((r) => !r.run).length;
  console.log(
    failed.length
      ? `\nprequeue: ${failed.length} step(s) FAILED`
      : `\nprequeue: all ${results.length} steps passed; ${notRun} queue gate command(s) were NOT run (listed above)`,
  );
  process.exitCode = failed.length ? 1 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 2;
});
