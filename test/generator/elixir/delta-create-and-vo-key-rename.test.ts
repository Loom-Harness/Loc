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
// 2. Renaming a value-object field renames its leaf columns, on the singular
//    value object and on the collection's child table alike, and moves no
//    json key (D-ONE-SCHEMA).

import { describe, expect, it } from "vitest";
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

  it("a value-object collection table: the shared (parent_fk, ordinal) PK, no timestamps", async () => {
    const delta = await lastDelta([V1, V2, V3]);
    const block = createBlock(delta, "post_addrs");
    expect(block).toBe(createBlock(await freshCreate(V3, "post_addrs"), "post_addrs"));
    expect(block).toMatch(/add :post_id, references\(:posts.*primary_key: true/);
    expect(block).toContain("add :ordinal, :integer, null: false, primary_key: true");
    expect(block).not.toContain("add :id,");
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

describe("elixir delta — renaming a value-object leaf", () => {
  it("renames the leaf column of the singular value object and of the collection", async () => {
    const delta = await lastDelta([
      people("street: string  city: string"),
      people("road: string  city: string"),
    ]);
    // A value object is its leaf columns on an aggregate table (D-ONE-SCHEMA).
    expect(delta).toContain('rename table(:persons, prefix: "c"), :home_street, to: :home_road');
    expect(delta).toContain('rename table(:person_past, prefix: "c"), :street, to: :road');
    // No json key move: there is no json column.
    expect(delta).not.toContain("jsonb_build_object");
  });
});
