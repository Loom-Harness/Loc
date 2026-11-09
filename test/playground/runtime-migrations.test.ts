import { describe, expect, it } from "vitest";
import { NO_TRANSACTION_MARKER } from "../../src/generator/sql-pg.js";
import { STATEMENT_BREAKPOINT } from "../../src/generator/typescript/emit/migrations.js";
import { parseChain } from "../../src/system/migration-chain.js";
import { migrationPlan, recordMigration } from "../../web/src/build/evolution.js";
import type {
  EvolutionTree,
  MigrationPlanOk,
  RecordMigrationOk,
  VfsEntry,
} from "../../web/src/build/protocol.js";
import {
  blockingMessage,
  DDL_HASH_KEY,
  HEAD_KEY,
  migrateChain,
  rebuildChain,
  type SqlHandle,
} from "../../web/src/runtime/migrate.js";
import type { MigrationPlan, MigrationUnitPlan } from "../../web/src/runtime/protocol.js";
import { generateSystemFiles } from "../_helpers/generate.js";

// The playground's runtime database evolves only by the recorded migration
// chain.  `migrationPlan` (build worker) renders the chain to the SQL the
// generated Hono backend's `db/migrations/` carries; `migrateChain` (runtime
// worker) applies the units after the head `__loom.schema_meta` records, and
// writes nothing while the model has unrecorded changes.  The real-PGlite leg
// of the same path is `web/scripts/smoke-runtime.mjs`.

const ENTRY = "/workspace/main.ddd";

const V1 = `subdomain Sales {
  context Sales {
    aggregate Customer with crudish { name: string email: string }
  }
}
system Shop {
  storage primary { type: postgres }
  resource salesState { for: Sales, kind: state, use: primary }
  deployable api { platform: node contexts: [Sales] dataSources: [salesState] port: 3000 }
}`;

const V2_ADDED = V1.replace("email: string", "email: string phone: string?");
const V2_DROPPED = V1.replace(" email: string", "");
const V2_INDEXED = V1.replace("use: primary }", "use: primary, index: [Customer.email] }");

function tree(source: string, chain: VfsEntry[] = []): EvolutionTree {
  return { entryPath: ENTRY, files: [{ kind: "file", path: ENTRY, content: source }, ...chain] };
}

async function record(
  source: string,
  name: string,
  chain: VfsEntry[] = [],
  allowDestructive = false,
): Promise<VfsEntry[]> {
  const r = await recordMigration({
    current: tree(source, chain),
    name,
    now: "20261025120000",
    allowDestructive,
  });
  expect(r.ok, JSON.stringify(r.diagnostics)).toBe(true);
  const files = (r as RecordMigrationOk).files.map(
    (f): VfsEntry => ({ kind: "file", path: f.path, content: f.content }),
  );
  return [...chain, ...files];
}

async function plan(source: string, chain: VfsEntry[] = []): Promise<ChainPlan> {
  const r = await migrationPlan({ current: tree(source, chain) });
  expect(r.ok, JSON.stringify(r.diagnostics)).toBe(true);
  const p = (r as MigrationPlanOk).plan;
  expect(p.kind).toBe("chain");
  return p as ChainPlan;
}

type ChainPlan = Extract<MigrationPlan, { kind: "chain" }>;

/** An in-memory stand-in for PGlite's `exec`/`query`, modelling exactly what
 *  the bookkeeping touches: whether `__loom.schema_meta` exists, its rows, and
 *  transactions (an upsert inside BEGIN lands only on COMMIT).  Every other
 *  statement is recorded in `executed`; one containing `FAIL_HERE` throws. */
class FakeDb implements SqlHandle {
  meta: Map<string, string> | null = null;
  executed: string[] = [];
  private txn: Map<string, string> | null = null;

  constructor(meta?: Record<string, string>) {
    if (meta) this.meta = new Map(Object.entries(meta));
  }

  async exec(sql: string): Promise<unknown> {
    if (sql.startsWith("CREATE SCHEMA IF NOT EXISTS __loom")) {
      this.meta ??= new Map();
    } else if (sql === "DELETE FROM __loom.schema_meta") {
      this.meta?.clear();
    } else if (sql === "BEGIN") {
      this.txn = new Map();
    } else if (sql === "COMMIT") {
      for (const [k, v] of this.txn ?? []) this.meta!.set(k, v);
      this.txn = null;
    } else if (sql === "ROLLBACK") {
      this.txn = null;
    } else if (sql.includes("FAIL_HERE")) {
      throw { message: "relation does not exist", severity: "ERROR" };
    } else {
      this.executed.push(sql);
    }
    return undefined;
  }

  async query(
    sql: string,
    params: unknown[] = [],
  ): Promise<{ rows: Array<Record<string, unknown>> }> {
    if (sql.includes("to_regclass")) return { rows: [{ present: this.meta !== null }] };
    if (sql.startsWith("SELECT key, value")) {
      return { rows: [...(this.meta ?? [])].map(([key, value]) => ({ key, value })) };
    }
    if (sql.startsWith("INSERT INTO __loom.schema_meta")) {
      const [k, v] = params as [string, string];
      (this.txn ?? this.meta!).set(k, v);
      return { rows: [] };
    }
    throw new Error(`FakeDb: unexpected query ${sql}`);
  }
}

const unit = (id: string, statements: string[], transactional = true): MigrationUnitPlan => ({
  id,
  statements,
  transactional,
});

const U1 = unit("1_sales_initial", ['CREATE TABLE "sales"."customers" ()']);
const U2 = unit("2_sales_add_phone", ['ALTER TABLE "sales"."customers" ADD COLUMN "phone" text']);
const U3 = unit("3_sales_add_city", ['ALTER TABLE "sales"."customers" ADD COLUMN "city" text']);

describe("migrationPlan — what a boot may do to the database", () => {
  it("a workspace with no chain has nothing to apply and its whole schema unrecorded", async () => {
    const p = await plan(V1);
    expect(p.units).toEqual([]);
    expect(p.unrecorded).toMatchObject({ initial: true, modules: ["Sales"], destructive: false });
    expect(p.unrecorded!.steps).toBeGreaterThan(0);
  });

  it("renders the recorded chain to exactly the migration files `generate system` writes", async () => {
    const chain = await record(V2_INDEXED, "initial");
    const evolved = await record(
      V2_ADDED.replace("use: primary }", "use: primary, index: [Customer.email] }"),
      "add-phone",
      chain,
    );
    const source = V2_ADDED.replace("use: primary }", "use: primary, index: [Customer.email] }");
    const p = await plan(source, evolved);
    expect(p.unrecorded).toBeNull();

    const files = await generateSystemFiles(source, {
      migrationChain: parseChain(
        evolved.map((f) => ({
          name: f.path.slice(f.path.lastIndexOf("/") + 1),
          content: (f as { content: string }).content,
        })),
      ),
    });
    const emitted = [...files.keys()]
      .filter((k) => /^api\/db\/migrations\/[^/]+\.sql$/.test(k))
      .sort();
    expect(p.units.map((u) => `api/db/migrations/${u.id}.sql`)).toEqual(emitted);
    for (const u of p.units) {
      const sql = files.get(`api/db/migrations/${u.id}.sql`)!;
      expect(u.transactional).toBe(!sql.startsWith(NO_TRANSACTION_MARKER));
      const body = u.transactional ? sql : sql.slice(NO_TRANSACTION_MARKER.length);
      expect(u.statements).toEqual(
        body
          .split(STATEMENT_BREAKPOINT)
          .map((s) => s.trim())
          .filter(Boolean),
      );
    }
    expect(p.units.map((u) => u.id)).toEqual([
      "20261025120000_sales_initial",
      expect.stringMatching(/_sales_add_phone$/),
    ]);
  });

  it("an unrecorded change after the chain is pending, flagged destructive when it drops", async () => {
    const chain = await record(V1, "initial");
    const added = await plan(V2_ADDED, chain);
    expect(added.units).toHaveLength(1);
    expect(added.unrecorded).toMatchObject({
      initial: false,
      modules: ["Sales"],
      steps: 1,
      destructive: false,
    });
    const dropped = await plan(V2_DROPPED, chain);
    expect(dropped.unrecorded).toMatchObject({ initial: false, destructive: true });
  });

  it("a destructive change recorded with the acknowledgement is applied like any other", async () => {
    const chain = await record(V1, "initial");
    const both = await record(V2_DROPPED, "drop-email", chain, true);
    const p = await plan(V2_DROPPED, both);
    expect(p.unrecorded).toBeNull();
    expect(p.units.at(-1)!.statements.join("\n")).toMatch(/DROP COLUMN "email"/);
  });

  it("a source without a system is unversioned — no chain can be recorded for it", async () => {
    const r = await migrationPlan({
      current: tree("context Sales { aggregate Customer { name: string } }"),
    });
    expect(r.ok && r.plan).toEqual({ kind: "unversioned" });
  });

  it("a chain that does not read refuses the plan", async () => {
    const r = await migrationPlan({
      current: tree(V1, [{ kind: "file", path: "/workspace/migrations/1_x.json", content: "{" }]),
    });
    expect(r.ok).toBe(false);
    expect(r.diagnostics.map((d) => d.code)).toContain("loom.migration-chain-invalid");
  });
});

describe("migrateChain — the runtime's boot-time migration", () => {
  it("initial pending: no chain recorded ⇒ nothing is created, not even the bookkeeping", async () => {
    const db = new FakeDb();
    const res = await migrateChain(db, {
      kind: "chain",
      units: [],
      unrecorded: { initial: true, modules: ["Sales"], steps: 3, destructive: false },
    });
    expect(res).toEqual({
      blocked: {
        kind: "unrecorded",
        head: null,
        initial: true,
        modules: ["Sales"],
        steps: 3,
        destructive: false,
      },
    });
    expect(db.executed).toEqual([]);
    expect(db.meta).toBeNull();
    expect(blockingMessage((res as { blocked: never }).blocked)).toMatch(
      /Migration required.*Record the initial migration \(Record migration… beside Boot/,
    );
  });

  it("an empty database applies every recorded unit and records the head", async () => {
    const db = new FakeDb();
    const res = await migrateChain(db, { kind: "chain", units: [U1, U2], unrecorded: null });
    expect(res).toEqual({ applied: [U1.id, U2.id] });
    expect(db.executed).toEqual([...U1.statements, ...U2.statements]);
    expect(db.meta?.get(HEAD_KEY)).toBe(U2.id);
  });

  it("applies only the units after the recorded head", async () => {
    const db = new FakeDb({ [HEAD_KEY]: U1.id });
    const res = await migrateChain(db, { kind: "chain", units: [U1, U2, U3], unrecorded: null });
    expect(res).toEqual({ applied: [U2.id, U3.id] });
    expect(db.executed).toEqual([...U2.statements, ...U3.statements]);
    expect(db.meta?.get(HEAD_KEY)).toBe(U3.id);
  });

  it("at the head: nothing to do", async () => {
    const db = new FakeDb({ [HEAD_KEY]: U2.id });
    expect(await migrateChain(db, { kind: "chain", units: [U1, U2], unrecorded: null })).toEqual({
      applied: [],
    });
    expect(db.executed).toEqual([]);
  });

  it("unrecorded changes leave the database as it is — even units recorded but not applied", async () => {
    const db = new FakeDb({ [HEAD_KEY]: U1.id });
    const res = await migrateChain(db, {
      kind: "chain",
      units: [U1, U2],
      unrecorded: { initial: false, modules: ["Sales"], steps: 1, destructive: true },
    });
    expect(res).toMatchObject({ blocked: { kind: "unrecorded", head: U1.id, destructive: true } });
    expect(db.executed).toEqual([]);
    expect(db.meta?.get(HEAD_KEY)).toBe(U1.id);
    expect(blockingMessage((res as { blocked: never }).blocked)).toMatch(
      /1 unrecorded schema change in module Sales\. The database was left as it is\..*destructive/,
    );
  });

  it("a database an earlier playground built by DDL hash is unknown — never dropped, never migrated", async () => {
    const db = new FakeDb({ [DDL_HASH_KEY]: "abc123" });
    const res = await migrateChain(db, { kind: "chain", units: [U1], unrecorded: null });
    expect(res).toEqual({ blocked: { kind: "unknown-database", reason: "legacy", head: null } });
    expect(db.executed).toEqual([]);
  });

  it("a head the chain no longer has is unknown — never dropped, never migrated", async () => {
    const db = new FakeDb({ [HEAD_KEY]: "9_sales_removed" });
    const res = await migrateChain(db, { kind: "chain", units: [U1, U2], unrecorded: null });
    expect(res).toEqual({
      blocked: { kind: "unknown-database", reason: "diverged", head: "9_sales_removed" },
    });
    expect(db.executed).toEqual([]);
  });

  it("a unit that fails rolls back and leaves the head at the unit before it", async () => {
    const db = new FakeDb({ [HEAD_KEY]: U1.id });
    const bad = unit("3_sales_bad", ["ALTER TABLE FAIL_HERE ADD COLUMN x text"]);
    await expect(
      migrateChain(db, { kind: "chain", units: [U1, U2, bad], unrecorded: null }),
    ).rejects.toThrow(/migration 3_sales_bad failed: relation does not exist/);
    expect(db.meta?.get(HEAD_KEY)).toBe(U2.id);
  });

  it("a non-transactional unit runs each statement on its own", async () => {
    const db = new FakeDb({ [HEAD_KEY]: U1.id });
    const concurrent = unit(
      "2_sales_index_email_concurrent",
      [
        'CREATE INDEX CONCURRENTLY IF NOT EXISTS "customers_email_idx" ON "sales"."customers" ("email")',
      ],
      false,
    );
    const execs: string[] = [];
    const exec = db.exec.bind(db);
    db.exec = async (sql: string) => {
      execs.push(sql);
      return exec(sql);
    };
    await migrateChain(db, { kind: "chain", units: [U1, concurrent], unrecorded: null });
    // No BEGIN/COMMIT around it — only the idempotent bookkeeping bootstrap.
    expect(execs.filter((s) => !s.startsWith("CREATE SCHEMA IF NOT EXISTS __loom"))).toEqual(
      concurrent.statements,
    );
    expect(db.meta?.get(HEAD_KEY)).toBe(concurrent.id);
  });

  it("the explicit reset drops the schemas and rebuilds every unit from the start", async () => {
    const db = new FakeDb({ [HEAD_KEY]: U2.id, [DDL_HASH_KEY]: "legacy" });
    expect(await rebuildChain(db, [U1, U2])).toEqual([U1.id, U2.id]);
    expect(db.executed[0]).toMatch(/DROP SCHEMA IF EXISTS %I CASCADE/);
    // The bookkeeping schema survives the drop; its rows start over.
    expect(db.executed[0]).toMatch(/nspname <> '__loom'/);
    expect(db.executed.slice(1)).toEqual([...U1.statements, ...U2.statements]);
    expect([...db.meta!]).toEqual([[HEAD_KEY, U2.id]]);
  });
});
