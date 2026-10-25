// `unique (…)` on an abstract TPC (`inheritanceUsing: ownTable`) base.
//
// A TPC base owns no table — each concrete is a standalone table carrying the
// merged base columns.  The unique keys used to stay on the base, so every
// per-table derivation keyed on `agg.uniqueKeys` (the migration's
// `<table>_<cols>_uq` index, the Hono per-router 23505 → 409 arm, the Ecto
// `unique_constraint`) found nothing on the concrete and the key was enforced
// NOWHERE, on every backend.  Enrichment now copies an ancestor's keys onto
// each TPC concrete, so each concrete table carries
// its own per-table unique index, and the base raises
// `loom.unique-tpc-not-hierarchy-wide` because nothing spans the siblings.

import { describe, expect, it } from "vitest";
import { validate } from "../../src/api/index.js";
import { buildLoomModel, generateSystemFiles } from "../_helpers/index.js";

const PLATFORMS = ["node", "dotnet", "java", "python", "elixir"] as const;

const system = (platform: string, layout = "ownTable", extra = "") => `
system Crm {
  subdomain Crm {
    context Parties {
      abstract aggregate Party inheritanceUsing: ${layout} {
        name: string
        email: string
        unique (email)
      }
      aggregate Customer extends Party inheritanceUsing: ${layout} { creditLimit: decimal }
      aggregate Supplier extends Party inheritanceUsing: ${layout} { rating: int }
      repository Customers for Customer { }
      repository Suppliers for Supplier { }
      ${extra}
    }
  }
  api CrmApi from Crm
  storage pg { type: postgres }
  resource partiesState { for: Parties, kind: state, use: pg }
  deployable api {
    platform: ${platform}
    contexts: [Parties]
    dataSources: [partiesState]
    serves: CrmApi
    port: 3000
  }
}
`;

/** Every generated file that creates the named unique index — the shared
 *  Postgres DDL (Drizzle/EF/Flyway/the python runner) or the Ecto call. */
const createsIndex = (files: Map<string, string>, name: string): string[] =>
  [...files.entries()]
    .filter(
      ([, c]) =>
        new RegExp(`CREATE UNIQUE INDEX \\S*${name}`).test(c) ||
        (c.includes("create index(") && c.includes(`unique: true, name: "${name}"`)),
    )
    .map(([p]) => p);

describe("TPC base `unique (…)` → a per-concrete unique index", () => {
  it("enrichment copies the base key onto each TPC concrete", async () => {
    const loom = await buildLoomModel(system("node"));
    const ctx = loom.systems[0]!.subdomains[0]!.contexts[0]!;
    for (const name of ["Customer", "Supplier"]) {
      const agg = ctx.aggregates.find((a) => a.name === name)!;
      expect(agg.uniqueKeys, name).toEqual([expect.objectContaining({ columns: ["email"] })]);
    }
  });

  for (const platform of PLATFORMS) {
    it(`${platform}: each concrete table gets its own unique index`, async () => {
      const files = await generateSystemFiles(system(platform));
      expect(createsIndex(files, "customers_email_uq"), "customers").not.toEqual([]);
      expect(createsIndex(files, "suppliers_email_uq"), "suppliers").not.toEqual([]);
      // The abstract base owns no table, so no index is minted for it.
      expect(createsIndex(files, "parties_email_uq")).toEqual([]);
    });
  }

  it("node: each concrete router maps the 23505 to 409", async () => {
    const files = await generateSystemFiles(system("node"));
    for (const router of ["customer.routes.ts", "supplier.routes.ts"]) {
      const routes = [...files.entries()].find(([p]) => p.endsWith(router))?.[1];
      expect(routes, router).toBeDefined();
      expect(routes, router).toContain('=== "23505"');
      expect(routes, router).toMatch(/return problem\(409, "Conflict",/);
    }
  });

  it("elixir: each concrete changeset ties the conflict to its own table's index", async () => {
    const files = await generateSystemFiles(system("elixir"));
    const all = [...files.values()].join("\n");
    expect(all).toContain('unique_constraint(:email, name: "customers_email_uq")');
    expect(all).toContain('unique_constraint(:email, name: "suppliers_email_uq")');
  });

  it("a by-key find over the inherited key, and the polymorphic base reader, still generate", async () => {
    // An abstract TPC base owns no repository (`find all <Base>` is the
    // delegating polymorphic reader); a by-key lookup lives on the concrete.
    const src = system("node").replace(
      "repository Customers for Customer { }",
      "repository Customers for Customer { find byEmail(e: string): Customer? where this.email == e }",
    );
    const files = await generateSystemFiles(src);
    expect(createsIndex(files, "customers_email_uq")).not.toEqual([]);
    const all = [...files.values()].join("\n");
    expect(all).toContain("byEmail");
    expect([...files.keys()].some((p) => /party-repository\.ts$/.test(p))).toBe(true);
  });
});

describe("loom.unique-tpc-not-hierarchy-wide", () => {
  const codes = async (src: string) =>
    (await validate(src)).diagnostics
      .map((d) => d.code)
      .filter((c) => c?.startsWith("loom.unique"));

  it("warns once, on the base, when a TPC base declares a unique key over ≥ 2 concretes", async () => {
    const result = await validate(system("node"));
    const hits = result.diagnostics.filter((d) => d.code === "loom.unique-tpc-not-hierarchy-wide");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.severity).toBe("warning");
    expect(hits[0]!.message).toContain("customers, suppliers");
    expect(hits[0]!.message).toContain("inheritanceUsing: sharedTable");
  });

  it("is silent under TPH — one shared table, one hierarchy-wide index", async () => {
    expect(await codes(system("node", "sharedTable"))).not.toContain(
      "loom.unique-tpc-not-hierarchy-wide",
    );
  });

  it("a rejected base key reports once, on the base — not again on each concrete's copy", async () => {
    const src = system("node")
      .replace("email: string\n", "email: string\n        addr: Addr\n")
      .replace("unique (email)", "unique (addr)")
      .replace("context Parties {", "context Parties {\n      valueobject Addr { street: string }");
    expect((await codes(src)).filter((c) => c === "loom.unique-valueobject-field")).toHaveLength(1);
  });
});

// A TPH (`sharedTable`) base's `unique (…)` is ONE index on the shared table
// (`parties_email_uq`), so it was always created — but the CONCRETE's write
// surface gates its 23505 mapping on the concrete's own `uniqueKeys`, which were
// empty: a duplicate POSTed through `/customers` answered 500 on node (the
// per-router onError had no 23505 arm) and raised `Ecto.ConstraintError` on
// elixir.  Enrichment now copies the base's keys onto TPH concretes too, and the
// Ecto changeset names the constraint for the table the row lives in.
describe("TPH base `unique (…)` → the concrete's write surface maps the 23505", () => {
  it("still emits exactly one index, on the shared table", async () => {
    const files = await generateSystemFiles(system("node", "sharedTable"));
    expect(createsIndex(files, "parties_email_uq")).not.toEqual([]);
    expect(createsIndex(files, "customers_email_uq")).toEqual([]);
    expect(createsIndex(files, "suppliers_email_uq")).toEqual([]);
  });

  it("node: each concrete router maps the 23505 to 409", async () => {
    const files = await generateSystemFiles(system("node", "sharedTable"));
    for (const router of ["customer.routes.ts", "supplier.routes.ts"]) {
      const routes = [...files.entries()].find(([p]) => p.endsWith(router))?.[1];
      expect(routes, router).toBeDefined();
      expect(routes, router).toContain('=== "23505"');
    }
  });

  it("elixir: each concrete changeset names the SHARED table's index", async () => {
    const files = await generateSystemFiles(system("elixir", "sharedTable"));
    const all = [...files.values()].join("\n");
    expect(all).toContain('unique_constraint(:email, name: "parties_email_uq")');
    expect(all).not.toContain("customers_email_uq");
    expect(all).not.toContain("suppliers_email_uq");
  });
});
