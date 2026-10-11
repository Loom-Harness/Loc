import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
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
// duplicate).  It then runs the project's emitted ExUnit suite — the elixir
// half of the fixture's `test` blocks — under `MIX_ENV=test mix test
// --warnings-as-errors`, which the prod compile never reaches (see
// `runMixTest`).
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

// Features whose emitted ExUnit suite (`test/**/*_test.exs`, the elixir half of
// the fixture's `test` blocks) does not yet pass `MIX_ENV=test mix test
// --warnings-as-errors`, while the PROD build above compiles clean.  Each
// value is the reproducible defect.  The waiver RATCHETS: a waived feature
// still runs its suite, and a suite that now passes fails the cell as a stale
// entry — fixing the emitter deletes the line in the same change.
const ELIXIR_TEST_WAIVERS: Record<string, string> = {
  // __WAIVERS__
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

// A waiver for a fixture this file never runs (renamed, dropped from
// `vanilla`, or compile-skipped) can never go stale through the run itself, so
// refuse it here — a waiver nothing reads is a claim nothing checks.
if (ENABLED) {
  const runnable = new Set(
    CORPUS.filter((f) => f.backends.includes("vanilla") && !(f.id in ELIXIR_COMPILE_SKIP)).map(
      (f) => f.id,
    ),
  );
  const orphaned = Object.keys(ELIXIR_TEST_WAIVERS).filter((id) => !runnable.has(id));
  if (orphaned.length > 0) {
    throw new Error(
      `ELIXIR_TEST_WAIVERS names fixtures this gate never runs: ${orphaned.join(", ")} — delete the entries`,
    );
  }
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
// The host port defaults to one Docker picks: a fixed port (it was 55432)
// collides when two cells of the matrix share a runner host —
// `failed to bind host port 0.0.0.0:55432 … address already in use` killed
// cells before any test ran.  LOOM_CORPUS_ELIXIR_PG_PORT still pins it.
const PG_PORT_PIN = process.env.LOOM_CORPUS_ELIXIR_PG_PORT;
let pgPort = Number(PG_PORT_PIN ?? 0);
const PG_NAME = `loom-corpus-elixir-pg-${process.pid}`;

function startPostgres(): void {
  execSync(`docker rm -f ${PG_NAME}`, { stdio: "ignore" });
  const publish = PG_PORT_PIN ? `${PG_PORT_PIN}:5432` : "127.0.0.1::5432";
  execSync(
    `docker run -d --rm --name ${PG_NAME} -e POSTGRES_PASSWORD=postgres -p ${publish} ${PG_IMAGE}`,
    { stdio: "inherit", timeout: 300_000 },
  );
  if (!PG_PORT_PIN) {
    // `docker port` prints `127.0.0.1:49153`; take the port after the last colon.
    const mapping = execSync(`docker port ${PG_NAME} 5432/tcp`, { encoding: "utf8" })
      .trim()
      .split("\n")[0];
    pgPort = Number(mapping.slice(mapping.lastIndexOf(":") + 1));
    if (!Number.isInteger(pgPort) || pgPort <= 0)
      throw new Error(`could not read the sidecar's host port from "${mapping}"`);
  }
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
    `-e MIX_ENV=prod -e DATABASE_URL=ecto://postgres:postgres@127.0.0.1:${pgPort}/${db} ` +
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

/** A short per-project `MIX_TEST_PARTITION`.  The emitted test database is
 *  `<app>_test<partition>`, and every single-service fixture's app is `d`, so
 *  the partition is what keeps one fixture's migrated tables out of the next
 *  fixture's database on a shared sidecar.  Hashed, not spelled out, because
 *  Postgres silently truncates identifiers past 63 bytes — two long names
 *  could collapse into one database. */
function testPartition(featureId: string, dir: string): string {
  return `_${createHash("sha256").update(`${featureId}/${dir}`).digest("hex").slice(0, 12)}`;
}

/** Does the project carry an emitted ExUnit suite at all? */
function hasExUnitTests(projDir: string): boolean {
  const testDir = path.join(projDir, "test");
  if (!fs.existsSync(testDir)) return false;
  return fs
    .readdirSync(testDir, { recursive: true, encoding: "utf8" })
    .some((p) => p.endsWith("_test.exs"));
}

/**
 * Point the emitted `config/test.exs` Repo at the sidecar's port.
 *
 * The emitted test config is stock Phoenix — `hostname: "localhost"` and no
 * port, i.e. 5432 — and reads no env var, while the sidecar's host port is one
 * Docker picks (a fixed one collides between matrix cells on a shared host).
 * Appending a `config` call is the narrowest override: `Config` merges it into
 * the emitted Repo keyword list, so every other emitted setting (the Sandbox
 * pool, the `MIX_TEST_PARTITION` database name) is what runs.
 */
function pointTestRepoAtSidecar(projDir: string): void {
  const testExs = path.join(projDir, "config", "test.exs");
  const src = fs.readFileSync(testExs, "utf8");
  const repos = [...src.matchAll(/^config (:\w+), ([\w.]+\.Repo),/gm)];
  if (repos.length === 0)
    throw new Error(`${testExs}: no \`config :app, App.Repo\` to point at the sidecar`);
  const overrides = repos.map((m) => `config ${m[1]}, ${m[2]}, port: ${pgPort}`).join("\n");
  fs.writeFileSync(testExs, `${src.trimEnd()}\n\n${overrides}\n`);
}

// The emitted ExUnit suite, under `MIX_ENV=test mix test --warnings-as-errors`.
// The prod build above never reads `test/`: `elixirc_paths(:prod)` is `lib`
// and `mix compile` ignores `*_test.exs`, so a domain `test` block whose elixir
// half calls a function that does not exist — or warns — shipped green on
// every gate.  `mix test` compiles `lib` again under :test (the flag is fatal
// for those warnings too), then compiles AND runs each test file.  The Repo
// starts with the app, and integration tests use the Sandbox against real
// tables, so the test db is created and migrated on the sidecar first, one
// database per project via `MIX_TEST_PARTITION` (the emitted name is
// `<app>_test<partition>`).  Returns whether the suite passed — the caller owns
// the verdict, because a waived feature is EXPECTED to fail.
function runMixTest(projDir: string, partition: string, mirror: HexMirror | undefined): boolean {
  const dockerArgs = mirror ? `${mirror.dockerArgs.join(" ")} ` : "--network host ";
  const shellPrefix = mirror?.shellPrefix ?? "";
  pointTestRepoAtSidecar(projDir);
  const env = `-e MIX_ENV=test -e MIX_TEST_PARTITION=${partition} `;
  try {
    execSync(
      `docker run --rm ${dockerArgs}-v ${projDir}:/app -v ${HEX_CACHE}:/root/.hex ` +
        `-w /app ${env}${IMAGE} ` +
        `bash -c '${shellPrefix}${mixLocalInstall()} && ` +
        `${mixDepsGet()} && mix ecto.create && mix ecto.migrate && ` +
        `mix test --warnings-as-errors'`,
      { stdio: "inherit", timeout: 600_000 },
    );
    return true;
  } catch (err) {
    // A docker/exec TIMEOUT is not a verdict on the suite — rethrow it, so a
    // hung run never reads as "the waived suite still fails".
    if ((err as { signal?: string }).signal) throw err;
    return false;
  }
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
    )("%s — generated elixir project compiles, its migrations apply, its ExUnit suite passes", (featureId) => {
      const outDir = fs.mkdtempSync(path.join(os.tmpdir(), `loom-corpus-elixir-${featureId}-`));
      try {
        const src = materializeCorpusFixture(featureId, "vanilla", outDir);
        execSync(`node ${cli} generate system ${src} -o ${outDir}`, {
          stdio: "inherit",
          cwd: repoRoot,
        });
        // One project per declared deployable (`d` for every single-service
        // fixture; a multi-service feature names both, and BOTH must compile).
        const failingSuites: string[] = [];
        for (const dir of corpusProjectDirs(featureId)) {
          const proj = path.join(outDir, dir);
          expect(
            fs.existsSync(path.join(proj, "mix.exs")),
            `${featureId}: elixir project '${dir}' emitted`,
          ).toBe(true);
          runMixCompileAndMigrate(proj, dbName(featureId, dir), mirror);
          if (hasExUnitTests(proj) && !runMixTest(proj, testPartition(featureId, dir), mirror)) {
            failingSuites.push(dir);
          }
        }
        const waiver = ELIXIR_TEST_WAIVERS[featureId];
        if (waiver === undefined) {
          expect(
            failingSuites,
            `${featureId}: emitted ExUnit suite fails \`mix test --warnings-as-errors\` (output above)`,
          ).toEqual([]);
        } else {
          expect(
            failingSuites.length,
            `${featureId}: STALE ELIXIR_TEST_WAIVERS entry — the ExUnit suite now passes; delete the waiver ("${waiver}")`,
          ).toBeGreaterThan(0);
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
    }, 1_300_000);
  },
);
