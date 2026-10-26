import { describe, expect, it } from "vitest";
import { renderEctoStep } from "../../src/generator/elixir/migrations-emit.js";
import { renderPgStep } from "../../src/generator/sql-pg.js";
import type { MigrationStep } from "../../src/ir/types/migrations-ir.js";
import { recordChain } from "../_helpers/generate.js";

// ---------------------------------------------------------------------------
// A table rename runs BEFORE every other step that addresses the renamed
// relation.  The diff pairs the renamed table with its new self and names it by
// its NEW name in every ALTER / DROP it emits (a dropped CHECK, a dropped
// column, a dropped index), so the `renameTable` has to have happened by the
// time those statements run — otherwise Postgres (and Ecto, which compiles to
// the same DDL) fails with `relation "<new name>" does not exist`.
// ---------------------------------------------------------------------------

const V1 = `
system Staffing { subdomain HR { context People {
  enum Grade { junior, senior }
  valueobject Address { street: string  city: string }
  aggregate Employee with crudish { name: string  grade: Grade  home: Address?  tags: string[]?  unique (name) }
  repository Employees for Employee { } } }
  api HrApi from HR  storage primary { type: postgres }
  resource peopleState { for: People, kind: state, use: primary }
  deployable dpy { platform: python contexts: [People] dataSources: [peopleState] serves: HrApi port: 4002 } }
`;

/** V1 with the aggregate renamed to `Staff`, optionally rewriting its body. */
const renamed = (
  body = "name: string  grade: Grade  home: Address?  tags: string[]?  unique (name)",
) =>
  `${V1.replace(
    "aggregate Employee with crudish { name: string  grade: Grade  home: Address?  tags: string[]?  unique (name) }",
    `aggregate Staff with crudish { ${body} }`,
  ).replace("repository Employees for Employee", "repository Staffs for Staff")}
migration "rename-emp" { Employee -> Staff }
`;

async function deltaSteps(v2: string): Promise<MigrationStep[]> {
  const chain = await recordChain([V1, v2]);
  const entries = chain.entries.filter((e) => e.module === "HR");
  expect(entries.length).toBe(2);
  return entries[1]!.steps;
}

/** The relation a step addresses, or undefined for one that names none. */
function tableOf(s: MigrationStep): string | undefined {
  switch (s.op) {
    case "dropCheck":
    case "dropColumn":
    case "dropIndex":
    case "addColumn":
    case "renameColumn":
    case "alterColumnNullable":
    case "alterColumnType":
    case "alterColumnDefault":
      return s.table;
    case "addCheck":
      return s.check.table;
    case "addIndex":
      return s.index.table;
    default:
      return undefined;
  }
}

/** Every step addressing the renamed table comes after the rename, and none
 *  addresses the old name once it is gone. */
function expectRenameFirst(steps: MigrationStep[], from: string, to: string): void {
  const at = steps.findIndex((s) => s.op === "renameTable" && s.from === from && s.to === to);
  expect(at, `no renameTable ${from} -> ${to}`).toBeGreaterThanOrEqual(0);
  steps.forEach((s, i) => {
    const t = tableOf(s);
    if (t === to) expect(i, `${s.op} on ${to} runs before the rename`).toBeGreaterThan(at);
    expect(t, `${s.op} still addresses the old table ${from}`).not.toBe(from);
  });
}

describe("table rename — step ordering against the renamed relation", () => {
  it("drops the enum CHECK on the NEW name AFTER renaming the table", async () => {
    const steps = await deltaSteps(renamed());
    expectRenameFirst(steps, "employees", "staffs");
    expect(steps.some((s) => s.op === "dropCheck" && s.table === "staffs")).toBe(true);

    const sql = steps.map(renderPgStep);
    const rename = sql.findIndex(
      (l) => l === 'ALTER TABLE "people"."employees" RENAME TO "staffs";',
    );
    const dropCheck = sql.findIndex((l) =>
      l.startsWith(
        'ALTER TABLE "people"."staffs" DROP CONSTRAINT IF EXISTS "employees_grade_enum"',
      ),
    );
    expect(rename).toBeGreaterThanOrEqual(0);
    expect(dropCheck).toBeGreaterThan(rename);
    // The re-added CHECK carries the new table-derived name.
    expect(sql.some((l) => l.includes('ADD CONSTRAINT "staffs_grade_enum"'))).toBe(true);

    const ecto = steps.flatMap(renderEctoStep);
    const eRename = ecto.findIndex((l) => l.startsWith("rename table(:employees"));
    const eDrop = ecto.findIndex((l) =>
      l.startsWith("drop constraint(:staffs, :employees_grade_enum"),
    );
    expect(eRename).toBeGreaterThanOrEqual(0);
    expect(eDrop).toBeGreaterThan(eRename);
  });

  it("drops a removed column on the NEW name AFTER renaming the table", async () => {
    const steps = await deltaSteps(
      renamed("name: string  grade: Grade  home: Address?  unique (name)"),
    );
    expectRenameFirst(steps, "employees", "staffs");
    expect(
      steps.some((s) => s.op === "dropColumn" && s.table === "staffs" && s.name === "tags"),
    ).toBe(true);

    const sql = steps.map(renderPgStep);
    const rename = sql.indexOf('ALTER TABLE "people"."employees" RENAME TO "staffs";');
    const drop = sql.indexOf('ALTER TABLE "people"."staffs" DROP COLUMN "tags";');
    expect(rename).toBeGreaterThanOrEqual(0);
    expect(drop).toBeGreaterThan(rename);

    const ecto = steps.flatMap(renderEctoStep);
    const eRename = ecto.findIndex((l) => l.startsWith("rename table(:employees"));
    const eDrop = ecto.findIndex((l) => l.startsWith("alter table(:staffs"));
    expect(eRename).toBeGreaterThanOrEqual(0);
    expect(eDrop).toBeGreaterThan(eRename);
  });

  it("renames the table before dropping a removed unique index", async () => {
    const steps = await deltaSteps(
      renamed("name: string  grade: Grade  home: Address?  tags: string[]?"),
    );
    expectRenameFirst(steps, "employees", "staffs");
    const ecto = steps.flatMap(renderEctoStep);
    const eRename = ecto.findIndex((l) => l.startsWith("rename table(:employees"));
    const eDrop = ecto.findIndex((l) => l.startsWith("drop index(:staffs"));
    expect(eDrop).toBeGreaterThan(eRename);
  });
});
