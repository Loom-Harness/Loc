import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { corpusProjectDirs, materializeCorpusFixture } from "../fixtures/corpus/harness.js";
import { CORPUS } from "../fixtures/corpus/manifest.js";
import { limiter, PARALLELISM, sh, shResult } from "./support/parallel.js";

// ---------------------------------------------------------------------------
// Phase 1 compile tier (docs/old/plans/global-test-coverage-plan.md) for the Python
// (FastAPI / SQLAlchemy) backend — the sibling of `corpus-tsc-build.test.ts`.
// The fast `corpus-coverage` gate proves every corpus feature *generates* on
// `python`; this gate proves the emitted project is statically clean under
// `uv sync` + `ruff check` + `mypy --strict` (+ `pytest` when emitted tests
// exist) — the same `/warnaserror` bar the .NET gate sets — upgrading the
// corpus from a generation floor to a static-soundness guarantee on a THIRD
// backend, from the SAME single source of truth (one `.ddd` per feature, no
// per-backend duplicate).
//
// Slow — opt-in via LOOM_PYTHON_BUILD=1; LOOM_CORPUS_PYTHON_CASE=<feature-id>
// narrows it to one feature.  Requires uv on PATH.
//
// One job runs every feature, PARALLELISM at a time (support/parallel.ts).
// The per-feature cost is `mypy --strict` re-analysing FastAPI, SQLAlchemy
// and pydantic from a cold cache — ~8 s of every ~9 s.  So the suite warms one
// mypy cache on the first feature and copies it into each project before its
// run: third-party modules are cache hits (~1 s), and the project's own
// modules are still checked, because mypy re-validates every cache entry
// against its source's hash.  `uv sync` already shares uv's global cache, so a
// project's venv costs ~0.1 s once the first one is built.
// ---------------------------------------------------------------------------

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const cli = path.join(repoRoot, "bin", "cli.js");

const ENABLED = process.env.LOOM_PYTHON_BUILD === "1";
const CASE = process.env.LOOM_CORPUS_PYTHON_CASE;

// Features that GENERATE on python but aren't yet ruff-/mypy-clean — real
// Python generator gaps this compile tier surfaced (the generation gate still
// covers all of them on all six backends; each line is a precise, reproducible
// bug report).  Widen the gate by FIXING the emitter, then dropping the entry.
const PYTHON_COMPILE_SKIP: Record<string, string> = {
  // (workflow-view: workflow own-state `:=` is now lowered + emitted on python —
  //  `state.<field> = …` + session.flush — so it gates here.)
  // (provenance: now emitted + ruff-/mypy-clean on python — W2 — so it gates here.)
  // (value-collections: `<VO>[]` now persists to an id-less relational child
  //  table — flattened VO columns keyed by (parent_fk, ordinal), wholesale
  //  replace on save, ordinal-ordered hydrate — matching node/.NET/Java, so it
  //  gates here.)
};

// Every corpus feature the manifest declares to generate on `python`, minus the
// documented compile-tier skips.
const pythonFeatures = CORPUS.filter((f) => f.backends.includes("python"))
  .filter((f) => !(f.id in PYTHON_COMPILE_SKIP))
  .filter((f) => !CASE || f.id === CASE)
  .map((f) => f.id);

/** The warm mypy cache every project's run starts from (set in beforeAll). */
let seedCache: string | undefined;
const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), "loom-corpus-python-"));

/** Generate one feature's projects under a fresh dir; returns that dir. */
async function generate(featureId: string): Promise<string> {
  const outDir = fs.mkdtempSync(path.join(workRoot, `${featureId}-`));
  const src = materializeCorpusFixture(featureId, "python", outDir);
  await sh(`node ${cli} generate system ${src} -o ${outDir}`, { cwd: repoRoot, timeout: 300_000 });
  return outDir;
}

/** uv sync + ruff + mypy --strict (+ pytest) for one emitted project. */
async function checkProject(proj: string): Promise<void> {
  const run = (cmd: string) => sh(cmd, { cwd: proj, timeout: 300_000 });
  await run("uv sync");
  await run("uv run ruff check .");
  if (seedCache) fs.cpSync(seedCache, path.join(proj, ".mypy_cache"), { recursive: true });
  const hasTests = fs.existsSync(path.join(proj, "tests"));
  await run(`uv run mypy --strict app${hasTests ? " tests" : ""}`);
  if (hasTests) await run("uv run pytest -q");
}

const limit = limiter(PARALLELISM);

describe.skipIf(!ENABLED)("corpus features are statically clean (Python/FastAPI)", () => {
  beforeAll(async () => {
    if (pythonFeatures.length === 0) return;
    // Warm the cache on the first feature.  Its verdict is ignored here — the
    // feature is checked for real below — and its own `app`/`tests` entries
    // are dropped so the seed carries third-party analysis only.
    const outDir = await generate(pythonFeatures[0]);
    const proj = path.join(outDir, corpusProjectDirs(pythonFeatures[0])[0]);
    await sh("uv sync", { cwd: proj, timeout: 600_000 });
    await shResult("uv run mypy --strict app", { cwd: proj, timeout: 600_000 });
    const cache = path.join(proj, ".mypy_cache");
    if (!fs.existsSync(cache)) return;
    seedCache = path.join(workRoot, "mypy-seed");
    fs.cpSync(cache, seedCache, { recursive: true });
    for (const ver of fs.readdirSync(seedCache)) {
      const dir = path.join(seedCache, ver);
      if (!fs.statSync(dir).isDirectory()) continue;
      for (const entry of fs.readdirSync(dir)) {
        if (/^(app|tests)(\.|$)/.test(entry)) {
          fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
        }
      }
    }
  }, 900_000);

  afterAll(() => {
    fs.rmSync(workRoot, { recursive: true, force: true });
  });

  it.concurrent.each(pythonFeatures)(
    "%s — generated python project passes ruff + mypy --strict",
    (featureId) =>
      limit(async () => {
        const outDir = await generate(featureId);
        try {
          // One project per declared deployable (`d` for every single-service
          // fixture; a multi-service feature names both, and BOTH must compile).
          for (const dir of corpusProjectDirs(featureId)) {
            const proj = path.join(outDir, dir);
            expect(
              fs.existsSync(path.join(proj, "pyproject.toml")),
              `${featureId}: python project '${dir}' emitted`,
            ).toBe(true);
            await checkProject(proj);
          }
        } finally {
          fs.rmSync(outDir, { recursive: true, force: true });
        }
      }),
    1_800_000,
  );
});
