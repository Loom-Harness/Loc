import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { corpusProjectDirs, materializeCorpusFixture } from "../fixtures/corpus/harness.js";
import { CORPUS } from "../fixtures/corpus/manifest.js";

// ---------------------------------------------------------------------------
// Phase 1 compile tier (https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/old/plans/global-test-coverage-plan.md) for the .NET
// (ASP.NET + EF Core + Mediator) backend — the sibling of `corpus-tsc-build`
// (node) and `corpus-java-build` (Java).  The fast `corpus-coverage` gate
// proves every corpus feature *generates* on `dotnet`; this gate proves the
// emitted project actually *compiles* under `dotnet build /warnaserror`,
// upgrading the corpus from a generation floor to a compile guarantee on the
// .NET backend too — from the SAME single source of truth (one `.ddd` per
// feature, no per-backend duplicate).  It then builds the project's emitted
// xUnit project (`Tests/<Ns>.Tests/<Ns>.Tests.csproj` — the .NET half of the
// fixture's `test` blocks) under the same `/warnaserror` and runs it, which the
// project-folder build never reaches (see `runEmittedTests`).
//
// Slow (`dotnet restore` per feature) — opt-in via LOOM_DOTNET_BUILD=1 (the
// same switch the single-fixture `generated-dotnet-build` gate uses).  CI
// shards one feature per cell via LOOM_CORPUS_DOTNET_CASE=<feature-id>.
// Requires the .NET SDK on PATH (the workflow runs it in the dotnet/sdk
// container; locally, run vitest inside `mcr.microsoft.com/dotnet/sdk:10.0`).
// ---------------------------------------------------------------------------

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const cli = path.join(repoRoot, "bin", "cli.js");

const ENABLED = process.env.LOOM_DOTNET_BUILD === "1";
const CASE = process.env.LOOM_CORPUS_DOTNET_CASE;

// Features that GENERATE on dotnet but don't yet compile under `dotnet build
// /warnaserror` — real .NET generator gaps this compile tier surfaces (the
// generation gate still covers all of them on all six backends; each line is a
// precise, reproducible bug report).  Widen the gate by FIXING the emitter,
// then dropping the entry.
const DOTNET_COMPILE_SKIP: Record<string, string> = {};

// Features whose emitted xUnit project does not yet build under `/warnaserror`
// or does not pass `dotnet test`, while the API project above compiles clean.
// Each value is the reproducible defect.  The waiver RATCHETS: a waived feature
// still builds and runs its test project, and one that now passes fails the
// cell as a stale entry — fixing the emitter deletes the line in the same
// change.  Pinned in `test/platform/allowlist-ratchet.test.ts`.
const DOTNET_TEST_WAIVERS: Record<string, string> = {
  // (empty — every corpus project that emits a test project builds and passes
  //  it.  Only fixtures with domain-tier `test` blocks emit one; `test e2e`
  //  blocks land in the generated `e2e/` harness, which this leg does not run.)
};

// Every corpus feature the manifest declares to generate on `dotnet`, minus the
// documented compile-tier skips.
const dotnetFeatures = CORPUS.filter((f) => f.backends.includes("dotnet"))
  .filter((f) => !(f.id in DOTNET_COMPILE_SKIP))
  .filter((f) => !CASE || f.id === CASE)
  .map((f) => f.id);

// A waiver for a fixture this file never runs (renamed, dropped from the
// manifest's `dotnet` row, or compile-skipped) can never go stale through the
// run itself, so refuse it here — a waiver nothing reads is a claim nothing
// checks.
if (ENABLED) {
  const runnable = new Set(
    CORPUS.filter((f) => f.backends.includes("dotnet") && !(f.id in DOTNET_COMPILE_SKIP)).map(
      (f) => f.id,
    ),
  );
  const orphaned = Object.keys(DOTNET_TEST_WAIVERS).filter((id) => !runnable.has(id));
  if (orphaned.length > 0) {
    throw new Error(
      `DOTNET_TEST_WAIVERS names fixtures this gate never runs: ${orphaned.join(", ")} — delete the entries`,
    );
  }
}

/** The emitted xUnit project, or undefined when the project emits none (the
 *  generator writes it only when some aggregate / value object / domain
 *  service / context declares a `test` block). */
function testCsproj(projDir: string): string | undefined {
  const testsDir = path.join(projDir, "Tests");
  if (!fs.existsSync(testsDir)) return undefined;
  for (const sub of fs.readdirSync(testsDir)) {
    const csproj = path.join(testsDir, sub, `${sub}.csproj`);
    if (fs.existsSync(csproj)) return csproj;
  }
  return undefined;
}

// The emitted xUnit project, built under `/warnaserror` and run.  The
// project-folder build above never compiles it: the API csproj carries
// `<Compile Remove="Tests/**" />` and the test csproj is a separate project
// that only references it, so a `test` block whose C# half calls a member that
// does not exist — or warns — shipped green on every corpus gate.
//
// `dotnet test` runs everything except the context-level `<Ctx>IntegrationTests`
// classes: those open a Postgres connection (`LOOM_PG_URL`), and this leg has no
// database.  They are still COMPILED here; the behavioral legs own running them.
// Returns whether the project built and passed — the caller owns the verdict,
// because a waived feature is EXPECTED to fail.
function runEmittedTests(csproj: string): boolean {
  try {
    execSync(`dotnet restore "${csproj}" --nologo`, { stdio: "inherit", timeout: 300_000 });
    execSync(`dotnet build "${csproj}" --no-restore --nologo /warnaserror`, {
      stdio: "inherit",
      timeout: 300_000,
    });
    execSync(
      `dotnet test "${csproj}" --no-build --nologo --filter "FullyQualifiedName!~IntegrationTests"`,
      { stdio: "inherit", timeout: 300_000 },
    );
    return true;
  } catch (err) {
    // A TIMEOUT is not a verdict on the tests — rethrow it, so a hung run never
    // reads as "the waived project still fails".
    if ((err as { signal?: string }).signal) throw err;
    return false;
  }
}

describe.skipIf(!ENABLED)("corpus features compile under dotnet build (.NET)", () => {
  it.each(
    dotnetFeatures,
  )("%s — generated .NET project compiles, its xUnit project builds and passes", (featureId) => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), `loom-corpus-dotnet-${featureId}-`));
    try {
      const src = materializeCorpusFixture(featureId, "dotnet", outDir);
      execSync(`node ${cli} generate system ${src} -o ${outDir}`, {
        stdio: "inherit",
        cwd: repoRoot,
      });
      // One project per declared deployable (`d` for every single-service
      // fixture; a multi-service feature names both, and BOTH must compile).
      const failingTestProjects: string[] = [];
      let anyTestProject = false;
      for (const dir of corpusProjectDirs(featureId)) {
        const proj = path.join(outDir, dir);
        expect(fs.existsSync(proj), `${featureId}: .NET project '${dir}' emitted`).toBe(true);
        execSync("dotnet restore --nologo", { cwd: proj, stdio: "inherit", timeout: 300_000 });
        // `/warnaserror` keeps the gate honest about both real errors and warnings
        // (an unused-using or nullable-mismatch the emitter shouldn't produce).
        execSync("dotnet build --no-restore --nologo /warnaserror", {
          cwd: proj,
          stdio: "inherit",
          timeout: 300_000,
        });
        const csproj = testCsproj(proj);
        if (csproj !== undefined) {
          anyTestProject = true;
          if (!runEmittedTests(csproj)) failingTestProjects.push(dir);
        }
      }
      const waiver = DOTNET_TEST_WAIVERS[featureId];
      if (waiver === undefined) {
        expect(
          failingTestProjects,
          `${featureId}: emitted xUnit project fails \`dotnet build /warnaserror\` or \`dotnet test\` (output above)`,
        ).toEqual([]);
      } else {
        expect(
          anyTestProject,
          `${featureId}: DOTNET_TEST_WAIVERS entry for a fixture that emits no xUnit project — delete the waiver ("${waiver}")`,
        ).toBe(true);
        expect(
          failingTestProjects.length,
          `${featureId}: STALE DOTNET_TEST_WAIVERS entry — the xUnit project now builds and passes; delete the waiver ("${waiver}")`,
        ).toBeGreaterThan(0);
      }
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  }, 1_300_000);
});
