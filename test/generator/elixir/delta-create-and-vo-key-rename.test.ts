// Two ways the elixir DELTA path used to disagree with what the Ecto schema
// (and a fresh create) expects.
//
// 1. A table that first appears in a LATER generation is created by the same
//    rendering a fresh project uses.  A value-object collection child table
//    needs Phoenix's synthetic `id` (the schema's `@primary_key :id`) and no
//    timestamps; an `X id[]` join table needs its composite key PK and no
//    timestamps (the `many_to_many` insert writes only the keys).  The delta
//    once rendered both as plain tables: no `id`, NOT NULL `timestamps()`.
//
// 2. A value object is ONE jsonb `:map` column on Phoenix, so renaming one of
//    its fields renames no column — but every stored document still carries
//    the old key, and `Loom.ValueObject` reads the new key as nil and re-dumps
//    without the old one.  The delta now moves the key in every row.

import { describe, expect, it } from "vitest";
import { collapseVoSteps } from "../../../src/generator/_persistence/vo-json-columns.js";
import type {
  MigrationsIR,
  SchemaSnapshot,
  TableShape,
} from "../../../src/ir/types/migrations-ir.js";
import { generateEvolvedSystemFiles, generateSystemFiles } from "../../_helpers/generate.js";

const blog = (postBody: string, extra = "") => `system J { subdomain Core { context Core {
  ${extra}
  aggregate Tag with crudish { label: string }
  aggregate Post with crudish { title: string  tags: Tag id[]  ${postBody} }
  repository Tags for Tag { }  repository Posts for Post { } } }
  api A from Core  storage primary { type: postgres }
  resource s { for: Core, kind: state, use: primary }
  deployable dex { platform: elixir contexts: [Core] dataSources: [s] serves: A port: 4005 } }`;

const V1 = blog("");
const V2 = blog("related: Tag id[]");
const V3 = blog("related: Tag id[]  addrs: Addr[]", "valueobject Addr { street: string }");

const migrations = (files: Map<string, string>) =>
  [...files.keys()].filter((k) => k.includes("/priv/repo/migrations/"));

/** The `create table(:<name> …) do … end` block of `src`, de-indented. */
function createBlock(src: string, table: string): string {
  const lines = src.split("\n");
  const start = lines.findIndex((l) => l.trim().startsWith(`create table(:${table},`));
  expect(start, `no create table(:${table}) in\n${src}`).toBeGreaterThanOrEqual(0);
  const indent = lines[start]!.length - lines[start]!.trimStart().length;
  const end = lines.findIndex((l, i) => i > start && l === `${" ".repeat(indent)}end`);
  return lines
    .slice(start, end + 1)
    .map((l) => l.slice(indent))
    .join("\n");
}

/** The fresh-create file for `table` when `src` is generated from scratch. */
async function freshCreate(src: string, table: string): Promise<string> {
  const files = await generateSystemFiles(src);
  const path = migrations(files).find((k) => k.endsWith(`_create_${table}.exs`));
  expect(path, `no fresh create for ${table}`).toBeDefined();
  return files.get(path!)!;
}

/** The newest delta file of the chain recorded for `sources`. */
async function lastDelta(sources: string[]): Promise<string> {
  const files = await generateEvolvedSystemFiles(sources);
  const deltas = migrations(files)
    .filter((k) => /_gen_?\d+\.exs$/.test(k))
    .sort();
  expect(deltas.length).toBeGreaterThan(0);
  return files.get(deltas[deltas.length - 1]!)!;
}

describe("elixir delta — a table added later is created exactly as a fresh create", () => {
  it("an `X id[]` join table: composite key PK, no timestamps", async () => {
    const delta = await lastDelta([V1, V2]);
    const block = createBlock(delta, "post_related");
    expect(block).toBe(createBlock(await freshCreate(V2, "post_related"), "post_related"));
    expect(block).toMatch(/add :post_id, references\(:posts.*primary_key: true/);
    expect(block).toMatch(/add :tag_id, references\(:tags.*primary_key: true/);
    expect(block).not.toContain("timestamps()");
  });

  it("a value-object collection table: the synthetic `id` PK, no timestamps", async () => {
    const delta = await lastDelta([V1, V2, V3]);
    const block = createBlock(delta, "post_addrs");
    expect(block).toBe(createBlock(await freshCreate(V3, "post_addrs"), "post_addrs"));
    expect(block).toContain("add :id, :uuid, primary_key: true, null: false");
    expect(block).not.toContain("timestamps()");
  });
});

const people = (fields: string) => `system P { subdomain C { context C {
  valueobject Address { ${fields} }
  aggregate Person with crudish { name: string  home: Address  past: Address[] }
  repository People for Person { } } }
  api A from C  storage pg { type: postgres }
  resource s { for: C, kind: state, use: pg }
  deployable d { platform: elixir contexts: [C] dataSources: [s] serves: A port: 4000 } }`;

describe("elixir delta — renaming a value-object field moves its jsonb key", () => {
  it("rewrites the key in the singular VO column, guarded, and renames the collection column", async () => {
    const delta = await lastDelta([
      people("street: string  city: string"),
      people("road: string  city: string"),
    ]);
    // The data move: old key out, new key in, every row whose map has it.
    expect(delta).toContain(
      `execute("UPDATE \\"c\\".\\"persons\\" SET \\"home\\" = (\\"home\\" - 'street') || jsonb_build_object('road', \\"home\\" -> 'street') WHERE jsonb_typeof(\\"home\\") = 'object' AND \\"home\\" -> 'street' IS NOT NULL")`,
    );
    // The guard runs first and stops the migration when a stored map has
    // neither key (a nested value object, or a key spelled differently).
    const guard = delta.indexOf("DO $$ BEGIN IF EXISTS");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(delta.indexOf('execute("UPDATE'));
    expect(delta).toContain(
      `\\"home\\" -> 'street' IS NULL AND \\"home\\" -> 'road' IS NULL) THEN RAISE EXCEPTION`,
    );
    // The collection's elements are real columns on Phoenix: a column rename.
    expect(delta).toContain('rename table(:person_past, prefix: "c"), :street, to: :road');
    // No column named for a leaf of the singular value object.
    expect(delta).not.toMatch(/:home_(street|road)/);
  });

  it("a field rename that also renames a leaf renames the column, then moves the key", () => {
    const leaf = (group: string, sub: string) => ({
      name: `${group}_${sub}`,
      type: { kind: "text" as const },
      nullable: false,
      voGroup: group,
    });
    const table = (cols: ReturnType<typeof leaf>[]): TableShape => ({
      name: "persons",
      ownerModule: "C",
      columns: [{ name: "id", type: { kind: "uuid" }, nullable: false }, ...cols],
      primaryKey: ["id"],
      foreignKeys: [],
      indexes: [],
    });
    const snap = (t: TableShape) => ({ schemaVersion: 1, tables: [t] }) as SchemaSnapshot;
    const m: MigrationsIR = {
      module: "C",
      storageName: "",
      baseline: snap(table([leaf("home", "street"), leaf("home", "city")])),
      next: snap(table([leaf("house", "road"), leaf("house", "city")])),
      steps: [
        ["home_street", "house_road"],
        ["home_city", "house_city"],
      ].map(([from, to]) => ({
        op: "renameColumn" as const,
        table: "persons",
        from: from!,
        to: to!,
        type: { kind: "text" as const },
      })),
      version: "20260102000000",
      name: "Gen1",
    };
    const steps = collapseVoSteps(m, "snake");
    expect(steps.map((s) => s.op)).toEqual(["renameColumn", "sqlExec", "sqlExec"]);
    expect(steps[0]).toMatchObject({ from: "home", to: "house" });
    // The move targets the RENAMED column; `city` kept its key.
    expect((steps[2] as { sql: string }).sql).toBe(
      `UPDATE "persons" SET "house" = ("house" - 'street') || jsonb_build_object('road', "house" -> 'street') WHERE jsonb_typeof("house") = 'object' AND "house" -> 'street' IS NOT NULL`,
    );
  });
});
