// Shared harness for the migration-EVOLUTION gate (M-T2.13) across the five SQL
// backends.
//
// The per-PR compile/first-boot tiers prove a migration EMITS and APPLIES to a
// fresh database.  Nothing proved a migration *evolves* correctly on data that
// already exists — the silent-data-loss class.  This harness runs the two
// runtime checks the mission asks for, per backend, against a real Postgres:
//
//   CHECK 1 — migrate-vs-create equivalence.  The schema after applying the
//     FULL migration chain (Initial v1 → delta v2) must be byte-for-byte
//     equivalent to the schema of a FRESH create of the head (v2) model.  A
//     drift means an `ALTER` diverged from what a `CREATE` of the same shape
//     produces.
//
//   CHECK 2 — populated forward-migrate.  Seed a v1 row through the REST
//     surface, evolve the `.ddd` to v2, apply the derived forward migration,
//     and assert the row SURVIVES with correct values (renamed column keeps its
//     value, back-filled NOT-NULL column is populated, nullable add is NULL).
//     A destructive/lossy column change the derive should have gated shows up
//     here as a lost or wrong row.
//
// The two `.ddd` versions live in test/e2e/fixtures/migration-evolution/{base,
// evolved}.ddd; the v1→v2 delta is a value-preserving rename + a back-filled
// NOT-NULL add + a nullable add (see evolved.ddd).  Only the boot mechanics
// differ per backend, so those stay in a per-backend `BackendDriver`; the
// Postgres lifecycle, the schema fingerprint, and both assertion sequences live
// here and are backend-agnostic.

import { type ChildProcess, execFileSync, execSync } from "node:child_process";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, "..", "..", "..");
export const cli = path.join(repoRoot, "bin", "cli.js");
const fixtureDir = path.join(repoRoot, "test", "e2e", "fixtures", "migration-evolution");

/** A non-`.ddd` fixture file, verbatim. */
export function readFixtureFile(name: string): string {
  return fs.readFileSync(path.join(fixtureDir, name), "utf8");
}

export function readFixture(
  name:
    | "base"
    | "evolved"
    | "vo-collection-base"
    | "vo-collection-evolved"
    | "field-default-base"
    | "field-default-evolved"
    | "journal-order-base"
    | "journal-order-evolved"
    | "unique-evo-base",
): string {
  return fs.readFileSync(path.join(fixtureDir, `${name}.ddd`), "utf8");
}

// Re-exported so the sibling suites importing it from this harness keep working.
// See `docker-probe.ts` for why the old inline `docker info` probe reported a
// busy daemon as a missing one.
// Imported as well as re-exported: a bare `export … from` does NOT bind the
// names locally, so the `hasDocker()` call below was an unresolved identifier
// (TS2304, and a ReferenceError on the docker-absent path).
import { hasDocker, requireDocker } from "./docker-probe.js";

export { hasDocker, requireDocker };

export async function freePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, () => {
      const addr = srv.address();
      if (typeof addr === "object" && addr) {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else {
        srv.close();
        reject(new Error("could not pick a free port"));
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Postgres — ONE server, TWO databases.  CHECK 1 needs the chain schema and the
// fresh-create schema side by side, so the harness stands up a single server
// and creates two databases in it (`chain`, `fresh`).  Honours
// `LOOM_MIGRATION_PG_URL` (the CI `services:` container) and otherwise spins a
// docker sidecar — same convention as the tenancy harness.
// ---------------------------------------------------------------------------

export interface PgServer {
  host: string;
  port: number;
  user: string;
  password: string;
  stop: () => void;
}

/** One database on the server — what a backend boot connects to. */
export interface PgConn {
  host: string;
  port: number;
  user: string;
  password: string;
  db: string;
}

export async function startPgServer(): Promise<PgServer> {
  const override = process.env.LOOM_MIGRATION_PG_URL;
  if (override) {
    const u = new URL(override);
    return {
      host: u.hostname,
      port: Number(u.port || "5432"),
      user: decodeURIComponent(u.username || "postgres"),
      password: decodeURIComponent(u.password || "postgres"),
      stop: () => {},
    };
  }
  if (!hasDocker()) {
    throw new Error(
      "migration-evolution e2e: docker unreachable and no LOOM_MIGRATION_PG_URL override given.",
    );
  }
  const name = `loom-migration-pg-${process.pid}`;
  const port = await freePort();
  execSync(
    `docker run -d --rm --name ${name} ` +
      `-e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=app ` +
      `-p ${port}:5432 postgres:18-alpine`,
    { stdio: "pipe", timeout: 60_000 },
  );
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      execSync(`docker exec ${name} pg_isready -U postgres`, { stdio: "pipe", timeout: 5_000 });
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  return {
    host: "127.0.0.1",
    port,
    user: "postgres",
    password: "postgres",
    stop: () => {
      try {
        execSync(`docker rm -f ${name}`, { stdio: "pipe", timeout: 15_000 });
      } catch {
        /* best-effort */
      }
    },
  };
}

function serverUrl(s: PgServer, db: string): string {
  return `postgres://${encodeURIComponent(s.user)}:${encodeURIComponent(s.password)}@${s.host}:${s.port}/${db}`;
}

/** Run one SQL statement via host `psql` (preinstalled on GitHub runners; the
 *  tenancy-hierarchy gate relies on the same).  Returns trimmed stdout. */
function psql(s: PgServer, db: string, sql: string): string {
  try {
    return execFileSync("psql", [serverUrl(s, db), "-tAqc", sql], {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30_000,
    })
      .toString()
      .trim();
  } catch (e) {
    const err = e as { stderr?: Buffer; message?: string };
    throw new Error(
      `psql failed (is postgresql-client on PATH?): ${err.stderr?.toString() ?? err.message ?? e}`,
    );
  }
}

/** Drop-and-recreate a database for a clean slate. */
export function resetDatabase(s: PgServer, db: string): void {
  psql(s, "postgres", `DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
  psql(s, "postgres", `CREATE DATABASE "${db}"`);
}

export function connFor(s: PgServer, db: string): PgConn {
  return { host: s.host, port: s.port, user: s.user, password: s.password, db };
}

// Migration-runner bookkeeping tables/schemas each backend maintains — excluded
// from the fingerprint so CHECK 1 compares only the DOMAIN schema.  node:
// `drizzle.__drizzle_migrations`; python and .NET Dapper: `__loom_migrations`;
// .NET EF: `__EFMigrationsHistory`; java: `flyway_schema_history`;
// elixir/Ecto: `schema_migrations`.
const TRACKING_SCHEMAS = ["pg_catalog", "information_schema", "drizzle"];
const TRACKING_TABLES = [
  "__drizzle_migrations",
  "__loom_migrations",
  "__efmigrationshistory",
  "flyway_schema_history",
  "schema_migrations",
];

/**
 * A normalized, ORDER-INDEPENDENT fingerprint of a database's domain schema:
 * one sorted line per column (`schema.table | column | type | nullable |
 * default`), one per primary key, and one per CHECK constraint.  Columns are
 * sorted by NAME, not physical ordinal — a rename leaves a column in place
 * while an add appends, so the physical order legitimately differs between the
 * chain and a fresh create; the SET of columns and their types/nullability/PKs
 * must not.
 *
 * CHECK constraints joined the fingerprint with the `enumValues` constraint
 * (see `CheckKind`), and they are the half most likely to diverge: a fresh
 * create inlines them in the CREATE TABLE while the chain adds them as an
 * ALTER, and on Phoenix those are two different renderers — exactly the
 * fresh-vs-chain split that once lost this fixture's INDEXES.  `NOT VALID` is
 * deliberately NOT part of the line: an inlined constraint is validated and an
 * ALTER-added one is not, which is a correct difference (there is nothing to
 * validate on an empty table), not a schema divergence.  Postgres's own
 * generated NOT NULL checks are excluded — `is_nullable` already carries that.
 */
export function fingerprintSchema(s: PgServer, db: string): string {
  const notSchemas = TRACKING_SCHEMAS.map((x) => `'${x}'`).join(",");
  const notTables = TRACKING_TABLES.map((x) => `'${x}'`).join(",");
  const q = `
SELECT string_agg(line, E'\\n' ORDER BY line) FROM (
  SELECT format('COL %s.%s | %s | %s(%s,%s) | nullable=%s | default=%s',
                c.table_schema, c.table_name, c.column_name, c.data_type,
                -- M-T2.14: bounds are part of a numeric column's identity —
                -- 'numeric' alone made CHECK 1 structurally blind to a
                -- DECIMAL vs NUMERIC(19,4) disagreement between the migrated
                -- chain and a fresh create (audit F15's gate half).
                coalesce(c.numeric_precision::text,'-'), coalesce(c.numeric_scale::text,'-'),
                c.is_nullable, coalesce(c.column_default,'-')) AS line
  FROM information_schema.columns c
  JOIN information_schema.tables t
    ON t.table_schema=c.table_schema AND t.table_name=c.table_name AND t.table_type='BASE TABLE'
  WHERE c.table_schema NOT IN (${notSchemas}) AND lower(c.table_name) NOT IN (${notTables})
  UNION ALL
  SELECT format('PK  %s.%s | %s',
                tc.table_schema, tc.table_name,
                string_agg(kcu.column_name, ',' ORDER BY kcu.ordinal_position))
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name=kcu.constraint_name AND tc.table_schema=kcu.table_schema
  WHERE tc.constraint_type='PRIMARY KEY'
    AND tc.table_schema NOT IN (${notSchemas}) AND lower(tc.table_name) NOT IN (${notTables})
  GROUP BY tc.table_schema, tc.table_name
  UNION ALL
  SELECT format('CHK %s.%s | %s | %s',
                n.nspname, cl.relname, con.conname,
                -- ' NOT VALID' stripped: see the doc comment.
                replace(pg_get_constraintdef(con.oid, true), ' NOT VALID', ''))
  FROM pg_constraint con
  JOIN pg_class cl ON cl.oid = con.conrelid
  JOIN pg_namespace n ON n.oid = cl.relnamespace
  WHERE con.contype = 'c'
    -- Postgres 17+ materialises NOT NULL as a CHECK row; 'is_nullable' on the
    -- column line already carries that, and counting it twice would make the
    -- fingerprint server-version dependent.
    AND pg_get_constraintdef(con.oid, true) NOT LIKE '%IS NOT NULL%'
    AND n.nspname NOT IN (${notSchemas}) AND lower(cl.relname) NOT IN (${notTables})
) s`;
  return psql(s, db, q);
}

// ---------------------------------------------------------------------------
// Codegen — write the fixture with the platform substituted, record it with
// `ddd migrate add` into the migration chain beside it (`migrations/`), then
// `generate system` into an output tree.  The v1 generation records the
// initial migrations; the v2 generation over the SAME tree records the forward
// migration on top of them.  A FRESH tree's chain starts at Initial(v2) — the
// fresh-create side of CHECK 1.
// ---------------------------------------------------------------------------

/** What `__PLATFORM__` expands to for a driver's `platform`.  A driver names
 *  either a platform (`node`, `dotnet`, …) or a persistence ADAPTER of one:
 *  `dapper` is the .NET backend on `persistence: dapper` — the realization
 *  clause the behavioural dapper runner injects the same way
 *  (`test/behavioral/run-dapper.mjs`).  Resolved HERE, in `generate`, rather
 *  than in each driver, so every gate in this file — present and future —
 *  runs on the adapter by passing `driver.platform` through unchanged. */
const PLATFORM_CLAUSES: Readonly<Record<string, string>> = {
  dapper: "dotnet { persistence: dapper }",
};

export function platformClause(platform: string): string {
  return PLATFORM_CLAUSES[platform] ?? platform;
}

export function generate(
  source: string,
  platform: string,
  outDir: string,
  opts: { allowDestructive?: boolean } = {},
): void {
  const dddPath = path.join(outDir, "app.ddd");
  fs.writeFileSync(dddPath, source.replaceAll("__PLATFORM__", platformClause(platform)));
  // One recorded generation per call, named by its position in the chain (a
  // call that changes nothing records nothing and leaves the name free).
  const recorded = fs.existsSync(chainDir(outDir))
    ? fs.readdirSync(chainDir(outDir)).filter((f) => f.endsWith(".json")).length
    : 0;
  try {
    const flag = opts.allowDestructive ? " --allow-destructive" : "";
    execSync(`node ${cli} migrate add gen-${recorded + 1} ${dddPath}${flag}`, {
      stdio: "pipe",
      cwd: repoRoot,
    });
    execSync(`node ${cli} generate system ${dddPath} -o ${outDir}`, {
      stdio: "pipe",
      cwd: repoRoot,
    });
  } catch (e) {
    const err = e as { stdout?: Buffer; stderr?: Buffer };
    throw new Error(
      `generate system failed for ${platform}:\n${err.stdout?.toString() ?? ""}\n${err.stderr?.toString() ?? ""}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Boot readiness + REST assertion sequences (backend-agnostic).
// ---------------------------------------------------------------------------

/** The migration chain `generate` records into, beside `app.ddd`. */
export function chainDir(outDir: string): string {
  return path.join(outDir, "migrations");
}

export async function waitForReady(
  base: string,
  bootLog: () => string,
  ms = 120_000,
): Promise<void> {
  const deadline = Date.now() + ms;
  for (;;) {
    try {
      const r = await fetch(`${base}/ready`);
      if (r.status === 200) return;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) {
      throw new Error(`backend never became ready; log:\n${bootLog().slice(0, 8192)}`);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

function rows<T>(body: unknown): T[] {
  if (Array.isArray(body)) return body as T[];
  if (body && typeof body === "object" && Array.isArray((body as { items?: unknown }).items)) {
    return (body as { items: T[] }).items;
  }
  throw new Error(`expected a list or {items:[…]} envelope, got: ${JSON.stringify(body)}`);
}

/** The seeded v1 row's value fingerprint — asserted to survive forward-migration. */
export const SEED = { name: "Widget", price: 9.99, status: "draft" } as const;

/** POST a v1 Product `{name, price}` and return its id. */
export async function seedV1Product(base: string): Promise<string> {
  const r = await fetch(`${base}/api/products`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: SEED.name, price: String(SEED.price), status: SEED.status }),
  });
  expect(r.status, `seed create: ${await r.clone().text()}`).toBe(201);
  const { id } = (await r.json()) as { id: string };
  expect(id, "created product id").toBeTruthy();
  return id;
}

interface V2Product {
  id: string;
  name: string;
  unitPrice: string | number;
  sku: string;
  description: string | null;
  status: string;
}

/**
 * CHECK 2 — the seeded v1 row survived the forward migration with correct
 * values: same id, name preserved, `price` renamed to `unitPrice` with its
 * value intact (compared numerically — wire money scale varies per backend),
 * `sku` back-filled to "SEED", `description` NULL (the nullable add).
 */
export async function assertForwardMigrated(base: string, id: string): Promise<void> {
  const r = await fetch(`${base}/api/products/${id}`);
  expect(r.status, `forward-migrated read: ${await r.clone().text()}`).toBe(200);
  const p = (await r.json()) as V2Product;
  expect(p.name, "name preserved").toBe(SEED.name);
  expect(Number(p.unitPrice), "renamed price value preserved as unitPrice").toBeCloseTo(
    SEED.price,
    2,
  );
  expect(p.sku, "NOT-NULL add back-filled").toBe("SEED");
  expect(p.description, "nullable add is NULL").toBeNull();
  // The enum narrowing (`status: string` → `status: Status`) did not touch the
  // stored value: the CHECK the migration adds is `NOT VALID`, so the seeded
  // row rides through untouched.
  expect(p.status, "value preserved across the string → enum narrowing").toBe(SEED.status);

  // The row must still be the ONLY row (no phantom/duplicate from the migration).
  const list = rows<V2Product>(await (await fetch(`${base}/api/products`)).json());
  expect(
    list.filter((x) => x.id === id).length,
    "exactly one surviving row for the seeded id",
  ).toBe(1);
}

/** CHECK 1 — the chain schema and the fresh-create schema are equivalent. */
export function assertSchemaEquivalent(fpChain: string, fpFresh: string): void {
  expect(fpChain, "chain-migrated schema must be non-empty").toBeTruthy();
  expect(
    fpChain,
    `migrate-chain schema drifted from a fresh create of the head model.\n` +
      `--- chain (Initial v1 → delta v2) ---\n${fpChain}\n` +
      `--- fresh (Initial v2) ---\n${fpFresh}`,
  ).toBe(fpFresh);
}

// ---------------------------------------------------------------------------
// Per-backend driver — the only backend-specific surface.  Boot mechanics and
// the out-of-band migrate step (Ecto) live here; the orchestration below is
// shared.
// ---------------------------------------------------------------------------

export interface BootHandle {
  base: string;
  bootLog: () => string;
  stop: () => void;
}

export interface BackendDriver {
  /** `__PLATFORM__` substitution value (node/python/java/dotnet/elixir). */
  platform: string;
  /** Toolchain presence check + its name (for the skip message). */
  toolchain: { name: string; check: () => boolean };
  /** One-time dependency install / compile against a freshly-generated tree. */
  install: (appDir: string) => void;
  /** Rebuild compiled artifacts after a regenerate (java bootJar); no-op else. */
  rebuild?: (appDir: string) => void;
  /**
   * Apply pending migrations OUT OF BAND where boot does not (Ecto:
   * ecto.create + ecto.migrate).  No-op for backends that migrate at boot
   * (node/python/dotnet/java).  Called before each boot against `pg`.
   */
  migrate?: (appDir: string, pg: PgConn) => void;
  /** Boot the app against `pg` on `port`.  Backends that migrate at boot do so here. */
  boot: (appDir: string, pg: PgConn, port: number) => BootHandle;
  /** Ready-poll budget (cold builds vary widely per backend). */
  readyTimeoutMs: number;
}

/** Kill a detached child's whole process group, best-effort. */
export function killChild(child: ChildProcess | undefined): void {
  if (!child?.pid) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
}

/** Wire a spawned child's stdout/stderr into an accumulating boot log + BootHandle. */
export function handleFor(
  child: ChildProcess,
  base: string,
): { handle: BootHandle; child: ChildProcess } {
  let log = "";
  child.stdout?.on("data", (c: Buffer) => {
    log += c.toString("utf8");
  });
  child.stderr?.on("data", (c: Buffer) => {
    log += c.toString("utf8");
  });
  return { child, handle: { base, bootLog: () => log, stop: () => killChild(child) } };
}

// ---------------------------------------------------------------------------
// The shared gate — runs both checks end to end for one backend.
//
//   Tree A (evolution): generate v1 → install → boot on `chain` → seed → stop
//     → regenerate v2 over the same tree → rebuild/migrate → boot on `chain`
//     → CHECK 2 (row survived) → fingerprint(chain).
//   Tree B (fresh): generate v2 fresh → install → migrate → boot on `fresh`
//     → fingerprint(fresh).
//   CHECK 1: fingerprint(chain) ≡ fingerprint(fresh).
// ---------------------------------------------------------------------------

export async function runMigrationEvolutionGate(driver: BackendDriver): Promise<void> {
  if (!driver.toolchain.check()) {
    throw new Error(
      `migration-evolution ${driver.platform}: \`${driver.toolchain.name}\` not on PATH.`,
    );
  }
  const base = readFixture("base");
  const evolved = readFixture("evolved");

  const treeA = fs.mkdtempSync(path.join(os.tmpdir(), `loom-mev-${driver.platform}-chain-`));
  const treeB = fs.mkdtempSync(path.join(os.tmpdir(), `loom-mev-${driver.platform}-fresh-`));
  const appA = path.join(treeA, "d");
  const appB = path.join(treeB, "d");

  let server: PgServer | undefined;
  const boots: BootHandle[] = [];
  const boot = async (appDir: string, pg: PgConn): Promise<BootHandle> => {
    driver.migrate?.(appDir, pg);
    const port = await freePort();
    const h = driver.boot(appDir, pg, port);
    boots.push(h);
    await waitForReady(h.base, h.bootLog, driver.readyTimeoutMs);
    return h;
  };

  try {
    server = await startPgServer();
    resetDatabase(server, "chain");
    resetDatabase(server, "fresh");
    const chain = connFor(server, "chain");
    const fresh = connFor(server, "fresh");

    // --- Tree A: v1 → seed → evolve → forward-migrate ---
    generate(base, driver.platform, treeA);
    driver.install(appA);
    const v1 = await boot(appA, chain);
    const id = await seedV1Product(v1.base);
    v1.stop();
    await settle();

    generate(evolved, driver.platform, treeA); // records the v1 → v2 delta on the chain
    driver.rebuild?.(appA);
    const v2 = await boot(appA, chain);
    await assertForwardMigrated(v2.base, id); // CHECK 2
    const fpChain = fingerprintSchema(server, "chain");
    v2.stop();
    await settle();

    // --- Tree B: fresh create of the head (v2) model ---
    generate(evolved, driver.platform, treeB);
    driver.install(appB);
    const fb = await boot(appB, fresh);
    const fpFresh = fingerprintSchema(server, "fresh");
    fb.stop();

    assertSchemaEquivalent(fpChain, fpFresh); // CHECK 1
  } finally {
    for (const b of boots) b.stop();
    server?.stop();
    for (const dir of [treeA, treeB]) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    }
  }
}

/** Give a killed detached child a moment to release its port before the reboot. */
function settle(): Promise<void> {
  return new Promise((r) => setTimeout(r, 1_500));
}

// ---------------------------------------------------------------------------
// M-T2.14 (numeric-types audit F15) — the pre-#2575 money-bounds CATCH-UP.
//
// #2575 bounded money's DDL to NUMERIC(19,4), but the diff comparator was
// kind-only, so a database created BEFORE it (bare DECIMAL money column, and a
// baseline snapshot with no bounds) never received an alterColumnType — the
// table and every ORM model reading it disagreed forever.  This gate builds
// that exact pre-#2575 world with psql alone (no backend boot — seconds, not
// minutes), then proves the two halves of the fix:
//   (a) regeneration now DIFFS the bound change out, but refuses to apply it
//       silently — the catch-up rounds >4-dp rows, so it is destructive and
//       aborts without --allow-destructive;
//   (b) with the flag, the delta applies: information_schema reports (19,4)
//       and an existing 6-dp row survives rounded, exactly as reviewed.
// ---------------------------------------------------------------------------
export async function runMoneyBoundsCatchUpGate(): Promise<void> {
  const base = readFixture("base");
  const tree = fs.mkdtempSync(path.join(os.tmpdir(), "loom-mev-money-bounds-"));
  let server: PgServer | undefined;
  try {
    generate(base, "node", tree);
    const migDir = path.join(tree, "d", "db", "migrations");
    const initial = fs.readdirSync(migDir).find((f) => f.endsWith(".sql"));
    if (!initial) throw new Error(`no initial migration emitted under ${migDir}`);
    const initialSql = fs.readFileSync(path.join(migDir, initial), "utf8");
    if (!initialSql.includes("DECIMAL(19, 4)")) {
      throw new Error("fixture no longer carries a money column — the gate needs one");
    }

    server = await startPgServer();
    resetDatabase(server, "catchup");

    // A genuine pre-#2575 database: the same schema with the money bound
    // erased — exactly what the old DDL emitter created.
    psql(server, "catchup", initialSql.replaceAll("DECIMAL(19, 4)", "DECIMAL"));

    // …and the matching pre-#2575 baseline: strip the bounds from the money
    // column in the recorded chain entry's schema (schema/table/column
    // discovered from the entry itself, not hard-coded).
    const entryFile = fs.readdirSync(chainDir(tree)).find((f) => f.endsWith(".json"));
    if (!entryFile) throw new Error(`no recorded migration under ${chainDir(tree)}`);
    const entryPath = path.join(chainDir(tree), entryFile);
    const entry = JSON.parse(fs.readFileSync(entryPath, "utf8"));
    const snap = entry.schema;
    let stripped = 0;
    let moneyTable = "";
    let moneyColumn = "";
    let moneySchema: string | undefined;
    for (const t of snap.tables ?? []) {
      for (const c of t.columns ?? []) {
        if (c.type?.kind === "decimal" && c.type.precision !== undefined) {
          c.type = { kind: "decimal" };
          stripped++;
          moneyTable = t.name;
          moneyColumn = c.name;
          moneySchema = t.schema;
        }
      }
    }
    if (stripped !== 1)
      throw new Error(`expected exactly one bounded money column, saw ${stripped}`);
    fs.writeFileSync(entryPath, JSON.stringify(entry, null, 2));
    const qualifiedTable = moneySchema ? `"${moneySchema}"."${moneyTable}"` : `"${moneyTable}"`;

    // A row only the unbounded column can hold: 6 fractional digits.
    // `status` is NOT NULL with no default (it carries the base fixture's
    // string → enum narrowing), so a raw INSERT has to supply it.  Any value
    // does here — this gate is about the money column's BOUNDS, and the row is
    // written before the v2 enum constraint exists.
    psql(
      server,
      "catchup",
      `INSERT INTO ${qualifiedTable} ("id", "name", "status", "${moneyColumn}") ` +
        `VALUES (gen_random_uuid(), 'pre-2575 row', 'draft', 9.999995)`,
    );

    // (a) The catch-up is diffed out but GATED: regeneration without the flag
    // must abort naming the destructive review path.
    let refused = "";
    try {
      generate(base, "node", tree);
    } catch (e) {
      refused = (e as Error).message;
    }
    if (!/destructive/i.test(refused)) {
      throw new Error(
        `expected regeneration to abort as destructive without --allow-destructive; got: ${
          refused || "success"
        }`,
      );
    }

    // (b) With the flag: a delta migration exists and applies.
    generate(base, "node", tree, { allowDestructive: true });
    const delta = fs
      .readdirSync(migDir)
      .filter((f) => f.endsWith(".sql") && f !== initial)
      .sort();
    if (delta.length !== 1) {
      throw new Error(`expected exactly one delta migration, saw [${delta.join(", ")}]`);
    }
    psql(server, "catchup", fs.readFileSync(path.join(migDir, delta[0]!), "utf8"));

    const bounds = psql(
      server,
      "catchup",
      `SELECT numeric_precision || ',' || numeric_scale FROM information_schema.columns ` +
        `WHERE table_name = '${moneyTable}' AND column_name = '${moneyColumn}'`,
    );
    if (bounds !== "19,4") {
      throw new Error(`money column bounds after catch-up: expected 19,4 got '${bounds}'`);
    }
    const value = psql(server, "catchup", `SELECT "${moneyColumn}" FROM ${qualifiedTable}`);
    if (value !== "10.0000") {
      throw new Error(`expected the 6-dp row to survive rounded to 10.0000, got '${value}'`);
    }
  } finally {
    server?.stop();
    try {
      fs.rmSync(tree, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
}

// ---------------------------------------------------------------------------
// Value-collection evolution gate (M-T2.15 / #2864 D1).
//
// Adding a value-object COLLECTION field to an aggregate already in the
// baseline used to emit, alongside the correct id-less child table, a phantom
// root column:
//
//   ALTER TABLE "ord"."orders" ADD COLUMN "lines" JSONB[] NULL;
//   ALTER TABLE "ord"."orders" ALTER COLUMN "lines" SET NOT NULL;
//
// No backend creates that column on a fresh generate and no ORM maps it, so
// nothing ever writes it — every INSERT after the migration failed the NOT NULL
// constraint permanently.  On a POPULATED table the `SET NOT NULL` failed at
// apply time instead, which is why this gate seeds a row BEFORE migrating: it
// catches both halves of the defect, and only a live Postgres can show either.
//
// Deliberately does NOT boot the backend — the defect is in the emitted DDL, so
// psql alone is a complete and much faster proof.
// ---------------------------------------------------------------------------
export async function runValueCollectionEvolutionGate(): Promise<void> {
  const v1 = readFixture("vo-collection-base");
  const v2 = readFixture("vo-collection-evolved");
  const tree = fs.mkdtempSync(path.join(os.tmpdir(), "loom-mev-vo-collection-"));
  let server: PgServer | undefined;
  try {
    generate(v1, "node", tree);
    const migDir = path.join(tree, "d", "db", "migrations");
    const initial = fs.readdirSync(migDir).find((f) => f.endsWith(".sql"));
    if (!initial) throw new Error(`no initial migration emitted under ${migDir}`);

    // The Initial migration is the control: it must already omit the phantom
    // column.  If this ever fails the defect has moved into the create path and
    // the rest of the gate would be testing the wrong thing.
    const initialSql = fs.readFileSync(path.join(migDir, initial), "utf8");
    expect(initialSql).not.toMatch(/"lines"/);

    server = await startPgServer();
    resetDatabase(server, "vocollection");
    psql(server, "vocollection", initialSql);

    // A pre-existing row — the state that turns the phantom `SET NOT NULL` from
    // "every future insert fails" into "the migration itself fails".
    psql(
      server,
      "vocollection",
      `INSERT INTO "ord"."orders" ("id", "note", "version") ` +
        `VALUES ('11111111-1111-1111-1111-111111111111', 'seeded', 1)`,
    );

    // (a) The evolution is NOT destructive.  Pre-fix this threw, naming
    // `ADD COLUMN ord.orders.lines NOT NULL (no default)` — adding a
    // value-collection field is a pure table add and needs no flag.
    generate(v2, "node", tree);

    const deltas = fs
      .readdirSync(migDir)
      .filter((f) => f.endsWith(".sql") && f !== initial)
      .sort();
    if (deltas.length !== 1) {
      throw new Error(`expected exactly one delta migration, saw [${deltas.join(", ")}]`);
    }
    const deltaSql = fs.readFileSync(path.join(migDir, deltas[0]!), "utf8");

    // (b) The delta creates the child table and touches no column on the root.
    expect(deltaSql).toMatch(/CREATE TABLE "ord"\."order_lines"/);
    expect(deltaSql).not.toMatch(/ALTER TABLE "ord"\."orders"/);
    expect(deltaSql).not.toMatch(/"lines"/);

    // (c) It applies to the POPULATED database.
    psql(server, "vocollection", deltaSql);

    // (d) `orders` still has exactly its v1 columns — no phantom `lines`.
    const cols = psql(
      server,
      "vocollection",
      `SELECT string_agg(column_name, ',' ORDER BY ordinal_position) ` +
        `FROM information_schema.columns ` +
        `WHERE table_schema = 'ord' AND table_name = 'orders'`,
    );
    expect(cols).toBe("id,note,version");

    // (e) The seeded row survived, and a NEW row still inserts — the assertion
    // the whole finding is about.
    expect(psql(server, "vocollection", `SELECT "note" FROM "ord"."orders"`)).toBe("seeded");
    psql(
      server,
      "vocollection",
      `INSERT INTO "ord"."orders" ("id", "note", "version") ` +
        `VALUES ('22222222-2222-2222-2222-222222222222', 'post-migration', 1)`,
    );
    psql(
      server,
      "vocollection",
      `INSERT INTO "ord"."order_lines" ("order_id", "ordinal", "sku", "qty") ` +
        `VALUES ('22222222-2222-2222-2222-222222222222', 0, 'SKU-1', 3)`,
    );
    const joined = psql(
      server,
      "vocollection",
      `SELECT o."note" || '/' || l."sku" || '/' || l."qty" FROM "ord"."orders" o ` +
        `JOIN "ord"."order_lines" l ON l."order_id" = o."id"`,
    );
    expect(joined).toBe("post-migration/SKU-1/3");
  } finally {
    server?.stop();
    try {
      fs.rmSync(tree, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
}

// ---------------------------------------------------------------------------
// Field-default evolution gate (M-T2.16 / #2864 G1, decision D-3).
//
// `status: string = "pending"` never reached the DDL, so the obvious way to add
// a required column to a live table was destructive: the add came out as a bare
//
//   ALTER TABLE "ord"."orders" ADD COLUMN "status" TEXT NOT NULL;
//
// which Postgres rejects on any populated table.  The author had to pass
// --allow-destructive and fill in a `-- TODO backfill` comment by hand, or
// restate the value in a `migration "…" { Order.status = "pending" }` block.
//
// D-3 rejects a persistent column default — a second source of truth for a
// value the domain layer owns — and takes the middle path: the DEFAULT exists
// only for the width of the add, then is dropped in the same migration.  That
// makes three claims at once, and only a live Postgres can settle them
// together, because they are claims about a table that ALREADY HAS ROWS:
//
//   (a) the migration applies to a populated table with no flag;
//   (b) the pre-existing rows come out holding the declared value, with no
//       backfill written by the author;
//   (c) the column is left with NO default — so a database grown by migration
//       and one built from a fresh CREATE TABLE are the same database.
//
// (c) is the half a unit test cannot really reach: it is an assertion about
// `information_schema`, compared against a schema Postgres built independently.
//
// Deliberately does NOT boot the backend — the whole finding lives in the
// emitted DDL, so psql alone is a complete and much faster proof.
// ---------------------------------------------------------------------------
export async function runFieldDefaultEvolutionGate(): Promise<void> {
  const v1 = readFixture("field-default-base");
  const v2 = readFixture("field-default-evolved");
  const tree = fs.mkdtempSync(path.join(os.tmpdir(), "loom-mev-field-default-"));
  const freshTree = fs.mkdtempSync(path.join(os.tmpdir(), "loom-mev-field-default-fresh-"));
  let server: PgServer | undefined;
  try {
    generate(v1, "node", tree);
    const migDir = path.join(tree, "d", "db", "migrations");
    const initial = fs.readdirSync(migDir).find((f) => f.endsWith(".sql"));
    if (!initial) throw new Error(`no initial migration emitted under ${migDir}`);
    const initialSql = fs.readFileSync(path.join(migDir, initial), "utf8");

    const pg = await startPgServer();
    server = pg;
    resetDatabase(pg, "fielddefault");
    psql(pg, "fielddefault", initialSql);

    // A row written under v1, when the column did not exist at all.  This is
    // what the whole finding is about: without the DEFAULT on the add, the
    // migration below fails outright on exactly this state.
    psql(
      pg,
      "fielddefault",
      `INSERT INTO "ord"."orders" ("id", "note", "version") ` +
        `VALUES ('11111111-1111-1111-1111-111111111111', 'seeded', 1)`,
    );

    // (a) Generating the evolution is NOT destructive.  Pre-fix this threw,
    // naming `ADD COLUMN ord.orders.status NOT NULL (no default)`.
    generate(v2, "node", tree);

    const deltas = fs
      .readdirSync(migDir)
      .filter((f) => f.endsWith(".sql") && f !== initial)
      .sort();
    if (deltas.length !== 1) {
      throw new Error(`expected exactly one delta migration, saw [${deltas.join(", ")}]`);
    }
    const deltaSql = fs.readFileSync(path.join(migDir, deltas[0]!), "utf8");
    expect(deltaSql).toContain(
      `ALTER TABLE "ord"."orders" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'pending';`,
    );
    expect(deltaSql).toContain(`ALTER TABLE "ord"."orders" ALTER COLUMN "status" DROP DEFAULT;`);
    // No hand-holding: the author wrote no backfill and got no TODO.
    expect(deltaSql).not.toContain("TODO backfill");

    // (b) It applies to the POPULATED database, and the pre-existing row comes
    // out holding the declared value.
    psql(pg, "fielddefault", deltaSql);
    expect(psql(pg, "fielddefault", `SELECT "status" FROM "ord"."orders"`)).toBe("pending");

    // (c) …and the column kept NO default.  Compared against a schema Postgres
    // built independently from the v2 source, so this is "the two databases are
    // the same", not "the string I expected came back".
    generate(v2, "node", freshTree);
    const freshMigDir = path.join(freshTree, "d", "db", "migrations");
    const freshInitial = fs.readdirSync(freshMigDir).find((f) => f.endsWith(".sql"));
    if (!freshInitial) throw new Error(`no initial migration emitted under ${freshMigDir}`);
    const freshSql = fs
      .readFileSync(path.join(freshMigDir, freshInitial), "utf8")
      .replaceAll(`"ord"`, `"ord_fresh"`);
    psql(pg, "fielddefault", freshSql);
    // Ordered by NAME, not ordinal: `ALTER TABLE … ADD COLUMN` appends, so a
    // migrated table carries a later-added column last while a fresh CREATE
    // TABLE places it in declaration order.  That is true of every column any
    // migration has ever added and is not something a default can change — so
    // comparing physical position would assert a property no migration holds.
    // What D-3 claims is that each column is the SAME column: type,
    // nullability, and (the point here) default.
    const describeCols = (schema: string): string =>
      psql(
        pg,
        "fielddefault",
        `SELECT string_agg(column_name || ' ' || data_type || ' null=' || is_nullable || ` +
          `' default=' || coalesce(column_default, '<none>'), '; ' ORDER BY column_name) ` +
          `FROM information_schema.columns ` +
          `WHERE table_schema = '${schema}' AND table_name = 'orders'`,
      );
    expect(describeCols("ord")).toBe(describeCols("ord_fresh"));
    expect(describeCols("ord")).toContain("status text null=NO default=<none>");

    // The contract that follows from (c), pinned in both directions so the
    // DROP DEFAULT cannot silently stop happening: an INSERT that omits the
    // column is refused on the migrated schema EXACTLY as it is on the fresh
    // one.  D-3's point is that the default never outlives its migration —
    // supplying the value stays the domain layer's job.
    const insertOmitting = (schema: string): string | undefined => {
      try {
        psql(
          pg,
          "fielddefault",
          `INSERT INTO "${schema}"."orders" ("id", "note", "version") ` +
            `VALUES ('22222222-2222-2222-2222-222222222222', 'omitted', 1)`,
        );
        return undefined;
      } catch (e) {
        return String((e as Error).message);
      }
    };
    for (const schema of ["ord", "ord_fresh"]) {
      expect(insertOmitting(schema)).toMatch(/violates not-null constraint/);
    }

    // And a row that DOES supply it still inserts — the table is working, not
    // merely well-described.
    psql(
      pg,
      "fielddefault",
      `INSERT INTO "ord"."orders" ("id", "note", "status", "version") ` +
        `VALUES ('33333333-3333-3333-3333-333333333333', 'post-migration', 'shipped', 1)`,
    );
    expect(
      psql(
        pg,
        "fielddefault",
        `SELECT string_agg("note" || '=' || "status", ',' ORDER BY "note") FROM "ord"."orders"`,
      ),
    ).toBe("post-migration=shipped,seeded=pending");

    // Re-generating against the now-baked baseline emits nothing: the delta is
    // naturally inert, so the DEFAULT/DROP pair cannot churn on every regen.
    generate(v2, "node", tree);
    expect(
      fs
        .readdirSync(migDir)
        .filter((f) => f.endsWith(".sql"))
        .sort(),
    ).toEqual([initial, deltas[0]!].sort());
  } finally {
    server?.stop();
    for (const dir of [tree, freshTree]) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    }
  }
}

// ---------------------------------------------------------------------------
// F-012 — the drizzle journal's ORDERING KEY, proved at runtime.
//
// The sibling gate above already boots twice against a populated database, and
// it passed throughout: its fixture is SINGLE-MODULE and non-provenanced, so the
// old positional key (`epochMillis(version) + arrayIndex`) happened to come out
// monotonic and nothing was ever renumbered.  This gate uses the two-module +
// `provenanced` fixture pair, which is the shape a real system has, and asserts
// the two things F-012 observed on a booted stack:
//
//   (1) the new migration ACTUALLY RUNS.  Its version lands in module Catalog's
//       block (`20260101500001`), below Billing's already-applied initial
//       (`20260102000000`) — and below the year-2999 provenance sentinel.  Under
//       a watermark migrator that meant the correct SQL was emitted and never
//       executed, with no error: `notes` simply did not exist.
//
//   (2) a `provenanced` model still BOOTS.  The provenance migration was pinned
//       last forever, so it was always the entry the positional key renumbered,
//       so it always re-ran — and `ADD COLUMN "total_provenance"` against a
//       column that already exists exits the process before it is healthy.
//
// Plus the structural invariant underneath both: an entry the database has
// already applied keeps its exact `when`, so the journal and
// `__drizzle_migrations` never stop agreeing about what has run.
//
// node/Drizzle only — it is the one backend whose migrator is a watermark
// (`lastApplied.created_at < entry.when`) rather than an applied-set.
// ---------------------------------------------------------------------------

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

function readJournal(appDir: string): JournalEntry[] {
  const p = path.join(appDir, "db", "migrations", "meta", "_journal.json");
  return JSON.parse(fs.readFileSync(p, "utf8")).entries as JournalEntry[];
}

export async function runJournalOrderingGate(driver: BackendDriver): Promise<void> {
  if (!driver.toolchain.check()) {
    throw new Error(
      `journal-ordering ${driver.platform}: \`${driver.toolchain.name}\` not on PATH.`,
    );
  }
  const tree = fs.mkdtempSync(path.join(os.tmpdir(), `loom-journal-${driver.platform}-`));
  const appDir = path.join(tree, "d");
  let server: PgServer | undefined;
  const boots: BootHandle[] = [];
  const boot = async (pg: PgConn): Promise<BootHandle> => {
    driver.migrate?.(appDir, pg);
    const port = await freePort();
    const h = driver.boot(appDir, pg, port);
    boots.push(h);
    await waitForReady(h.base, h.bootLog, driver.readyTimeoutMs);
    return h;
  };

  try {
    server = await startPgServer();
    resetDatabase(server, "journal");
    const pg = connFor(server, "journal");

    // --- v1: the first deploy.  This one was always fine. ---
    generate(readFixture("journal-order-base"), driver.platform, tree);
    driver.install(appDir);
    const v1Journal = readJournal(appDir);
    // The fixture has to actually carry the two things that reach the defect,
    // or this gate silently degrades into the single-module one that already
    // passed. Asserted here rather than assumed.
    expect(
      v1Journal.some((e) => e.tag.endsWith("_provenance")),
      `fixture must emit the late provenance migration; journal: ${v1Journal.map((e) => e.tag).join(", ")}`,
    ).toBe(true);
    expect(
      new Set(v1Journal.filter((e) => e.tag.endsWith("_initial")).map((e) => e.tag)).size,
      "fixture must span two modules (two initial migrations)",
    ).toBe(2);

    const v1 = await boot(pg);
    const id = await seedV1Product(v1.base);
    v1.stop();
    await settle();

    // What the database recorded as applied.  Drizzle writes `entry.when` into
    // `__drizzle_migrations.created_at`, and compares the MAX of that column
    // against every journal entry on the next boot.
    const appliedBefore = psql(
      server,
      "journal",
      `SELECT max(created_at) FROM drizzle.__drizzle_migrations`,
    );
    expect(appliedBefore, "v1 recorded a migration watermark").not.toBe("");

    // --- v2: the first real evolution, against a database WITH data in it. ---
    generate(readFixture("journal-order-evolved"), driver.platform, tree);
    driver.rebuild?.(appDir);
    const v2Journal = readJournal(appDir);

    // The structural invariant: regenerating must not renumber an entry the
    // database has already applied.  This is the defect itself — every later
    // entry's `when` shifted by one, so the journal stopped agreeing with
    // `__drizzle_migrations`.
    const before = new Map(v1Journal.map((e) => [e.tag, e.when]));
    for (const e of v2Journal) {
      const prior = before.get(e.tag);
      if (prior === undefined) continue; // the newly inserted delta
      if (e.tag.endsWith("_provenance")) continue; // re-homed on purpose; idempotent SQL
      expect(e.when, `\`when\` of already-applied ${e.tag} must not move`).toBe(prior);
    }
    // …and the new entry must clear the recorded watermark, or the migrator
    // skips it in silence.
    const inserted = v2Journal.filter((e) => !before.has(e.tag));
    expect(inserted.length, "exactly one new journal entry for the nullable add").toBe(1);
    expect(
      inserted[0].when,
      `inserted ${inserted[0].tag} must sort above the applied watermark ${appliedBefore}`,
    ).toBeGreaterThan(Number(appliedBefore));

    // (2) The boot itself is the assertion: the provenance migration re-running
    // against an existing `total_provenance` column used to exit the process.
    const v2 = await boot(pg);

    // (1) The delta actually ran.  This is the exact query F-012 reported as
    // returning zero rows.
    const notes = psql(
      server,
      "journal",
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'products' AND column_name = 'notes'`,
    );
    expect(notes, "the evolved model's `notes` column must exist after the second boot").toBe(
      "notes",
    );

    // The provenanced column is there exactly once, and the seeded row survived.
    const provCols = psql(
      server,
      "journal",
      `SELECT count(*) FROM information_schema.columns
        WHERE table_name = 'invoices' AND column_name = 'total_provenance'`,
    );
    expect(provCols, "one co-located provenance column on invoices").toBe("1");
    const read = await fetch(`${v2.base}/api/products/${id}`);
    expect(read.status, `seeded row survives the evolution: ${await read.clone().text()}`).toBe(
      200,
    );
    const row = (await read.json()) as { name: string; notes: string | null };
    expect(row.name, "seeded name preserved").toBe(SEED.name);
    expect(row.notes, "the nullable add reads NULL on the pre-existing row").toBeNull();

    // The journal and the database now agree: the watermark advanced to the
    // newest entry rather than being stuck behind a year-2999 sentinel.
    const appliedAfter = psql(
      server,
      "journal",
      `SELECT max(created_at) FROM drizzle.__drizzle_migrations`,
    );
    expect(Number(appliedAfter)).toBeGreaterThan(Number(appliedBefore));
    v2.stop();
  } finally {
    for (const b of boots) b.stop();
    server?.stop();
    try {
      fs.rmSync(tree, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
}

// ---------------------------------------------------------------------------
// Unique-index evolution gate (#3229) — `unique (…)` keys that the per-table
// derivation has to carry across a capability flip and across inheritance.
// One tree, one database, three generations (fixture: unique-evo-base.ddd):
//
//   v1  Account `unique (number)` is a FULL index → a duplicate is a 409.
//       TPC: Party's `unique (email)` lands on BOTH concrete tables — a
//       duplicate within one subtype is a 409, the same email in the sibling
//       table is allowed (the documented `loom.unique-tpc-not-hierarchy-wide`
//       limit).  TPH: Machine's `unique (serial)` is ONE index on the shared
//       table — a duplicate through either CONCRETE's route is a 409 (it was a
//       500: the concrete's write surface did not know the key existed).
//       TPH, the CONCRETE's own key: Lathe's `unique (model)` lands on the
//       shared table as `machines_lathe_model_uq … WHERE kind = 'Lathe'` (it
//       reached no index at all).  A duplicate Lathe model is a 409; a Press
//       — which shares the `model` column but declared no key — may reuse a
//       Lathe's model (201): the key constrains exactly the rows it was
//       declared on.
//   v2  Account gains `softDeletable` → the migration REBUILDS the index as the
//       partial `WHERE is_deleted = false` (it used to keep the full one, the
//       diff pairing indexes by name only).  A soft-deleted row's key can be
//       reused (201); a live duplicate is still a 409.
//       The generation carries NO backfill block and NO flag: the capability's
//       `is_deleted NOT NULL` is added WITH `DEFAULT false` (then the default
//       is dropped), so the populated table migrates and the v1 row still
//       reads 200, flagged `false`.  (It used to refuse without
//       `--allow-destructive`.)
//       DELETE semantics: `crudish`'s `DELETE /{id}` on the softDeletable
//       aggregate stays a HARD delete — documented (`loom.crudish-hard-delete`
//       advises), so the row is physically gone, not flagged.
//   v3  Account drops `softDeletable` again → the index is rebuilt FULL.  That
//       tightens over rows that now collide, so the generation carries the
//       `sql before` dedupe `loom.migration-unique-on-existing-table` asks for;
//       the migration applies and a duplicate is a 409 again.
// ---------------------------------------------------------------------------

const ACCOUNT_V1 = "aggregate Account with crudish {";

/** Remove one column from the recorded baseline under `tree` — the head
 *  migration-chain entry whose schema has `table` — the "this database
 *  predates the column" half of a catch-up scenario (the other half is
 *  dropping it from the database itself). */
function dropBaselineColumn(tree: string, table: string, column: string): void {
  const entries = fs
    .readdirSync(chainDir(tree))
    .filter((n) => n.endsWith(".json"))
    .sort((a, b) => (BigInt(a.split("_")[0]!) < BigInt(b.split("_")[0]!) ? -1 : 1));
  type Entry = { schema: { tables?: { name: string; columns?: { name: string }[] }[] } };
  for (const f of [...entries].reverse()) {
    const p = path.join(chainDir(tree), f);
    const entry = JSON.parse(fs.readFileSync(p, "utf8")) as Entry;
    const t = entry.schema.tables?.find((x) => x.name === table);
    if (!t?.columns) continue;
    const before = t.columns.length;
    t.columns = t.columns.filter((c) => c.name !== column);
    if (before - t.columns.length !== 1) {
      throw new Error(`expected one ${table}.${column} in the head entry ${f}`);
    }
    fs.writeFileSync(p, JSON.stringify(entry, null, 2));
    return;
  }
  throw new Error(`no recorded migration has table ${table}`);
}
const ACCOUNT_SOFT = "aggregate Account with softDeletable, crudish {";

export async function runUniqueIndexEvolutionGate(driver: BackendDriver): Promise<void> {
  if (!driver.toolchain.check()) {
    throw new Error(
      `unique-index evolution ${driver.platform}: \`${driver.toolchain.name}\` not on PATH.`,
    );
  }
  const v1Src = readFixture("unique-evo-base");
  expect(v1Src, "fixture carries the v1 Account header").toContain(ACCOUNT_V1);
  // No `migration { Account.isDeleted = false }` block: the capability's own
  // column backfills itself.
  const v2Src = v1Src.replace(ACCOUNT_V1, ACCOUNT_SOFT);
  const v3Src = `${v1Src}
migration "harden" { sql before "DELETE FROM ledger.accounts WHERE is_deleted = true" }
`;

  const tree = fs.mkdtempSync(path.join(os.tmpdir(), `loom-uqevo-${driver.platform}-`));
  const appDir = path.join(tree, "d");
  let server: PgServer | undefined;
  const boots: BootHandle[] = [];
  const boot = async (pg: PgConn): Promise<BootHandle> => {
    driver.migrate?.(appDir, pg);
    const port = await freePort();
    const h = driver.boot(appDir, pg, port);
    boots.push(h);
    await waitForReady(h.base, h.bootLog, driver.readyTimeoutMs);
    return h;
  };
  const postFor = async (
    base: string,
    resource: string,
    body: object,
  ): Promise<{ status: number; id?: string }> => {
    const r = await fetch(`${base}/api/${resource}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await r.text();
    let id: string | undefined;
    try {
      id = (JSON.parse(text) as { id?: string }).id;
    } catch {
      /* a problem body or an empty one */
    }
    return { status: r.status, id };
  };
  const post = async (base: string, resource: string, body: object): Promise<number> =>
    (await postFor(base, resource, body)).status;
  const DB = "uniqevo";
  const indexDef = (s: PgServer, name: string): string =>
    psql(s, DB, `SELECT indexdef FROM pg_indexes WHERE indexname = '${name}'`);

  try {
    server = await startPgServer();
    resetDatabase(server, DB);
    const pg = connFor(server, DB);

    // --- v1 ---------------------------------------------------------------
    generate(v1Src, driver.platform, tree);
    driver.install(appDir);
    const v1 = await boot(pg);
    expect(indexDef(server, "accounts_number_uq"), "v1: full unique").toMatch(/\(number\)$/);
    const alice = await postFor(v1.base, "accounts", { number: "ACC-1", owner: "alice" });
    expect(alice.status).toBe(201);
    expect(alice.id, "v1: the create answers the new row's id").toBeTruthy();
    expect(await post(v1.base, "accounts", { number: "ACC-1", owner: "bob" }), "v1 dup").toBe(409);

    // TPC: a per-concrete index on each table, none for the abstract base.
    expect(indexDef(server, "customers_email_uq"), "TPC: customers index").toMatch(/\(email\)/);
    expect(indexDef(server, "suppliers_email_uq"), "TPC: suppliers index").toMatch(/\(email\)/);
    expect(indexDef(server, "parties_email_uq"), "TPC: the base owns no table").toBe("");
    const party = { name: "Acme", email: "a@x.com" };
    expect(await post(v1.base, "customers", { ...party, creditLimit: 10 })).toBe(201);
    expect(
      await post(v1.base, "customers", { ...party, creditLimit: 20 }),
      "TPC: duplicate within Customer",
    ).toBe(409);
    expect(
      await post(v1.base, "suppliers", { ...party, rating: 3 }),
      "TPC: the sibling table may share the email (not hierarchy-wide)",
    ).toBe(201);
    expect(
      await post(v1.base, "suppliers", { ...party, rating: 4 }),
      "TPC: duplicate within Supplier",
    ).toBe(409);

    // TPH: one index on the shared table, mapped to 409 on every concrete route.
    expect(indexDef(server, "machines_serial_uq"), "TPH: shared-table index").toMatch(/\(serial\)/);
    const lathe = await postFor(v1.base, "lathes", { serial: "S-1", spindles: 2, model: "L-1" });
    expect(lathe.status).toBe(201);
    expect(
      await post(v1.base, "lathes", { serial: "S-1", spindles: 3, model: "L-2" }),
      "TPH: duplicate through the same concrete",
    ).toBe(409);
    expect(
      await post(v1.base, "presses", { serial: "S-1", tonnage: 50, model: "P-1" }),
      "TPH: duplicate through a sibling concrete (one table, hierarchy-wide)",
    ).toBe(409);

    // TPH, the CONCRETE's own key: Lathe `unique (model)`.  Written first, so a
    // missing index shows up as the 201 it used to answer.
    expect(
      await post(v1.base, "lathes", { serial: "S-2", spindles: 1, model: "L-1" }),
      "TPH concrete key: a duplicate Lathe model",
    ).toBe(409);
    expect(
      await post(v1.base, "presses", { serial: "S-3", tonnage: 10, model: "L-1" }),
      "TPH concrete key: a Press shares the model column, not Lathe's key",
    ).toBe(201);
    expect(
      indexDef(server, "machines_lathe_model_uq"),
      "TPH concrete key: partial on kind",
    ).toMatch(/\(model\) WHERE \(kind = 'Lathe'::text\)$/);
    v1.stop();
    await settle();

    // --- between v1 and v2: a POPULATED TPH table from before `versioned` --
    // Every aggregate is versioned by default (M-T3.4), so no `.ddd` can spell
    // "v1 without `versioned`" any more — but a database created before that
    // has a populated TPH shared table with no `version` column, and the next
    // generation must add it.  Recreate exactly that state, the way the
    // money-bounds catch-up gate recreates a pre-#2575 one: drop the column
    // from the database AND from the committed baseline snapshot.  The v2
    // diff then adds `version` to a table holding rows.  It applies with no
    // flag, and the column must end `NOT NULL DEFAULT 1` like every other
    // versioned table.  The TPH shared table used to miss that default (the
    // add then went through the field-default backfill path, which drops the
    // default again), so a migrated TPH table disagreed with a plain one.
    psql(server, DB, `ALTER TABLE ledger.machines DROP COLUMN version`);
    dropBaselineColumn(tree, "machines", "version");

    // --- v2: + softDeletable → partial ------------------------------------
    generate(v2Src, driver.platform, tree);
    driver.rebuild?.(appDir);
    const v2 = await boot(pg);
    // `versioned` re-added to the populated TPH table: applied with no flag,
    // every pre-existing row seeded at version 1, and the row still reads 200.
    expect(
      psql(
        server,
        DB,
        `SELECT coalesce(column_default, '<none>') || ' ' || is_nullable FROM information_schema.columns
          WHERE table_schema = 'ledger' AND table_name = 'machines' AND column_name = 'version'`,
      ),
      "v2: the TPH shared table's version column is NOT NULL DEFAULT 1",
    ).toBe("1 NO");
    expect(
      psql(server, DB, `SELECT string_agg(DISTINCT version::text, ',') FROM ledger.machines`),
      "v2: every pre-existing TPH row is at version 1",
    ).toBe("1");
    const latheRead = await fetch(`${v2.base}/api/lathes/${lathe.id}`);
    expect(latheRead.status, `v2: the v1 Lathe survives: ${await latheRead.clone().text()}`).toBe(
      200,
    );
    await latheRead.text();
    expect(indexDef(server, "accounts_number_uq"), "v2: rebuilt partial").toMatch(
      /WHERE \(?is_deleted = false\)?$/,
    );
    // The capability column backfilled itself: the v1 row is still readable
    // (the `!isDeleted` read filter admits it) and holds `false`, and the
    // transient DEFAULT is gone again (the column matches a fresh CREATE).
    const aliceRead = await fetch(`${v2.base}/api/accounts/${alice.id}`);
    expect(aliceRead.status, `v2: the v1 row survives: ${await aliceRead.clone().text()}`).toBe(
      200,
    );
    expect(((await aliceRead.json()) as { owner: string }).owner).toBe("alice");
    expect(
      psql(server, DB, `SELECT is_deleted FROM ledger.accounts WHERE number = 'ACC-1'`),
      "v2: the existing row is backfilled not-deleted",
    ).toBe("f");
    expect(
      psql(
        server,
        DB,
        `SELECT coalesce(column_default, '<none>') || ' ' || is_nullable FROM information_schema.columns
          WHERE table_name = 'accounts' AND column_name = 'is_deleted'`,
      ),
      "v2: is_deleted ends NOT NULL with no lingering default",
    ).toBe("<none> NO");

    // crudish's DELETE on a softDeletable aggregate: a HARD delete (documented).
    const doomed = await postFor(v2.base, "accounts", { number: "ACC-DEL", owner: "zed" });
    expect(doomed.status).toBe(201);
    const del = await fetch(`${v2.base}/api/accounts/${doomed.id}`, { method: "DELETE" });
    await del.text();
    expect(del.status, "v2: crudish DELETE answers 204").toBe(204);
    expect(
      psql(server, DB, `SELECT count(*) FROM ledger.accounts WHERE number = 'ACC-DEL'`),
      "v2: crudish DELETE removed the row (hard delete), it did not flag it",
    ).toBe("0");

    // Soft-delete alice's row the way the capability does (flag, not DELETE).
    psql(server, DB, `UPDATE ledger.accounts SET is_deleted = true WHERE number = 'ACC-1'`);
    expect(
      await post(v2.base, "accounts", { number: "ACC-1", owner: "carol" }),
      "v2: a live row reuses a soft-deleted row's key",
    ).toBe(201);
    expect(
      await post(v2.base, "accounts", { number: "ACC-1", owner: "dave" }),
      "v2: a duplicate of a LIVE row is still refused",
    ).toBe(409);
    expect(
      psql(server, DB, `SELECT count(*) FROM ledger.accounts WHERE number = 'ACC-1'`),
      "v2: the soft-deleted row and the live one coexist",
    ).toBe("2");
    v2.stop();
    await settle();

    // --- v3: − softDeletable → full again (dedupe first) --------------------
    generate(v3Src, driver.platform, tree, { allowDestructive: true });
    driver.rebuild?.(appDir);
    const v3 = await boot(pg);
    expect(indexDef(server, "accounts_number_uq"), "v3: rebuilt full").toMatch(/\(number\)$/);
    expect(
      psql(server, DB, `SELECT owner FROM ledger.accounts WHERE number = 'ACC-1'`),
      "v3: the `sql before` dedupe removed the soft-deleted row ahead of the index",
    ).toBe("carol");
    expect(
      await post(v3.base, "accounts", { number: "ACC-1", owner: "erin" }),
      "v3: duplicate refused by the full index",
    ).toBe(409);
    v3.stop();
  } finally {
    for (const b of boots) b.stop();
    server?.stop();
    try {
      fs.rmSync(tree, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
}
