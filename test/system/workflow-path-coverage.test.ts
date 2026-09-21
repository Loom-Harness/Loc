// A gate that never runs is not a gate.
//
// WHY THIS EXISTS
// ---------------
// Every heavy CI gate narrows itself with a `paths:` filter so it only fires on
// a change that could plausibly break it.  That filter is hand-maintained, and
// it is written ONCE — when the workflow is added — against whatever the test
// imported that day.  The test's dependencies then grow, the filter doesn't,
// and the gate quietly stops firing for a widening slice of the compiler.
//
// The failure is invisible in exactly the way the surrounding work has been
// draining (#2384, #2387/#2391, #2393, #2394): the gate is green, the check
// name is in the list, the workflow file looks thorough — and for the change
// you just made, it never ran.  Worse than a vacuous assertion, because there
// is no assertion to inspect.
//
// When this test was written, ALL 27 path-filtered gates omitted
// `src/macros/**` and `src/util/**`.  So a change to `src/macros/prelude.ts` —
// which is where the `auditable`, `tenantOwned`, `versioned` and
// `tenantRegistry` capabilities are defined — fired none of them.  Neither did
// a change to `src/util/naming.ts` (`pascal`/`camel`/`snake`/`plural`) or
// `src/util/code-builder.ts` (`lines()`), both imported by every emitter on
// every backend.  That `auditable` is what landed there is not a coincidence:
// #2387 and #2391 were both audit-capability bugs on the Dapper path.
//
// THE INVARIANT
// -------------
// A workflow that (a) carries a `paths:` filter and (b) runs a test that
// generates a project must watch every dir on the GENERATION PATH:
//
//     parse -> macro expand -> lower -> enrich -> IR validate -> compose
//     language/   macros/      ir/                               system/
//                                    util/  (naming + code-builder + axes,
//                                            imported by every emitter)
//
// Those five run for EVERY backend, so no per-backend argument excuses one.
//
// THE SECOND INVARIANT — the shared generator seams
// -------------------------------------------------
// The first cut of this file waved the `src/generator/_*` dirs through with
// "those are genuinely per-target, and requiring them would produce false
// positives".  That rationale was exactly inverted, and the code-review of
// 2026-09-13 (P0-3) measured the hole it left: `java-build`, `dotnet-build`,
// `python-build`, `hono-build` and `corpus-elixir-build` each listed
// `src/generator/_expr/**` and NONE of the other sixteen shared seams, so a
// change to `_stmt/target.ts` (the `StmtIR` dispatcher every backend's leaf
// table plugs into) or `_payload/union-wire.ts` (the single source of truth
// for the tagged-union wire shape, consumed by all five backends) compiled no
// Elixir project on any per-PR gate.  The leading underscore means SHARED,
// not per-target — it is the opposite of the claim the exemption rested on.
//
// So: a workflow whose `paths:` claims a WHOLE platform generator tree
// (`src/generator/<plat>/**`) is claiming "any change to this backend's
// emitters could break me".  The shared seams that tree imports are part of
// that backend's emission — they were factored OUT of it — so the claim has to
// cover them too.  The required set is DERIVED, never listed here: it is the
// `src/generator/_*` dirs reachable in the import closure of the platform
// roots the workflow itself names, cut at the boundary of any platform dir it
// deliberately does NOT name (so `java-build` is not asked to watch the React
// body walker it only reaches through the SPA-embed branch it already
// excludes).  A workflow that wants to stay narrower escapes this rule by
// being MORE precise — naming the subdirs it really depends on, the way
// `elixir-vanilla-obs-e2e.yml` names `src/generator/elixir/vanilla/**` — never
// by being vaguer.
//
// THE THIRD INVARIANT — per trigger, not unioned
// ----------------------------------------------
// Both invariants above were once read off the UNION of a workflow's `paths:`
// blocks, and twenty workflows leaned on that union: they carried the four
// dirs `src/language/**`, `src/macros/**`, `src/system/**` and `src/util/**`
// on `push:` only, so a change to `src/util/naming.ts` fired none of them ON A
// PULL REQUEST.  Each trigger's block now stands on its own.  Only a
// `pull_request:` block may decline, via `PR_TIER_DECLARED` below, because it
// is the one tier with a fallback underneath it.  Full rationale and the cost
// measurements are at that register.
//
// "Runs a test that generates a project" is DERIVED, not declared: the entry
// points named by the workflow are walked transitively, and the workflow counts
// as a generation gate when that closure reaches `src/system/index.ts` or the
// built `out/system/index.js`, or spawns `bin/cli.js`.  Entry points are found
// through THREE indirections, each of which was once a blind spot that silently
// skipped a whole family (see `entryPoints`): a `test/**.test.ts` path, a `.mjs`
// driver run from a `run:` step (the `behavioral-e2e-*` legs), and an
// `npm run <script>` resolved in the step's own `working-directory`'s
// package.json (`playground-realm-check`).  So a workflow cannot fall out of
// scope by having its imports rearranged, nor by putting a process boundary, a
// build step or a nested workspace in the way.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const workflowsDir = path.join(repoRoot, ".github/workflows");
const generatorDir = path.join(repoRoot, "src/generator");

/** Per-platform generator trees — `src/generator/<plat>/`, no leading `_`. */
const PLATFORM_DIRS: readonly string[] = readdirSync(generatorDir).filter(
  (d) => !d.startsWith("_") && statSync(path.join(generatorDir, d)).isDirectory(),
);

/** Shared emission seams — `src/generator/_<seam>/`.  `_i18n` has a DIGIT in
 *  it, so the character class must not be `[a-z]+` (that silently dropped the
 *  one seam that decides validation-catalog membership for all five
 *  backends). */
const SEAM_RE = /^src\/generator\/(_[a-z0-9]+)\//;

/** The pipeline phases every `generate system` walks, whatever the backend. */
const GENERATION_PATH = [
  "src/language/**",
  "src/macros/**",
  "src/ir/**",
  "src/system/**",
  "src/util/**",
] as const;

/** The composition entry every generation path funnels through. */
const GENERATION_ENTRY = "src/system/index.ts";

// ---------------------------------------------------------------------------
// Workflows that carry a `paths:` filter but are legitimately NOT generation
// gates, or are scoped to one narrow artefact on purpose.  Each entry is a
// REASON, not a suppression: it must say why the generation path cannot break
// this workflow's subject.  Keep this list short — it is the pressure valve
// that decides whether this gate stays honest.
// ---------------------------------------------------------------------------
const EXEMPT: Record<string, string> = {
  "langium-generated.yml":
    "checks only that `langium:generate` output matches the grammar — it runs the generator, not the pipeline, and the closure below never reaches src/system/index.ts",
  "workflow-lint.yml": "lints .github/workflows/** itself; touches no Loom source",
};

// ---------------------------------------------------------------------------
// A deliberately small resolver for local ESM imports.  `src/**` is authored as
// `./x.js` specifiers over `.ts` sources, so `.js` is rewritten before probing.
// ---------------------------------------------------------------------------
function resolveSpec(fromFile: string, spec: string): string | undefined {
  if (!spec.startsWith(".")) return undefined;
  const raw = path.resolve(path.dirname(fromFile), spec);
  const base = raw.replace(/\.js$/, ".ts");
  // `raw` last, and only for `.mjs`: the behavioural case drivers are authored
  // as ESM `.mjs` and import each other by their real extension, so the
  // `.js -> .ts` rewrite above never applies to them.
  const candidates = [base, `${base}.ts`, path.join(base.replace(/\.ts$/, ""), "index.ts"), raw];
  return candidates.find((c) => existsSync(c) && /\.(ts|mjs)$/.test(c));
}

const IMPORT_RE = /(?:from|import)\s*\(?\s*["']([^"']+)["']/g;
/** A file that shells out to the CLI, or reaches the composer through the BUILT
 *  output rather than the sources, drives the whole pipeline all the same.
 *  `out/system/index.js` is `src/system/index.ts` with a `tsc` in between —
 *  `web/scripts/smoke-runtime.mjs` imports exactly that, and the source-only
 *  closure could never see it. */
const DRIVES_GENERATION_RE = /cli\.js|out\/cli\/main\.js|out\/system\/index\.js/;

interface Closure {
  /** Every repo-relative `src/**` file reachable from the entry points. */
  readonly files: ReadonlySet<string>;
  /** True when some visited file drives generation (in-process or via the CLI). */
  readonly generates: boolean;
}

function closureOf(entries: readonly string[]): Closure {
  const seen = new Set<string>();
  let spawnsCli = false;

  const walk = (file: string): void => {
    if (seen.has(file)) return;
    seen.add(file);
    let source: string;
    try {
      source = readFileSync(file, "utf8");
    } catch {
      return;
    }
    if (DRIVES_GENERATION_RE.test(source)) spawnsCli = true;
    IMPORT_RE.lastIndex = 0;
    let m = IMPORT_RE.exec(source);
    while (m) {
      const target = resolveSpec(file, m[1]);
      if (target) walk(target);
      m = IMPORT_RE.exec(source);
    }
  };

  for (const e of entries) walk(path.join(repoRoot, e));

  const files = new Set([...seen].map((f) => path.relative(repoRoot, f).split(path.sep).join("/")));
  return { files, generates: spawnsCli || files.has(GENERATION_ENTRY) };
}

// ---------------------------------------------------------------------------
// Workflow reading — the same indentation-disciplined approach as
// `merge-queue-readiness.test.ts` (no YAML parser resolves in this repo's
// dependency tree).  Two things are extracted: the positive `paths:` globs
// under every trigger, and the test entry points the jobs run.
// ---------------------------------------------------------------------------

/** Positive `paths:` globs across all triggers (`!`-negations are ignored:
 *  they only ever SHRINK coverage, and a shrink is not what this gate is
 *  looking for). */
function globsByTrigger(source: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  let trigger: string | undefined;
  let inOn = false;
  let inPaths = false;
  let keyIndent = 0;
  for (const raw of source.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (/^\s*#/.test(line)) continue;
    if (/^on:\s*$/.test(line)) {
      inOn = true;
      continue;
    }
    if (inOn && /^\S/.test(line)) inOn = false;
    if (inOn) {
      const t = line.match(/^ {2}([a-z_]+):/);
      if (t) {
        trigger = t[1];
        if (!out.has(trigger)) out.set(trigger, []);
        inPaths = false;
      }
    }
    const header = line.match(/^(\s*)paths(-ignore)?:\s*$/);
    if (header) {
      inPaths = header[2] === undefined;
      keyIndent = header[1].length;
      continue;
    }
    if (!inPaths) continue;
    const item = line.match(/^(\s*)-\s*'([^']+)'\s*$/);
    if (item && item[1].length > keyIndent) {
      if (!item[2].startsWith("!") && trigger) out.get(trigger)?.push(item[2]);
      continue;
    }
    // Any non-list line at or above the `paths:` indent ends the block.
    if (line.trim() !== "") inPaths = false;
  }
  return out;
}

/** Positive `paths:` globs across all triggers — the UNION.  Used only to ask
 *  "does this workflow filter on paths at all"; every coverage assertion below
 *  reads the per-trigger buckets instead, because the union is what hid the
 *  hole this file's third invariant closes. */
const pathGlobs = (source: string): string[] => [
  ...new Set([...globsByTrigger(source).values()].flat()),
];

/** `scripts` of the `package.json` at a repo-relative dir ("" = the root).
 *  A step with `working-directory: web` resolves `npm run e2e:realm` in
 *  `web/package.json`, which the root-only lookup could never see. */
const pkgScripts = (() => {
  const cache = new Map<string, Record<string, string>>();
  return (wd: string): Record<string, string> => {
    const cached = cache.get(wd);
    if (cached) return cached;
    const p = path.join(repoRoot, wd, "package.json");
    const scripts = existsSync(p)
      ? ((JSON.parse(readFileSync(p, "utf8")) as { scripts?: Record<string, string> }).scripts ??
        {})
      : {};
    cache.set(wd, scripts);
    return scripts;
  };
})();

/**
 * Everything a workflow RUNS that could drive generation: `test/**.test.ts`
 * paths named inline, `.mjs` drivers invoked from a `run:` step, and both of
 * those reached through an `npm run <script>` indirection.
 *
 * THE BUG THIS CLOSES.  Everything in this file keys on "does this workflow
 * drive generation", and that was derived from two signals only: a resolved
 * `test/**.test.ts` entry point, or an inline `bin/cli.js generate` in the
 * workflow source.  The `behavioral-e2e-*.yml` legs are neither — each runs
 * `node run-<backend>.mjs`, and THAT file spawns the CLI.  So six of the seven
 * scored as non-generation gates and EVERY assertion here skipped them in
 * silence, the shared-seam requirement (P0-3) included.  A skipped assertion is
 * indistinguishable from a passing one in the report, which is the purest form
 * of the failure this file exists to catch: the gate never reached the thing it
 * names.  `playground-realm-check.yml` was a third variant of the same
 * blindness — `npm run e2e:realm` resolved in `web/package.json`, driving
 * generation through the BUILT `out/system/index.js`.
 *
 * Comment lines are stripped — a workflow that merely *mentions* a test path in
 * a comment does not run it.  (This bit immediately: the rationale comments
 * these `paths:` blocks carry name this very file.)  A step's
 * `working-directory:` is tracked, a `$GITHUB_WORKSPACE/` prefix is stripped,
 * and only a path that really exists is kept.
 */
function entryPoints(yaml: string): string[] {
  const found = new Set<string>();
  const addFrom = (text: string, workdir: string): void => {
    for (const m of text.matchAll(/(test\/[\w./-]+\.test\.ts)/g)) {
      const rel = [path.join(workdir, m[1]), m[1]].find((c) => existsSync(path.join(repoRoot, c)));
      if (rel) found.add(rel.split(path.sep).join("/"));
    }
    // `.mjs` only when something on the line actually runs node — otherwise a
    // `paths:` entry naming a script would read as an entry point.
    for (const raw of text.split("\n")) {
      if (!/\bnode\b/.test(raw)) continue;
      for (const m of raw.matchAll(/([\w./-]+\.mjs)\b/g)) {
        const rel = [path.join(workdir, m[1]), m[1]].find((c) =>
          existsSync(path.join(repoRoot, c)),
        );
        if (rel) found.add(rel.split(path.sep).join("/"));
      }
    }
  };

  let workdir = "";
  for (const raw of yaml.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (/^\s*#/.test(line)) continue;
    // A new list item starts a new step, so its predecessor's
    // `working-directory:` stops applying.
    if (/^\s+-\s/.test(line)) workdir = "";
    const wd = line.match(/^\s*-?\s*working-directory:\s*['"]?([^'"\s]+)/);
    if (wd) workdir = wd[1];
    addFrom(line, workdir);
    for (const m of line.matchAll(/npm run ([\w:-]+)/g)) {
      const script = pkgScripts(workdir)[m[1]] ?? pkgScripts("")[m[1]];
      if (script) addFrom(script, workdir);
    }
  }
  return [...found];
}

/** Does `glob` cover EVERY file under `dir/`?  Only a `dir/**` (or a wider
 *  ancestor) does — a single-file pin like `src/ir/lower/lower.ts` covers one
 *  file and leaves the rest of the phase dark, which is precisely the drift
 *  this gate is about. */
function watchesTree(globs: readonly string[], tree: string): boolean {
  const dir = tree.replace(/\*\*$/, "");
  return globs.some((g) => g.endsWith("**") && dir.startsWith(g.slice(0, -2)));
}

// ---------------------------------------------------------------------------
// The shared-seam requirement.
// ---------------------------------------------------------------------------

/** Every `.ts` under `p` (or `p` itself when it names a file). */
function tsFilesUnder(p: string): string[] {
  if (!existsSync(p)) return [];
  if (!statSync(p).isDirectory()) return p.endsWith(".ts") ? [p] : [];
  const out: string[] = [];
  for (const entry of readdirSync(p)) out.push(...tsFilesUnder(path.join(p, entry)));
  return out;
}

const repoRel = (f: string): string => path.relative(repoRoot, f).split(path.sep).join("/");

/**
 * The `src/generator/_*` seams a workflow's own platform claims reach.
 *
 * The roots are the WHOLE-TREE platform claims in its `paths:`
 * (`src/generator/<plat>/**`) plus any `src/platform/<x>` it names; the walk
 * stops at every platform generator dir the workflow did NOT claim, so a seam
 * reachable only through a backend this gate deliberately ignores is not
 * required.  A workflow that names no whole platform tree requires nothing —
 * precision is the escape hatch, vagueness is not.
 */
function sharedSeams(globs: readonly string[]): string[] {
  const declared = new Set<string>();
  const roots: string[] = [];
  for (const g of globs) {
    const gen = g.match(/^src\/generator\/([a-z0-9]+)\/\*\*$/);
    if (gen) {
      declared.add(gen[1]);
      roots.push(`src/generator/${gen[1]}`);
      continue;
    }
    if (/^src\/platform\/[a-z0-9]+(\.ts$|\/)/.test(g)) {
      roots.push(g.replace(/\*\*$/, "").replace(/\/$/, ""));
    }
  }
  if (!declared.size) return [];

  const seen = new Set<string>();
  const seams = new Set<string>();
  const walk = (file: string): void => {
    if (seen.has(file)) return;
    seen.add(file);
    const seam = repoRel(file).match(SEAM_RE);
    if (seam) seams.add(seam[1]);
    let source: string;
    try {
      source = readFileSync(file, "utf8");
    } catch {
      return;
    }
    IMPORT_RE.lastIndex = 0;
    let m = IMPORT_RE.exec(source);
    while (m) {
      const target = resolveSpec(file, m[1]);
      if (target) {
        const plat = repoRel(target).match(/^src\/generator\/([a-z0-9]+)\//);
        const foreign = plat && PLATFORM_DIRS.includes(plat[1]) && !declared.has(plat[1]);
        if (!foreign) walk(target);
      }
      m = IMPORT_RE.exec(source);
    }
  };
  for (const r of roots) for (const f of tsFilesUnder(path.join(repoRoot, r))) walk(f);
  return [...seams].sort();
}

// ---------------------------------------------------------------------------
// THE THIRD INVARIANT — per TRIGGER, not unioned.
// ---------------------------------------------------------------------------
// The two invariants above were read off the UNION of a workflow's `paths:`
// blocks, and several workflows lean on that union deliberately
// (`elixir-vanilla-obs-e2e.yml` says so in a comment: "the coverage test unions
// globs across triggers, so this block only needs the per-PR blast radius").
// Measured per trigger instead, TWENTY workflows carried the four dirs
// `src/language/**`, `src/macros/**`, `src/system/**` and `src/util/**` on
// `push:` only — so a change confined to `src/util/naming.ts`, which every
// emitter on every backend imports, fired NONE of them on a PR.  That is P0-3
// one level down: the gate's name is on the pull request, and for that change
// it never ran.
//
// So each trigger's own block must stand on its own.  A `pull_request:` block —
// and ONLY a `pull_request:` block — may decline, because it is the one tier
// with something underneath it: the workflow's own `push: main` run.  Declining
// is a REGISTER ENTRY (`PR_TIER_DECLARED`), not silence, and the register can
// only be used by a workflow that really has that fallback and whose fallback
// block really is compliant.  Every other trigger has nothing below it, so
// there is no waiver to grant.

interface TierDeclaration {
  /** Why this leg accepts a post-merge-only tier for the generation path. */
  readonly reason: string;
  /** Measured runner-minutes for ONE firing (median job wall-clock over the
   *  last 5+ successful runs).  A cheap gate has no cost argument to make, so
   *  the register refuses one. */
  readonly costMin: number;
  /** ISO date `costMin` was measured.  A cost claim rots — the register fails
   *  once it is older than 180 days, so the BUDGET gets re-measured even though
   *  the decision itself is standing.  (CR1-d's lesson, applied to the input
   *  rather than the verdict: 23 census waivers became permanent invisibly
   *  because nothing ever re-evaluated what they rested on.) */
  readonly measured: string;
}

/**
 * Workflows whose `pull_request:` block is knowingly narrower than the
 * generation path.
 *
 * THE SPLIT, and the numbers behind it (measured 2026-09-21 via the Actions
 * API, median job wall-clock over the last 5–11 successful runs).  Twenty
 * workflows were asymmetric.  Fifteen cost 1.0–4.7 runner-minutes a firing —
 * the ten `*-obs-e2e`/`*-oidc-e2e`/`*-vo-e2e` legs, the four
 * `generated-*-e2e` SPA smokes, `behavioral-heex-ui-e2e` — plus the ~1-minute
 * `playground-realm-check`.  Together they add ~32 runner-minutes on the ~14 %
 * of `src/**` PRs that touch these four dirs and NOT `src/ir/**` (17 of 123
 * first-parent commits, 2026-09-01..21), so their blocks were simply fixed.
 *
 * The six `behavioral-e2e-*` legs are the other tier: 5.0–13.1 runner-minutes
 * EACH, ~58 together, and they fire as one family because they share their
 * path claims — six simultaneous slots out of a shared ~20, on a leg family
 * that is already this repo's timeout problem child (see the COST MODEL and
 * `timeout-minutes` notes in `behavioral-e2e-java.yml`).  Reversing that
 * unilaterally is a runner-budget decision, not a bug fix.  It is declared here
 * instead, so it is reviewable and so a NEW workflow cannot drift into the same
 * shape in silence.
 */
const PR_TIER_DECLARED: Record<string, TierDeclaration> = {
  "behavioral-e2e-dapper.yml": {
    reason:
      "behavioural family: boots the generated .NET backend on the Dapper adapter against a postgres sidecar, one project build per corpus case; the six legs share path claims and fire together (~58 runner-min, 6 of ~20 slots). Post-merge `push: main` block carries the full generation path.",
    costMin: 7.8,
    measured: "2026-09-21",
  },
  "behavioral-e2e-dotnet.yml": {
    reason:
      "behavioural family: boots the generated .NET backend against a postgres sidecar, one project build per corpus case; fires with its five siblings. Post-merge `push: main` block carries the full generation path.",
    costMin: 8.9,
    measured: "2026-09-21",
  },
  "behavioral-e2e-elixir.yml": {
    reason:
      "behavioural family: boots the generated Phoenix release against a postgres sidecar and needs hex egress, one mix compile per corpus case. Post-merge `push: main` block carries the full generation path.",
    costMin: 12.6,
    measured: "2026-09-21",
  },
  "behavioral-e2e-java.yml": {
    reason:
      "behavioural family and the most expensive leg in it — a Gradle build plus a Spring Boot start per corpus case; its own file documents a 20->30 min cap raise after the cap censored 13 of 74 runs. Post-merge `push: main` block carries the full generation path.",
    costMin: 13.1,
    measured: "2026-09-21",
  },
  "behavioral-e2e-mikroorm.yml": {
    reason:
      "behavioural family: the node backend on the MikroORM adapter, booted against a real postgres because @mikro-orm/postgresql cannot use PGlite. Post-merge `push: main` block carries the full generation path.",
    costMin: 10.9,
    measured: "2026-09-21",
  },
  "behavioral-e2e-python.yml": {
    reason:
      "behavioural family: boots the generated FastAPI backend against a postgres sidecar. Cheapest of the six at ~5 min, but it fires as part of the same family burst and there is no per-leg path claim that would separate it. Post-merge `push: main` block carries the full generation path.",
    costMin: 5.0,
    measured: "2026-09-21",
  },
};

/** A cost claim below this has no budget argument to make — fix the block. */
const DECLARABLE_MIN_MINUTES = 4;
/** A cost claim older than this must be re-measured. */
const COST_CLAIM_MAX_AGE_DAYS = 180;

interface Gate {
  readonly file: string;
  readonly globs: readonly string[];
  readonly byTrigger: ReadonlyMap<string, readonly string[]>;
  readonly entries: readonly string[];
  readonly closure: Closure;
  /** True when the workflow drives generation itself — a `run:` step calling
   *  `node bin/cli.js generate …` with no test file in between.  Found the hard
   *  way: the first cut of this gate keyed only on resolved `test/**.test.ts`
   *  entry points, and `generated-{feliz,flutter}-build` — which generate
   *  straight from a `run:` step — fell out of scope entirely.  That is the
   *  same "looked covered, wasn't" shape this file is about, so it is checked
   *  from the workflow SOURCE rather than inferred from its tests. */
  readonly generatesInline: boolean;
}

const gates: Gate[] = readdirSync(workflowsDir)
  .filter((f) => f.endsWith(".yml"))
  .sort()
  .map((file) => {
    const source = readFileSync(path.join(workflowsDir, file), "utf8");
    const entries = entryPoints(source);
    return {
      file,
      globs: pathGlobs(source),
      byTrigger: globsByTrigger(source),
      entries,
      closure: closureOf(entries),
      generatesInline: /bin\/cli\.js\s+generate/.test(source),
    };
  })
  .filter((g) => g.globs.length > 0);

const generates = (g: Gate): boolean => g.closure.generates || g.generatesInline;
const generationGates = gates.filter((g) => generates(g) && !(g.file in EXEMPT));

describe("workflow path filters cover the generation path", () => {
  it("finds the path-filtered generation gates (the reader still works)", () => {
    // If the reader silently stops recognising workflows, every assertion below
    // passes over an empty set — this gate's own vacuous-success mode. Pin it.
    expect(generationGates.length).toBeGreaterThan(10);
    expect(gates.every((g) => g.globs.length > 0)).toBe(true);
  });

  for (const gate of generationGates) {
    /** The triggers whose own `paths:` block has to stand on its own — every
     *  one that filters, minus a `pull_request:` block this workflow has
     *  declared in `PR_TIER_DECLARED`. */
    const checkedTriggers = (): [string, readonly string[]][] =>
      [...gate.byTrigger]
        .filter(([, g]) => g.length > 0)
        .filter(([t]) => !(t === "pull_request" && gate.file in PR_TIER_DECLARED));

    it(`${gate.file} watches every pipeline phase it depends on, per trigger`, () => {
      const holes = checkedTriggers()
        .map(([t, g]) => [t, GENERATION_PATH.filter((tree) => !watchesTree(g, tree))] as const)
        .filter(([, missing]) => missing.length > 0)
        .map(([t, missing]) => `${t}: ${missing.join(", ")}`);
      expect(
        holes,
        `${gate.file} filters on \`paths:\` but a trigger's OWN block does not watch:\n` +
          `  ${holes.join("\n  ")}\n` +
          `It drives \`generate system\` (${
            gate.generatesInline
              ? "a `run:` step invokes bin/cli.js directly"
              : `via ${gate.entries.join(", ")}`
          }) — so a change confined to an unwatched phase cannot trigger this ` +
          "gate on that event, and it will not run for that change at all.\n" +
          "Globs are NOT unioned across triggers here: a `push: main` block does not " +
          "cover the pull request, which is where the gate's name is shown.\n" +
          "Add the missing globs to THAT trigger's block; or, for a `pull_request:` " +
          "block on an expensive leg, add a measured entry to PR_TIER_DECLARED in this " +
          "file; or add a reasoned entry to EXEMPT.",
      ).toEqual([]);
    });

    it(`${gate.file} watches every shared generator seam its platforms delegate into, per trigger`, () => {
      const holes = checkedTriggers()
        .map(
          ([t, g]) =>
            [
              t,
              sharedSeams(g).filter((seam) => !watchesTree(g, `src/generator/${seam}/**`)),
            ] as const,
        )
        .filter(([, missing]) => missing.length > 0)
        .map(([t, missing]) => `${t}: ${missing.map((s) => `src/generator/${s}/**`).join(", ")}`);
      expect(
        holes,
        `${gate.file} claims a whole platform generator tree in a trigger's block but ` +
          `that same block does not watch:\n  ${holes.join("\n  ")}\n` +
          "Those are SHARED emission seams that tree imports — `_stmt` is the StmtIR " +
          "dispatcher each backend's leaf table plugs into, `_payload/union-wire.ts` the " +
          "one tagged-union wire shape all five backends emit, `_i18n` the collector that " +
          "decides validation-catalog membership.  A change confined to one of them " +
          "changes what this gate compiles and cannot trigger it on that event.\n" +
          "Add the missing globs next to the platform claim in THAT trigger's `paths:` " +
          "block, or narrow the platform claim to the subdirs this gate really depends " +
          "on (the way elixir-vanilla-obs-e2e.yml names src/generator/elixir/vanilla/**).",
      ).toEqual([]);
    });
  }

  // -------------------------------------------------------------------------
  // PR_TIER_DECLARED hygiene.  The register is the pressure valve for the
  // third invariant, so it gets the same treatment EXEMPT does — and one thing
  // EXEMPT cannot have: a structural check on the claim itself.
  // -------------------------------------------------------------------------
  it("every PR_TIER_DECLARED entry names a real generation gate and carries a measured cost", () => {
    for (const [file, d] of Object.entries(PR_TIER_DECLARED)) {
      const gate = generationGates.find((g) => g.file === file);
      expect(gate, `${file} is not a path-filtered generation gate`).toBeDefined();
      expect(d.reason.trim().length, `${file} needs a reason`).toBeGreaterThan(40);
      expect(
        d.costMin,
        `${file} declares ${d.costMin} runner-min — below ${DECLARABLE_MIN_MINUTES}, so it ` +
          "has no budget argument to make.  Fix the pull_request block instead.",
      ).toBeGreaterThanOrEqual(DECLARABLE_MIN_MINUTES);
      expect(d.measured, `${file}: measured must be an ISO date`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const ageDays = (Date.now() - Date.parse(d.measured)) / 86_400_000;
      expect(
        ageDays,
        `${file}'s cost claim was measured on ${d.measured}, over ${COST_CLAIM_MAX_AGE_DAYS} ` +
          "days ago.  Re-measure it (median job wall-clock over the last 5+ successful " +
          "runs) and update the entry — a budget argument resting on a stale number is " +
          "the shape this wave exists to drain.",
      ).toBeLessThan(COST_CLAIM_MAX_AGE_DAYS);
    }
  });

  it("every PR_TIER_DECLARED entry really has the post-merge tier it falls back on", () => {
    // The whole claim is "this runs on `push: main` instead".  If that block
    // does not exist, or does not itself cover the generation path and the
    // seams, the declaration is not a tiering decision — it is a hole.
    for (const file of Object.keys(PR_TIER_DECLARED)) {
      const gate = generationGates.find((g) => g.file === file);
      if (!gate) continue;
      const push = gate.byTrigger.get("push") ?? [];
      expect(
        push.length,
        `${file} declares a post-merge fallback but has no push paths`,
      ).toBeGreaterThan(0);
      const missing = [
        ...GENERATION_PATH.filter((tree) => !watchesTree(push, tree)),
        ...sharedSeams(push)
          .filter((s) => !watchesTree(push, `src/generator/${s}/**`))
          .map((s) => `src/generator/${s}/**`),
      ];
      expect(
        missing,
        `${file}'s pull_request block is declared post-merge-only, but its push block ` +
          `does not cover ${missing.join(", ")} either — so nothing covers it at all.`,
      ).toEqual([]);
    }
  });

  it("no PR_TIER_DECLARED entry is stale — a compliant block must drop its entry", () => {
    // The register RATCHETS: once a leg's pull_request block satisfies the
    // invariant on its own, the declaration is dead weight that would hide the
    // next regression.  Deleting it is a one-line change.
    const stale = Object.keys(PR_TIER_DECLARED).filter((file) => {
      const gate = generationGates.find((g) => g.file === file);
      if (!gate) return false;
      const pr = gate.byTrigger.get("pull_request") ?? [];
      if (pr.length === 0) return true; // no PR paths filter at all: nothing to decline
      const missing = [
        ...GENERATION_PATH.filter((tree) => !watchesTree(pr, tree)),
        ...sharedSeams(pr).filter((s) => !watchesTree(pr, `src/generator/${s}/**`)),
      ];
      return missing.length === 0;
    });
    expect(
      stale,
      `These PR_TIER_DECLARED entries no longer decline anything — delete them: ${stale}`,
    ).toEqual([]);
  });

  it("every EXEMPT entry names a real workflow and carries a reason", () => {
    for (const [file, reason] of Object.entries(EXEMPT)) {
      expect(existsSync(path.join(workflowsDir, file)), `${file} does not exist`).toBe(true);
      expect(reason.trim().length, `${file} needs a reason`).toBeGreaterThan(20);
    }
  });

  it("no EXEMPT entry is stale — an exempt workflow must not be a generation gate", () => {
    // An exemption granted because "this doesn't generate" has to stay true.
    // If the workflow later starts driving the pipeline, the exemption is
    // silently hiding a real hole.
    const stale = Object.keys(EXEMPT).filter((f) => {
      const g = gates.find((x) => x.file === f);
      return g !== undefined && generates(g);
    });
    expect(stale, `EXEMPT claims these don't generate, but their closure does: ${stale}`).toEqual(
      [],
    );
  });
});

describe("the closure walker resolves what it claims to", () => {
  // The walker is the whole gate: if it resolved nothing, every workflow would
  // read as "not a generation gate" and this suite would pass while checking
  // nothing.  Pin it against a known-shaped fixture from the tree.
  it("reaches the pipeline from a test that spawns the CLI", () => {
    const c = closureOf(["test/e2e/corpus-dotnet-build.test.ts"]);
    expect(c.generates).toBe(true);
    expect(c.files.has("src/macros/prelude.ts")).toBe(true);
    expect(c.files.has("src/util/naming.ts")).toBe(true);
  });

  it("reaches the pipeline from a test that imports the composer directly", () => {
    const c = closureOf(["test/conformance/behavioural-coverage.test.ts"]);
    expect(c.generates).toBe(true);
    expect(c.files.has(GENERATION_ENTRY)).toBe(true);
  });

  it("recognises a workflow that generates from a `run:` step, with no test file", () => {
    // generated-{feliz,flutter}-build run `node bin/cli.js generate system`
    // directly. They resolve NO test entry point, so a closure-only reader
    // scores them as non-generation gates and skips them silently — which is
    // exactly what the first cut of this file did.
    const inline = gates.filter(
      (g) => g.generatesInline && !g.entries.some((e) => e.endsWith(".test.ts")),
    );
    expect(inline.map((g) => g.file)).toContain("generated-feliz-build.yml");
    expect(inline.map((g) => g.file)).toContain("generated-flutter-build.yml");
  });

  it("recognises a workflow that generates through a `.mjs` case driver", () => {
    // The `behavioral-e2e-*` legs run `node run-<backend>.mjs`; the CLI spawn
    // is inside THAT file, not the workflow.  Before `mjsDrivers`, six of the
    // seven resolved no entry point at all and every assertion above skipped
    // them without a word.  Pin BOTH halves — that they are seen at all, and
    // that the driver is what makes them generation gates (not a `.test.ts`
    // and not an inline `bin/cli.js`).
    const family = gates.filter((g) => g.file.startsWith("behavioral-e2e-"));
    expect(family.length).toBeGreaterThanOrEqual(6);
    for (const g of family) {
      expect(generates(g), `${g.file} is not recognised as a generation gate`).toBe(true);
      expect(g.generatesInline, `${g.file} names bin/cli.js inline after all`).toBe(false);
      expect(
        g.entries.filter((e) => e.endsWith(".mjs")),
        `${g.file} resolves no .mjs driver`,
      ).not.toEqual([]);
    }
    // The driver itself must reach the CLI — otherwise `generates` is riding
    // on some other signal and this pin proves nothing.
    expect(closureOf(["test/behavioral/run-java.mjs"]).generates).toBe(true);
  });

  it("sharedSeams finds the seams a backend claim really reaches", () => {
    // The whole shared-seam assertion is this function: if it returned [] for
    // everything the requirement would be vacuous and every gate would pass.
    // Pin it against the two seams the 2026-09-13 review measured as dark.
    const seams = sharedSeams(["src/generator/java/**", "src/platform/java.ts"]);
    expect(seams).toContain("_payload"); // java/emit/api.ts -> _payload/union-wire.ts
    expect(seams).toContain("_stmt"); // java/render-stmt.ts -> _stmt/leaves.ts
    expect(seams).toContain("_i18n"); // java/index.ts -> _i18n/validation-catalog.ts
    expect(seams.length).toBeGreaterThan(10);
  });

  it("sharedSeams cuts at a platform tree the workflow does not claim", () => {
    // `src/generator/java/index.ts` imports the React/Vue/Svelte/Angular
    // generators to emit the embedded ClientApp bundle.  java-build does not
    // watch those trees and does not compile that bundle, so the body walker
    // they pull in is NOT its business — requiring it would be the false
    // positive the original exemption feared.
    expect(sharedSeams(["src/generator/java/**"])).not.toContain("_walker");
    // …but a workflow that DOES claim a frontend tree gets the walker.
    expect(sharedSeams(["src/generator/react/**"])).toContain("_walker");
  });

  it("sharedSeams requires nothing of a workflow that claims no platform tree", () => {
    // Precision is the escape hatch: name subdirs, not the whole tree.
    expect(sharedSeams(["src/generator/elixir/vanilla/**", "src/generator/_obs/**"])).toEqual([]);
    expect(sharedSeams(["src/ir/**", "src/system/**"])).toEqual([]);
  });

  it("follows `npm run` into a nested package.json, and the BUILT composer", () => {
    // The third variant of the same blindness: `playground-realm-check.yml`
    // runs `npm run e2e:realm` with `working-directory: web`, so the script
    // lives in `web/package.json` — invisible to a root-only lookup — and the
    // driver it names reaches the composer through `out/system/index.js`, not
    // `src/`.  Both halves are needed; pin both.
    const src = readFileSync(path.join(workflowsDir, "playground-realm-check.yml"), "utf8");
    expect(
      entryPoints(src),
      "the `npm run e2e:realm` indirection through web/package.json is not being followed",
    ).toContain("web/scripts/smoke-runtime.mjs");
    const c = closureOf(["web/scripts/smoke-runtime.mjs"]);
    expect(
      c.generates,
      "smoke-runtime.mjs reaches the composer only through the BUILT out/system/index.js — " +
        "DRIVES_GENERATION_RE must keep its `out/` arm",
    ).toBe(true);
    // …and it must NOT be reached through `src/system/index.ts` — otherwise
    // this pin would pass with that `out/` arm removed.
    expect(
      c.files.has(GENERATION_ENTRY),
      "if this is now reachable through src/, the pin above proves nothing — repoint it",
    ).toBe(false);
    expect(generationGates.map((g) => g.file)).toContain("playground-realm-check.yml");
  });

  it("globsByTrigger really separates the triggers (the union is not what is read)", () => {
    // The third invariant is entirely this function.  If it collapsed every
    // block into one bucket, every per-trigger assertion would silently fall
    // back to the union — the exact behaviour those assertions replace — and
    // the suite would stay green while checking nothing.
    const src = readFileSync(path.join(workflowsDir, "behavioral-e2e-java.yml"), "utf8");
    const byTrigger = globsByTrigger(src);
    expect([...byTrigger.keys()]).toEqual(
      expect.arrayContaining(["push", "pull_request", "workflow_dispatch"]),
    );
    const push = byTrigger.get("push") ?? [];
    const pr = byTrigger.get("pull_request") ?? [];
    // The measured asymmetry itself: the union says "covered", the PR block
    // says otherwise.  If these two ever agree, this pin has stopped proving
    // anything and needs a different fixture.
    expect(watchesTree(pathGlobs(src), "src/util/**")).toBe(true);
    expect(watchesTree(push, "src/util/**")).toBe(true);
    expect(watchesTree(pr, "src/util/**")).toBe(false);
    // …and a trigger with no `paths:` (workflow_dispatch) contributes nothing.
    expect(byTrigger.get("workflow_dispatch")).toEqual([]);
  });

  it("the per-trigger check is not degenerate — most gates really have two filtered blocks", () => {
    const multi = generationGates.filter(
      (g) => [...g.byTrigger.values()].filter((v) => v.length > 0).length > 1,
    );
    expect(multi.length).toBeGreaterThan(20);
    expect(Object.keys(PR_TIER_DECLARED).length).toBeGreaterThan(0);
  });

  it("watchesTree accepts a tree glob and rejects a single-file pin", () => {
    expect(watchesTree(["src/ir/**"], "src/ir/**")).toBe(true);
    expect(watchesTree(["src/**"], "src/macros/**")).toBe(true);
    expect(watchesTree(["src/ir/lower/lower.ts"], "src/ir/**")).toBe(false);
    expect(watchesTree(["src/generator/**"], "src/util/**")).toBe(false);
  });
});
