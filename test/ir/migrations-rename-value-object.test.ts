import { describe, expect, it } from "vitest";
import { renderPgStep } from "../../src/generator/sql-pg.js";
import type { MigrationStep } from "../../src/ir/types/migrations-ir.js";
import { pendingMigrations } from "../../src/system/index.js";
import type { MigrationWarning } from "../../src/system/migrations-builder.js";
import { generateEvolvedSystemFiles, recordChain } from "../_helpers/generate.js";
import { buildLoomModel } from "../_helpers/index.js";

// ---------------------------------------------------------------------------
// Renaming a value-object-typed field.  The relational backends store the
// field as one column per leaf (`home_road`, `home_city`); Ecto and Dapper as
// one json column (`home`).  `migration { Person.home -> residence }` names the
// FIELD, so it renames every leaf column on the SQL backends and the single
// json column on the other two — never the drop + add of the whole value.
// ---------------------------------------------------------------------------

const system = (field: string, deployable: string, migration = "") => `system S {
  subdomain HR {
    context People {
      valueobject Address { road: string  city: string }
      aggregate Person with crudish { name: string  ${field}: Address }
      repository People for Person {}
    }
  }
  api A from HR
  storage pg { type: postgres }
  resource st { for: People, kind: state, use: pg }
  deployable d { platform: ${deployable}  contexts: [People]  dataSources: [st]  serves: A  port: 4000 }
}
${migration}`;

const FIELD_FORM = `migration "res" { Person.home -> residence }`;
const LEAF_FORM = `migration "res" { Person.homeRoad -> residenceRoad  Person.homeCity -> residenceCity }`;

/** The delta steps of the second generation, recorded WITHOUT
 *  `--allow-destructive` — a drop + add of the value would trip the gate. */
async function deltaSteps(migration: string, deployable = "node"): Promise<MigrationStep[]> {
  const chain = await recordChain(
    [system("home", deployable), system("residence", deployable, migration)],
    { allowDestructive: false },
  );
  const entries = chain.entries.filter((e) => e.module === "HR");
  expect(entries.length).toBe(2);
  return entries[1]!.steps;
}

const renames = (steps: MigrationStep[]) =>
  steps
    .filter((s): s is Extract<MigrationStep, { op: "renameColumn" }> => s.op === "renameColumn")
    .map((s) => `${s.table}.${s.from}->${s.to}`)
    .sort();

describe("value-object field rename — Person.home -> residence", () => {
  for (const [label, migration] of [
    ["field form", FIELD_FORM],
    ["per-leaf form", LEAF_FORM],
  ] as const) {
    it(`${label}: renames every leaf column, nothing dropped or added`, async () => {
      const steps = await deltaSteps(migration);
      expect(renames(steps)).toEqual([
        "persons.home_city->residence_city",
        "persons.home_road->residence_road",
      ]);
      expect(steps.some((s) => s.op === "dropColumn" || s.op === "addColumn")).toBe(false);
      expect(steps.map(renderPgStep)).toEqual(
        expect.arrayContaining([
          'ALTER TABLE "people"."persons" RENAME COLUMN "home_road" TO "residence_road";',
          'ALTER TABLE "people"."persons" RENAME COLUMN "home_city" TO "residence_city";',
        ]),
      );
    });
  }

  it("a leaf the value object gained alongside the rename is an add, the rest still rename", async () => {
    const grown = system("residence", "node", FIELD_FORM).replace(
      "valueobject Address { road: string  city: string }",
      "valueobject Address { road: string  city: string  zip: string? }",
    );
    const chain = await recordChain([system("home", "node"), grown], { allowDestructive: false });
    const steps = chain.entries.filter((e) => e.module === "HR")[1]!.steps;
    expect(renames(steps)).toEqual([
      "persons.home_city->residence_city",
      "persons.home_road->residence_road",
    ]);
    expect(
      steps
        .filter((s) => s.op === "addColumn")
        .map((s) => (s.op === "addColumn" ? s.column.name : "")),
    ).toEqual(["residence_zip"]);
    expect(steps.some((s) => s.op === "dropColumn")).toBe(false);
  });

  it("Ecto renames the single :map column", async () => {
    const files = await generateEvolvedSystemFiles(
      [system("home", "elixir"), system("residence", "elixir", FIELD_FORM)],
      { allowDestructive: false },
    );
    const delta = [...files.entries()].find(
      ([k]) => k.includes("/priv/repo/migrations/") && /_gen\d+\.exs$/.test(k),
    )?.[1];
    expect(delta).toBeDefined();
    expect(delta).toContain('rename table(:persons, prefix: "people"), :home, to: :residence');
    expect(delta).not.toMatch(/home_|residence_|remove |add :/);
  });

  it("Dapper renames the single jsonb column", async () => {
    const dapper = "dotnet { persistence: dapper }";
    const files = await generateEvolvedSystemFiles(
      [system("home", dapper), system("residence", dapper, FIELD_FORM)],
      { allowDestructive: false },
    );
    const sql = [...files.entries()]
      .filter(([k]) => /migrations?\//i.test(k) && /gen/i.test(k))
      .map(([, v]) => v)
      .join("\n");
    expect(sql).toContain(
      'ALTER TABLE ""people"".""persons"" RENAME COLUMN ""home"" TO ""residence"";',
    );
    expect(sql).not.toMatch(/home_|residence_|DROP COLUMN/);
  });

  it("the block reads as applied once the rename is in the chain", async () => {
    const v2 = system("residence", "node", FIELD_FORM);
    const chain = await recordChain([system("home", "node"), v2], { allowDestructive: false });
    const warnings: MigrationWarning[] = [];
    const deltas = pendingMigrations(await buildLoomModel(v2), chain, { warnings });
    expect(deltas.flatMap((d) => d.steps)).toEqual([]);
    expect(warnings.map((w) => w.code)).toContain("loom.migration-block-applied");
  });
});
