import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { corpusProjectDirs, generateCorpusCase } from "../fixtures/corpus/harness.js";
import { CORPUS } from "../fixtures/corpus/manifest.js";
import { installGeneratedProject } from "./support/npm-install.js";
import { limiter, PARALLELISM, sh } from "./support/parallel.js";

// ---------------------------------------------------------------------------
// Phase 1 compile tier (https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/old/plans/global-test-coverage-plan.md) for the
// reference backend (Hono/TS).  The fast `corpus-coverage` gate proves every
// corpus feature *generates* on `node`; this gate proves the emitted project
// actually *type-checks* under strict `tsc` — upgrading the corpus from a
// generation floor to a compile guarantee, from the SAME single source of
// truth (one `.ddd` per feature, no per-backend duplicate).
//
// Slow — opt-in via LOOM_TS_BUILD=1; LOOM_CORPUS_TSC_CASE=<feature-id> narrows
// it to one feature.
//
// One job runs every feature, PARALLELISM at a time (support/parallel.ts).
// The per-feature cost was a full `npm install` into each generated project,
// though nearly every project declares the same dependency set.  So each
// distinct set — the exact `dependencies` + `devDependencies` + `overrides`,
// never a superset, so an undeclared import still fails — is installed once
// and its `node_modules` symlinked into every project that declares it.
// ---------------------------------------------------------------------------

const ENABLED = process.env.LOOM_TS_BUILD === "1";
const CASE = process.env.LOOM_CORPUS_TSC_CASE;

// Features that GENERATE on node but don't yet `tsc`-compile under strict mode —
// real Hono generator gaps this compile tier surfaced (the generation gate still
// covers all of them on all six backends; each line is a precise, reproducible
// bug report).  Widen the gate by FIXING the emitter, then dropping the entry.
const TS_COMPILE_SKIP: Record<string, string> = {};

// Every corpus feature the manifest declares to generate on `node`, minus the
// documented compile-tier skips.
const nodeFeatures = CORPUS.filter((f) => f.backends.includes("node"))
  .filter((f) => !(f.id in TS_COMPILE_SKIP))
  .filter((f) => !CASE || f.id === CASE)
  .map((f) => f.id);

const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), "loom-corpus-tsc-"));

/** One install per distinct dependency set, keyed by its hash. */
const installs = new Map<string, Promise<string>>();

/** The shared `node_modules` for a project's exact dependency set. */
function sharedNodeModules(proj: string): Promise<string> {
  const pkg = JSON.parse(fs.readFileSync(path.join(proj, "package.json"), "utf8"));
  const deps = {
    dependencies: pkg.dependencies ?? {},
    devDependencies: pkg.devDependencies ?? {},
    overrides: pkg.overrides ?? {},
  };
  const sig = createHash("sha256").update(JSON.stringify(deps)).digest("hex").slice(0, 16);
  let install = installs.get(sig);
  if (!install) {
    install = (async () => {
      const dir = path.join(workRoot, "deps", sig);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, "package.json"),
        JSON.stringify({ name: `deps-${sig}`, private: true, ...deps }, null, 2),
      );
      installGeneratedProject(dir, { timeout: 300_000 });
      return path.join(dir, "node_modules");
    })();
    installs.set(sig, install);
  }
  return install;
}

const limit = limiter(PARALLELISM);

describe.skipIf(!ENABLED)("corpus features type-check under strict tsc (Hono/node)", () => {
  // The shared installs make this a large tree; give the delete room.
  afterAll(() => {
    fs.rmSync(workRoot, { recursive: true, force: true });
  }, 300_000);

  it.concurrent.each(nodeFeatures)(
    "%s — generated node project type-checks",
    (featureId) =>
      limit(async () => {
        const files = await generateCorpusCase(featureId, "node");
        const outDir = fs.mkdtempSync(path.join(workRoot, `${featureId}-`));
        try {
          // Write the emitted file map to disk.
          for (const [rel, content] of files) {
            const abs = path.join(outDir, rel);
            fs.mkdirSync(path.dirname(abs), { recursive: true });
            fs.writeFileSync(abs, content);
          }
          // One project per declared deployable (`d` for every single-service
          // fixture; a multi-service feature names both, and BOTH must compile).
          for (const dir of corpusProjectDirs(featureId)) {
            const proj = path.join(outDir, dir);
            expect(
              fs.existsSync(path.join(proj, "package.json")),
              `${featureId}: node project '${dir}' emitted`,
            ).toBe(true);
            fs.symlinkSync(await sharedNodeModules(proj), path.join(proj, "node_modules"), "dir");
            await sh("npx tsc --noEmit", { cwd: proj, timeout: 300_000 });
          }
        } finally {
          fs.rmSync(outDir, { recursive: true, force: true });
        }
      }),
    1_800_000,
  );
});
