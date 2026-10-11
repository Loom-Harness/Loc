import { describe, expect, it } from "vitest";
import { emitDotnetMigrations } from "../../src/generator/dotnet/emit/migrations.js";
import { emitMigrations as emitEctoMigrations } from "../../src/generator/elixir/migrations-emit.js";
import { emitJavaMigrations } from "../../src/generator/java/emit/migrations.js";
import { emitPythonMigrations } from "../../src/generator/python/emit/migrations.js";
import { emitTypescriptMigrations } from "../../src/generator/typescript/emit/migrations.js";
import type {
  MigrationStep,
  MigrationsIR,
  SchemaSnapshot,
} from "../../src/ir/types/migrations-ir.js";
import { buildMigrations, type MigrationWarning } from "../../src/system/migrations-builder.js";
import { memorySnapshotStore } from "../../src/system/snapshot.js";
import { buildLoomModel } from "../_helpers/index.js";

// A `unique (…)` index follows a `softDeletable` flip.
//
// The derived index name (`<table>_<cols>_uq`) is a function of the table and
// the columns only, so adding or removing `softDeletable` keeps the name and
// changes just the partial-index predicate (`WHERE is_deleted = false`).  The
// diff used to pair indexes by name and stop there, so the flip emitted NO
// index step: the full unique survived the capability being added (a live
// row could never reuse a soft-deleted row's key), and the partial one
// survived the capability being dropped (live rows' keys stopped being
// unique against the formerly soft-deleted ones).  Postgres cannot alter an
// index predicate, so the rebuild is a DROP + CREATE.

function src(softDelete: boolean, migration = ""): string {
  return `
system Bank {
  subdomain Banking {
    context Accounts {
      aggregate Account${softDelete ? " with softDeletable" : ""} {
        number: string
        holder: string
        unique (number)
      }
      repository Accounts for Account { }
    }
  }
  deployable api { platform: node, contexts: [Accounts], port: 3000 }
}
${migration}
`;
}

// Adding `softDeletable` to a populated table needs its NOT NULL `is_deleted`
// filled — the backfill makes the add non-destructive.
const BACKFILL = `migration "soft" { Account.isDeleted = false }`;

async function baseline(softDelete: boolean): Promise<SchemaSnapshot> {
  const loom = await buildLoomModel(src(softDelete));
  return buildMigrations(loom.systems[0]!, memorySnapshotStore({}), {})[0]!.next;
}

async function evolve(
  v2: string,
  base: SchemaSnapshot,
  allowDestructive = false,
): Promise<{ mig: MigrationsIR; warnings: MigrationWarning[] }> {
  const loom = await buildLoomModel(v2);
  const warnings: MigrationWarning[] = [];
  const mig = buildMigrations(loom.systems[0]!, memorySnapshotStore({ Banking: base }), {
    sqlSteps: loom.sqlMigrationSteps,
    renameIntents: loom.renameIntents,
    tableRenameIntents: loom.tableRenameIntents,
    backfillIntents: loom.backfillIntents,
    allowDestructive,
    warnings,
  })[0]!;
  return { mig, warnings };
}

const at = (steps: readonly MigrationStep[], pred: (s: MigrationStep) => boolean): number =>
  steps.findIndex(pred);

describe("unique index × softDeletable flip — the builder", () => {
  it("full → partial (softDeletable ADDED): drop + create the partial index, after `is_deleted` exists", async () => {
    const { mig, warnings } = await evolve(src(true, BACKFILL), await baseline(false));
    const drop = at(mig.steps, (s) => s.op === "dropIndex" && s.name === "accounts_number_uq");
    const add = at(mig.steps, (s) => s.op === "addIndex" && s.index.name === "accounts_number_uq");
    const col = at(mig.steps, (s) => s.op === "addColumn" && s.column.name === "is_deleted");
    expect(drop, "old full index dropped").toBeGreaterThan(-1);
    expect(add, "partial index created").toBeGreaterThan(-1);
    const added = mig.steps[add] as Extract<MigrationStep, { op: "addIndex" }>;
    expect(added.index.unique).toBe(true);
    expect(added.index.predicate).toBe("is_deleted = false");
    expect(drop).toBeLessThan(add);
    // The predicate names `is_deleted`, so the CREATE must follow its ADD COLUMN.
    expect(col).toBeGreaterThan(-1);
    expect(col).toBeLessThan(add);
    // A relaxation: every row the full index admitted, the partial one admits.
    expect(warnings).toEqual([]);
  });

  it("partial → full (softDeletable DROPPED): drop + create the full index, and warn — it tightens on populated data", async () => {
    const { mig, warnings } = await evolve(src(false), await baseline(true), true);
    const drop = at(mig.steps, (s) => s.op === "dropIndex" && s.name === "accounts_number_uq");
    const add = at(mig.steps, (s) => s.op === "addIndex" && s.index.name === "accounts_number_uq");
    const dropCol = at(mig.steps, (s) => s.op === "dropColumn" && s.name === "is_deleted");
    expect(drop).toBeGreaterThan(-1);
    expect(add).toBeGreaterThan(drop);
    const added = mig.steps[add] as Extract<MigrationStep, { op: "addIndex" }>;
    expect(added.index.predicate).toBeUndefined();
    // The partial index names `is_deleted`: it goes before the column does.
    expect(dropCol).toBeGreaterThan(drop);
    // Formerly soft-deleted rows now count — a stored duplicate fails the CREATE.
    expect(warnings.map((w) => w.code)).toEqual(["loom.migration-unique-on-existing-table"]);
    expect(warnings[0]!.message).toContain("accounts_number_uq");
  });

  it("an unchanged unique index emits no index step", async () => {
    const { mig } = await evolve(src(true), await baseline(true));
    expect(mig.steps.filter((s) => s.op === "dropIndex" || s.op === "addIndex")).toEqual([]);
  });

  it("the flip is not destructive on its own — no --allow-destructive needed for full → partial", async () => {
    // `evolve` passes allowDestructive=false; a destructive step would throw.
    await expect(evolve(src(true, BACKFILL), await baseline(false))).resolves.toBeDefined();
  });
});

describe("unique index × softDeletable flip — every backend's migration renderer", () => {
  const render = (mig: MigrationsIR): Record<string, string> => {
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
    const out: Record<string, string> = {};
    for (const [backend, files] of Object.entries(outputs)) {
      out[backend] = [...files.values()].find((c) => c.includes("accounts_number_uq")) ?? "";
    }
    return out;
  };

  it("full → partial: each backend drops the old index and creates the partial one", async () => {
    const { mig } = await evolve(src(true, BACKFILL), await baseline(false));
    for (const [backend, file] of Object.entries(render(mig))) {
      expect(file, `${backend}: migration names the index`).not.toBe("");
      if (backend === "ecto") {
        const drop = file.indexOf('drop index(:accounts, name: "accounts_number_uq"');
        const create = file.indexOf(
          'create index(:accounts, [:number], unique: true, where: "is_deleted = false", name: "accounts_number_uq"',
        );
        expect(drop, `${backend}: drop`).toBeGreaterThan(-1);
        expect(create, `${backend}: partial create`).toBeGreaterThan(drop);
      } else {
        const drop = file.search(/DROP INDEX \S*accounts_number_uq/);
        const create = file.search(
          /CREATE UNIQUE INDEX \S*accounts_number_uq\S* ON \S+ \(\S*number\S*\) WHERE is_deleted = false/,
        );
        expect(drop, `${backend}: drop`).toBeGreaterThan(-1);
        expect(create, `${backend}: partial create`).toBeGreaterThan(drop);
      }
    }
  });

  it("partial → full: each backend drops the partial index and creates the full one", async () => {
    const { mig } = await evolve(src(false), await baseline(true), true);
    for (const [backend, file] of Object.entries(render(mig))) {
      expect(file, `${backend}: migration names the index`).not.toBe("");
      if (backend === "ecto") {
        const drop = file.indexOf('drop index(:accounts, name: "accounts_number_uq"');
        const create = file.indexOf(
          'create index(:accounts, [:number], unique: true, name: "accounts_number_uq"',
        );
        expect(drop, `${backend}: drop`).toBeGreaterThan(-1);
        expect(create, `${backend}: full create`).toBeGreaterThan(drop);
      } else {
        const drop = file.search(/DROP INDEX \S*accounts_number_uq/);
        const create = file.search(
          /CREATE UNIQUE INDEX \S*accounts_number_uq\S* ON \S+ \(\S*number\S*\);/,
        );
        expect(drop, `${backend}: drop`).toBeGreaterThan(-1);
        expect(create, `${backend}: full create`).toBeGreaterThan(drop);
      }
    }
  });
});
