// A suite no CI path can turn on is dead code that reads as coverage.
//
// WHY THIS EXISTS
// ---------------
// Every slow tier in this repo is opt-in behind its own `LOOM_*` env var and a
// matching `npm run test:*` script, and a workflow sets the var to run it.
// That is three links in a chain, and the middle one is invisible when it
// breaks: `describe.skipIf(!ENABLED)` skips *silently*, so a suite whose var no
// workflow and no script ever sets is indistinguishable — in every report, on
// every run — from a suite that passed.
//
// The code review of 2026-09-13 (P1-1) found two of them, 677 lines between
// them:
//
//   - test/e2e/embed-react-elixir.test.ts (LOOM_EMBED_E2E_PHOENIX) — the only
//     runtime proof that the Phoenix-embeds-React wiring SERVES (`GET /app` →
//     SPA shell, `GET /api/<agg>` → JSON on the same origin); the mix-compile
//     gate only proves it compiles.  Its own header says it "reuses the
//     phoenix-obs-e2e.yml workflow" — a workflow that no longer exists.  It was
//     orphaned by a RENAME (phoenix-obs-e2e -> elixir-vanilla-obs-e2e) and
//     nothing noticed, because nothing could.
//   - test/e2e/auth-gate-ui-e2e.test.ts (LOOM_AUTH_GATE_E2E) — the only runtime
//     proof that `requires`-gated menus / pages / operation buttons actually
//     hide and show client-side.
//
// THE INVARIANT
// -------------
// Every `LOOM_*` env var a test reads AS A SKIP CONDITION must be set
// somewhere a human or a workflow can reach: a `package.json` script, or a
// `.github/workflows/*.yml`.  Zero tolerance, not a ratchet — there is no
// allowlist to go stale, because the honest fix for a suite nobody can run is
// to wire it or delete it.
//
// SCOPE — what is deliberately NOT a skip condition:
//   - env vars of the GENERATED app that a test merely asserts about
//     (`LOOM_CHANNEL_LIFECYCLE_BUS_URL`, `DATABASE_URL`, …).  They are string
//     literals in expectations, not gates.
//   - manual tuning knobs read outside a skip expression (`LOOM_FUZZ_SEEDS`,
//     `LOOM_CORPUS_*_CASE`, `LOOM_WIRE_UPDATE`).  Leaving them unset does not
//     strand a suite; it picks a default.
//   - ESCAPE HATCHES — a read whose UNSET state already satisfies the
//     condition, i.e. compared with `!==`/`!=` (`LOOM_E2E_ALLOW_NO_DOCKER !==
//     "1"`).  Unset means the suite RUNS, so nothing is stranded.
// Only a var that must be SET for the suite to run is in scope.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const testDir = path.join(repoRoot, "test");
const workflowsDir = path.join(repoRoot, ".github/workflows");

function tsFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = path.join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...tsFilesUnder(p));
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

/** `describe.skipIf(`, `it.runIf(`, `describe.sequential.skipIf(`, … */
const SKIP_CALL_RE = /\b(?:describe|it|test)(?:\.\w+)*\.(?:skipIf|runIf)\s*\(/g;
/** A `process.env.LOOM_X` read plus whatever operator follows it. */
const ENV_READ_RE = /process\.env\.(LOOM_[A-Z0-9_]+)\s*(!==|!=)?/g;
const IDENT_RE = /\b[A-Za-z_$][\w$]*\b/g;

/** The argument of the call whose `(` sits at `openIdx`, parens balanced. */
function balancedArg(source: string, openIdx: number): string {
  let depth = 0;
  for (let i = openIdx; i < source.length; i++) {
    if (source[i] === "(") depth++;
    else if (source[i] === ")") {
      depth--;
      if (depth === 0) return source.slice(openIdx + 1, i);
    }
  }
  return source.slice(openIdx + 1);
}

/**
 * A skip expression is usually an identifier (`!ENABLED`), so the local
 * `const` bindings it names are inlined — transitively, since `PHX_RUN` is
 * built from `ENABLED`.  Bounded depth: this is a text scan, not an evaluator.
 */
function expandLocals(expr: string, source: string): string {
  let text = expr;
  for (let depth = 0; depth < 4; depth++) {
    let grown = text;
    for (const id of new Set(text.match(IDENT_RE) ?? [])) {
      const binding = source.match(
        new RegExp(`\\bconst\\s+${id}\\s*(?::[^=]+)?=\\s*([\\s\\S]*?);`, "m"),
      );
      if (binding) grown += `\n${binding[1]}`;
    }
    if (grown === text) break;
    text = grown;
  }
  return text;
}

interface SkipGate {
  /** repo-relative test file */
  readonly file: string;
  readonly varName: string;
  /** true when unset already satisfies the condition (`!== "1"`) */
  readonly escapeHatch: boolean;
}

/**
 * Comments are stripped before scanning.  A file that merely *documents*
 * `describe.skipIf(` or `process.env.LOOM_X` does not gate on it — and an
 * unbalanced paren inside a comment makes the argument scan run to EOF and
 * swallow the rest of the file.  (This file was its own first false positive.)
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function skipGatesIn(file: string): SkipGate[] {
  const source = stripComments(readFileSync(file, "utf8"));
  const rel = path.relative(repoRoot, file).split(path.sep).join("/");
  const found = new Map<string, SkipGate>();
  SKIP_CALL_RE.lastIndex = 0;
  let call = SKIP_CALL_RE.exec(source);
  while (call) {
    const text = expandLocals(balancedArg(source, SKIP_CALL_RE.lastIndex - 1), source);
    ENV_READ_RE.lastIndex = 0;
    let read = ENV_READ_RE.exec(text);
    while (read) {
      const prior = found.get(read[1]);
      const escapeHatch = read[2] !== undefined && (prior?.escapeHatch ?? true);
      found.set(read[1], { file: rel, varName: read[1], escapeHatch });
      read = ENV_READ_RE.exec(text);
    }
    call = SKIP_CALL_RE.exec(source);
  }
  return [...found.values()];
}

const allGates: SkipGate[] = tsFilesUnder(testDir).flatMap(skipGatesIn);
const requiredGates = allGates.filter((g) => !g.escapeHatch);

/** Every `LOOM_*` a `package.json` script or a workflow actually SETS. */
function settableVars(): Set<string> {
  const out = new Set<string>();
  const collect = (text: string): void => {
    // `LOOM_X=1 vitest …` in a script, `LOOM_X: '1'` in a workflow `env:`.
    for (const m of text.matchAll(/\b(LOOM_[A-Z0-9_]+)\s*[:=]/g)) out.add(m[1]);
  };
  collect(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  for (const f of readdirSync(workflowsDir).filter((x) => x.endsWith(".yml"))) {
    collect(readFileSync(path.join(workflowsDir, f), "utf8"));
  }
  return out;
}

const settable = settableVars();

describe("every skip-gating LOOM_* var is reachable", () => {
  it("the scanner found the real population (it is not passing over nothing)", () => {
    // Without this the whole file is vacuous the moment the scan regexes rot.
    expect(allGates.length).toBeGreaterThan(60);
    expect(settable.size).toBeGreaterThan(50);
    expect(existsSync(workflowsDir)).toBe(true);
  });

  it("the scanner resolves an indirected skip condition", () => {
    // `const ENABLED = process.env.LOOM_JAVA_BUILD === "1"` then
    // `describe.skipIf(!ENABLED)` — the identifier hop is the normal shape
    // here, so a scanner that only saw `process.env` inside the skip call
    // itself would find almost nothing and report a clean tree.
    const java = skipGatesIn(path.join(testDir, "e2e/generated-java-build.test.ts"));
    expect(java.map((g) => g.varName)).toContain("LOOM_JAVA_BUILD");
  });

  it("an escape-hatch read is classified as one, not as a gate", () => {
    // test/e2e/e2e.test.ts: `… && process.env.LOOM_E2E_ALLOW_NO_DOCKER !== "1"`.
    // Unset means the suite RUNS, so this var must NOT be demanded of CI —
    // but it must still be SEEN, or the classifier is just a blind spot.
    const seen = allGates.filter((g) => g.varName === "LOOM_E2E_ALLOW_NO_DOCKER");
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((g) => g.escapeHatch)).toBe(true);
    expect(requiredGates.map((g) => g.varName)).not.toContain("LOOM_E2E_ALLOW_NO_DOCKER");
  });

  it("no suite is stranded behind a var nothing sets", () => {
    const stranded = requiredGates
      .filter((g) => !settable.has(g.varName))
      .map((g) => `${g.file} — ${g.varName}`)
      .sort();
    expect(
      stranded,
      `These suites skip themselves unless a LOOM_* var is set, and nothing sets it:\n` +
        `${stranded.map((s) => `  ${s}`).join("\n")}\n\n` +
        "A skipped suite is indistinguishable from a passing one, so this is " +
        "coverage that reads as real and is not. Fix it one of two ways:\n" +
        "  - WIRE it: add a `package.json` script that sets the var, and run that " +
        "script from a workflow (a job, or a `run-*`-labelled leg); or\n" +
        "  - DELETE it, if the coverage is genuinely redundant — and say which " +
        "gate covers it instead.\n" +
        "There is no allowlist here on purpose: an allowlist entry is how a dead " +
        "suite becomes permanent.",
    ).toEqual([]);
  });
});
