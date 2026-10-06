import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { corpusProjectDirs, materializeCorpusFixture } from "../fixtures/corpus/harness.js";
import { CORPUS } from "../fixtures/corpus/manifest.js";
import { type HexMirror, startHexMirror } from "./support/hex-mirror.js";
import { mixDepsGet, mixLocalInstall } from "./support/mix-retry.js";

// ---------------------------------------------------------------------------
// Phase 1 compile tier (docs/old/plans/global-test-coverage-plan.md) for the
// Elixir (plain Ecto/Phoenix) backend — the sibling of `corpus-{tsc,dotnet,
// java,python}-build.test.ts` (M-T9.10).  The fast `corpus-coverage` gate
// proves every corpus feature *generates* on `vanilla` (elixir); this gate
// proves the emitted project actually *compiles* under `mix compile
// --warnings-as-errors` inside the hexpm/elixir Docker image — upgrading the
// corpus from a generation floor to a compile guarantee on the FIFTH backend,
// from the SAME single source of truth (one `.ddd` per feature, no per-backend
// duplicate).
//
// Before this leg, an Elixir codegen regression on any corpus feature shipped
// green until the nightly cross-backend conformance run — this closes that
// silent per-PR gap (the matrix used to cap at tsc/dotnet/java/python because
// only Elixir needs the docker hexpm image + the LOOM_HEX_MIRROR loopback dance
// behind a TLS-fingerprinting egress proxy).
//
// Slow (docker mix deps.get + compile per feature) — opt-in via
// LOOM_ELIXIR_BUILD=1.  CI shards one feature per cell via
// LOOM_CORPUS_ELIXIR_CASE=<feature-id> (see corpus-elixir-build.yml).  Requires
// a running docker daemon; behind a TLS-fingerprinting proxy set LOOM_HEX_MIRROR=1
// (a no-op on CI's direct hex.pm access).  See test/e2e/support/hex-mirror.ts.
// ---------------------------------------------------------------------------

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const cli = path.join(repoRoot, "bin", "cli.js");

const ENABLED = process.env.LOOM_ELIXIR_BUILD === "1";
const CASE = process.env.LOOM_CORPUS_ELIXIR_CASE;

// Same image the single-fixture vanilla gate pins
// (test/e2e/generated-elixir-vanilla-build.test.ts) — keep the two in lockstep.
const IMAGE = "hexpm/elixir:1.18.4-erlang-27.3.4-debian-bookworm-20260610-slim";

// Features that GENERATE on elixir but don't yet compile under `mix compile
// --warnings-as-errors` — real Elixir generator gaps this compile tier would
// surface (the generation gate still covers all of them on all six backends;
// each line is a precise, reproducible bug report).  Widen the gate by FIXING
// the emitter, then dropping the entry.
const ELIXIR_COMPILE_SKIP: Record<string, string> = {
  // (empty — every corpus feature the manifest declares on `vanilla` compiles
  //  clean under `mix compile --warnings-as-errors`.)
};

// Every corpus feature the manifest declares to generate on the elixir backend
// (manifest key `vanilla` — plain Ecto/Phoenix), minus the documented
// compile-tier skips.
const elixirFeatures = CORPUS.filter((f) => f.backends.includes("vanilla"))
  .filter((f) => !(f.id in ELIXIR_COMPILE_SKIP))
  .filter((f) => !CASE || f.id === CASE)
  .map((f) => f.id);

// A CASE that names no manifest fixture selects ZERO tests, and the workflow's
// `--passWithNoTests` (there so a fixture excluded from `vanilla` keeps its
// cell green) turned that into a pass — a renamed fixture or a typo ran
// nothing and reported green.  Refuse it loudly instead.  A known fixture the
// manifest excludes from `vanilla` still selects zero tests, deliberately.
if (ENABLED && CASE && !CORPUS.some((f) => f.id === CASE)) {
  throw new Error(
    `LOOM_CORPUS_ELIXIR_CASE=${CASE} names no corpus manifest fixture — this cell would run nothing`,
  );
}

// A hex PACKAGE cache shared by every container this file starts.
//
// `docker run --rm` throws away the container's `~/.hex`, so each project
// re-downloads the entire dependency closure from scratch.  That was invisible
// while a feature meant exactly one project; a multi-deployable feature doubles
// it, and behind the loopback hex mirror the second `deps.get` reliably dies
// with `Request failed (:timeout)` fetching a tarball the first run had already
// pulled.  Mounting one host dir at `/root/.hex` makes the second project a
// cache hit — correctness behind the mirror, and a straight speed-up on CI's
// direct hex.pm access.  Same shape as the NuGet cache mount in
// `api-call-e2e.test.ts`.
const HEX_CACHE = path.join(os.tmpdir(), "loom-corpus-elixir-hex");

// The migrations the compile below compiles are APPLIED too.  `mix compile`
// type-checks `priv/repo/migrations/*.exs` as code but never runs them, so a
// migration that is valid Elixir and invalid DDL — #3060's index on a column
// the value-object collapse removes (`column "berth_ship" does not exist`) —
// was green here and broken on the first `docker compose up`, where the
// release's `Release.migrate()` runs the same files
// (docs/audits/2026-10-04-tested-vs-shipped.md, family B).  So one Postgres
// sidecar serves the whole file, and each project gets its own database.
const PG_IMAGE = "postgres:18-alpine";
const PG_PORT = Number(process.env.LOOM_CORPUS_ELIXIR_PG_PORT ?? "55432");
const PG_NAME = `loom-corpus-elixir-pg-${process.pid}`;

function startPostgres(): void {
  execSync(`docker rm -f ${PG_NAME}`, { stdio: "ignore" });
  execSync(
    `docker run -d --rm --name ${PG_NAME} -e POSTGRES_PASSWORD=postgres -p ${PG_PORT}:5432 ${PG_IMAGE}`,
    { stdio: "inherit", timeout: 300_000 },
  );
  // pg_isready inside the container: the TCP port opens before initdb's
  // restart, so poll the server, not the socket.
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      execSync(`docker exec ${PG_NAME} pg_isready -U postgres -h 127.0.0.1`, { stdio: "ignore" });
      return;
    } catch {
      if (Date.now() > deadline) throw new Error(`${PG_IMAGE} sidecar never became ready`);
      execSync("sleep 1");
    }
  }
}

/** A per-project database name (`ecto.create` makes it). */
function dbName(featureId: string, dir: string): string {
  return `loom_${featureId}_${dir}`
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .slice(0, 63);
}

// `mix deps.get --only prod && mix compile --warnings-as-errors`, then
// `mix ecto.create && mix ecto.migrate` against the sidecar, inside the elixir
// image.  When `mirror` is set (LOOM_HEX_MIRROR=1) hex.pm traffic is routed
// through the loopback mirror so this gate also runs behind a
// TLS-fingerprinting egress proxy — mirrors the single-fixture vanilla gate.
// The FETCH is retried (transient hex.pm 500s used to kill whole cells — see
// support/mix-retry.ts); the COMPILE and MIGRATE are not, and must keep failing
// fast.  Host networking either way, so the container reaches the sidecar's
// published port on 127.0.0.1 (the mirror's args already carry it).
function runMixCompileAndMigrate(projDir: string, db: string, mirror: HexMirror | undefined): void {
  const dockerArgs = mirror ? `${mirror.dockerArgs.join(" ")} ` : "--network host ";
  const shellPrefix = mirror?.shellPrefix ?? "";
  fs.mkdirSync(HEX_CACHE, { recursive: true });
  // prod's config/runtime.exs raises without these two; the secret is never
  // used (no endpoint starts under ecto.migrate) but must be ≥ 64 bytes.
  const env =
    `-e MIX_ENV=prod -e DATABASE_URL=ecto://postgres:postgres@127.0.0.1:${PG_PORT}/${db} ` +
    `-e SECRET_KEY_BASE=${"x".repeat(64)} `;
  execSync(
    `docker run --rm ${dockerArgs}-v ${projDir}:/app -v ${HEX_CACHE}:/root/.hex ` +
      `-w /app ${env}${IMAGE} ` +
      `bash -c '${shellPrefix}${mixLocalInstall()} && ` +
      `${mixDepsGet("--only prod")} && mix compile --warnings-as-errors && ` +
      `mix ecto.create && mix ecto.migrate'`,
    { stdio: "inherit", timeout: 600_000 },
  );
}

describe.skipIf(!ENABLED)(
  "corpus features compile under mix (Elixir/Phoenix) (LOOM_ELIXIR_BUILD=1)",
  () => {
    // Behind a TLS-fingerprinting proxy (LOOM_HEX_MIRROR=1) start one loopback
    // hex mirror for the whole suite; a no-op (undefined) with direct access.
    let mirror: HexMirror | undefined;
    beforeAll(async () => {
      mirror = await startHexMirror();
      startPostgres();
    }, 360_000);
    afterAll(() => {
      mirror?.stop();
      execSync(`docker rm -f ${PG_NAME}`, { stdio: "ignore" });
    });

    it.each(
      elixirFeatures,
    )("%s — generated elixir project compiles and its migrations apply", (featureId) => {
      const outDir = fs.mkdtempSync(path.join(os.tmpdir(), `loom-corpus-elixir-${featureId}-`));
      try {
        const src = materializeCorpusFixture(featureId, "vanilla", outDir);
        execSync(`node ${cli} generate system ${src} -o ${outDir}`, {
          stdio: "inherit",
          cwd: repoRoot,
        });
        // One project per declared deployable (`d` for every single-service
        // fixture; a multi-service feature names both, and BOTH must compile).
        for (const dir of corpusProjectDirs(featureId)) {
          const proj = path.join(outDir, dir);
          expect(
            fs.existsSync(path.join(proj, "mix.exs")),
            `${featureId}: elixir project '${dir}' emitted`,
          ).toBe(true);
          runMixCompileAndMigrate(proj, dbName(featureId, dir), mirror);
        }
      } finally {
        // Best-effort: the docker container runs as root and writes root-owned
        // `deps/` + `_build/` into the mounted project dir, so a non-root CI
        // runner's rmSync can't remove them (EACCES).  The compile result is
        // what gates; a leftover temp dir on an ephemeral runner is harmless.
        try {
          fs.rmSync(outDir, { recursive: true, force: true });
        } catch {
          // leave the root-owned tree for the runner's own /tmp cleanup
        }
      }
    }, 700_000);
  },
);
