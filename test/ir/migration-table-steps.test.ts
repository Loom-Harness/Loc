import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderEctoStep } from "../../src/generator/elixir/migrations-emit.js";
import { renderPgStep } from "../../src/generator/sql-pg.js";
import type { MigrationStep, SchemaSnapshot } from "../../src/ir/types/migrations-ir.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { buildMigrations, MigrationDestructiveError } from "../../src/system/migrations-builder.js";
import { memorySnapshotStore } from "../../src/system/snapshot.js";
import { generateEvolvedSystemFiles } from "../_helpers/generate.js";
import { buildLoomModel } from "../_helpers/index.js";

// ---------------------------------------------------------------------------
// The generalized migration table step: `Old -> New` renames the tables of an
// aggregate, workflow or projection; `A.Old -> B.New` moves them to another
// bounded context (`SET SCHEMA`).  Each case diffs a baseline built from the
// OLD model against the NEW one, with and without the step.
// ---------------------------------------------------------------------------

type EnrichedModel = Awaited<ReturnType<typeof buildLoomModel>>;

/** Every module's schema of `loom`, as the baseline a later generation reads. */
function baselines(loom: EnrichedModel): Record<string, SchemaSnapshot> {
  const sys = loom.systems[0]!;
  const out: Record<string, SchemaSnapshot> = {};
  // Through `buildMigrations` itself, so schemas are binding-aware exactly as
  // the chain would record them.
  for (const d of buildMigrations(sys, memorySnapshotStore({}))) out[d.module] = d.next;
  return out;
}

async function derive(oldSrc: string, newSrc: string, opts: { allowDestructive?: boolean } = {}) {
  const base = baselines(await buildLoomModel(oldSrc));
  const loom = await buildLoomModel(newSrc);
  return buildMigrations(loom.systems[0]!, memorySnapshotStore(base), {
    tableRenameIntents: loom.tableRenameIntents,
    allowDestructive: opts.allowDestructive,
  });
}

const ops = (steps: readonly MigrationStep[]) => steps.map((s) => s.op);
const sql = (steps: readonly MigrationStep[]) => steps.map(renderPgStep).join("\n");
const ecto = (steps: readonly MigrationStep[]) => steps.flatMap(renderEctoStep).join("\n");

// --- workflow + projection renames (in place) -------------------------------

const FLOW = (wf: string, proj: string) => `
system Shop {
  subdomain Sales {
    context Orders {
      event OrderPlaced { orderId: Order id, total: int }
      aggregate Order {
        total: int
        operation place() { emit OrderPlaced { orderId: id, total: total } }
      }
      repository Orders for Order { }
      workflow ${wf} {
        orderId: Order id
        seen: int
        create(p: OrderPlaced) by p.orderId { }
      }
      projection ${proj} keyed by orderId {
        orderId: Order id
        total: int?
        on(e: OrderPlaced) by e.orderId { total := e.total }
      }
    }
  }
  storage pg { type: postgres }
  resource st { for: Orders, kind: state, use: pg }
  deployable api { platform: node, contexts: [Orders], dataSources: [st], port: 3000 }
}`;

describe("table step — workflow and projection renames", () => {
  it("renames the saga state table and the read-model table, nothing dropped or created", async () => {
    const [d] = await derive(
      FLOW("Tracker", "OrderTotal"),
      `${FLOW("Watcher", "OrderSum")}
migration "rename-flow" {
  Tracker -> Watcher
  OrderTotal -> OrderSum
}`,
    );
    const renames = d!.steps
      .filter((s): s is Extract<MigrationStep, { op: "renameTable" }> => s.op === "renameTable")
      .map((s) => `${s.schema}.${s.from}->${s.to}`)
      .sort();
    expect(renames).toEqual(["orders.order_totals->order_sums", "orders.trackers->watchers"]);
    expect(ops(d!.steps)).not.toContain("dropTable");
    expect(ops(d!.steps)).not.toContain("createTable");
    expect(sql(d!.steps)).toContain(`ALTER TABLE "orders"."trackers" RENAME TO "watchers";`);
  });

  it("without the step the rename is still a destructive drop + create", async () => {
    await expect(
      derive(FLOW("Tracker", "OrderTotal"), FLOW("Watcher", "OrderSum")),
    ).rejects.toThrow(MigrationDestructiveError);
  });
});

// --- cross-context move within one module -----------------------------------

const NOTES = (noteIn: "A" | "B", name = "Note") => {
  const note = `
      aggregate ${name} {
        text: string
        charges: Money[]
        contains lines: Line[]
        entity Line { sku: string }
      }
      valueobject Money { amount: int  currency: string }
      repository ${name}s for ${name} { }`;
  return `
system Shop {
  subdomain Notes {
    context A {
      aggregate Keep { name: string }
      repository Keeps for Keep { }${noteIn === "A" ? note : ""}
    }
    context B {
      aggregate Other { name: string }
      repository Others for Other { }${noteIn === "B" ? note : ""}
    }
  }
  storage pg { type: postgres }
  resource sa { for: A, kind: state, use: pg }
  resource sb { for: B, kind: state, use: pg }
  deployable api { platform: node, contexts: [A, B], dataSources: [sa, sb], port: 3000 }
}`;
};

describe("table step — cross-context move (one module)", () => {
  it("moves the root and every owned child table with SET SCHEMA — no drop, no create", async () => {
    const [d] = await derive(
      NOTES("A"),
      `${NOTES("B")}\nmigration "move-note" { A.Note -> B.Note }`,
    );
    expect(ops(d!.steps)).not.toContain("dropTable");
    expect(ops(d!.steps)).not.toContain("createTable");
    const out = sql(d!.steps);
    for (const t of ["notes", "lines", "note_charges"]) {
      expect(out).toContain(`ALTER TABLE "a"."${t}" SET SCHEMA "b";`);
    }
    expect(out).toContain(`CREATE SCHEMA IF NOT EXISTS "b";`);
    expect(ecto(d!.steps)).toContain(
      `execute("ALTER TABLE \\"a\\".\\"notes\\" SET SCHEMA \\"b\\"")`,
    );
  });

  it("a move that also renames sets the schema, then renames in the new one", async () => {
    const [d] = await derive(
      NOTES("A"),
      `${NOTES("B", "Memo")}\nmigration "move-note" { A.Note -> B.Memo }`,
    );
    const out = sql(d!.steps);
    expect(out).toContain(
      `ALTER TABLE "a"."notes" SET SCHEMA "b";\nALTER TABLE "b"."notes" RENAME TO "memos";`,
    );
    expect(out).toContain(`ALTER TABLE "a"."note_charges" SET SCHEMA "b";`);
    expect(out).toContain(`ALTER TABLE "b"."note_charges" RENAME TO "memo_charges";`);
    expect(out).toContain(`RENAME COLUMN "note_id" TO "memo_id"`);
    expect(ops(d!.steps)).not.toContain("dropTable");
    expect(ecto(d!.steps)).toContain(
      `rename table(:notes, prefix: "b"), to: table(:memos, prefix: "b")`,
    );
  });

  it("without the step the move is destructive, and the gate names the step", async () => {
    const err = await derive(NOTES("A"), NOTES("B")).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(MigrationDestructiveError);
    expect((err as Error).message).toContain("DROP TABLE a.notes");
    expect((err as Error).message).toContain("<OldContext>.<Old> -> <NewContext>.<New>");
  });

  it("is inert once the move is in the baseline", async () => {
    const moved = `${NOTES("B")}\nmigration "move-note" { A.Note -> B.Note }`;
    const loom = await buildLoomModel(moved);
    const [d] = buildMigrations(loom.systems[0]!, memorySnapshotStore(baselines(loom)), {
      tableRenameIntents: loom.tableRenameIntents,
    });
    expect(d!.steps).toEqual([]);
  });
});

// --- cross-module move -------------------------------------------------------

const SPLIT = (noteIn: "Notes" | "Archive") => `
system Shop {
  subdomain Notes {
    context A {
      aggregate Keep { name: string }
      repository Keeps for Keep { }${
        noteIn === "Notes"
          ? `
      aggregate Note { text: string  contains lines: Line[]  entity Line { sku: string } }
      repository Notes for Note { }`
          : ""
      }
    }
  }${
    noteIn === "Archive"
      ? `
  subdomain Archive {
    context B {
      aggregate Note { text: string  contains lines: Line[]  entity Line { sku: string } }
      repository Notes for Note { }
    }
  }`
      : ""
  }
  storage pg { type: postgres }
  resource sa { for: A, kind: state, use: pg }${
    noteIn === "Archive" ? `\n  resource sb { for: B, kind: state, use: pg }` : ""
  }
  deployable api { platform: node, contexts: [A${noteIn === "Archive" ? ", B" : ""}], dataSources: [sa${
    noteIn === "Archive" ? ", sb" : ""
  }], port: 3000 }
}`;

describe("table step — cross-module move", () => {
  it("the target module's generation moves the tables; the source module drops nothing", async () => {
    const deltas = await derive(
      SPLIT("Notes"),
      `${SPLIT("Archive")}\nmigration "move-note" { A.Note -> B.Note }`,
    );
    const notes = deltas.find((d) => d.module === "Notes")!;
    const archive = deltas.find((d) => d.module === "Archive")!;
    // The source only records the hand-off, so its schema stops listing them.
    expect(ops(notes.steps)).toEqual(["sqlComment", "sqlComment"]);
    expect(notes.next.tables.map((t) => t.name)).toEqual(["keeps"]);
    // The Archive module is new: its first generation takes the tables over.
    expect(archive.baseline).toBeNull();
    expect(ops(archive.steps)).toEqual(["renameTable", "renameTable"]);
    expect(sql(archive.steps)).toContain(`ALTER TABLE "a"."notes" SET SCHEMA "b";`);
    expect(sql(archive.steps)).toContain(`ALTER TABLE "a"."lines" SET SCHEMA "b";`);
    expect(archive.next.tables.map((t) => `${t.schema}.${t.name}`).sort()).toEqual([
      "b.lines",
      "b.notes",
    ]);
  });

  it("without the step the source module drops the tables (destructive)", async () => {
    await expect(derive(SPLIT("Notes"), SPLIT("Archive"))).rejects.toThrow(
      MigrationDestructiveError,
    );
  });
});

// --- event-sourced aggregate -------------------------------------------------

const LEDGER = (
  ledgerIn: "Leases" | "Ledgers",
  name = "LeaseLedger",
  otherIn?: "Leases" | "Ledgers",
) => {
  const ledger = `
      event Charged { ledgerId: ${name} id  amount: int }
      aggregate ${name} persistedAs: eventLog {
        balance: int
        operation charge(amount: int) { emit Charged { ledgerId: this.id, amount: amount } }
        apply(e: Charged) { balance := balance + e.amount }
      }
      repository ${name}s for ${name} { }`;
  const other = otherIn
    ? `
      event Opened { leaseId: Lease id }
      aggregate Lease persistedAs: eventLog {
        open: bool
        operation start() { emit Opened { leaseId: this.id } }
        apply(e: Opened) { open := true }
      }
      repository Leases for Lease { }`
    : "";
  return `
system Rent {
  subdomain Leasing {
    context Leases {
      aggregate Unit { code: string }
      repository Units for Unit { }${otherIn === "Leases" ? other : ""}${ledgerIn === "Leases" ? ledger : ""}
    }
    context Ledgers {
      aggregate Account { code: string }
      repository Accounts for Account { }${otherIn === "Ledgers" ? other : ""}${ledgerIn === "Ledgers" ? ledger : ""}
    }
  }
  storage pg { type: postgres }
  resource sl { for: Leases, kind: state, use: pg }
  resource sg { for: Ledgers, kind: state, use: pg }
  deployable api { platform: node, contexts: [Leases, Ledgers], dataSources: [sl, sg], port: 3000 }
}`;
};

describe("table step — event-sourced aggregate move", () => {
  it("takes the whole log along when nothing else is left in it", async () => {
    const [d] = await derive(
      LEDGER("Leases"),
      `${LEDGER("Ledgers", "Ledger")}\nmigration "move-ledger" { Leases.LeaseLedger -> Ledgers.Ledger }`,
    );
    expect(ops(d!.steps)).not.toContain("dropTable");
    expect(ops(d!.steps)).not.toContain("createTable");
    const out = sql(d!.steps);
    expect(out).toContain(
      `ALTER TABLE "leases"."leases_events" SET SCHEMA "ledgers";\nALTER TABLE "ledgers"."leases_events" RENAME TO "ledgers_events";`,
    );
    expect(out).toContain(
      `UPDATE "ledgers"."ledgers_events" SET "stream_type" = 'Ledger' WHERE "stream_type" = 'LeaseLedger';`,
    );
    expect(out).toContain(
      `ALTER SEQUENCE IF EXISTS "ledgers"."leases_events_seq_seq" RENAME TO "ledgers_events_seq_seq";`,
    );
  });

  it("copies the stream's rows when the old log keeps another stream", async () => {
    const [d] = await derive(
      LEDGER("Leases", "LeaseLedger", "Leases"),
      `${LEDGER("Ledgers", "LeaseLedger", "Leases")}\nmigration "move-ledger" { Leases.LeaseLedger -> Ledgers.LeaseLedger }`,
    );
    const out = sql(d!.steps);
    // The new log is created by this generation, so the copy runs after it.
    const create = out.indexOf(`CREATE TABLE "ledgers"."ledgers_events"`);
    const copy = out.indexOf(`INSERT INTO "ledgers"."ledgers_events"`);
    expect(create).toBeGreaterThanOrEqual(0);
    expect(copy).toBeGreaterThan(create);
    expect(out).toContain(
      `FROM "leases"."leases_events" WHERE "stream_type" = 'LeaseLedger' ORDER BY "seq";`,
    );
    expect(out).toContain(
      `DELETE FROM "leases"."leases_events" WHERE "stream_type" = 'LeaseLedger';`,
    );
    expect(ops(d!.steps)).not.toContain("dropTable");
  });

  it("copies ahead of the drop when the old log goes and the new one already exists", async () => {
    const [d] = await derive(
      LEDGER("Leases", "LeaseLedger", "Ledgers"),
      `${LEDGER("Ledgers", "LeaseLedger", "Ledgers")}\nmigration "move-ledger" { Leases.LeaseLedger -> Ledgers.LeaseLedger }`,
      { allowDestructive: true },
    );
    const out = sql(d!.steps);
    const copy = out.indexOf(`INSERT INTO "ledgers"."ledgers_events"`);
    const drop = out.indexOf(`DROP TABLE "leases"."leases_events"`);
    expect(copy).toBeGreaterThanOrEqual(0);
    expect(drop).toBeGreaterThan(copy);
  });
});

// --- the recorded chain -------------------------------------------------------

describe("table step — a cross-module move through the migration chain", () => {
  for (const platform of ["node", "elixir"] as const) {
    it(`${platform}: the source module records the hand-off, the target the move`, async () => {
      const src = (s: string) => s.replace("platform: node", `platform: ${platform}`);
      const files = await generateEvolvedSystemFiles(
        [
          src(SPLIT("Notes")),
          `${src(SPLIT("Archive"))}\nmigration "move-note" { A.Note -> B.Note }`,
        ],
        { allowDestructive: false },
      );
      const migrations = [...files].filter(([p]) => /\/(db|priv\/repo)\/migrations\//.test(p));
      const all = migrations.map(([, c]) => c).join("\n");
      expect(all).not.toMatch(/DROP TABLE|drop table/);
      if (platform === "node") {
        const archive = migrations.find(([p]) => p.endsWith("_archive_initial.sql"))![1];
        expect(archive).toContain(`ALTER TABLE "a"."notes" SET SCHEMA "b";`);
        expect(archive).toContain(`ALTER TABLE "a"."lines" SET SCHEMA "b";`);
        expect(archive).not.toContain("CREATE TABLE");
      } else {
        const takeover = migrations.find(([p]) => p.endsWith("_archive_take_over_tables.exs"))![1];
        expect(takeover).toContain(`execute("ALTER TABLE \\"a\\".\\"notes\\" SET SCHEMA \\"b\\"")`);
        expect(
          migrations.some(([p]) => /archive.*create_notes|create_notes.*archive/.test(p)),
        ).toBe(false);
      }
    });
  }
});

describe("table step — the migration-evolution move fixtures render on every DB backend", () => {
  const fixture = (n: string, platform: string) =>
    readFileSync(
      new URL(`../e2e/fixtures/migration-evolution/${n}.ddd`, import.meta.url),
      "utf8",
    ).replaceAll("__PLATFORM__", platform);
  for (const platform of [
    "node",
    "dotnet",
    "dotnet { persistence: dapper }",
    "java",
    "python",
    "elixir",
  ]) {
    it(`${platform}: recorded without --allow-destructive, rendered with no drop`, async () => {
      const files = await generateEvolvedSystemFiles(
        [fixture("move-base", platform), fixture("move-evolved", platform)],
        { allowDestructive: false },
      );
      const migrations = [...files].filter(([p]) => /migration/i.test(p));
      expect(migrations.length).toBeGreaterThan(0);
      const all = migrations.map(([, c]) => c).join("\n");
      expect(all).toContain("SET SCHEMA");
      expect(all).not.toMatch(/DROP TABLE|drop table/);
    });
  }
});

// --- phase ⑦ target resolution ----------------------------------------------

async function irCodes(src: string): Promise<string[]> {
  return validateLoomModel(await buildLoomModel(src))
    .map((d) => d.code ?? "")
    .filter((c) => c.startsWith("loom.migration-"));
}

describe("table step — target resolution (phase ⑦)", () => {
  it("a well-formed move resolves", async () => {
    expect(await irCodes(`${NOTES("B")}\nmigration "m" { A.Note -> B.Note }`)).toEqual([]);
  });

  it("an unknown context on the move form", async () => {
    expect(await irCodes(`${NOTES("B")}\nmigration "m" { A.Note -> Nowhere.Note }`)).toEqual([
      "loom.migration-step-unknown-context",
    ]);
  });

  it("a target that is not in the model (or not in the named context)", async () => {
    expect(await irCodes(`${NOTES("B")}\nmigration "m" { Gone -> Missing }`)).toEqual([
      "loom.migration-step-target-missing",
    ]);
    expect(await irCodes(`${NOTES("B")}\nmigration "m" { B.Note -> A.Note }`)).toEqual([
      "loom.migration-step-target-missing",
    ]);
  });

  it("an unqualified name two contexts declare is ambiguous", async () => {
    const src = NOTES("B").replace(
      "aggregate Keep { name: string }",
      "aggregate Keep { name: string }\n      aggregate Other { name: string }\n      repository OtherAs for Other { }",
    );
    expect(await irCodes(`${src}\nmigration "m" { Old -> Other }`)).toEqual([
      "loom.migration-step-ambiguous",
    ]);
  });

  it("a move between modules on different databases", async () => {
    const src = SPLIT("Archive").replace(
      `deployable api { platform: node, contexts: [A, B], dataSources: [sa, sb], port: 3000 }`,
      `deployable api { platform: node, contexts: [A], dataSources: [sa], port: 3000 }
  deployable archive { platform: node, contexts: [B], dataSources: [sb], port: 3001 }`,
    );
    expect(await irCodes(`${src}\nmigration "m" { A.Note -> B.Note }`)).toEqual([
      "loom.migration-move-across-databases",
    ]);
  });
});
