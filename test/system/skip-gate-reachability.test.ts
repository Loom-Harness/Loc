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
//
// SECOND LINK — the script must be RUN.  A `package.json` script that sets the
// var is only a way in if something invokes it: a workflow `run:` step that
// calls `npm run test:x`, or a `scripts:` / `script:` matrix value that the
// step feeds to `npm run "$script"` (tenancy-e2e.yml).  A script that sets a
// gate var and is invoked by nothing (and whose var no workflow sets itself)
// strands its suite exactly as an unset var does, so it fails below.  The
// suites that are on-demand by design are named in ON_DEMAND_SCRIPTS with the
// reason; a waiver whose script is wired (or gone) fails as stale.

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

/** Escape hatches declared through the shared run-precondition helper.
 *
 *  `skipGatesIn` reads the skip CALL and expands identifiers local to that
 *  file.  That was enough while every suite spelled its own
 *  `process.env.LOOM_E2E_ALLOW_NO_DOCKER !== "1"` inline in the guard — and it
 *  stopped being enough the moment `declareRunPrecondition` centralised the
 *  guard, because the hatch read moved INTO the helper and its name moved into
 *  a `const` in another module.  Nothing about the tree got less safe; the
 *  classifier simply went blind to the only example it had.
 *
 *  That blindness is exactly what the "an escape-hatch read is classified as
 *  one" case below exists to catch, and it caught it. Following the
 *  indirection is the fix — the same shape as the workflow gate following
 *  `npm run` into a nested `package.json` rather than pinning a second list.
 *
 *  Both spellings count: the helper's `DEFAULT_ALLOW_SKIP_ENV`, and any
 *  per-suite `allowSkipEnv: "LOOM_…"` override at a call site. */
function preconditionEscapeHatches(): SkipGate[] {
  const out: SkipGate[] = [];
  const helper = path.join(testDir, "e2e/support/run-precondition.ts");
  if (existsSync(helper)) {
    const src = stripComments(readFileSync(helper, "utf8"));
    for (const m of src.matchAll(/DEFAULT_ALLOW_SKIP_ENV\s*=\s*["'](LOOM_[A-Z0-9_]+)["']/g)) {
      out.push({
        file: "test/e2e/support/run-precondition.ts",
        varName: m[1],
        escapeHatch: true,
      });
    }
  }
  for (const f of tsFilesUnder(testDir)) {
    const src = stripComments(readFileSync(f, "utf8"));
    for (const m of src.matchAll(/allowSkipEnv\s*:\s*["'](LOOM_[A-Z0-9_]+)["']/g)) {
      out.push({
        file: path.relative(repoRoot, f).split(path.sep).join("/"),
        varName: m[1],
        escapeHatch: true,
      });
    }
  }
  return out;
}

const allGates: SkipGate[] = [
  ...tsFilesUnder(testDir).flatMap(skipGatesIn),
  ...preconditionEscapeHatches(),
];
// An escape hatch declared through the helper must not also be DEMANDED of CI
// because some other suite happens to read it inline: the hatch classification
// wins wherever the var appears.
const hatchVars = new Set(allGates.filter((g) => g.escapeHatch).map((g) => g.varName));
const requiredGates = allGates.filter((g) => !g.escapeHatch && !hatchVars.has(g.varName));

/**
 * The `LOOM_*` vars a workflow actually SETS for a step: a key of an `env:`
 * mapping (workflow, job or step level) or an assignment inside a `run:`
 * script.  A mention anywhere else — a `paths:` filter, a `with:` input, a
 * comment, a label name — wires nothing.  A line scanner rather than a YAML
 * parse (no YAML parser is a dependency); workflows here use plain block
 * mappings, which is all it needs to follow.
 */
function workflowSetVars(text: string): Set<string> {
  const out = new Set<string>();
  const indentOf = (l: string): number => l.length - l.trimStart().length;
  let blockIndent = -1; // column of the `env:` / `run:` key that opened the block
  let blockKind: "env" | "run" | null = null;
  for (const raw of text.split("\n")) {
    if (raw.trim() === "" || raw.trimStart().startsWith("#")) continue;
    const ind = indentOf(raw);
    if (blockKind !== null && ind <= blockIndent) blockKind = null;
    const body = raw.trimStart().replace(/^-\s+/, "");
    // A list-item prefix (`- run:`) shifts the key's column by the dash.
    const keyIndent = ind + (raw.trimStart().length - body.length);
    if (blockKind === "env") {
      const m = body.match(/^(LOOM_[A-Z0-9_]+)\s*:/);
      if (m) out.add(m[1]);
      continue;
    }
    if (blockKind === "run") {
      for (const m of body.matchAll(/\b(LOOM_[A-Z0-9_]+)=/g)) out.add(m[1]);
      continue;
    }
    if (/^env:\s*$/.test(body)) {
      blockKind = "env";
      blockIndent = keyIndent;
    } else if (/^env:\s*\{/.test(body)) {
      for (const m of body.matchAll(/\b(LOOM_[A-Z0-9_]+)\s*:/g)) out.add(m[1]);
    } else if (/^run:/.test(body)) {
      blockKind = "run";
      blockIndent = keyIndent;
      for (const m of body.matchAll(/\b(LOOM_[A-Z0-9_]+)=/g)) out.add(m[1]);
    }
  }
  return out;
}

/** `npm run [-flags] <name>` in a script body or workflow line. */
const NPM_RUN_NAME_RE = /\bnpm run\s+(?:-\w+\s+)*([\w:.-]+)/g;
const SCRIPT_LIST_RE = /^\s*(?:-\s+)?scripts?:\s*(.+)$/;

/**
 * The npm script names a workflow invokes: a literal `npm run <name>` on any
 * non-comment line, plus the `test:*` names listed as a `scripts:` / `script:`
 * value (a matrix cell the step later feeds to `npm run "$script"`).  Same
 * line scanner as {@link workflowSetVars} — no YAML parse.
 */
function workflowInvokedScripts(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.split("\n")) {
    if (raw.trimStart().startsWith("#")) continue;
    for (const m of raw.matchAll(NPM_RUN_NAME_RE)) out.add(m[1]);
    const list = SCRIPT_LIST_RE.exec(raw);
    if (list) for (const tok of list[1].split(/\s+/)) if (tok.startsWith("test:")) out.add(tok);
  }
  return out;
}

/** `names` plus every script they run through `npm run` in their own body. */
function scriptClosure(
  names: Iterable<string>,
  scripts: Readonly<Record<string, string>>,
): Set<string> {
  const out = new Set<string>(names);
  const queue = [...out];
  for (let n = queue.pop(); n !== undefined; n = queue.pop()) {
    for (const m of (scripts[n] ?? "").matchAll(NPM_RUN_NAME_RE)) {
      if (!out.has(m[1])) {
        out.add(m[1]);
        queue.push(m[1]);
      }
    }
  }
  return out;
}

const rootScripts: Record<string, string> = JSON.parse(
  readFileSync(path.join(repoRoot, "package.json"), "utf8"),
).scripts;
const workflowTexts = readdirSync(workflowsDir)
  .filter((x) => x.endsWith(".yml"))
  .map((f) => readFileSync(path.join(workflowsDir, f), "utf8"));

const invokedScripts = scriptClosure(
  workflowTexts.flatMap((t) => [...workflowInvokedScripts(t)]),
  rootScripts,
);
const workflowSet = new Set(workflowTexts.flatMap((t) => [...workflowSetVars(t)]));

/** The `LOOM_*` vars a script body assigns (`LOOM_X=1 vitest run …`). */
const varsOfScript = (body: string): string[] =>
  [...body.matchAll(/\b(LOOM_[A-Z0-9_]+)=/g)].map((m) => m[1]);

/** Scripts that set a gate var and are run by hand on purpose — not wired to CI.
 *  Each needs a reason; a script that gets wired (or removed) fails as stale. */
const ON_DEMAND_SCRIPTS: Readonly<Record<string, string>> = {
  "test:pack-spacing-dom":
    "measures URLs of apps the caller already booted (docs/testing.md: local / on-demand)",
  "test:format-dotnet": "dotnet-format conformance of a generated tree, run locally on demand",
  "test:fuzz-deep": "long-running deep pipeline fuzz, run locally on demand",
};

/** Scripts that set a gate var no workflow sets itself, and that no workflow
 *  invokes.  (A var a workflow sets directly is reachable without the script.) */
function unwiredGateScripts(
  scripts: Readonly<Record<string, string>>,
  invoked: ReadonlySet<string>,
  setByWorkflow: ReadonlySet<string>,
  gateVars: ReadonlySet<string>,
): string[] {
  return Object.entries(scripts)
    .filter(
      ([name, body]) =>
        name.startsWith("test:") &&
        !invoked.has(name) &&
        varsOfScript(body).some((v) => gateVars.has(v) && !setByWorkflow.has(v)),
    )
    .map(([name]) => name)
    .sort();
}

/** Every `LOOM_*` a workflow sets, or that an INVOKED (or on-demand) script sets. */
function settableVars(): Set<string> {
  const out = new Set<string>(workflowSet);
  const reachable = [...invokedScripts, ...Object.keys(ON_DEMAND_SCRIPTS)];
  for (const name of reachable) for (const v of varsOfScript(rootScripts[name] ?? "")) out.add(v);
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

  it("a workflow counts a var as wired only when a step's env: or run: sets it", () => {
    const wired = workflowSetVars(
      [
        "env:",
        "  LOOM_WORKFLOW_LEVEL: '1'",
        "jobs:",
        "  a:",
        "    steps:",
        "      - run: LOOM_INLINE=1 npx vitest run x",
        "      - name: multi",
        "        run: |",
        "          LOOM_BLOCK=1 npm run test:y",
        "        env:",
        "          LOOM_STEP_ENV: '1'",
      ].join("\n"),
    );
    expect([...wired].sort()).toEqual([
      "LOOM_BLOCK",
      "LOOM_INLINE",
      "LOOM_STEP_ENV",
      "LOOM_WORKFLOW_LEVEL",
    ]);
  });

  it("a var named only in paths:, with:, a comment or a label is NOT wired", () => {
    const wired = workflowSetVars(
      [
        "on:",
        "  pull_request:",
        "    paths:",
        "      - 'test/LOOM_ONLY_IN_PATHS=x'",
        "      - LOOM_PATH_KEY: nope",
        "jobs:",
        "  a:",
        "    steps:",
        "      # LOOM_IN_COMMENT=1",
        "      - uses: some/action@v1",
        "        with:",
        "          LOOM_IN_WITH: '1'",
        "      - run: npm test",
      ].join("\n"),
    );
    expect([...wired]).toEqual([]);
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

  it("a workflow counts a script as invoked via npm run, a scripts: list or a script: cell", () => {
    const invoked = workflowInvokedScripts(
      [
        "      matrix:",
        "        include:",
        "          - backend: node",
        "            scripts: test:one test:two",
        "          - backend: py",
        "            script: test:three",
        "    steps:",
        "      - run: npm run -s test:four -- --reporter=verbose",
        "      - run: |",
        "          npm run test:five",
        "      # npm run test:commented",
        '      - run: npm run "$script"',
      ].join("\n"),
    );
    expect([...invoked].sort()).toEqual([
      "test:five",
      "test:four",
      "test:one",
      "test:three",
      "test:two",
    ]);
  });

  it("an invoked script's own `npm run` calls are invoked too", () => {
    const closure = scriptClosure(["a"], { a: "npm run b && echo", b: "npm run -s c", c: "x" });
    expect([...closure].sort()).toEqual(["a", "b", "c"]);
  });

  it("a gate script that nothing invokes is reported", () => {
    const scripts = {
      "test:wired": "LOOM_A=1 vitest run a",
      "test:orphan": "LOOM_B=1 vitest run b",
      "test:direct": "LOOM_C=1 vitest run c",
      "test:plain": "vitest run d",
    };
    expect(
      unwiredGateScripts(
        scripts,
        new Set(["test:wired"]),
        new Set(["LOOM_C"]),
        new Set(["LOOM_A", "LOOM_B", "LOOM_C"]),
      ),
    ).toEqual(["test:orphan"]);
  });

  it("every gate script is run by a workflow, or is on demand by design", () => {
    const gateVars = new Set(requiredGates.map((g) => g.varName));
    const unwired = unwiredGateScripts(rootScripts, invokedScripts, workflowSet, gateVars).filter(
      (n) => !(n in ON_DEMAND_SCRIPTS),
    );
    expect(
      unwired,
      `These package.json scripts set a skip-gate var, yet no workflow \`run:\` step ` +
        `invokes them (directly, or through a \`scripts:\` value):\n` +
        `${unwired.map((s) => `  ${s}`).join("\n")}\n` +
        "Run each from a workflow, or list it in ON_DEMAND_SCRIPTS with the reason.",
    ).toEqual([]);
  });

  it("every on-demand waiver is still needed", () => {
    const gateVars = new Set(requiredGates.map((g) => g.varName));
    const unwired = new Set(unwiredGateScripts(rootScripts, invokedScripts, workflowSet, gateVars));
    const stale = Object.keys(ON_DEMAND_SCRIPTS).filter((n) => !unwired.has(n));
    expect(stale, `stale ON_DEMAND_SCRIPTS entries (wired or gone): ${stale.join(", ")}`).toEqual(
      [],
    );
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
