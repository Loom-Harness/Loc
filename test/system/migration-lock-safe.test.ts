// Lock-safe migration SQL on a table that already holds rows.
//
// Two shapes used to hold an ACCESS EXCLUSIVE / SHARE lock on a populated
// table for as long as the work took, inside the migration transaction, so
// every read and write of the table stalled for the whole migration:
//
//   1. A backfilled column add rendered `ADD COLUMN … NULL` → an UPDATE over
//      every row → `SET NOT NULL` (a full scan).  When the backfill value is a
//      constant, the column is now added `DEFAULT <c>` and the default dropped
//      again — catalog-only on PG11+.  An expression backfill keeps the UPDATE.
//   2. An index added to an existing table rendered a plain `CREATE INDEX`
//      (SHARE lock: writes block for the whole build).  It is now built
//      `CONCURRENTLY`, which Postgres refuses inside a transaction, so every
//      backend applies it as a separate, non-transactional migration unit
//      right after the generation's transactional one, recorded on its own.

import { describe, expect, it } from "vitest";
import type { MigrationStep } from "../../src/ir/types/migrations-ir.js";
import {
  type ChainEntry,
  entryFileName,
  type MigrationChain,
  parseChain,
  serializeEntry,
} from "../../src/system/migration-chain.js";
import { generateSystemFiles, recordChain } from "../_helpers/generate.js";

const shop = (platform: string, v2: boolean, backfill = "Order.priority = 1") => `system Market {
  subdomain Commerce { context Store {
    enum OrderStatus { Open, Paid }
    aggregate Order with crudish {
      ref: string  status: OrderStatus  qty: int ${v2 ? "priority: int" : ""}
    }
    repository Orders for Order { }
  }}
  storage primary { type: postgres }
  resource storeState { for: Store, kind: state, use: primary${v2 ? ", index: [Order.status]" : ""} }
  deployable api { platform: ${platform}, contexts: [Store], dataSources: [storeState], port: 3000 }
}
${v2 ? `migration "priority" { ${backfill} }` : ""}
`;

const lastSteps = async (sources: string[]): Promise<MigrationStep[]> =>
  (await recordChain(sources)).entries.at(-1)!.steps;

/** Every migration file of `files`, in the order its backend's runner applies
 *  them: Flyway by numeric version, the others by file name. */
function applyOrder(files: Map<string, string>): { path: string; content: string }[] {
  const flyway = (p: string) => /V([\d.]+)__/.exec(p)![1]!.split(".").map(Number);
  const paths = [...files.keys()].filter((p) =>
    /\/(db\/migrations|migrations|db\/migration|Migrations|priv\/repo\/migrations)\/[^/]+\.(sql|cs|exs)$/.test(
      p,
    ),
  );
  paths.sort((a, b) => {
    if (a.includes("/db/migration/") && b.includes("/db/migration/")) {
      const [x, y] = [flyway(a), flyway(b)];
      for (let i = 0; i < Math.max(x.length, y.length); i++) {
        const d = (x[i] ?? -1) - (y[i] ?? -1);
        if (d !== 0) return d;
      }
      return 0;
    }
    return a < b ? -1 : a > b ? 1 : 0;
  });
  return paths.map((path) => ({ path, content: files.get(path)! }));
}

describe("constant backfill → ADD COLUMN … DEFAULT, then DROP DEFAULT", () => {
  it("a literal backfill on a NOT NULL add rides the default, with no UPDATE and no SET NOT NULL", async () => {
    const steps = await lastSteps([shop("node", false), shop("node", true)]);
    const priority = steps.filter(
      (s) =>
        (s.op === "addColumn" && s.column.name === "priority") ||
        (s.op === "alterColumnDefault" && s.name === "priority") ||
        (s.op === "backfillColumn" && s.column === "priority") ||
        (s.op === "alterColumnNullable" && s.name === "priority"),
    );
    expect(priority).toEqual([
      {
        op: "addColumn",
        table: "orders",
        schema: "store",
        column: { name: "priority", type: { kind: "int" }, nullable: false, default: "1" },
      },
      {
        op: "alterColumnDefault",
        table: "orders",
        schema: "store",
        name: "priority",
        from: "1",
        to: undefined,
      },
    ]);
  });

  it("`now()` and constant arithmetic are constants too", async () => {
    const arith = await lastSteps([
      shop("node", false),
      shop("node", true, "Order.priority = 2 * 3"),
    ]);
    expect(arith.find((s) => s.op === "addColumn")).toMatchObject({
      column: { default: "(2 * 3)" },
    });
    const dated = (v2: boolean) =>
      shop("node", false).replace("qty: int ", `qty: int ${v2 ? "seenAt: datetime" : ""}`) +
      (v2 ? `migration "seen" { Order.seenAt = now() }` : "");
    const steps = await lastSteps([dated(false), dated(true)]);
    expect(steps.map((s) => s.op)).toEqual(["addColumn", "alterColumnDefault"]);
    expect(steps[0]).toMatchObject({
      column: { name: "seen_at", default: "now()", nullable: false },
    });
  });

  it("an expression backfill keeps the add-nullable → UPDATE → SET NOT NULL sequence", async () => {
    const steps = await lastSteps([
      shop("node", false),
      shop("node", true, "Order.priority = qty + 1"),
    ]);
    expect(steps.filter((s) => s.op !== "addIndex").map((s) => s.op)).toEqual([
      "addColumn",
      "backfillColumn",
      "alterColumnNullable",
    ]);
    expect(steps[0]).toMatchObject({ column: { name: "priority", nullable: true } });
    expect(steps[1]).toMatchObject({ valueSql: `("qty" + 1)`, onlyNull: true });
  });

  it("renders the pair on every backend — Ecto included", async () => {
    for (const platform of ["node", "python", "java", "dotnet", "elixir"]) {
      const files = await generateSystemFiles(shop(platform, true), {
        migrationChain: await recordChain([shop(platform, false), shop(platform, true)]),
      });
      const all = applyOrder(files)
        .map((f) => f.content)
        .join("\n");
      expect(all, platform).not.toMatch(/UPDATE \\?"store\\?"\.\\?"orders\\?" SET \\?"priority/);
      if (platform === "elixir") {
        expect(all).toContain("add :priority, :integer, null: false, default: 1");
        expect(all).toContain(
          'execute("ALTER TABLE \\"store\\".\\"orders\\" ALTER COLUMN \\"priority\\" DROP DEFAULT")',
        );
      } else {
        expect(all, platform).toMatch(
          /ALTER TABLE "+store"+\."+orders"+ ADD COLUMN "+priority"+ INTEGER NOT NULL DEFAULT 1;/,
        );
        expect(all, platform).toMatch(
          /ALTER TABLE "+store"+\."+orders"+ ALTER COLUMN "+priority"+ DROP DEFAULT;/,
        );
      }
    }
  });
});

describe("Ecto spells a SQL default it cannot hold bare as a fragment", () => {
  it("a boolean is lower-cased (TRUE is a module alias in Elixir); an expression is a fragment", async () => {
    const flagged = (v2: boolean, value: string) =>
      shop("elixir", false).replace("qty: int ", `qty: int ${v2 ? "flag: bool  rank: int" : ""}`) +
      (v2 ? `migration "flag" { Order.flag = ${value}  Order.rank = 2 * 3 }` : "");
    const files = await generateSystemFiles(flagged(true, "true"), {
      migrationChain: await recordChain([flagged(false, ""), flagged(true, "true")]),
    });
    const delta = applyOrder(files).find((f) => f.path.endsWith("_gen1.exs"))!.content;
    expect(delta).toContain("add :flag, :boolean, null: false, default: true");
    expect(delta).toContain(`add :rank, :integer, null: false, default: fragment("(2 * 3)")`);
  });
});

describe("CREATE INDEX CONCURRENTLY on a table that already exists", () => {
  it("flags every index the diff adds to an existing table, and leaves a new table's inline", async () => {
    const steps = await lastSteps([shop("node", false), shop("node", true)]);
    expect(steps.filter((s) => s.op === "addIndex")).toEqual([
      expect.objectContaining({
        concurrently: true,
        index: expect.objectContaining({ name: "orders_status_idx" }),
      }),
    ]);
    // The initial generation creates the table: its indexes are inline and plain.
    const initial = (await recordChain([shop("node", true, "")])).entries[0]!.steps;
    expect(initial.some((s) => s.op === "addIndex")).toBe(false);
  });

  it("each backend applies it in a separate, non-transactional unit, after the transactional one", async () => {
    const expectations: Record<string, (units: { path: string; content: string }[]) => void> = {
      node: (u) => {
        expect(u.map((f) => f.path.split("/").at(-1))).toEqual([
          "20260101000000_commerce_initial.sql",
          "20260102000000_commerce_gen1.sql",
          "20260102000000_commerce_gen1_concurrent.sql",
        ]);
        expect(u[2]!.content.split("\n")[0]).toBe("-- loom:no-transaction");
      },
      python: (u) => {
        expect(u.map((f) => f.path.split("/").at(-1))).toEqual([
          "20260101000000_commerce_initial.sql",
          "20260102000000_commerce_gen1.sql",
          "20260102000000_commerce_gen1_concurrent.sql",
        ]);
        expect(u[2]!.content.split("\n")[0]).toBe("-- loom:no-transaction");
      },
      java: (u) => {
        expect(u.map((f) => f.path.split("/").at(-1))).toEqual([
          "V20260101000000.1__Commerce_Initial.sql",
          "V20260102000000.2__Commerce_Gen1.sql",
          "V20260102000000.2.1__Commerce_Gen1Concurrent.sql",
        ]);
        // Flyway runs a script holding only CONCURRENTLY statements outside a
        // transaction, and refuses one that mixes them with others.
        const stmts = u[2]!.content.split("\n").filter((l) => l.trim() && !l.startsWith("--"));
        expect(stmts.every((l) => /^(DROP|CREATE)( UNIQUE)? INDEX CONCURRENTLY /.test(l))).toBe(
          true,
        );
      },
      dotnet: (u) => {
        expect(u.map((f) => f.path.split("/").at(-1))).toEqual([
          "20260101000000_Commerce_Initial.cs",
          "20260102000000_Commerce_Gen1.cs",
          "20260102000000_Commerce_Gen1_Concurrent.cs",
        ]);
        expect(u[2]!.content).toContain('[Migration("20260102000000_Commerce_Gen1_Concurrent")]');
        // One suppressTransaction command per statement: Npgsql sends a
        // command's statements as one batch, an implicit transaction.
        const calls = u[2]!.content.match(/migrationBuilder\.Sql\(.*\);/g)!;
        expect(calls).toHaveLength(2);
        expect(calls.every((c) => c.endsWith(", suppressTransaction: true);"))).toBe(true);
      },
      "dotnet { persistence: dapper }": (u) => {
        expect(u.map((f) => f.path.split("/").at(-1))).toEqual([
          "20260101000000_Commerce_Initial.cs",
          "20260102000000_Commerce_Gen1.cs",
          "20260102000000_Commerce_Gen1_Concurrent.cs",
        ]);
        expect(u[2]!.content).toContain("public override bool InTransaction => false;");
        expect(u[1]!.content).not.toContain("InTransaction");
      },
      elixir: (u) => {
        const names = u
          .map((f) => f.path.split("/").at(-1)!)
          .filter((n) => !n.includes("_create_"));
        expect(names).toEqual([
          "20260102000000_commerce_gen1.exs",
          "20260102000001_commerce_gen1_concurrent.exs",
        ]);
        const conc = u.find((f) => f.path.endsWith("_concurrent.exs"))!.content;
        expect(conc).toContain("@disable_ddl_transaction true");
        expect(conc).toContain("@disable_migration_lock true");
        expect(conc).toContain(
          'drop_if_exists index(:orders, [:status], prefix: "store", concurrently: true)\n    create index(:orders, [:status], prefix: "store", concurrently: true)',
        );
      },
    };
    for (const [platform, check] of Object.entries(expectations)) {
      const files = await generateSystemFiles(shop(platform, true), {
        migrationChain: await recordChain([shop(platform, false), shop(platform, true)]),
      });
      const units = applyOrder(files);
      check(units);
      // The transactional unit never builds an index concurrently, and the
      // concurrent unit drops a leftover INVALID index before it builds.
      const main = units.find((f) => /gen1\.(sql|cs|exs)$/i.test(f.path))!;
      expect(main.content, platform).not.toMatch(/CONCURRENTLY|concurrently/);
      const conc = units.find((f) => /concurrent\.(sql|cs|exs)$/i.test(f.path))!.content;
      const drop = conc.search(/DROP INDEX CONCURRENTLY IF EXISTS|drop_if_exists index\(/);
      const create = conc.search(
        /CREATE (UNIQUE )?INDEX CONCURRENTLY "|create index\(.*concurrently: true/,
      );
      expect(drop, platform).toBeGreaterThan(-1);
      expect(create, platform).toBeGreaterThan(drop);
    }
  });

  it("an index-only generation emits only the concurrent unit (no empty transactional file)", async () => {
    const noBackfill = (v2: boolean) =>
      shop("node", false).replace(
        "use: primary }",
        v2 ? "use: primary, index: [Order.status] }" : "use: primary }",
      );
    const files = await generateSystemFiles(noBackfill(true), {
      migrationChain: await recordChain([noBackfill(false), noBackfill(true)]),
    });
    expect(applyOrder(files).map((f) => f.path.split("/").at(-1))).toEqual([
      "20260101000000_commerce_initial.sql",
      "20260102000000_commerce_gen1_concurrent.sql",
    ]);
  });

  it("a generation recorded before the flag existed renders unchanged: a plain CREATE INDEX in its one file", async () => {
    const chain = await recordChain([shop("node", false), shop("node", true)]);
    const legacy: MigrationChain = {
      entries: chain.entries.map((e) => ({
        ...e,
        steps: e.steps.map((s) => {
          if (s.op !== "addIndex") return s;
          const { concurrently: _dropped, ...rest } = s;
          return rest;
        }),
      })),
    };
    const files = await generateSystemFiles(shop("node", true), { migrationChain: legacy });
    const units = applyOrder(files);
    expect(units.map((f) => f.path.split("/").at(-1))).toEqual([
      "20260101000000_commerce_initial.sql",
      "20260102000000_commerce_gen1.sql",
    ]);
    expect(units[1]!.content).toContain(
      `CREATE INDEX "orders_status_idx" ON "store"."orders" ("status");`,
    );
  });
});

describe("the migration chain reserves a version for the non-transactional unit", () => {
  it("numbers the next entry two above a generation that builds an index concurrently", async () => {
    const v3 = shop("node", true).replace("qty: int", "qty: int  note: string?");
    const chain = await recordChain([shop("node", false), shop("node", true), v3]);
    const [, gen1, gen2] = chain.entries;
    expect(BigInt(gen2!.version) - BigInt(gen1!.version)).toBe(2n);
  });

  it("refuses a chain whose entry takes the reserved version", async () => {
    const v3 = shop("node", true).replace("qty: int", "qty: int  note: string?");
    const chain = await recordChain([shop("node", false), shop("node", true), v3]);
    const gen1 = chain.entries[1]!;
    const clash: ChainEntry = { ...chain.entries[2]!, version: String(BigInt(gen1.version) + 1n) };
    const files = [...chain.entries.slice(0, 2), clash].map((e) => ({
      name: entryFileName(e),
      content: serializeEntry(e),
    }));
    expect(() => parseChain(files)).toThrow(/reserves version 20260102000001/);
  });
});

describe("the boot runners apply a no-transaction unit outside a transaction", () => {
  it("node: db/migrate.ts keeps Drizzle's ledger and runs a marked file without one", async () => {
    const files = await generateSystemFiles(shop("node", true), {
      migrationChain: await recordChain([shop("node", false), shop("node", true)]),
    });
    expect(files.get("api/index.ts")).toContain(`import { migrate } from "./db/migrate";`);
    const runner = files.get("api/db/migrate.ts")!;
    expect(runner).toContain(`"drizzle"."__drizzle_migrations"`);
    expect(runner).toContain(`const NO_TRANSACTION = "-- loom:no-transaction";`);
    // A marked file runs on `db` directly; the others inside `db.transaction`.
    expect(runner).toMatch(
      /if \(!inTransaction\(head\)\) \{\n\s+for \(const stmt of head\.sql\) \{\n\s+if \(stmt\.trim\(\)\.length > 0\) await db\.execute/,
    );
    expect(runner).toContain("await db.transaction(async (tx) => {");
  });

  it("python: run_migrations applies a marked file on an AUTOCOMMIT connection", async () => {
    const files = await generateSystemFiles(shop("python", true), {
      migrationChain: await recordChain([shop("python", false), shop("python", true)]),
    });
    const runner = files.get("api/app/db/migrate.py")!;
    expect(runner).toContain(`_NO_TRANSACTION = "-- loom:no-transaction"`);
    expect(runner).toMatch(
      /if not _in_transaction\(sql\):\n\s+async with target\.connect\(\) as raw:\n\s+conn = await raw\.execution_options\(isolation_level="AUTOCOMMIT"\)/,
    );
  });

  it("dapper: DbSchema runs an InTransaction = false migration without a transaction", async () => {
    const p = "dotnet { persistence: dapper }";
    const files = await generateSystemFiles(shop(p, true), {
      migrationChain: await recordChain([shop(p, false), shop(p, true)]),
    });
    const runner = [...files].find(([k]) =>
      k.endsWith("Infrastructure/Persistence/DbSchema.cs"),
    )![1];
    expect(runner).toContain("public virtual bool InTransaction => true;");
    expect(runner).toMatch(
      /if \(!migration\.InTransaction\)\n\s+\{\n\s+foreach \(var statement in migration\.Statements\)\n\s+\{\n\s+await conn\.ExecuteAsync\(new CommandDefinition\(statement, cancellationToken/,
    );
  });
});
