#!/usr/bin/env node
// Pre-merge-queue check for a train coordinator: materialise origin/main
// merged with HEAD in a throwaway worktree and run, on that merged tree, the
// gates the merge queue would run — typecheck, test/ typecheck, lint and the
// fast whole-tree censuses. Then name the per-backend compile gates the diff
// reaches (`--heavy` runs them, one at a time). Mirrors the push preflight in
// `.claude/hooks/pre-push-merge-check.sh`, plus the heavy legs it leaves out.
//
//   npm run prequeue [-- --heavy] [-- --all-censuses] [-- --keep]

import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

// ---------------------------------------------------------------------------
// Backend → paths that reach it → strict compile command(s). One table; every
// command is the one the named workflow runs (docs/testing.md → "Running any
// CI gate locally").
// ---------------------------------------------------------------------------
const SHARED_PATHS = [
  /^src\/generator\/_/,
  /^src\/ir\//,
  /^src\/generator\/[^/]+\.ts$/,
  /^src\/system\//,
  /^src\/util\//,
];
const FRONTEND_SEAMS = [/^src\/generator\/_walker\//, /^src\/generator\/_frontend\//];
const BACKENDS = [
  {
    name: "node (hono)",
    paths: [
      /^src\/generator\/typescript\//,
      /^src\/platform\/hono\//,
      /^packages\/backend-hono-v5\//,
    ],
    cmds: [
      {
        env: { LOOM_TS_BUILD: "1" },
        cmd: "npx vitest run test/e2e/generated-build.test.ts",
        ci: "hono-build",
      },
      {
        env: { LOOM_TS_BUILD: "1" },
        cmd: "npx vitest run test/e2e/corpus-tsc-build.test.ts",
        ci: "corpus-build (tsc)",
      },
    ],
  },
  {
    name: "dotnet",
    paths: [/^src\/generator\/dotnet\//, /^src\/platform\/dotnet/],
    cmds: [
      {
        env: { LOOM_DOTNET_BUILD: "1" },
        cmd: "npx vitest run test/e2e/generated-dotnet-build.test.ts",
        ci: "dotnet-build (/warnaserror)",
      },
      {
        env: { LOOM_DOTNET_BUILD: "1" },
        cmd: "npx vitest run test/e2e/corpus-dotnet-build.test.ts",
        ci: "corpus-build (dotnet)",
      },
    ],
  },
  {
    name: "elixir",
    paths: [/^src\/generator\/elixir\//, /^src\/platform\/elixir/],
    cmds: [
      {
        env: { LOOM_PHOENIX_VANILLA_BUILD: "1", LOOM_HEX_MIRROR: "1" },
        cmd: "npx vitest run test/e2e/generated-elixir-vanilla-build.test.ts",
        ci: "elixir-vanilla-build (--warnings-as-errors)",
      },
    ],
  },
  {
    name: "python",
    paths: [/^src\/generator\/python\//, /^src\/platform\/python/],
    cmds: [
      {
        env: { LOOM_PYTHON_BUILD: "1" },
        cmd: "npx vitest run test/e2e/generated-python-build.test.ts",
        ci: "python-build (ruff+mypy+pytest)",
      },
      {
        env: { LOOM_PYTHON_BUILD: "1" },
        cmd: "npx vitest run test/e2e/corpus-python-build.test.ts",
        ci: "corpus-build (python)",
      },
    ],
  },
  {
    name: "java",
    paths: [/^src\/generator\/java\//, /^src\/platform\/java/],
    // javac -Xlint:all -Werror comes from the gradle init script, which --heavy
    // installs into ~/.gradle/init.d for the run and removes afterwards.
    javaWerror: true,
    cmds: [
      {
        env: { LOOM_JAVA_BUILD: "1" },
        cmd: "npx vitest run test/e2e/generated-java-build.test.ts",
        ci: "java-build (-Xlint:all -Werror)",
      },
      {
        env: { LOOM_JAVA_BUILD: "1" },
        cmd: "npx vitest run test/e2e/corpus-java-build.test.ts",
        ci: "corpus-build (java, -Werror)",
      },
    ],
  },
  {
    name: "react",
    paths: [
      /^src\/generator\/react\//,
      /^src\/platform\/react/,
      /^src\/generator\/_packs\//,
      /^designs\//,
      ...FRONTEND_SEAMS,
    ],
    cmds: [
      {
        env: { LOOM_REACT_BUILD: "1" },
        cmd: "npx vitest run test/e2e/generated-react-build.test.ts",
        ci: "generated-react-build",
      },
    ],
  },
  {
    name: "vue",
    paths: [/^src\/generator\/vue\//, /^src\/platform\/vue/, ...FRONTEND_SEAMS],
    cmds: [
      {
        env: { LOOM_VUE_BUILD: "1" },
        cmd: "npx vitest run test/e2e/generated-vue-build.test.ts",
        ci: "generated-vue-build",
      },
    ],
  },
  {
    name: "svelte",
    paths: [/^src\/generator\/svelte\//, /^src\/platform\/svelte/, ...FRONTEND_SEAMS],
    cmds: [
      {
        env: { LOOM_SVELTE_BUILD: "1" },
        cmd: "npx vitest run test/e2e/generated-svelte-build.test.ts",
        ci: "generated-svelte-build",
      },
    ],
  },
  {
    name: "angular",
    paths: [/^src\/generator\/angular\//, /^src\/platform\/angular/, ...FRONTEND_SEAMS],
    cmds: [
      {
        env: { LOOM_ANGULAR_BUILD: "1" },
        cmd: "npx vitest run test/e2e/generated-angular-build.test.ts",
        ci: "generated-angular-build",
      },
    ],
  },
];
const FIVE_BACKENDS = ["node (hono)", "dotnet", "elixir", "python", "java"];

// Mirrors census_merged in .claude/hooks/pre-push-merge-check.sh, plus the
// diagnostic catalog gate.
const CENSUS_SLOW =
  /diagnostic-firing-census|openapi-component-uniqueness-census|\/ddd-source-census/;

// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log(`Usage: npm run prequeue [-- flags]

Runs the merge-queue pre-checks on (origin/main + HEAD) in a throwaway worktree:
  tsc -b, test/ typecheck, lint, fast censuses/ratchets (+ diagnostic-catalog).
Then lists the per-backend compile gates the diff reaches.

  --heavy           run those per-backend compile gates, one at a time
  --all-censuses    include the three slow corpus-wide censuses
  --keep            keep the worktree for inspection
  --help            this text

Exit status is non-zero if any step failed.`);
  process.exit(0);
}
const HEAVY = args.includes("--heavy");
const ALL = args.includes("--all-censuses");
const KEEP = args.includes("--keep");

const sh = (cmd, opts = {}) => spawnSync("bash", ["-c", cmd], { encoding: "utf8", ...opts });
const git = (cwd, ...a) => spawnSync("git", a, { cwd, encoding: "utf8" });
const repo = git(process.cwd(), "rev-parse", "--show-toplevel").stdout.trim();
if (!repo) {
  console.error("prequeue: not inside a git repository");
  process.exit(2);
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

async function main() {
  const fetched = git(repo, "fetch", "origin", "main", "--quiet");
  if (fetched.status !== 0)
    console.warn("prequeue: warning — fetch origin main failed; using the local origin/main ref");
  const head = git(repo, "rev-parse", "HEAD").stdout.trim();
  if (git(repo, "rev-parse", "--verify", "--quiet", "origin/main").status !== 0) {
    console.error("prequeue: no origin/main");
    process.exit(2);
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
  results.push(await run("tsc -b", "npx tsc -b"));
  results.push(await run("test/ typecheck", "node scripts/test-typecheck.mjs"));
  results.push(await run("lint", "npm run lint"));

  const files = sh(
    "ls test/system/*census*.test.ts test/system/*ratchet*.test.ts test/system/typing-differential.test.ts test/system/diagnostic-catalog.test.ts 2>/dev/null | sort -u",
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

  // Per-backend gates the diff reaches.
  const changed = git(repo, "diff", "--name-only", "origin/main...HEAD")
    .stdout.split("\n")
    .filter(Boolean);
  const shared = changed.some((f) => SHARED_PATHS.some((re) => re.test(f)));
  const hit = BACKENDS.filter(
    (b) =>
      (shared && FIVE_BACKENDS.includes(b.name)) ||
      changed.some((f) => b.paths.some((re) => re.test(f))),
  );
  console.log(
    `\n=== per-backend compile gates reached by the diff (${changed.length} changed files${shared ? ", shared seam: all five backends" : ""})`,
  );
  if (!hit.length) console.log("none");
  for (const b of hit) {
    for (const c of b.cmds) {
      const env = Object.entries(c.env)
        .map(([k, v]) => `${k}=${v}`)
        .join(" ");
      console.log(`  [${b.name}] ${env} ${c.cmd}   # ${c.ci}`);
    }
  }

  if (HEAVY && hit.length) {
    let initInstalled = null;
    const initDst = path.join(homedir(), ".gradle", "init.d", "java-werror.gradle");
    try {
      for (const b of hit) {
        if (b.javaWerror && !existsSync(initDst)) {
          mkdirSync(path.dirname(initDst), { recursive: true });
          copyFileSync(path.join(wt, "test/e2e/support/java-werror.init.gradle"), initDst);
          initInstalled = initDst;
        }
        for (const c of b.cmds) results.push(await run(`${b.name}: ${c.ci}`, c.cmd, c.env));
      }
    } finally {
      if (initInstalled) rmSync(initInstalled, { force: true });
    }
  } else if (hit.length) {
    console.log("(not run: pass --heavy to run them)");
  }

  console.log("\n=== prequeue summary");
  for (const r of results)
    console.log(
      `  ${r.ok ? "PASS" : "FAIL"}  ${fmt(r.ms).padStart(5)}  ${r.label}${r.ok ? "" : `  (exit ${r.code})`}`,
    );
  const failed = results.filter((r) => !r.ok);
  console.log(
    failed.length ? `\nprequeue: ${failed.length} step(s) FAILED` : "\nprequeue: all steps passed",
  );
  process.exitCode = failed.length ? 1 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 2;
});
