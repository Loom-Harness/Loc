import { describe, expect, it } from "vitest";
import type { MigrationStep, SchemaSnapshot } from "../../src/ir/types/migrations-ir.js";
import { buildMigrations, MigrationDestructiveError } from "../../src/system/migrations-builder.js";
import { canonicalSnapshot, memorySnapshotStore } from "../../src/system/snapshot.js";
import { buildLoomModel, generateSystemFiles } from "../_helpers/index.js";

// #3229 follow-ups, on the migration builder:
//
//  1. A built-in capability added to a POPULATED table.  `softDeletable`'s
//     `is_deleted` is NOT NULL with no default, so adding the capability used
//     to be a destructive change (refused without `--allow-destructive`).  Its
//     value for every pre-existing row is unambiguously `false`, so the add now
//     carries `DEFAULT false` (dropped again in the same migration).
//     `tenantOwned`'s `tenant_id` and `auditable`'s stamps have no such value —
//     they keep refusing, with a line that names the capability and why.
//  2. A `unique (…)` a TPH CONCRETE declares itself reached no index (only the
//     base's keys were read).  It now lands on the shared table, partial on the
//     concrete's `kind`.

const tenancyHead = `user { id: guid  tenantId: string }
  tenancy by user.tenantId of Org`;

function src(accountWith: string, opts: { tenancy?: boolean; auth?: boolean } = {}): string {
  return `
system Bank {
  ${opts.tenancy ? tenancyHead : opts.auth ? "user { id: guid }" : ""}
  subdomain Banking {
    context Accounts {
      ${opts.tenancy ? "aggregate Org with tenantRegistry, crudish { name: string }\n      repository Orgs for Org { }" : ""}
      aggregate Account ${accountWith} { number: string }
      repository Accounts for Account { }
    }
  }
  deployable api { platform: node, contexts: [Accounts], port: 3000${opts.tenancy || opts.auth ? ", auth: required" : ""} }
}
`;
}

async function snapshotOf(source: string): Promise<SchemaSnapshot> {
  const loom = await buildLoomModel(source);
  return buildMigrations(loom.systems[0]!, memorySnapshotStore({}), {})[0]!.next;
}

async function evolve(v1: string, v2: string): Promise<readonly MigrationStep[]> {
  const base = await snapshotOf(v1);
  const loom = await buildLoomModel(v2);
  return buildMigrations(loom.systems[0]!, memorySnapshotStore({ Banking: base }), {
    backfillIntents: loom.backfillIntents,
    allowDestructive: false,
  })[0]!.steps;
}

async function refusal(v1: string, v2: string): Promise<MigrationDestructiveError> {
  try {
    await evolve(v1, v2);
  } catch (e) {
    if (e instanceof MigrationDestructiveError) return e;
    throw e;
  }
  throw new Error("expected the destructive gate to refuse the migration");
}

describe("a capability added to a populated table", () => {
  it("softDeletable: `is_deleted` is added WITH DEFAULT false, which is then dropped — no flag needed", async () => {
    const steps = await evolve(src("with crudish"), src("with softDeletable, crudish"));
    const add = steps.find((s) => s.op === "addColumn" && s.column.name === "is_deleted");
    expect(add?.op).toBe("addColumn");
    if (add?.op !== "addColumn") return;
    expect(add.column.nullable).toBe(false);
    expect(add.column.default, "the existing rows are backfilled `false`").toBe("false");
    const drop = steps.find((s) => s.op === "alterColumnDefault" && s.name === "is_deleted");
    expect(drop, "the transient default is dropped in the same migration").toMatchObject({
      to: undefined,
    });
    expect(steps.indexOf(drop!)).toBeGreaterThan(steps.indexOf(add));
  });

  it("softDeletable: a declared backfill block still wins over the capability default", async () => {
    const steps = await evolve(
      src("with crudish"),
      `${src("with softDeletable, crudish")}\nmigration "soft" { Account.isDeleted = true }`,
    );
    const backfill = steps.find((s) => s.op === "backfillColumn" && s.column === "is_deleted");
    expect(backfill).toMatchObject({ valueSql: "TRUE" });
    expect(steps.some((s) => s.op === "alterColumnDefault" && s.name === "is_deleted")).toBe(false);
  });

  it("the capability stamp never reaches the committed snapshot, and a fresh CREATE has no default", async () => {
    const snap = await snapshotOf(src("with softDeletable, crudish"));
    const accounts = snap.tables.find((t) => t.name === "accounts")!;
    const col = accounts.columns.find((c) => c.name === "is_deleted")!;
    expect(col.capability).toBe("softDeletable");
    expect(col.default).toBeUndefined();
    const json = JSON.stringify(canonicalSnapshot(snap));
    expect(json).not.toContain('"capability"');
    expect(json).not.toContain('"addColumnDefault"');
  });

  it("tenantOwned: still refused — Loom cannot know which tenant owns an existing row", async () => {
    const e = await refusal(
      src("crossTenant with crudish", { tenancy: true }),
      src("with tenantOwned, crudish", { tenancy: true }),
    );
    expect(e.code).toBe("loom.migration-destructive");
    expect(e.message).toContain(
      "accounts.tenant_id NOT NULL (no default) — contributed by `with tenantOwned`",
    );
    expect(e.message).toContain("cannot infer which tenant owns a row");
  });

  it("auditable: still refused — an existing row's creation time and author are unknown", async () => {
    const e = await refusal(
      src("with crudish", { auth: true }),
      src("with auditable, crudish", { auth: true }),
    );
    expect(e.code).toBe("loom.migration-destructive");
    expect(e.message).toContain(
      "accounts.created_by NOT NULL (no default) — contributed by `with auditable`",
    );
    expect(e.message).toContain("creation time and author");
  });
});

const tph = (latheKey: boolean): string => `
system Shop {
  subdomain Floor {
    context Floor {
      abstract aggregate Machine inheritanceUsing: sharedTable {
        serial: string
        unique (serial)
      }
      aggregate Lathe extends Machine with crudish {
        model: string
        ${latheKey ? "unique (model)" : ""}
      }
      aggregate Press extends Machine with crudish { model: string }
      repository Lathes for Lathe { }
      repository Presses for Press { }
    }
  }
  api FloorApi from Floor
  storage pg { type: postgres }
  resource st { for: Floor, kind: state, use: pg }
  deployable api { platform: elixir, contexts: [Floor], dataSources: [st], serves: FloorApi, port: 4000 }
}
`;

describe("a TPH concrete's own `unique (…)`", () => {
  it("lands on the shared table, partial on the concrete's kind, beside the base's full index", async () => {
    const snap = await snapshotOf(tph(true));
    const machines = snap.tables.find((t) => t.name === "machines")!;
    const uq = machines.indexes.filter((i) => i.unique);
    expect(uq.map((i) => [i.name, i.columns.join(","), i.predicate])).toEqual([
      ["machines_serial_uq", "serial", undefined],
      ["machines_lathe_model_uq", "model", "kind = 'Lathe'"],
    ]);
  });

  it("no concrete key → no extra index (the base's full index only)", async () => {
    const snap = await snapshotOf(tph(false));
    const machines = snap.tables.find((t) => t.name === "machines")!;
    expect(machines.indexes.filter((i) => i.unique).map((i) => i.name)).toEqual([
      "machines_serial_uq",
    ]);
  });

  it("the Ecto changeset names the concrete key's own index (so the 23505 maps to 409)", async () => {
    const files = await generateSystemFiles(tph(true));
    const out = [...files.entries()].find(([p]) => p.endsWith("lathe_changeset.ex"))?.[1] ?? "";
    expect(out).toContain('unique_constraint(:serial, name: "machines_serial_uq")');
    expect(out).toContain('unique_constraint(:model, name: "machines_lathe_model_uq")');
  });
});

// `versioned`'s `DEFAULT 1` used to be applied only by `tableForAggregate`, so
// the TPH shared table carried `version INTEGER NOT NULL` with no default —
// unlike a plain or TPC table.  Adding `version` to a populated TPH table (a
// database from before default versioning, M-T3.4) was NOT refused — the
// field's `.ddd` default `= 1` already rode the add-WITH-DEFAULT path — but
// that path then DROPPED the default, so the migrated table still disagreed
// with every other versioned table.  TPC concretes go through
// `tableForAggregate` and always had it.
describe("versioned on every table layout", () => {
  it("the TPH shared table's `version` is NOT NULL DEFAULT 1, like a plain or TPC table", async () => {
    const snap = await snapshotOf(tph(false));
    const version = snap.tables
      .find((t) => t.name === "machines")!
      .columns.find((c) => c.name === "version")!;
    expect(version).toMatchObject({ nullable: false, default: "1", capability: "versioned" });
  });

  it("adding `version` to a populated TPH table keeps DEFAULT 1 (no transient-default drop)", async () => {
    const base = await snapshotOf(tph(false));
    const machines = base.tables.find((t) => t.name === "machines")!;
    machines.columns = machines.columns.filter((c) => c.name !== "version");
    const loom = await buildLoomModel(tph(false));
    const steps = buildMigrations(loom.systems[0]!, memorySnapshotStore({ Floor: base }), {
      allowDestructive: false,
    })[0]!.steps;
    const add = steps.find((s) => s.op === "addColumn" && s.column.name === "version");
    expect(add).toMatchObject({ table: "machines", column: { nullable: false, default: "1" } });
    expect(
      steps.some((s) => s.op === "alterColumnDefault" && s.name === "version"),
      "the DEFAULT 1 is the column's own, not a transient backfill default",
    ).toBe(false);
  });
});
