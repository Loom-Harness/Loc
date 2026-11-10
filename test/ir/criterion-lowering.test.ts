// Lowering coverage for `criterion`: the IR record on the context, and
// the inline-equivalence contract — a criterion reference in another
// criterion's body lowers to *exactly* the same ExprIR as the equivalent
// inline predicate, with parameters substituted and `&&` composing for free.

import { describe, expect, it } from "vitest";
import { allContexts, type ExprIR } from "../../src/ir/types/loom-ir.js";
import { buildLoomModel } from "../_helpers/index.js";

const SRC = `
  context Sales {
    aggregate Customer { active: bool  region: string }
    repository Customers for Customer { }
    criterion ActiveInline of Customer = active
    criterion ActiveViaCriterion of Customer = ActiveCustomer
    criterion InRegionInline(r: string) of Customer = region == r
    criterion InRegionViaCriterion(r: string) of Customer = InRegion(r)
    criterion EligibleViaCriterion(r: string) of Customer = ActiveCustomer && InRegion(r)
    criterion EligibleInline(r: string) of Customer = active && region == r
    criterion ActiveCustomer of Customer = active
    criterion InRegion(rgn: string) of Customer = region == rgn
  }
`;

/** Each criterion's lowered body, by its name with the first letter lowered
 *  (`activeViaCriterion` → `ActiveViaCriterion`). */
async function finds() {
  const loom = await buildLoomModel(SRC);
  const ctx = allContexts(loom).find((c) => c.name === "Sales")!;
  const byName = (n: string) => {
    const c = ctx.criteria.find((x) => x.name === n[0]!.toUpperCase() + n.slice(1))!;
    return { filter: c.body };
  };
  return { ctx, byName };
}

/** Deep-clone `value` with every `origin` key stripped.  A criterion-inlined
 *  filter's body lowers from the `criterion` DECLARATION's own `.ddd` span
 *  (`inlineCriterion`, src/ir/lower/lower-expr.ts), while the hand-written
 *  inline predicate lowers from its own — different — span in the same
 *  source.  The equivalence these tests assert is structural shape, not
 *  "same source position", so strip `origin` before comparing. */
function stripOrigin<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => stripOrigin(v)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === "origin") continue;
      out[k] = stripOrigin(v);
    }
    return out as T;
  }
  return value;
}

describe("lowering — criterion `of T as <alias>`", () => {
  const ALIAS_SRC = `
    context Sales {
      aggregate Customer { active: bool  region: string }
      criterion ExplicitThis(rgn: string) of Customer = this.region == rgn
      criterion Aliased(rgn: string) of Customer as o = o.region == rgn
    }
  `;

  it("an aliased candidate access lowers byte-identically to explicit `this.field`", async () => {
    const loom = await buildLoomModel(ALIAS_SRC);
    const ctx = allContexts(loom).find((c) => c.name === "Sales")!;
    const thisForm = ctx.criteria.find((c) => c.name === "ExplicitThis")!;
    const aliased = ctx.criteria.find((c) => c.name === "Aliased")!;
    // `o.region == rgn` ≡ `this.region == rgn` — `o` IS the candidate.
    expect(stripOrigin(aliased.body)).toEqual(stripOrigin(thisForm.body));
  });

  it("`o.field` is a member access on the candidate (stays SQL-queryable)", async () => {
    const loom = await buildLoomModel(ALIAS_SRC);
    const ctx = allContexts(loom).find((c) => c.name === "Sales")!;
    const aliased = ctx.criteria.find((c) => c.name === "Aliased")!;
    // body is `o.region == rgn`; the LHS is `region` on a `this` receiver typed
    // as the candidate — the same shape explicit `this.region` produces.
    const lhs = (aliased.body as unknown as { left: ExprIR }).left;
    expect(lhs).toMatchObject({
      kind: "member",
      member: "region",
      receiver: { kind: "this" },
      receiverType: { kind: "entity", name: "Customer", declKind: "aggregate" },
    });
  });
});

describe("lowering — criterion", () => {
  it("records criteria on the bounded-context IR", async () => {
    const loom = await buildLoomModel(SRC);
    const ctx = allContexts(loom).find((c) => c.name === "Sales")!;
    expect(ctx.criteria.map((c) => c.name)).toEqual(
      expect.arrayContaining(["ActiveCustomer", "InRegion"]),
    );
    const active = ctx.criteria.find((c) => c.name === "ActiveCustomer")!;
    expect(active.targetType).toEqual({ kind: "entity", name: "Customer", declKind: "aggregate" });
    expect(active.body).toMatchObject({ kind: "ref", refKind: "this-prop", name: "active" });
  });

  it("inlines a parameterless criterion identically to the inline predicate", async () => {
    const { byName } = await finds();
    expect(stripOrigin(byName("activeViaCriterion").filter)).toEqual(
      stripOrigin(byName("activeInline").filter),
    );
  });

  it("substitutes parameters when inlining a parameterised criterion", async () => {
    const { byName } = await finds();
    expect(stripOrigin(byName("inRegionViaCriterion").filter)).toEqual(
      stripOrigin(byName("inRegionInline").filter),
    );
  });

  it("composes criteria via `&&` into the same shape as the inline composition", async () => {
    const { byName } = await finds();
    expect(stripOrigin(byName("eligibleViaCriterion").filter)).toEqual(
      stripOrigin(byName("eligibleInline").filter),
    );
  });

  it("produces a queryable binary tree (no unresolved refs) for the composed criterion", async () => {
    const { byName } = await finds();
    const filter = byName("eligibleViaCriterion").filter as ExprIR;
    expect(filter.kind).toBe("binary");
    const refKinds: string[] = [];
    const walk = (e: ExprIR): void => {
      if (e.kind === "ref") refKinds.push(e.refKind);
      else if (e.kind === "binary") {
        walk(e.left);
        walk(e.right);
      }
    };
    walk(filter);
    expect(refKinds).not.toContain("unknown");
  });
});
