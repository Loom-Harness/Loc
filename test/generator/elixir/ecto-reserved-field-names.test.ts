// Field names Ecto / Elixir reserve on a schema struct — legal `.ddd`
// identifiers, each probed against `mix compile --warnings-as-errors`
// (Elixir 1.18.4, ecto 3.14.2):
//
//   inserted_at / updated_at / insertedAt   (aggregate ROOT or entity part)
//     → an ORDINARY declared column.  No schema or migration uses Ecto's
//       bundled `timestamps()` (every table carries exactly the shared
//       migration's columns, which another backend may have created), so
//       nothing else defines the field.
//   createdAt / updatedAt on an entity part (embedded or relational)
//     → an ORDINARY declared column: nothing stamps a part, so the part
//       schema declares and casts it.  Skipping it as a root-style audit name
//       left it in `@derive {Jason.Encoder, only: …}` with no struct key
//       ("`:only` specified keys ([:updated_at]) that are not defined in
//       defstruct") and a relational `created_at` NOT NULL column unwritten.
//   __meta__ / __struct__   (any record)
//     → "field/association :__meta__ already exists on schema" / "cannot set
//       :__struct__ in struct definition"; pydantic also ignores dunder
//       fields.  REFUSED on every backend (`loom.dunder-field-name`).
//   meta / updatedAt   (aggregate ROOT)
//     → compile clean; untouched.

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../../src/ir/lower/lower.js";
import { validateLoomModel } from "../../../src/ir/validate/validate.js";
import { generateSystemFiles } from "../../_helpers/generate.js";
import { parseString } from "../../_helpers/parse.js";

function system(body: string, platform = "elixir", contextExtras = ""): string {
  return `
system E {
  subdomain D {
    context Ec {
      ${contextExtras}
      aggregate Thing with crudish {
        ${body}
        label: string
      }
      repository Things for Thing { }
    }
  }
  api EcApi from D
  storage pg { type: postgres }
  resource ecState { for: Ec, kind: state, use: pg }
  deployable api {
    platform: ${platform}
    contexts: [Ec]
    dataSources: [ecState]
    serves: EcApi
    port: 4000
  }
}`;
}

function bySuffix(f: Map<string, string>, suffix: string): string {
  const key = [...f.keys()].find((k) => k.endsWith(suffix));
  if (!key) throw new Error(`no generated file ending in ${suffix}`);
  return f.get(key)!;
}

async function codes(source: string, code: string): Promise<string[]> {
  const { model } = await parseString(source, { validate: false });
  return validateLoomModel(enrichLoomModel(lowerModel(model)))
    .filter((d) => d.code === code)
    .map((d) => d.message);
}

// What this asserts is ABSENCE ("emits no timestamps()"), which no booted tier
// observes on its own; the cross-backend behaviour is the shared-database leg.
describe("phoenix generator — no Ecto timestamps() on any schema or migration", () => {
  for (const [label, decl, column] of [
    ["plain", "meta: string", null],
    ["inserted_at", "inserted_at: string", "inserted_at"],
    ["updated_at", "updated_at: string", "updated_at"],
    ["insertedAt", "insertedAt: datetime", "inserted_at"],
  ] as const) {
    it(`${label}: the root schema and migration carry only the declared columns`, async () => {
      const files = await generateSystemFiles(system(decl));
      const schema = bySuffix(files, "lib/api/ec/thing.ex");
      const migration = bySuffix(files, "_create_things.exs");
      if (column) {
        expect(schema).toContain(`    field :${column}, `);
        expect(migration).toContain(`      add :${column}, `);
      }
      expect(schema).not.toContain("timestamps(");
      expect(migration).not.toContain("timestamps()");
    });
  }

  for (const field of ["inserted_at: string", "insertedAt: datetime", "updatedAt: datetime"]) {
    it(`a relational part declaring '${field}' gets an ordinary column`, async () => {
      const src = system(`contains lines: Line[]
        entity Line { sku: string  ${field} }`);
      const files = await generateSystemFiles(src);
      const line = bySuffix(files, "lib/api/ec/line.ex");
      expect(line).not.toContain("timestamps(");
      expect(bySuffix(files, "_create_lines.exs")).not.toContain("timestamps()");
    });
  }
});

describe("loom.dunder-field-name", () => {
  const CODE = "loom.dunder-field-name";

  it("refuses __meta__ / __struct__ on an aggregate, once each (not again on its <Agg>Wire)", async () => {
    const diags = await codes(system("__meta__: string\n        __struct__: string"), CODE);
    expect(diags).toHaveLength(2);
    expect(diags[0]).toContain("'Ec.Thing' declares the field '__meta__'");
    expect(diags[1]).toContain("'Ec.Thing' declares the field '__struct__'");
  });

  it("is universal — node and python refuse it too", async () => {
    expect(await codes(system("__meta__: string", "node"), CODE)).toHaveLength(1);
    expect(await codes(system("__meta__: string", "python"), CODE)).toHaveLength(1);
  });

  it("covers value objects, events and declared payloads", async () => {
    const diags = await codes(
      system(
        "",
        "elixir",
        `valueobject Box { __meta__: string }
      event Moved { __struct__: string }
      command Go { __meta__: string }`,
      ),
      CODE,
    );
    expect(diags.map((d) => d.split(" declares")[0])).toEqual([
      "'Ec.Box'",
      "'Ec.Moved'",
      "'Ec.Go'",
    ]);
  });

  it("leaves single-underscore and plain names alone", async () => {
    expect(
      await codes(system("meta: string\n        _meta: string\n        meta__: string"), CODE),
    ).toEqual([]);
  });
});

describe("phoenix generator — a part's createdAt / updatedAt is an ordinary column", () => {
  const PART = (field: string) => `contains lines: Line[]
        entity Line { sku: string  ${field} }`;

  it("embedded part: declared, cast and on the wire", async () => {
    const src = system(PART("createdAt: datetime  updatedAt: datetime")).replace(
      "Thing with",
      "Thing shape: embedded with",
    );
    const line = bySuffix(await generateSystemFiles(src), "lib/api/ec/line.ex");
    expect(line).toContain("@derive {Jason.Encoder, only: [:id, :sku, :created_at, :updated_at]}");
    expect(line).toContain(
      "  embedded_schema do\n    field :sku, :string\n    field :created_at, Loom.Datetime\n    field :updated_at, Loom.Datetime\n  end",
    );
    expect(line).toContain("|> cast(attrs, [:sku, :created_at, :updated_at])");
  });

  it("relational part: `createdAt` is a declared field and column", async () => {
    const files = await generateSystemFiles(system(PART("createdAt: datetime")));
    const line = bySuffix(files, "lib/api/ec/line.ex");
    expect(line).toContain("    field :created_at, Loom.Datetime\n");
    expect(line).toContain("|> cast(attrs, [:sku, :created_at])");
    const migration = bySuffix(files, "_create_lines.exs");
    expect(migration).toContain("      add :created_at, :timestamptz, null: false\n");
  });
});
