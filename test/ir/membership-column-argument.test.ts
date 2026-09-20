// `<refColl>.contains(<column>)` is refused on EVERY target, at every site —
// ledger `drizzle-projection-membership-column-arg-crash`.
//
// A reference-collection membership lowers on all four relational adapters, and
// the way it lowers is the same everywhere: a subquery over the join table whose
// target is BOUND (`inArray` on drizzle, an EXISTS fragment on Dapper, an
// uncorrelated `id in (select …)` on MikroORM, `Any(...)` over a closed-over
// value on EF Core).  So the ARGUMENT has to be a bindable value.  A column
// there has nowhere to go — on any of them.
//
// WHY THE REFUSAL MOVED.  It lived in the per-adapter descriptor
// (`find-predicate-capability.ts`, the `mikroorm` entry), and
// `validateFindPredicateAdapterSupport` keys on `dep.persistence` — which a
// deployable on the DEFAULT adapter does not carry.  So the identical shape was
// refused honestly under `persistence: mikroorm` and CRASHED codegen on a bare
// `platform: node` one: `0 error(s), 0 warning(s)` followed by
//
//   Error: internal: where-clause for projection 'MyTotals' could not lower to
//   Drizzle, but the validator should have caught this. Please file a bug.
//
// It is reachable only from a query-time `projection … where`, because that is
// the one predicate position with no parameters to bind — which is exactly why
// a repository-find test alone would not have caught it.  Both sites are
// asserted below for that reason.
//
// The CONTROL matters as much as the refusal: membership with a bindable
// argument must still be accepted everywhere, or this gate would have closed a
// crash by deleting a working feature.

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { generateSystemFiles } from "../_helpers/generate.js";
import { parseString } from "../_helpers/parse.js";

/** `platform:` clauses spanning both node adapters plus the other four
 *  backends — the refusal is target-neutral, so the sweep has to say so. */
const PLATFORMS = [
  "node",
  "node { persistence: drizzle }",
  "node { persistence: mikroorm }",
  "dotnet",
  "java",
  "python",
  "elixir",
];

function sys(platform: string, body: string): string {
  return `
system Shop {
  subdomain S { context Sales {
    aggregate Tag { label: string }
    repository Tags for Tag { }
    aggregate Order with crudish {
      code: string
      tags: Tag id[]
    }
    repository Orders for Order {
      ${body.includes("find ") ? body : ""}
    }
    ${body.includes("projection ") ? body : ""}
  } }
  api SalesApi from S
  storage pg { type: postgres }
  resource st { for: Sales, kind: state, use: pg }
  deployable d {
    platform: ${platform}
    contexts: [Sales]
    dataSources: [st]
    serves: SalesApi
    port: 4000
  }
}
`;
}

/** The crashing shape: a query-time projection whose `where` passes a COLUMN of
 *  the same row as the membership argument. */
const PROJECTION_COLUMN_ARG = `projection MyTotals {
      orders: int
      from Order as o
      where o.tags.contains(o.id)
      select orders = count
    }`;

/** The same shape in a repository find — reached through a `this.<field>`
 *  argument rather than an alias, since a find HAS parameters and would
 *  otherwise never produce it. */
const FIND_COLUMN_ARG = `find weird(): Order[] where this.tags.contains(this.id)`;

/** The CONTROL — a bindable argument.  Must stay accepted on every target. */
const FIND_BOUND_ARG = `find byTag(t: Tag id): Order[] where this.tags.contains(t)`;

async function errorCodes(source: string): Promise<string[]> {
  const { model, errors } = await parseString(source, { validate: false });
  if (errors.length > 0) throw new Error(`fixture has parse errors:\n${errors.join("\n")}`);
  return validateLoomModel(enrichLoomModel(lowerModel(model)))
    .filter((d) => d.severity === "error")
    .map((d) => d.code ?? "<no code>");
}

describe("a reference-collection membership needs a BINDABLE argument", () => {
  for (const platform of PLATFORMS) {
    it(`${platform}: a column argument is refused in a projection where`, async () => {
      const codes = await errorCodes(sys(platform, PROJECTION_COLUMN_ARG));
      expect(codes).toContain("loom.projection-where-not-queryable");
    });

    it(`${platform}: a column argument is refused in a find where`, async () => {
      const codes = await errorCodes(sys(platform, FIND_COLUMN_ARG));
      expect(codes).toContain("loom.find-where-not-queryable");
    });

    it(`${platform}: a BOUND argument is still accepted (control)`, async () => {
      const codes = await errorCodes(sys(platform, FIND_BOUND_ARG));
      expect(codes).not.toContain("loom.find-where-not-queryable");
      expect(codes).not.toContain("loom.find-predicate-unsupported");
    });
  }

  // The message has to name the rewrite, or the author is told "not queryable"
  // about a predicate whose every leaf is a column — which is queryable.
  it("the diagnostic names the argument, not the membership", async () => {
    const { model } = await parseString(sys("node", PROJECTION_COLUMN_ARG), { validate: false });
    const text = validateLoomModel(enrichLoomModel(lowerModel(model)))
      .filter((d) => d.code === "loom.projection-where-not-queryable")
      .map((d) => d.message)
      .join("\n");
    expect(text).toContain(".contains(<column>)");
    expect(text).toMatch(/binds its argument as a query parameter/);
  });

  // The generation half: before the gate this printed `0 error(s)` and THEN
  // threw out of `buildQueryProjectionsFile`.  A validator-only assertion would
  // not notice if the crash came back by another route, so the emitter is
  // exercised on the shape that still WORKS, and the refused one is checked to
  // be refused before generation is reached at all.
  it("the bound-argument projection still generates on node", async () => {
    const files = await generateSystemFiles(
      sys(
        "node",
        `projection ByTag {
      orders: int
      from Order as o
      where o.code == "x"
      select orders = count
    }`,
      ),
    );
    const key = [...files.keys()].find((k) => k.endsWith("http/query-projections.ts"));
    expect(key, "query-projections.ts not emitted").toBeDefined();
  });
});
