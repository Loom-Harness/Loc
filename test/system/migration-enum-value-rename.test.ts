// An enum VALUE rename in a `migration` block: `Status.Draft -> Pending`.
//
// Stored rows hold an enum value by its NAME, so renaming one in the model
// leaves every existing row holding a value the model no longer declares.  The
// declared step is the ledger record that says what the stored rows become:
// one UPDATE per column that stores the enum, emitted once.
//
//   migration "rename-draft" { Status.Draft -> Pending }
//
//   UPDATE "c"."orders" SET "status" = 'Pending' WHERE "status" = 'Draft';
//   UPDATE "c"."orders" SET "tags" = array_replace("tags", 'Draft', 'Pending')
//     WHERE 'Draft' = ANY("tags");

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { detectRenames } from "../../src/i18n/renames.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import type { MigrationStep, SchemaSnapshot } from "../../src/ir/types/migrations-ir.js";
import { printStructural } from "../../src/language/print/print-structural.js";
import { evolveSystem, migrationIntents } from "../../src/system/migration-diff.js";
import {
  buildMigrations,
  type MigrationDelta,
  type MigrationWarning,
} from "../../src/system/migrations-builder.js";
import { canonicalSnapshot, memorySnapshotStore } from "../../src/system/snapshot.js";
import { buildLoomModel, generateEvolvedSystemFiles } from "../_helpers/index.js";
import { parseErrorsOf, parseString } from "../_helpers/parse.js";

const SYS = (enumDecl: string, extra = "") => `system M {
  subdomain S { context C {
    ${enumDecl}
    valueobject Spot { label: string  status: Status? }
    aggregate Order with crudish {
      title: string
      status: Status
      prior: Status?
      tags: Status[]
      spot: Spot?
      contains lines: Line[]
      entity Line { qty: int  status: Status }
    }
    repository Orders for Order { }
    ${extra}
  } }
  storage p { type: postgres }  resource r { for: C, kind: state, use: p }
  deployable api { platform: node, contexts: [C], dataSources: [r], port: 3000 }
}`;

const V1 = "enum Status { Draft, Placed }";
const V2 = "enum Status { Pending, Placed }";
const RENAME = `migration "rename-draft" { Status.Draft -> Pending }`;

/** Build `v1`'s Initial, then derive `v2` against it.  Returns the second
 *  generation's deltas, warnings and destructive refusals, plus the stored
 *  heads (canonicalised, as the chain stores them). */
async function evolve(v1: string, v2: string) {
  const heads: Record<string, SchemaSnapshot> = {};
  const store = memorySnapshotStore(heads);
  const m1 = await buildLoomModel(v1);
  const first = buildMigrations(m1.systems[0]!, store, migrationIntents(m1));
  for (const d of first) heads[d.module] = canonicalSnapshot(d.next);
  const m2 = await buildLoomModel(v2);
  const warnings: MigrationWarning[] = [];
  const refusals: Error[] = [];
  const second = buildMigrations(m2.systems[0]!, store, {
    ...migrationIntents(m2),
    warnings,
    destructiveRefusals: refusals as never,
  });
  return { first, second, warnings, refusals, heads, store };
}

const execs = (deltas: readonly MigrationDelta[]): string[] =>
  deltas.flatMap((d) => d.steps.flatMap((s: MigrationStep) => (s.op === "sqlExec" ? [s.sql] : [])));

describe("enum value rename — parsing, lowering, printing", () => {
  it("parses as a column step whose owner links to the enum, and lowers to an intent", async () => {
    const src = `${SYS(V2)}\n${RENAME}`;
    expect(parseErrorsOf(src)).toEqual([]);
    const { model } = await parseString(src, { validate: false });
    const loom = lowerModel(model);
    expect(loom.enumValueRenameIntents).toMatchObject([
      {
        migration: "rename-draft",
        index: 0,
        enum: "Status",
        context: "C",
        from: "Draft",
        to: "Pending",
      },
    ]);
    // Not mistaken for a column rename of an aggregate.
    expect(loom.renameIntents).toEqual([]);
  });

  it("a root-level enum lowers with no context", async () => {
    const src = `enum Level { Low, High }
system M { subdomain S { context C {
  aggregate T with crudish { level: Level }  repository Ts for T { }
} } }
migration "m" { Level.Lo -> Low }`;
    const { model } = await parseString(src, { validate: false });
    const [intent] = lowerModel(model).enumValueRenameIntents;
    expect(intent).toMatchObject({ enum: "Level", from: "Lo", to: "Low" });
    expect(intent!.context).toBeUndefined();
  });

  it("prints back to the same step", async () => {
    const { model } = await parseString(`${SYS(V2)}\n${RENAME}`, { validate: false });
    const migration = model.members.find((m) => m.$type === "Migration")!;
    expect(printStructural(migration)).toContain("Status.Draft -> Pending");
  });
});

describe("enum value rename — AST validation", () => {
  const codes = async (migration: string): Promise<string[]> =>
    (await parseString(`${SYS(V2)}\n${migration}`)).diagnostics
      .map((d) => String(d.code ?? ""))
      .filter((c) => c.startsWith("loom.migration") || c.startsWith("loom.rename"));

  it("accepts a well-formed rename (and two old values merging into one)", async () => {
    expect(await codes(`migration "m" { Status.Draft -> Pending  Status.New -> Pending }`)).toEqual(
      [],
    );
  });

  it("rejects the backfill `=` form on an enum", async () => {
    expect(await codes(`migration "m" { Status.Draft = Pending }`)).toEqual([
      "loom.migration-enum-value-form",
    ]);
  });

  it("rejects a NEW value the enum does not declare", async () => {
    expect(await codes(`migration "m" { Status.Draft -> Pendng }`)).toEqual([
      "loom.migration-enum-value-unknown",
    ]);
  });

  it("rejects a self-rename and a value renamed twice", async () => {
    expect(await codes(`migration "m" { Status.Pending -> Pending }`)).toEqual([
      "loom.rename-to-self",
    ]);
    expect(
      await codes(`migration "m" { Status.Draft -> Pending  Status.Draft -> Placed }`),
    ).toEqual(["loom.rename-duplicate-source"]);
  });

  it("an unknown owner is still a linking error", async () => {
    const { diagnostics } = await parseString(
      `${SYS(V2)}\nmigration "m" { Nope.Draft -> Pending }`,
    );
    expect(diagnostics.some((d) => /Could not resolve reference/.test(d.message))).toBe(true);
  });
});

describe("enum value rename — the migration chain", () => {
  it("updates every column that stores the enum, after the CHECK is re-added", async () => {
    const { second, refusals } = await evolve(SYS(V1), `${SYS(V2)}\n${RENAME}`);
    expect(refusals).toEqual([]);
    expect(execs(second)).toEqual([
      // Part table — a contained entity's own column.
      `UPDATE "c"."lines" SET "status" = 'Pending' WHERE "status" = 'Draft'`,
      // Aggregate root: the scalar, the nullable scalar, the enum array, and
      // the flattened value-object leaf.
      `UPDATE "c"."orders" SET "status" = 'Pending' WHERE "status" = 'Draft'`,
      `UPDATE "c"."orders" SET "prior" = 'Pending' WHERE "prior" = 'Draft'`,
      `UPDATE "c"."orders" SET "tags" = array_replace("tags", 'Draft', 'Pending') WHERE 'Draft' = ANY("tags")`,
      `UPDATE "c"."orders" SET "spot_status" = 'Pending' WHERE "spot_status" = 'Draft'`,
    ]);
    // Ordered after the re-added CHECK: the old CHECK does not admit
    // 'Pending', the new one (NOT VALID) does.
    const steps = second[0]!.steps;
    const lastCheck = steps.map((s) => s.op).lastIndexOf("addCheck");
    const firstUpdate = steps.findIndex((s) => s.op === "sqlExec");
    expect(lastCheck).toBeGreaterThan(-1);
    expect(firstUpdate).toBeGreaterThan(lastCheck);
  });

  it("runs once: the ledger records the step, and the next generation is empty", async () => {
    const v2 = `${SYS(V2)}\n${RENAME}`;
    const { second, heads, store } = await evolve(SYS(V1), v2);
    expect(second[0]!.next.appliedDataMigrations).toEqual(["rename-draft#0"]);
    for (const d of second) heads[d.module] = canonicalSnapshot(d.next);
    const m = await buildLoomModel(v2);
    const warnings: MigrationWarning[] = [];
    const third = buildMigrations(m.systems[0]!, store, { ...migrationIntents(m), warnings });
    expect(third.flatMap((d) => d.steps)).toEqual([]);
    expect(warnings.map((w) => w.code)).toEqual(["loom.migration-block-applied"]);
  });

  it("an Initial generation records the step without an UPDATE (no row exists)", async () => {
    const m = await buildLoomModel(`${SYS(V2)}\n${RENAME}`);
    const [initial] = buildMigrations(m.systems[0]!, memorySnapshotStore(), migrationIntents(m));
    expect(execs([initial!])).toEqual([]);
    expect(initial!.next.appliedDataMigrations).toEqual(["rename-draft#0"]);
  });

  it("covers the removal: without the step the same edit is breaking-for-data", async () => {
    const without = await evolve(SYS(V1), SYS(V2));
    expect(without.refusals.map((r) => (r as { code?: string }).code)).toEqual([
      "loom.migration-enum-narrowed",
    ]);
    expect(execs(without.second)).toEqual([]);
  });

  it("the derivation-only stamp never reaches a stored snapshot", async () => {
    const { second } = await evolve(SYS(V1), `${SYS(V2)}\n${RENAME}`);
    const stored = JSON.stringify(canonicalSnapshot(second[0]!.next));
    expect(stored).not.toContain("enumOf");
    expect(JSON.stringify(second[0]!.next)).toContain('"enumOf":"Status"');
  });

  it("projection and saga state tables are columns too, and are updated", async () => {
    const extra = `
    event Placed { order: Order id  status: Status }
    projection Board keyed by order {
      order: Order id
      status: Status
      on(e: Placed) {
        order := e.order
        status := e.status
      }
    }`;
    const v1 = SYS(V1, extra);
    const v2 = `${SYS(V2, extra)}\n${RENAME}`;
    const sqls = execs((await evolve(v1, v2)).second);
    expect(sqls.some((s) => /"boards?" SET "status" = 'Pending'/.test(s))).toBe(true);
  });

  it("names the JSON places it cannot rewrite (a document-shaped aggregate)", async () => {
    const doc = (e: string) => `system M {
  subdomain S { context C {
    ${e}
    aggregate Note shape: document with crudish { title: string  status: Status }
    aggregate Order with crudish { status: Status }
    repository Notes for Note { }
    repository Orders for Order { }
  } }
  storage p { type: postgres }  resource r { for: C, kind: state, use: p }
  deployable api { platform: node, contexts: [C], dataSources: [r], port: 3000 }
}`;
    const { second, warnings } = await evolve(doc(V1), `${doc(V2)}\n${RENAME}`);
    // The relational column is updated …
    expect(execs(second)).toEqual([
      `UPDATE "c"."orders" SET "status" = 'Pending' WHERE "status" = 'Draft'`,
    ]);
    // … and the document is named, not silently skipped.
    const unmigrated = warnings.filter((w) => w.code === "loom.migration-enum-value-unmigrated");
    expect(unmigrated).toHaveLength(1);
    expect(unmigrated[0]!.message).toContain("c.notes.data (the document of Note)");
  });

  it("a purely relational module raises no unmigrated warning", async () => {
    const { warnings } = await evolve(SYS(V1), `${SYS(V2)}\n${RENAME}`);
    expect(warnings.filter((w) => w.code === "loom.migration-enum-value-unmigrated")).toEqual([]);
  });
});

describe("enum value rename — `ddd diff` classification", () => {
  async function classify(v1: string, v2: string) {
    const m1 = await buildLoomModel(v1);
    const seed: Record<string, SchemaSnapshot> = {};
    for (const d of buildMigrations(m1.systems[0]!, memorySnapshotStore())) seed[d.module] = d.next;
    const m2 = await buildLoomModel(v2);
    return evolveSystem(m2, m2.systems[0]!, null, memorySnapshotStore(seed));
  }

  it("an undeclared removal is breaking-for-data", async () => {
    const evo = await classify(SYS(V1), SYS(V2));
    expect(evo.breaking).toBe(true);
    expect([...evo.destructive.values()].join("\n")).toContain("no longer admits 'Draft'");
  });

  it("the declared rename is compatible for data", async () => {
    const evo = await classify(SYS(V1), `${SYS(V2)}\n${RENAME}`);
    expect(evo.destructive.size).toBe(0);
  });
});

describe("enum value rename — the label translation is carried", () => {
  it("re-keys the value's catalog entry from the declared step", () => {
    const base = { "C.Status.value.Draft": "Draft" };
    const theirs = { "C.Status.value.Pending": "Pending" };
    const declared = {
      columns: [],
      tables: [],
      enumValues: [{ context: "C", enum: "Status", from: "Draft", to: "Pending" }],
    };
    // The text changed, so inference alone cannot pair them …
    expect(detectRenames(base, theirs)).toEqual([]);
    // … the declared step does.
    expect(detectRenames(base, theirs, declared)).toEqual([
      { from: "C.Status.value.Draft", to: "C.Status.value.Pending", via: "declared" },
    ]);
  });

  it("a root-level enum files under `_system`", () => {
    expect(
      detectRenames(
        { "_system.Level.value.Lo": "Lo" },
        { "_system.Level.value.Low": "Low" },
        { columns: [], tables: [], enumValues: [{ enum: "Level", from: "Lo", to: "Low" }] },
      ),
    ).toEqual([{ from: "_system.Level.value.Lo", to: "_system.Level.value.Low", via: "declared" }]);
  });
});

// The UPDATE is a `sqlExec` step of the shared chain: every backend with a
// database renders it from the same text — the node / Dapper / Alembic /
// Flyway / EF migration files carry it verbatim, Ecto wraps it in `execute/1`.
describe("enum value rename — rendered on every DB backend", () => {
  const fixture = (n: string, platform: string) =>
    readFileSync(
      new URL(`../e2e/fixtures/migration-evolution/${n}.ddd`, import.meta.url),
      "utf8",
    ).replaceAll("__PLATFORM__", platform);
  const UPDATE = `UPDATE "catalog"."products" SET "stage" = 'drafted' WHERE "stage" = 'draft'`;
  for (const platform of [
    "node",
    "dotnet",
    "dotnet { persistence: dapper }",
    "java",
    "python",
    "elixir",
  ]) {
    it(`${platform}: the evolution fixture's migration carries the UPDATE`, async () => {
      const files = await generateEvolvedSystemFiles(
        [fixture("base", platform), fixture("evolved", platform)],
        { allowDestructive: false },
      );
      const migrations = [...files]
        .filter(([p]) => /migration/i.test(p))
        .map(([, c]) => c)
        .join("\n");
      // Each host language quotes the same text its own way: Ecto's
      // `execute("…")`, a C# verbatim `@"…"` (doubled `"`), plain SQL elsewhere.
      const rendered = platform.startsWith("dotnet")
        ? UPDATE.replaceAll('"', '""')
        : platform === "elixir"
          ? `execute(${JSON.stringify(UPDATE)})`
          : UPDATE;
      expect(migrations).toContain(rendered);
    });
  }
});
