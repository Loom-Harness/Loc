// F-022 — a bare enum value shared by two enums resolves by the SITE's type.
//
// `enum OrderStatus { Draft, … }` next to `enum InvoiceStatus { Draft, … }` is
// ordinary modelling, and before this the bare `Draft` in EVERY expression
// resolved to whichever enum declared the name first.  The field lowered
// correctly, so the emitted code compared an `InvoiceStatus` against an
// `OrderStatus`: `tsc` accepted it (string-literal unions), `mypy` flagged a
// non-overlapping equality check, `javac` and `csc` refused to build it — four
// different wrong answers from one mis-resolved IR node, with `ddd parse`
// reporting `0 error(s)` throughout.
//
// The contract these tests pin is the IR one (`docs/technical.md`): a name
// arrives at a backend already resolved.  So they assert on the LOWERED ref,
// not on any backend's rendering of it.

import { describe, expect, it } from "vitest";
import { forEachModelExpr } from "../../src/ir/util/model-exprs.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { buildLoomModel } from "../_helpers/index.js";

const SOURCE = (members: string): string => `
system Shop {
  subdomain BillingDomain {
    context Billing {
      enum OrderStatus   { Draft, Confirmed }
      enum InvoiceStatus { Draft, Issued, Paid }
      aggregate Invoice with crudish {
        status: InvoiceStatus = Draft
        label: string
${members}
      }
    }
  }
  api BillingApi from BillingDomain
  storage pg { type: postgres }
  resource st { for: Billing, kind: state, use: pg }
  deployable d { platform: node contexts: [Billing] dataSources: [st] serves: BillingApi port: 3000 }
}
`;

/** Every `enum-value` ref anywhere in the model, flattened to
 *  `<value>@<enum>` — the assertion subject, since the defect is exactly a ref
 *  carrying the wrong `enumName`.  Rides `forEachModelExpr`, the model-wide
 *  expression enumeration, rather than hand-rolling a walk over the sites this
 *  fixture happens to use (CLAUDE.md, "no hand-rolled IR walks"). */
async function enumRefsOf(members: string): Promise<string[]> {
  const model = await buildLoomModel(SOURCE(members));
  const out: string[] = [];
  forEachModelExpr(model, ({ expr }) => {
    if (expr.kind === "ref" && expr.refKind === "enum-value") {
      out.push(`${expr.name}@${expr.enumName}`);
    }
  });
  return out;
}

async function errorCodes(members: string): Promise<string[]> {
  const diags = validateLoomModel(await buildLoomModel(SOURCE(members)));
  return diags.filter((d) => d.severity === "error").map((d) => d.code ?? d.message);
}

describe("F-022 — bare enum value shared by two enums", () => {
  it("resolves a field default against the FIELD's enum, not the first declared", async () => {
    // `status: InvoiceStatus = Draft` — the only `Draft` in this model, and it
    // reaches the walk twice (the field default and the create-input default
    // the `crudish` macro derives from it).  Both must name InvoiceStatus.
    expect(new Set(await enumRefsOf(""))).toEqual(new Set(["Draft@InvoiceStatus"]));
  });

  it("resolves a comparison against the compared field's enum", async () => {
    const refs = await enumRefsOf(`        function isDraft(): bool = status == Draft`);
    expect(refs).toContain("Draft@InvoiceStatus");
    expect(refs).not.toContain("Draft@OrderStatus");
  });

  it("resolves the same way with the operands reversed", async () => {
    const refs = await enumRefsOf(`        function isDraft(): bool = Draft == status`);
    expect(refs).not.toContain("Draft@OrderStatus");
    expect(refs).toContain("Draft@InvoiceStatus");
  });

  it("resolves a `when` guard and an assignment RHS", async () => {
    const refs = await enumRefsOf(
      `        operation issue() when status == Draft { status := Draft }`,
    );
    expect(refs).not.toContain("Draft@OrderStatus");
    expect(refs.filter((r) => r === "Draft@InvoiceStatus").length).toBeGreaterThanOrEqual(2);
  });

  it("still resolves a value only ONE enum declares", async () => {
    const refs = await enumRefsOf(
      `        function confirmedOrder(s: OrderStatus): bool = s == Confirmed`,
    );
    expect(refs).toContain("Confirmed@OrderStatus");
  });

  it("accepts the qualified spelling the diagnostic recommends", async () => {
    // Both halves matter: it resolves to the named enum AND raises nothing.
    const members = `        derived isDraft2: bool = status == InvoiceStatus.Draft`;
    expect(await enumRefsOf(members)).toContain("Draft@InvoiceStatus");
    expect(await errorCodes(members)).not.toContain("loom.ambiguous-enum-value");
  });

  it("raises loom.ambiguous-enum-value where no site supplies a type", async () => {
    // A `let` with no declared type is the honest hole: nothing here says which
    // `Draft` is meant, and first-wins would silently pick `OrderStatus`.
    const members = `        operation touch() { let x = Draft label := "x" }`;
    expect(await errorCodes(members)).toContain("loom.ambiguous-enum-value");
  });

  it("names BOTH candidate enums and the qualified fix in the message", async () => {
    const diags = validateLoomModel(
      await buildLoomModel(SOURCE(`        operation touch() { let x = Draft label := "x" }`)),
    );
    const d = diags.find((x) => x.code === "loom.ambiguous-enum-value");
    expect(d?.message).toContain("OrderStatus");
    expect(d?.message).toContain("InvoiceStatus");
    expect(d?.message).toContain("OrderStatus.Draft");
  });

  it("stays quiet when only one enum declares the name", async () => {
    // `Issued` is unique to InvoiceStatus — an unqualified use must not start
    // erroring just because SOME value name collides elsewhere in the context.
    const members = `        operation issue() { status := Issued }`;
    expect(await errorCodes(members)).not.toContain("loom.ambiguous-enum-value");
    expect(await enumRefsOf(members)).toContain("Issued@InvoiceStatus");
  });
});
