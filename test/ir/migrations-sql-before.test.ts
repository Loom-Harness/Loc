import { describe, expect, it } from "vitest";
import { emitDotnetMigrations } from "../../src/generator/dotnet/emit/migrations.js";
import { emitMigrations as emitEctoMigrations } from "../../src/generator/elixir/migrations-emit.js";
import { emitJavaMigrations } from "../../src/generator/java/emit/migrations.js";
import { emitPythonMigrations } from "../../src/generator/python/emit/migrations.js";
import { emitTypescriptMigrations } from "../../src/generator/typescript/emit/migrations.js";
import type { MigrationsIR, SchemaSnapshot } from "../../src/ir/types/migrations-ir.js";
import {
  buildMigrations,
  type MigrationWarning,
  schemaFromModule,
} from "../../src/system/migrations-builder.js";
import { memorySnapshotStore } from "../../src/system/snapshot.js";
import { buildLoomModel } from "../_helpers/index.js";

// B-20 (banking eval): a raw `sql before "…"` step is emitted AHEAD of the
// generation's structural DDL, so a dedupe can precede the `unique (…)` index
// it guards.  B-20b: adding a unique index to a table the baseline already
// has warns (`loom.migration-unique-on-existing-table`) unless a `before`
// step is declared for that generation.

const DEDUPE = "UPDATE banking.accounts SET number = number || '-dup' WHERE false";

function src(opts: { unique?: string; migration?: string; extra?: string; softDelete?: boolean }) {
  return `
system Bank {
  subdomain Banking {
    context Accounts {
      aggregate Account${opts.softDelete ? " with softDeletable" : ""} {
        number: string
        holder: string
        ${opts.unique ?? ""}
      }
      repository Accounts for Account { }
      ${opts.extra ?? ""}
    }
  }
  deployable api { platform: node, contexts: [Accounts], port: 3000 }
}
${opts.migration ?? ""}
`;
}

async function v1Baseline(softDelete = false): Promise<SchemaSnapshot> {
  const loom = await buildLoomModel(src({ softDelete }));
  const gen = buildMigrations(loom.systems[0]!, memorySnapshotStore({}), {})[0]!;
  return gen.next;
}

async function evolve(
  v2: string,
  baseline: SchemaSnapshot | null,
  allowDestructive = false,
): Promise<{ mig: MigrationsIR; warnings: MigrationWarning[] }> {
  const loom = await buildLoomModel(v2);
  const warnings: MigrationWarning[] = [];
  const mig = buildMigrations(
    loom.systems[0]!,
    memorySnapshotStore(baseline ? { Banking: baseline } : {}),
    {
      sqlSteps: loom.sqlMigrationSteps,
      renameIntents: loom.renameIntents,
      tableRenameIntents: loom.tableRenameIntents,
      backfillIntents: loom.backfillIntents,
      allowDestructive,
      warnings,
    },
  )[0]!;
  return { mig, warnings };
}

describe("`sql before` ordering (B-20)", () => {
  it("emits a `before` step ahead of the generation's structural steps, a plain one after", async () => {
    const base = await v1Baseline();
    const { mig } = await evolve(
      src({
        unique: "unique (number)",
        migration: `migration "v2" { sql before "${DEDUPE}"  sql "UPDATE banking.accounts SET holder = holder" }`,
      }),
      base,
    );
    expect(mig.steps.map((s) => s.op)).toEqual(["sqlExec", "addIndex", "sqlExec"]);
    expect(mig.steps[0]).toEqual({ op: "sqlExec", sql: DEDUPE });
    // Same exactly-once ledger as a plain raw step: both keys recorded …
    expect(mig.next.appliedDataMigrations).toEqual(["v2#0", "v2#1"]);
    // … so the next generation is a no-op.
    const loom = await buildLoomModel(
      src({
        unique: "unique (number)",
        migration: `migration "v2" { sql before "${DEDUPE}"  sql "UPDATE banking.accounts SET holder = holder" }`,
      }),
    );
    const gen3 = buildMigrations(loom.systems[0]!, memorySnapshotStore({ Banking: mig.next }), {
      sqlSteps: loom.sqlMigrationSteps,
    })[0]!;
    expect(gen3.steps).toEqual([]);
  });

  it("without `before` the raw step still trails the DDL (default unchanged)", async () => {
    const base = await v1Baseline();
    const { mig } = await evolve(
      src({ unique: "unique (number)", migration: `migration "v2" { sql "${DEDUPE}" }` }),
      base,
    );
    expect(mig.steps.map((s) => s.op)).toEqual(["addIndex", "sqlExec"]);
  });

  it("on a module's Initial generation `before` keeps the trailing position (nothing to precede)", async () => {
    const { mig } = await evolve(
      src({ migration: `migration "boot" { sql before "${DEDUPE}" }` }),
      null,
    );
    expect(mig.name).toBe("Initial");
    expect(mig.steps.at(-1)).toEqual({ op: "sqlExec", sql: DEDUPE });
    expect(mig.steps[0]!.op).toBe("createTable");
  });

  it("every backend's migration file runs the dedupe before the unique index", async () => {
    const base = await v1Baseline();
    const { mig } = await evolve(
      src({ unique: "unique (number)", migration: `migration "v2" { sql before "${DEDUPE}" }` }),
      base,
    );
    const outputs: Record<string, Map<string, string>> = {
      drizzle: new Map(),
      ef: new Map(),
      flyway: new Map(),
      alembic: new Map(),
      ecto: new Map(),
    };
    emitTypescriptMigrations([mig], outputs.drizzle!);
    emitDotnetMigrations([mig], "Bank", outputs.ef!);
    emitJavaMigrations([mig], outputs.flyway!);
    emitPythonMigrations([mig], outputs.alembic!);
    emitEctoMigrations("bank", [mig], "Bank", outputs.ecto!);
    for (const [backend, files] of Object.entries(outputs)) {
      const file = [...files.values()].find((c) => c.includes("-dup"));
      expect(file, `${backend}: dedupe emitted`).toBeDefined();
      const dedupe = file!.indexOf("-dup");
      const index = file!.search(/CREATE UNIQUE INDEX|create index\(/);
      expect(index, `${backend}: unique index in the same file`).toBeGreaterThan(-1);
      expect(dedupe, `${backend}: dedupe precedes the unique index`).toBeLessThan(index);
    }
  });
});

describe("loom.migration-unique-on-existing-table (B-20b)", () => {
  it("warns when a unique index lands on a table the baseline already has", async () => {
    const base = await v1Baseline();
    const { warnings } = await evolve(src({ unique: "unique (number)" }), base);
    expect(warnings.map((w) => w.code)).toEqual(["loom.migration-unique-on-existing-table"]);
    expect(warnings[0]!.message).toContain("existing table accounts (number)");
    expect(warnings[0]!.message).toContain("sql before");
  });

  it("is silenced by a `sql before` step in the same generation", async () => {
    const base = await v1Baseline();
    const { warnings } = await evolve(
      src({ unique: "unique (number)", migration: `migration "v2" { sql before "${DEDUPE}" }` }),
      base,
    );
    expect(warnings).toEqual([]);
  });

  it("a plain (trailing) sql step does NOT silence it — it runs too late", async () => {
    const base = await v1Baseline();
    const { warnings } = await evolve(
      src({ unique: "unique (number)", migration: `migration "v2" { sql "${DEDUPE}" }` }),
      base,
    );
    expect(warnings.map((w) => w.code)).toEqual(["loom.migration-unique-on-existing-table"]);
  });

  it("does not warn for a unique index on a table created this generation", async () => {
    const base = await v1Baseline();
    const { warnings } = await evolve(
      src({
        extra: `aggregate Card { pan: string  unique (pan) }\n      repository Cards for Card { }`,
      }),
      base,
    );
    expect(warnings).toEqual([]);
  });

  it("does not warn on a first generation (nothing pre-exists)", async () => {
    const { warnings } = await evolve(src({ unique: "unique (number)" }), null);
    expect(warnings).toEqual([]);
  });

  it("does not warn when a column rename only rebuilds an existing unique index", async () => {
    const loom1 = await buildLoomModel(src({ unique: "unique (number)" }));
    const base = buildMigrations(loom1.systems[0]!, memorySnapshotStore({}), {})[0]!.next;
    const v2 = src({
      unique: "unique (iban)",
      migration: `migration "r" { Account.number -> iban }`,
    }).replace("number: string", "iban: string");
    const { mig, warnings } = await evolve(v2, base);
    expect(mig.steps.some((s) => s.op === "renameColumn")).toBe(true);
    expect(warnings).toEqual([]);
  });

  it("does not warn when an inferred rename rebuilds the unique index (drop + add)", async () => {
    // No migration block: the builder INFERS the rename, and rebuilds the
    // derived-name index as dropIndex + addIndex over the renamed column — the
    // exemption (same column set, mapped through the rename) keeps it quiet.
    const loom1 = await buildLoomModel(src({ unique: "unique (number)" }));
    const base = buildMigrations(loom1.systems[0]!, memorySnapshotStore({}), {})[0]!.next;
    const v2 = src({ unique: "unique (iban)" }).replace("number: string", "iban: string");
    const { mig, warnings } = await evolve(v2, base);
    expect(mig.steps.map((s) => s.op)).toEqual(["dropIndex", "renameColumn", "addIndex"]);
    expect(warnings.map((w) => w.code)).toEqual(["loom.migration-rename-inferred"]);
  });

  it("warns for a partial unique under softDeletable too", async () => {
    const base = await v1Baseline(true);
    const { mig, warnings } = await evolve(
      src({ unique: "unique (number)", softDelete: true }),
      base,
    );
    const add = mig.steps.find((s) => s.op === "addIndex");
    expect(add && add.op === "addIndex" && add.index.predicate).toBeTruthy();
    expect(warnings.map((w) => w.code)).toEqual(["loom.migration-unique-on-existing-table"]);
    expect(warnings[0]!.message).toContain("partial");
  });
});

// Sanity: the baseline used above is the v1 schema itself.
it("v1 baseline carries the accounts table without a unique index", async () => {
  const loom = await buildLoomModel(src({}));
  const snap = schemaFromModule(loom.systems[0]!.subdomains[0]!);
  const accounts = snap.tables.find((t) => t.name === "accounts")!;
  expect(accounts.indexes.some((i) => i.unique)).toBe(false);
});
