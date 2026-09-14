// A direct-table query-time projection may only name columns that EXIST on the
// source's table — `loom.projection-columnless-source`, the `#field` half.
//
// WHAT WAS BROKEN.  The gate next door asks whether the SOURCE has columns at
// all (`persistedAs: eventLog`, `shape: document`, a TPC abstract base).  It
// never asked whether the individual NAMES the arm's SQL emits are columns on
// a source that does.  Two shapes slipped straight through it and every backend
// emitted a reference to something the schema emitter never wrote:
//
//   `derived total: money = unitPrice * qty`   node `sum(schema.orders.total)`
//   + `select revenue = sum(o.total)`          → TS2339; the DDL has no `total`
//                                              column, because a derived field
//                                              is computed in the domain layer
//                                              on each hydrated row
//
//   `amount: Money` + `sum(b.amount.amount)`   node `sum(schema.bills.amount)`
//                                              → TS2339; the schema FLATTENS a
//                                              value object to `amount_amount`
//                                              / `amount_currency`
//
// The two get OPPOSITE answers, deliberately, and that split is what this file
// pins.  A derived field has no column and never will — refused.  A
// value-object leaf IS a real column, and aggregating one is a legitimate,
// useful query — so it must NOT be refused here, and the emitters must name the
// column the schema actually wrote (pinned in
// `test/generator/projection-physical-column.test.ts`, the emission half).
//
// WHAT MUST STILL PASS.  `select n = count()` names no column at all; a plain
// stored field is a column; `id` is the one column every shape has, including
// a document `(id, data, version)` triple — over-gating any of the three would
// break the dashboard tiles `scaffoldDashboard` synthesises.

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { parseString } from "../_helpers/parse.js";

const CODE = "loom.projection-columnless-source";

/** Every backend platform clause a projection can be hosted on, including both
 *  .NET persistence adapters and MikroORM — the gate is universal (no backend
 *  renders a column that does not exist), so the adapter axis is in the matrix
 *  rather than assumed. */
const PLATFORMS = [
  "node",
  "node { persistence: mikroorm }",
  "dotnet",
  "dotnet { persistence: dapper }",
  "java",
  "python",
  "elixir",
];

const SYS = (platform: string, body: string) => `
system S {
  subdomain Sales {
    context Orders {
      valueobject Money { amount: money  currency: string }
      ${body}
    }
  }
  api A from Sales
  storage pg { type: postgres }
  resource s { for: Orders, kind: state, use: pg }
  deployable d { platform: ${platform}, contexts: [Orders], dataSources: [s], serves: A, port: 4000 }
}`;

/** An aggregate carrying one of every shape the resolver has to classify. */
const AGG = `aggregate Order {
        qty: int
        unitPrice: money
        price: Money
        tags: string[]
        derived total: money = unitPrice * qty
      }
      repository Orders for Order { }`;

const errorsFor = async (source: string): Promise<string[]> => {
  const { model } = await parseString(source);
  return validateLoomModel(enrichLoomModel(lowerModel(model)))
    .filter((d) => d.severity === "error" && d.code === CODE)
    .map((d) => d.message);
};

describe("a direct-table projection's select names real columns", () => {
  describe("REFUSED — the name is not a column on the source table", () => {
    it.each(PLATFORMS)("aggregating a `derived` field, on %s", async (platform) => {
      const errs = await errorsFor(
        SYS(
          platform,
          `${AGG}
      projection OrderTotals {
        orders: int
        revenue: money
        from Order as o
        select orders = count(), revenue = sum(o.total)
      }`,
        ),
      );
      expect(errs).toHaveLength(1);
      // The reason must name the FIELD and say why it has no column — a bare
      // "not a column" would send the author looking at the source's shape,
      // which is fine.
      expect(errs[0]).toContain("derived field 'Order.total'");
      expect(errs[0]).toContain("computed in the domain layer");
    });

    it.each(PLATFORMS)("a `derived` field as a `group by` key, on %s", async (platform) => {
      const errs = await errorsFor(
        SYS(
          platform,
          `${AGG}
      projection ByTotal {
        total: money
        orders: int
        from Order as o
        group by o.total
        select total = o.total, orders = count()
      }`,
        ),
      );
      expect(errs.join("\n")).toContain("derived field 'Order.total'");
    });

    it.each(PLATFORMS)("a `derived` field in the `where`, on %s", async (platform) => {
      const errs = await errorsFor(
        SYS(
          platform,
          `${AGG}
      projection BigOrders {
        orders: int
        from Order as o
        where o.total > money("10.00")
        select orders = count()
      }`,
        ),
      );
      expect(errs.join("\n")).toContain("derived field 'Order.total'");
    });

    it("aggregating a collection field — its own child/join table", async () => {
      const errs = await errorsFor(
        SYS(
          "node",
          `${AGG}
      projection TagVolume {
        n: int
        from Order as o
        select n = count(), total = count()
      }
      projection TagSum {
        n: int
        from Order as o
        select n = max(o.tags)
      }`,
        ),
      );
      expect(errs.join("\n")).toContain("collection field 'Order.tags'");
    });

    it("aggregating a value object WITHOUT naming its leaf", async () => {
      const errs = await errorsFor(
        SYS(
          "node",
          `${AGG}
      projection PriceSum {
        total: money
        from Order as o
        select total = sum(o.price)
      }`,
        ),
      );
      expect(errs.join("\n")).toContain("value object 'Order.price'");
      // The remedy has to be actionable — the author needs to know a leaf
      // exists, not just that the whole object is refused.
      expect(errs.join("\n")).toContain("price.<field>");
    });
  });

  describe("ACCEPTED — the name IS a column", () => {
    it.each(PLATFORMS)("a value-object LEAF is a real column, on %s", async (platform) => {
      const errs = await errorsFor(
        SYS(
          platform,
          `${AGG}
      projection PriceSum {
        n: int
        total: money
        from Order as o
        select n = count(), total = sum(o.price.amount)
      }`,
        ),
      );
      expect(errs).toEqual([]);
    });

    it.each(PLATFORMS)("a plain stored field, on %s", async (platform) => {
      const errs = await errorsFor(
        SYS(
          platform,
          `${AGG}
      projection QtySum {
        n: int
        total: int
        from Order as o
        select n = count(), total = sum(o.qty)
      }`,
        ),
      );
      expect(errs).toEqual([]);
    });

    it.each(PLATFORMS)("a bare `count()` names no column at all, on %s", async (platform) => {
      const errs = await errorsFor(
        SYS(
          platform,
          `${AGG}
      projection OrderCount {
        n: int
        from Order as o
        select n = count()
      }`,
        ),
      );
      expect(errs).toEqual([]);
    });

    it("the PER-ROW arm may read anything — it hydrates through the repository", async () => {
      // No aggregation and no `group by`, so the read goes through the
      // aggregate's own repository and the `select` runs on a domain object.
      // A `derived` field is exactly what that object exposes, so refusing it
      // here would be over-gating.
      const errs = await errorsFor(
        SYS(
          "node",
          `${AGG}
      projection OrderRows {
        total: money
        from Order as o
        select total = o.total
      }`,
        ),
      );
      expect(errs).toEqual([]);
    });
  });
});
