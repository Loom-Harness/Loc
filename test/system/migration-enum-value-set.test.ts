// An `enum`'s VALUE SET is part of the schema, so narrowing one produces a
// migration.
//
// An enum persists as `TEXT` on every backend, so the set of legal values was
// invisible to `MigrationsIR` — `mapTypeToColumn` returned `{kind: "text"}` and
// the enum's identity was gone.  Two ordinary schema evolutions were therefore
// complete no-ops:
//
//   1. `skill: string` → `skill: Skill`   (tighten a loose column)
//   2. `enum Skill { physio, gp, dentist }` → `{ physio, gp }`  (delete a member)
//
// Both regenerated with `0 error(s), 0 warning(s)`, wrote NO migration file, and
// left the database accepting values the model had just outlawed — while the
// same generation's OpenAPI declared the field `$ref`-ed to the enum and the
// same generation's zod/pydantic client refused them.  The server served data
// its own published contract forbade; the generated client threw on it.
//
// The fix makes the value set a table-level `CHECK` (`CheckKind.enumValues`),
// so the ordinary check diff sees any change to it.  Added `NOT VALID`, which
// is what makes this safe to land on a populated database: already-stored rows
// are not re-checked (the deploy cannot fail on them), while every future
// INSERT/UPDATE is refused immediately.  Proved against a real Postgres:
// seeding `'dentist'`, narrowing the enum, then reading the row back (it
// survives) and re-inserting `'dentist'` (`ERROR: new row … violates check
// constraint "appts_skill_enum"`).
//
// All five backends carry it — the constraint names one real column, unlike
// the value-object null-consistency kind Phoenix correctly skips.

import { describe, expect, it } from "vitest";
import type { SchemaSnapshot } from "../../src/ir/types/migrations-ir.js";
import { buildMigrations } from "../../src/system/migrations-builder.js";
import { memorySnapshotStore } from "../../src/system/snapshot.js";
import { generateSystemFiles } from "../_helpers/generate.js";
import { buildLoomModel } from "../_helpers/index.js";

const NODE = (decl: string, field: string) => `system M {
  subdomain S { context C {
    ${decl}
    aggregate Appt { label: string  skill: ${field}  note: string?  derived display: string = label }
    repository Appts for Appt { }
  } }
  storage p { type: postgres }  resource r { for: C, kind: state, use: p }
  deployable api { platform: node, contexts: [C], dataSources: [r], port: 3000 }
}`;

const ENUM3 = "enum Skill { physio, gp, dentist }";

async function initialSql(src: string): Promise<string> {
  const files = await generateSystemFiles(src);
  const hit = [...files.entries()].find(([p]) => /db\/migrations\/.*\.sql$/.test(p));
  expect(hit, "no initial migration emitted").toBeDefined();
  return hit![1];
}

/** Generate `v1`, keep its snapshot, then generate `v2` against it — the same
 *  two-generation shape `ddd generate system` performs over one output tree —
 *  and return the derived forward steps. */
async function evolve(v1: string, v2: string) {
  const first = buildMigrations((await buildLoomModel(v1)).systems[0]!, memorySnapshotStore());
  const store = memorySnapshotStore(
    Object.fromEntries(first.map((m) => [m.module, m.next])) as Record<string, SchemaSnapshot>,
  );
  const second = buildMigrations((await buildLoomModel(v2)).systems[0]!, store);
  return second.flatMap((m) => m.steps);
}

describe("an enum's value set reaches the schema", () => {
  it("a fresh table carries the value set as an inline CHECK", async () => {
    const sql = await initialSql(NODE(ENUM3, "Skill"));
    expect(sql).toContain(
      `CONSTRAINT "appts_skill_enum" CHECK ("skill" IN ('physio', 'gp', 'dentist'))`,
    );
    // Inline on a CREATE TABLE, so there is nothing to validate and no
    // `NOT VALID` — that qualifier belongs to the ALTER path only.
    expect(sql).not.toContain("NOT VALID");
  });

  it("a NULLABLE enum column spells the null arm", async () => {
    const sql = await initialSql(`system M {
      subdomain S { context C {
        ${ENUM3}
        aggregate Appt { label: string  skill: Skill?  derived display: string = label }
        repository Appts for Appt { }
      } }
      storage p { type: postgres }  resource r { for: C, kind: state, use: p }
      deployable api { platform: node, contexts: [C], dataSources: [r], port: 3000 }
    }`);
    expect(sql).toContain(`CHECK ("skill" IS NULL OR "skill" IN ('physio', 'gp', 'dentist'))`);
  });

  it("a plain string column gets no check", async () => {
    const sql = await initialSql(NODE("", "string"));
    expect(sql).not.toContain("appts_skill_enum");
    expect(sql).not.toContain("CHECK");
  });

  it("an enum inside a flattened value object is covered too", async () => {
    const sql = await initialSql(`system M {
      subdomain S { context C {
        enum Country { nl, be }
        valueobject Address { line1: string  country: Country }
        aggregate Appt { label: string  shipTo: Address  derived display: string = label }
        repository Appts for Appt { }
      } }
      storage p { type: postgres }  resource r { for: C, kind: state, use: p }
      deployable api { platform: node, contexts: [C], dataSources: [r], port: 3000 }
    }`);
    // The VO flattens into `ship_to_line1` / `ship_to_country`; the enum leaf
    // is constrained under its flattened column name.
    expect(sql).toContain(
      `CONSTRAINT "appts_ship_to_country_enum" CHECK ("ship_to_country" IN ('nl', 'be'))`,
    );
  });

  it("a plain string NARROWED to an enum emits a migration", async () => {
    const steps = await evolve(NODE("", "string"), NODE(ENUM3, "Skill"));
    // The move that used to produce NOTHING.
    expect(steps.map((s) => s.op)).toContain("addCheck");
    const add = steps.find((s) => s.op === "addCheck") as Extract<
      (typeof steps)[number],
      { op: "addCheck" }
    >;
    expect(add.check.name).toBe("appts_skill_enum");
    expect(add.check.kind).toBe("enumValues");
    expect(add.check.expression).toBe(`"skill" IN ('physio', 'gp', 'dentist')`);
  });

  it("DELETING an enum member emits a migration", async () => {
    const steps = await evolve(NODE(ENUM3, "Skill"), NODE("enum Skill { physio, gp }", "Skill"));
    // Postgres cannot alter a constraint in place, so a narrowed value set is
    // a drop + re-add under the same name.
    expect(steps.map((s) => s.op)).toEqual(expect.arrayContaining(["dropCheck", "addCheck"]));
    const add = steps.find((s) => s.op === "addCheck") as Extract<
      (typeof steps)[number],
      { op: "addCheck" }
    >;
    expect(add.check.expression).toBe(`"skill" IN ('physio', 'gp')`);
    const drop = steps.find((s) => s.op === "dropCheck") as Extract<
      (typeof steps)[number],
      { op: "dropCheck" }
    >;
    // The drop carries the KIND so each backend skips exactly what it skips on
    // the add side (Ecto has no `if_exists` on `drop constraint`, so dropping
    // one it never created would fail the migration).
    expect(drop.kind).toBe("enumValues");
  });

  it("ADDING an enum member is still a migration, and a widening one", async () => {
    const steps = await evolve(NODE("enum Skill { physio, gp }", "Skill"), NODE(ENUM3, "Skill"));
    const add = steps.find((s) => s.op === "addCheck") as Extract<
      (typeof steps)[number],
      { op: "addCheck" }
    >;
    expect(add.check.expression).toBe(`"skill" IN ('physio', 'gp', 'dentist')`);
  });

  it("regenerating an UNCHANGED model emits no check churn", async () => {
    // The constraint is derived from the value set, so an unchanged model must
    // produce an empty diff — otherwise every regeneration would mint a
    // drop+add migration forever.
    const steps = await evolve(NODE(ENUM3, "Skill"), NODE(ENUM3, "Skill"));
    expect(steps).toEqual([]);
  });

  it("every backend that renders migrations carries the constraint", async () => {
    // Phoenix skips the value-object null-consistency kind (its leaf columns do
    // not exist on Ecto) — it must NOT skip this one, or the elixir app would
    // be the single backend whose database still accepted a deleted value.
    const ecto = await generateSystemFiles(
      NODE(ENUM3, "Skill").replace("platform: node", "platform: elixir"),
    );
    const mig = [...ecto.entries()].find(([p]) => /priv\/repo\/migrations\/.*\.exs$/.test(p));
    expect(mig, "no Ecto migration emitted").toBeDefined();
    expect(mig![1]).toContain(
      String.raw`create constraint(:appts, :appts_skill_enum, check: "\"skill\" IN ('physio', 'gp', 'dentist')", prefix: "c")`,
    );
  });
});
