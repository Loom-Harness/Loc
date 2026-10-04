// Field names Ecto / Elixir reserve on a schema struct — legal `.ddd`
// identifiers, each probed against `mix compile --warnings-as-errors`
// (Elixir 1.18.4, ecto 3.14.2):
//
//   inserted_at / updated_at / insertedAt   (aggregate ROOT)
//     → "field/association :inserted_at already exists on schema" (the bundled
//       `timestamps()` defines the same field).  FIXED in the emitter: a
//       declared field owning one of those columns drops `timestamps()` from
//       the schema AND the migration, so the declared field owns the column,
//       its wire key and its value (an insert + read round-trip through
//       `ecto.migrate`'d Postgres returns the declared values).
//   the same names on a RELATIONAL entity part
//     → same error on the part schema; REFUSED (`loom.elixir-part-timestamp-
//       field`) — the shared `__put_assoc_parts` helper strips those keys off
//       every part, so the column could not keep its value.
//   __meta__ / __struct__   (any record)
//     → "field/association :__meta__ already exists on schema" / "cannot set
//       :__struct__ in struct definition"; pydantic also ignores dunder
//       fields.  REFUSED on every backend (`loom.dunder-field-name`).
//   meta / updatedAt
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

describe("phoenix generator — a declared field owning an Ecto timestamp column", () => {
  for (const [label, decl, column] of [
    ["inserted_at", "inserted_at: string", "inserted_at"],
    ["updated_at", "updated_at: string", "updated_at"],
    ["insertedAt", "insertedAt: datetime", "inserted_at"],
  ] as const) {
    it(`${label}: drops timestamps() from schema and migration, keeps the column`, async () => {
      const files = await generateSystemFiles(system(decl));
      const schema = bySuffix(files, "lib/api/ec/thing.ex");
      expect(schema).toContain(`    field :${column}, `);
      expect(schema).not.toContain("timestamps(");
      const migration = bySuffix(files, "_create_things.exs");
      expect(migration).toContain(`      add :${column}, `);
      expect(migration).not.toContain("timestamps()");
    });
  }

  it("a model without such a field keeps both timestamps() lines", async () => {
    const files = await generateSystemFiles(system("meta: string"));
    expect(bySuffix(files, "lib/api/ec/thing.ex")).toContain(
      "    field :meta, :string\n    field :label, :string\n    field :version, :integer, default: 1\n    timestamps(type: :utc_datetime)\n",
    );
    expect(bySuffix(files, "_create_things.exs")).toContain("      timestamps()\n");
  });
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

describe("loom.elixir-part-timestamp-field", () => {
  const CODE = "loom.elixir-part-timestamp-field";
  const PART = (field: string) => `contains lines: Line[]
        entity Line { sku: string  ${field} }`;

  for (const field of ["inserted_at: string", "insertedAt: datetime", "updated_at: string"]) {
    it(`refuses '${field}' on a relational part hosted on elixir`, async () => {
      const diags = await codes(system(PART(field)), CODE);
      expect(diags).toHaveLength(1);
      expect(diags[0]).toContain("'Ec.Thing.Line' declares the field");
    });
  }

  it("leaves the camelCase audit names, the root, and other backends alone", async () => {
    expect(await codes(system(PART("updatedAt: datetime")), CODE)).toEqual([]);
    expect(await codes(system("inserted_at: string"), CODE)).toEqual([]);
    expect(await codes(system(PART("inserted_at: string"), "node"), CODE)).toEqual([]);
  });
});
