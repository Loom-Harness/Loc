// How a `migration` backfill step resolves to the UPDATEs a generation runs.
//
// A backfill of a field declared on an inheritance BASE reaches every table
// that stores the field.  A TPC (`ownTable`) base owns no table — each
// concrete carries the base's fields as its own columns — so `Asset.owner = …`
// fans out to every concrete's table; a TPH base's step targets its one shared
// table.  The concrete spelling of an inherited field (`Phone.owner = …`) is
// refused with a message naming the base, so exactly one spelling works for
// every layout and neither is ever dropped without a word.
//
// A required column cannot be filled from an optional sibling as-is: the
// UPDATE would write NULL and the SET NOT NULL after it fail at boot.  The
// `??` fallback is the fix the refusal names, and it renders as a CASE.

import { describe, expect, it } from "vitest";
import { renderPgStep } from "../../src/generator/sql-pg.js";
import { recordChain } from "../_helpers/generate.js";
import { parseString } from "../_helpers/parse.js";

const sys = (aggregates: string, migration = "") => `
system Shop {
  subdomain Sales {
    context Hr {
${aggregates}
      repository Laptops for Laptop { }
      repository Phones for Phone { }
    }
  }
  storage pg { type: postgres }
  resource st { for: Hr, kind: state, use: pg }
  deployable api { platform: node  contexts: [Hr]  dataSources: [st]  port: 3000 }
}
${migration}
`;

const tpc = (base: string, laptop: string) => `
      abstract aggregate Asset inheritanceUsing: ownTable { ${base} }
      aggregate Laptop extends Asset inheritanceUsing: ownTable { ${laptop} }
      aggregate Phone extends Asset inheritanceUsing: ownTable { number: string }`;

/** The SQL of the generation recorded for the LAST source. */
async function lastGenerationSql(sources: string[]): Promise<string[]> {
  const chain = await recordChain(sources, { allowDestructive: false });
  return chain.entries.at(-1)!.steps.map(renderPgStep);
}

describe("backfill on a TPC base fans out to every concrete table", () => {
  it("moving a field up to the base backfills the concrete that lacked it", async () => {
    const sql = await lastGenerationSql([
      sys(tpc("label: string", "owner: string")),
      sys(tpc("label: string  owner: string", ""), `migration "m" { Asset.owner = "it" }`),
    ]);
    expect(sql).toEqual([
      `ALTER TABLE "hr"."phones" ADD COLUMN "owner" TEXT NULL;`,
      `UPDATE "hr"."phones" SET "owner" = 'it' WHERE "owner" IS NULL;`,
      `ALTER TABLE "hr"."phones" ALTER COLUMN "owner" SET NOT NULL;`,
    ]);
  });

  it("a new base field is backfilled on every concrete, reading each one's own columns", async () => {
    const sql = await lastGenerationSql([
      sys(tpc("label: string", "")),
      sys(tpc("label: string  tag: string", ""), `migration "m" { Asset.tag = label + "-1" }`),
    ]);
    for (const table of ["laptops", "phones"]) {
      expect(sql).toContain(
        `UPDATE "hr"."${table}" SET "tag" = ("label" || '-1') WHERE "tag" IS NULL;`,
      );
      expect(sql).toContain(`ALTER TABLE "hr"."${table}" ALTER COLUMN "tag" SET NOT NULL;`);
    }
  });
});

describe("the concrete spelling of an inherited field names the base", () => {
  const diagnostics = async (src: string) =>
    (await parseString(src)).diagnostics.filter((d) => d.code === "loom.backfill-unknown-field");

  it("TPC: `Phone.owner` points at `Asset.owner`", async () => {
    const found = await diagnostics(
      sys(tpc("label: string  owner: string", ""), `migration "m" { Phone.owner = "it" }`),
    );
    expect(found.map((d) => d.message)).toEqual([
      "'owner' is inherited by 'Phone' from 'Asset' — backfill it where it is declared: `Asset.owner = …` fills it in every table that stores it.",
    ]);
  });

  it("a field nobody in the chain declares keeps the plain unknown-field message", async () => {
    const found = await diagnostics(
      sys(tpc("label: string", ""), `migration "m" { Phone.missing = "it" }`),
    );
    expect(found.map((d) => d.message)).toEqual([
      "'missing' is not a field of aggregate 'Phone' — a backfill targets a live field (it names the newly-added column).",
    ]);
  });
});

describe("an optional sibling with a `??` fallback fills a required column", () => {
  const contracts = (fields: string, migration = "") => `
system Shop {
  subdomain Sales {
    context Legal {
      aggregate Contract { ${fields} }
      repository Contracts for Contract { }
    }
  }
  storage pg { type: postgres }
  resource st { for: Legal, kind: state, use: pg }
  deployable api { platform: node  contexts: [Legal]  dataSources: [st]  port: 3000 }
}
${migration}
`;

  it("renders the fallback as a CASE the SET NOT NULL can follow", async () => {
    const sql = await lastGenerationSql([
      contracts("label: string?"),
      contracts(
        "label: string?  title: string",
        `migration "m" { Contract.title = label ?? "untitled" }`,
      ),
    ]);
    expect(sql).toEqual([
      `ALTER TABLE "legal"."contracts" ADD COLUMN "title" TEXT NULL;`,
      `UPDATE "legal"."contracts" SET "title" = (CASE WHEN ("label" IS NULL) THEN 'untitled' ELSE "label" END) WHERE "title" IS NULL;`,
      `ALTER TABLE "legal"."contracts" ALTER COLUMN "title" SET NOT NULL;`,
    ]);
  });

  it("refuses the bare optional sibling before any migration is recorded", async () => {
    await expect(
      lastGenerationSql([
        contracts("label: string?"),
        contracts("label: string?  title: string", `migration "m" { Contract.title = label }`),
      ]),
    ).rejects.toThrow(/loom\.backfill-type-mismatch .*the value can be null/);
  });
});
