import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHexMirror } from "./support/hex-mirror.js";
import { mixDepsGet } from "./support/mix-retry.js";
import { MixWorkspace, SEED_FROM_TEMPLATE } from "./support/mix-workspace.js";
import { installGeneratedProject } from "./support/npm-install.js";
import { limiter, PARALLELISM, sh } from "./support/parallel.js";

// ---------------------------------------------------------------------------
// Slice 6 of docs/old/plans/vanilla-foundation-tdd-plan.md — CI gate for
// the vanilla emit subtree.  Parallel to test/e2e/generated-elixir-ash-
// build.test.ts but exercises `foundation: vanilla` deployables and
// expects no Ash deps in the generated mix.exs.
//
// For every fixture under `test/e2e/fixtures/elixir-vanilla-build/`,
// generate the project then `mix deps.get && mix compile
// --warnings-as-errors` inside the hexpm/elixir Docker image.  Catches
// every Elixir surface error the unit-test layer (string assertions)
// can't see — the actual acceptance gate for the vanilla emitters.
//
// Gated behind LOOM_PHOENIX_VANILLA_BUILD=1 so it stays out of the
// always-on `test` matrix; runs in CI via .github/workflows/elixir-
// vanilla-build.yml and locally via `npm run test:phoenix`.
//
// One job builds every fixture, PARALLELISM at a time (support/parallel.ts),
// each project starting from a dependency template built once per dependency
// set (support/mix-workspace.ts) — the fixture's own code is what compiles.
// ---------------------------------------------------------------------------

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const cli = path.join(repoRoot, "bin", "cli.js");
const fixturesDir = path.join(here, "fixtures", "elixir-vanilla-build");
const ENABLED = process.env.LOOM_PHOENIX_VANILLA_BUILD === "1";
/** Projects, dependency templates and caches (support/mix-workspace.ts). */
const mix = new MixWorkspace("loom-vanilla");

// `mix compile --warnings-as-errors` inside the elixir image, starting from the
// fixture's dependency template.  `mix deps.get --only prod` still runs: with
// the template's lock and deps in place it is a no-op, and it fails loudly if
// they ever stop matching.  Routed through the loopback hex mirror when
// LOOM_HEX_MIRROR=1 (support/hex-mirror.ts).  The FETCH is retried
// (support/mix-retry.ts); the COMPILE is not, and must keep failing fast.
async function runMixCompile(projDir: string): Promise<void> {
  await sh(
    mix.dockerRun(
      await mix.seededMounts(projDir),
      "-e MIX_ENV=prod ",
      `${SEED_FROM_TEMPLATE} && ${mixDepsGet("--only prod")} && mix compile --warnings-as-errors`,
    ),
    { timeout: 600_000 },
  );
}

// `mix test` (MIX_ENV=test) for a fixture whose aggregates declare domain
// `test "..."` blocks — the emitted ExUnit suite runs the pure domain core
// (vanilla/domain-core-emit.ts) with NO database, so this gate just compiles +
// runs the tests.  Catches an emitter regression that produces invalid Elixir
// or a behaviourally wrong assertion (the `mix compile --warnings-as-errors`
// gate above is MIX_ENV=prod and never compiles `test/`).
async function runMixTest(projDir: string): Promise<void> {
  await sh(mix.dockerRun(`-v ${projDir}:/app`, "", `${mixDepsGet()} && mix test`), {
    timeout: 600_000,
  });
}

// Embedded-SPA host (M-T6.1): a `hosts:` React/Vue/Svelte deployable drops the
// SPA project under `<proj>/assets/`.  `mix compile` (above) never touches it
// (elixirc_paths is `lib` only), so the SPA's own tsc + vite build is proved
// HERE on the host — the Phoenix-embedded equivalent of `generated-react-
// build.yml`, gating the one path (`basePath: "/app"` + same-origin `/api`)
// the standalone react-build matrix doesn't exercise.  No-op when no `assets/`
// project exists (every non-hosting fixture).
async function runSpaBuild(assetsDir: string): Promise<void> {
  installGeneratedProject(assetsDir, {
    ciFirst: ["--prefer-offline", "--no-audit", "--no-fund"],
    flags: [],
    timeout: 600_000,
  });
  await sh("npm run build", { cwd: assetsDir, timeout: 600_000 });
}

// `LOOM_PHOENIX_VANILLA_BUILD_CASE=<fixture>.ddd[,<fixture>.ddd…]` selects
// those fixtures; unset builds them all.
function pickCases<T extends { name: string }>(all: T[]): T[] {
  const only = process.env.LOOM_PHOENIX_VANILLA_BUILD_CASE?.split(",").filter(Boolean);
  if (!only) return all;
  const unknown = only.filter((name) => !all.some((c) => c.name === name));
  if (unknown.length > 0) {
    throw new Error(
      `LOOM_PHOENIX_VANILLA_BUILD_CASE names no elixir-vanilla-build fixture: ${unknown.join(", ")} ` +
        `(have: ${all.map((c) => c.name).join(", ")})`,
    );
  }
  return all.filter((c) => only.includes(c.name));
}

const limit = limiter(PARALLELISM);

describe.skipIf(!ENABLED)(
  "generated vanilla Phoenix project compiles against plain Ecto (LOOM_PHOENIX_VANILLA_BUILD=1)",
  () => {
    // Behind a TLS-fingerprinting proxy (LOOM_HEX_MIRROR=1) start one loopback
    // hex mirror for the whole suite; a no-op (undefined) with direct access.
    beforeAll(async () => {
      mix.mirror = await startHexMirror();
    });
    afterAll(async () => {
      mix.mirror?.stop();
      await mix.remove(mix.root);
      fs.rmSync(mix.root, { recursive: true, force: true });
    }, 300_000);
    // Enumerate the fixtures dynamically from the directory, so a fixture
    // added/removed under elixir-vanilla-build/ needs no edit anywhere.  Every
    // `.ddd` in the dir is a mix-compile target.
    const allFixtures = fs
      .readdirSync(fixturesDir)
      .filter((f) => f.endsWith(".ddd"))
      .sort()
      .map((name) => ({ name }));
    it.concurrent.each(pickCases(allFixtures))(
      "$name → mix compile --warnings-as-errors",
      ({ name }) =>
        limit(async () => {
          const fixturePath = path.join(fixturesDir, name);
          const outDir = fs.mkdtempSync(path.join(mix.root, `${name.replace(/\.ddd$/, "")}-`));
          try {
            const genRoot = path.join(outDir, "out");
            await sh(`node ${cli} generate system ${fixturePath} -o ${genRoot}`, {
              cwd: repoRoot,
              timeout: 300_000,
            });
            // The vanilla orchestrator emits one project per deployable under
            // `out/<deployable>/`; the deployable slug varies per fixture (`api`,
            // `phoenixApp`, …), so discover the elixir project(s) by globbing for
            // `mix.exs` rather than hardcoding the slug.
            const projDirs = fs
              .readdirSync(genRoot)
              .map((d) => path.join(genRoot, d))
              .filter((d) => fs.existsSync(path.join(d, "mix.exs")));
            expect(projDirs.length).toBeGreaterThan(0);

            for (const projDir of projDirs) {
              // Vanilla mix.exs must have zero Ash deps — re-asserting at the e2e
              // level on top of the unit assertion.
              const mixExs = fs.readFileSync(path.join(projDir, "mix.exs"), "utf8");
              expect(mixExs).not.toContain(":ash,");
              expect(mixExs).not.toContain(":ash_postgres,");
              expect(mixExs).not.toContain(":ash_phoenix,");

              await runMixCompile(projDir);

              // THE SUPPLY-CHAIN CLAIM, pinned against the REAL lockfile rather
              // than the emitted source: no edge of the cowboy chain may be
              // resolved.  cowlib's latest release is the one carrying
              // CVE-2026-43966 / CVE-2026-43969 and there is nothing to bump to,
              // so the only fix is not to depend on it — which the emitter does
              // by serving on Bandit (see the unit gate in
              // test/generator/elixir/vanilla-http-adapter.test.ts).  A
              // dependency that re-introduces `plug_cowboy` transitively would
              // never show up in mix.exs, so mix.lock — resolved by `mix
              // deps.get` from this project's own deps block, in its template —
              // is the only place this can honestly be asserted.
              // NOT `ranch`: it is a generic TCP acceptor pool, not part of the
              // CVE chain, and a fixture with an email resource reaches it
              // legitimately (Swoosh's SMTP adapter -> gen_smtp -> ranch).
              // Forbidding it failed `vanilla-resources` and
              // `vanilla-outbox-marker` for a reason with nothing to do with
              // what this assertion names.  The carrier is `cowlib`; the only
              // edges into it are `plug_cowboy` -> `cowboy` (+ its
              // `cowboy_telemetry` sibling).
              const lock = fs.readFileSync(path.join(projDir, "mix.lock"), "utf8");
              for (const pkg of ["cowlib", "cowboy", "cowboy_telemetry", "plug_cowboy"]) {
                expect(
                  lock,
                  `${pkg} resolved into ${path.basename(projDir)}'s mix.lock`,
                ).not.toContain(`"${pkg}": {:hex`);
              }
              expect(lock).toContain('"bandit": {:hex');

              // If the fixture's aggregates declared domain `test "..."` blocks, the
              // emitter wrote an ExUnit suite (+ test_helper.exs) — run it (DB-free).
              if (fs.existsSync(path.join(projDir, "test", "test_helper.exs"))) {
                await runMixTest(projDir);
              }

              // Embedded-SPA host: build the `assets/` SPA project (tsc + vite) so
              // the fullstack Phoenix path is compile-proved end to end.
              const assetsDir = path.join(projDir, "assets");
              if (fs.existsSync(path.join(assetsDir, "package.json"))) {
                await runSpaBuild(assetsDir);
              }
            }
          } finally {
            await mix.remove(outDir);
          }
        }),
      3_600_000,
    );
  },
);
