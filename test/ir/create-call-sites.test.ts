// `Agg.create({ … })` CALL-SITE validation
// (`loom.create-call-not-constructible`, `loom.create-call-missing-field`).
//
// Nothing validated the call site against the factory it calls, so two shapes
// reached the emitted project and failed its OWN compiler.
//
// 1. An invariant over a CONTAINED collection makes the aggregate
//    non-constructible (`isConstructible`, `src/ir/enrich/wire-projection.ts`)
//    and every backend then correctly emits no `static create(...)` — while the
//    unit-test emitter and the workflow emitter kept emitting the call:
//
//      domain/order.test.ts(7,21): TS2551: Property 'create' does not exist on
//        type 'typeof Order'. Did you mean '_create'?
//      http/workflows.ts(46,23):   (the same)
//
//    Deleting the one invariant makes it compile.
//
// 2. A call site that omits a REQUIRED create-input field:
//
//      domain/part.test.ts(8,27): TS2345: Property 'binCode' is missing in type
//        '{ sku: string; onHand: number; }' but required in type
//        '{ sku: string; binCode: string; onHand: number; }'.
//
// The gate calls `isConstructible` / `buildCreateInput` — the SAME functions
// the emitters gate on — rather than re-deriving the contract, so it cannot
// drift away from what is emitted.  (The WORKFLOW half of case 2 was already
// covered by `loom.workflow-create-missing-field`; case 1 was covered nowhere,
// and case 2 was covered nowhere outside a workflow body.)

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { parseString } from "../_helpers/index.js";

async function codesFor(body: string): Promise<string[]> {
  const { model } = await parseString(
    `system S { subdomain M { context C {
${body}
    }}}`,
    { validate: false },
  );
  return validateLoomModel(enrichLoomModel(lowerModel(model))).map((d) => d.code ?? "");
}

async function diagsFor(body: string) {
  const { model } = await parseString(
    `system S { subdomain M { context C {
${body}
    }}}`,
    { validate: false },
  );
  return validateLoomModel(enrichLoomModel(lowerModel(model)));
}

/** The repro: one invariant over a containment removes the factory. */
const NON_CONSTRUCTIBLE = `
      aggregate Order {
        currency: string
        contains lines: Line[]
        derived display: string = currency
        invariant lines.all(l => l.currency == currency)
        entity Line { currency: string }
        test "an order can be built" {
          let o = Order.create({ currency: "EUR" })
          expect(o.display).toBe("EUR")
        }
      }
      repository Orders for Order {}
      workflow openOrder {
        create(currency: string) { let o = Order.create({ currency: currency }) }
      }`;

describe("Agg.create({…}) call sites", () => {
  it("refuses a create call on a NON-CONSTRUCTIBLE aggregate, in a test body", async () => {
    const diags = await diagsFor(NON_CONSTRUCTIBLE);
    const hits = diags.filter((d) => d.code === "loom.create-call-not-constructible");
    expect(
      hits.some((d) => d.source.includes("an order can be built")),
      JSON.stringify(
        diags.map((d) => `${d.code} @ ${d.source}`),
        null,
        1,
      ),
    ).toBe(true);
  });

  it("refuses it in a WORKFLOW body too — the second emitter that kept calling it", async () => {
    const diags = await diagsFor(NON_CONSTRUCTIBLE);
    const hits = diags.filter((d) => d.code === "loom.create-call-not-constructible");
    expect(
      hits.some((d) => d.source.includes("openOrder")),
      JSON.stringify(
        diags.map((d) => `${d.code} @ ${d.source}`),
        null,
        1,
      ),
    ).toBe(true);
  });

  it("names the invariant that removed the factory", async () => {
    // The emitted `tsc` error can only say "no such property"; the blocking
    // invariant is the line the author actually has to change.
    const diags = await diagsFor(NON_CONSTRUCTIBLE);
    const hit = diags.find((d) => d.code === "loom.create-call-not-constructible");
    expect(hit?.message).toContain("lines.all(l => l.currency == currency)");
  });

  it("refuses a create call that omits a required create-input field", async () => {
    const codes = await codesFor(`
      aggregate Part {
        sku: string
        binCode: string
        onHand: int
        derived display: string = sku
        test "part is built" {
          let p = Part.create({ sku: "a", onHand: 1 })
          expect(p.display).toBe("a")
        }
      }
      repository Parts for Part {}`);
    expect(codes).toContain("loom.create-call-missing-field");
  });

  it("does NOT count an optional / defaulted / bare-bool field as required", async () => {
    // The required-set rule is `isRequiredCreateInput`, not "non-null": an
    // optional field, an `= default`, and a bare `bool` (implicit `false`) are
    // all omittable.  Re-deriving that by hand is exactly the drift this gate
    // exists to avoid, so it has to be asserted.
    const codes = await codesFor(`
      aggregate Widget {
        sku: string
        note: string?
        colour: string = "red"
        active: bool
        derived display: string = sku
        test "widget is built" {
          let w = Widget.create({ sku: "a" })
          expect(w.display).toBe("a")
        }
      }
      repository Widgets for Widget {}`);
    expect(codes).not.toContain("loom.create-call-missing-field");
  });

  // NON-VACUITY -------------------------------------------------------------

  it("accepts a complete create call on a constructible aggregate with ZERO diagnostics", async () => {
    const diags = await diagsFor(`
      aggregate Part {
        sku: string
        binCode: string
        onHand: int
        derived display: string = sku
        test "part is built" {
          let p = Part.create({ sku: "a", binCode: "B1", onHand: 1 })
          expect(p.display).toBe("a")
        }
      }
      repository Parts for Part {}
      workflow stock {
        create(sku: string) { let p = Part.create({ sku: sku, binCode: "B1", onHand: 0 }) }
      }`);
    expect(
      diags.map((d) => `${d.code} @ ${d.source}: ${d.message}`),
      "a well-formed model must produce nothing",
    ).toEqual([]);
  });

  it("stays quiet when the same aggregate keeps its create despite an invariant", async () => {
    // An invariant satisfiable from the create input alone does NOT remove the
    // factory — so the call site is fine and the gate must not fire.
    const diags = await diagsFor(`
      aggregate Order {
        currency: string
        qty: int
        derived display: string = currency
        invariant qty > 0
        test "an order can be built" {
          let o = Order.create({ currency: "EUR", qty: 1 })
          expect(o.display).toBe("EUR")
        }
      }
      repository Orders for Order {}`);
    expect(diags.map((d) => `${d.code} @ ${d.source}`)).toEqual([]);
  });
});
