// A `valueobject` declared INSIDE one bounded context and referenced from
// ANOTHER — the README's own Quick Example shape (`Money` in `context Orders`,
// `Product.price: Money` in `context Products`).  `ddd parse` and
// `ddd generate system` both exit 0 on it, and five targets then emitted a file
// that USES a type nothing in it (or reachable from it) DECLARES:
//
//   dotnet   Application/Payments/Responses/PaymentResponses.cs named
//            `MoneyResponse`; the record was emitted only into the DECLARING
//            aggregate's `Application/Invoices/Responses/` namespace, and a
//            per-aggregate DTO file carries no `using` back to a sibling
//            aggregate's namespace  → CS0246
//   react    src/api/payment.ts used `MoneySchema`, declared only in
//            src/api/invoice.ts, imported from nowhere                → TS2304
//   vue      src/api/payment.ts — same shape
//   svelte   src/lib/api/payment.ts — same shape
//   angular  src/api/payment.ts used `MoneyResponse`, declared only in
//            src/api/invoice.ts
//
// Narrowed by experiment, and this is what says where the bug is:
//
//   two aggregates in the SAME context sharing a VO  → emitted into BOTH files
//   a ROOT-LEVEL (shared-kernel) VO used by two contexts → emitted into both
//   a VO declared in context A used from context B    → dangling
//
// So the emitters gathered "value objects to emit for this file" from the
// DECLARING context (`ctx.valueObjects`) rather than from the set the
// aggregate's own wire shape actually REFERENCES.  The fix widens the POOL the
// lookup resolves against (`valueObjectPool` / `findValueObjectInScope` over
// `ctx.siblingValueObjects`) and leaves the reachability filter alone, so an
// unreferenced sibling VO still emits nothing and a single-context model is
// byte-identical.
//
// The SECOND half of the same repro: `crudish`'s synthesized
// `update(paid: Money)` collapsed to `update(paid: string)` — the lowering-time
// ambient decl index walked `members` but never a `subdomain`'s `contexts`, so
// it was blind to everything nested in `subdomain > context` and the
// macro-emitted (unlinked) reference had nothing to fall back on.  That one hit
// ALL FIVE backends: `.NET` emitted `public void Update(string paid) { Paid =
// paid; }` against a `Money` property (CS0029), java `update(String paid)`
// against a `Money` field.  Both halves are needed for the repro to compile.

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel, mergeLoomModels } from "../../src/ir/lower/lower.js";
import { generateSystemFiles } from "../_helpers/generate.js";
import { parseValid } from "../_helpers/parse.js";

/** `Money` lives in `context Alpha`; `Payment` in `context Beta` references it.
 *  Every backend + every JSX frontend in one system, generated together. */
const src = `
system Shared {
  subdomain Left {
    context Alpha {
      valueobject Money { amount: decimal  currency: string }
      aggregate Invoice with crudish { total: Money }
      repository Invoices for Invoice { }
    }
  }
  subdomain Right {
    context Beta {
      aggregate Payment with crudish { paid: Money }
      repository Payments for Payment { }
    }
  }
  api LeftApi from Left
  api RightApi from Right
  storage pg { type: postgres }
  resource alphaState { for: Alpha, kind: state, use: pg }
  resource betaState  { for: Beta,  kind: state, use: pg }
  deployable apiNet  { platform: dotnet, contexts: [Alpha, Beta], dataSources: [alphaState, betaState], serves: LeftApi, RightApi, port: 8080 }
  deployable apiJava { platform: java,   contexts: [Alpha, Beta], dataSources: [alphaState, betaState], serves: LeftApi, RightApi, port: 8082 }
  ui WebReact  with scaffold(subdomains: [Left, Right]) { framework: react   api Left: LeftApi  api Right: RightApi }
  ui WebVue    with scaffold(subdomains: [Left, Right]) { framework: vue     api Left: LeftApi  api Right: RightApi }
  ui WebSvelte with scaffold(subdomains: [Left, Right]) { framework: svelte  api Left: LeftApi  api Right: RightApi }
  ui WebNg     with scaffold(subdomains: [Left, Right]) { framework: angular api Left: LeftApi  api Right: RightApi }
  deployable webReact  { platform: static, targets: apiNet, ui: WebReact  { Left: apiNet, Right: apiNet }, port: 3001 }
  deployable webVue    { platform: static, targets: apiNet, ui: WebVue    { Left: apiNet, Right: apiNet }, port: 3002 }
  deployable webSvelte { platform: static, targets: apiNet, ui: WebSvelte { Left: apiNet, Right: apiNet }, port: 3003 }
  deployable webNg     { platform: static, targets: apiNet, ui: WebNg     { Left: apiNet, Right: apiNet }, port: 3004 }
}
`;

/** The same model with `Money` declared in the SAME context as `Payment` — the
 *  control: this shape has always worked, and must keep working identically. */
const sameContextSrc = `
system Shared {
  subdomain Left {
    context Alpha {
      valueobject Money { amount: decimal  currency: string }
      aggregate Invoice with crudish { total: Money }
      aggregate Payment with crudish { paid: Money }
      repository Invoices for Invoice { }
      repository Payments for Payment { }
    }
  }
  api LeftApi from Left
  storage pg { type: postgres }
  resource alphaState { for: Alpha, kind: state, use: pg }
  deployable apiNet { platform: dotnet, contexts: [Alpha], dataSources: [alphaState], serves: LeftApi, port: 8080 }
}
`;

let cached: Map<string, string> | undefined;
async function files(): Promise<Map<string, string>> {
  if (!cached) cached = await generateSystemFiles(src);
  return cached;
}

async function emitted(suffix: string): Promise<string> {
  const all = await files();
  const key = [...all.keys()].find((k) => k.endsWith(suffix));
  expect(key, `${suffix} not emitted — emitted keys: ${[...all.keys()].join(", ")}`).toBeDefined();
  return all.get(key as string) as string;
}

describe("a value object declared in another context is DECLARED where it is used", () => {
  it("dotnet: the consuming aggregate's response DTO file declares MoneyResponse", async () => {
    const payments = await emitted("Application/Payments/Responses/PaymentResponses.cs");
    expect(payments).toContain("MoneyResponse Paid");
    // The reference must resolve: the record is duplicated into THIS namespace,
    // which is exactly what .NET already does for a same-context shared VO.
    expect(payments).toMatch(/public sealed record MoneyResponse\(/);
  });

  it("dotnet: the consuming aggregate's request DTO file declares MoneyRequest", async () => {
    const payments = await emitted("Application/Payments/Requests/PaymentRequests.cs");
    expect(payments).toContain("MoneyRequest Paid");
    expect(payments).toMatch(/public sealed record MoneyRequest\(/);
  });

  it("react: the consuming aggregate's api module declares MoneySchema", async () => {
    const payment = await emitted("web_react/src/api/payment.ts");
    expect(payment).toContain("paid: MoneySchema");
    expect(payment).toMatch(/export const MoneySchema = z\.object\(/);
  });

  it("vue: the consuming aggregate's api module declares MoneySchema", async () => {
    const payment = await emitted("web_vue/src/api/payment.ts");
    expect(payment).toContain("paid: MoneySchema");
    expect(payment).toMatch(/export const MoneySchema = z\.object\(/);
  });

  it("svelte: the consuming aggregate's api module declares MoneySchema", async () => {
    const payment = await emitted("web_svelte/src/lib/api/payment.ts");
    expect(payment).toContain("paid: MoneySchema");
    expect(payment).toMatch(/export const MoneySchema = z\.object\(/);
  });

  it("angular: the consuming aggregate's api module declares MoneyResponse", async () => {
    const payment = await emitted("web_ng/src/api/payment.ts");
    expect(payment).toContain("paid: MoneyResponse");
    expect(payment).toMatch(/export interface MoneyResponse \{/);
  });

  it("react: the scaffolded create form renders the VO's fields, not one text input", async () => {
    // The `undefined` branch of the VO lookup is a DEGRADED fallback (one
    // `register("paid")` text input for a whole object), not an error — so the
    // miss was invisible until the form was used.
    const newPage = await emitted("web_react/src/pages/payments/new.tsx");
    expect(newPage).toContain('name="paid.amount"');
    expect(newPage).toContain('register("paid.currency")');
    expect(newPage).toContain('defaultValues: { paid: { amount: 0, currency: "" } }');
  });

  it("an unreferenced sibling VO is NOT pulled into a file that never names it", async () => {
    // `Invoice` references `Money` itself, so the pool cannot be proven inert
    // there — assert instead that the pool is a LOOKUP, not an emission list:
    // no aggregate module gains a schema for a type its wire shape never names.
    const invoice = await emitted("web_react/src/api/invoice.ts");
    expect(invoice).not.toContain("PaymentSchema");
  });
});

describe("the ambient decl index reaches into `subdomain > context`", () => {
  // The macro-emitted `update(<field>: <type>)` reference is unlinked (no
  // `$refNode`), so it falls back to the project-global ambient decl index.
  // That index walked `members` only — and a `subdomain` holds its contexts in
  // `contexts`, so every declaration under `subdomain > context` was invisible
  // and the param type collapsed to `string`.
  const irFor = async (source: string) => {
    const model = await parseValid(source);
    return enrichLoomModel(mergeLoomModels([lowerModel(model)]));
  };

  it("a cross-context VO keeps its type in a macro-emitted `update` param", async () => {
    const ir = await irFor(src);
    const beta = ir.systems[0].subdomains.flatMap((s) => s.contexts).find((c) => c.name === "Beta");
    const payment = beta?.aggregates.find((a) => a.name === "Payment");
    const update = payment?.operations.find((o) => o.name === "update");
    expect(update?.params[0].type).toEqual({ kind: "valueobject", name: "Money" });
  });

  it("the consuming context carries its siblings' value objects as a lookup pool", async () => {
    const ir = await irFor(src);
    const contexts = ir.systems[0].subdomains.flatMap((s) => s.contexts);
    const beta = contexts.find((c) => c.name === "Beta");
    const alpha = contexts.find((c) => c.name === "Alpha");
    expect(beta?.valueObjects.map((v) => v.name)).toEqual([]);
    expect(beta?.siblingValueObjects?.map((v) => v.name)).toEqual(["Money"]);
    // Own declarations are never duplicated into the sibling pool.
    expect(alpha?.siblingValueObjects ?? []).toEqual([]);
  });

  it("a single-context model grows no sibling pool at all", async () => {
    const ir = await irFor(sameContextSrc);
    const alpha = ir.systems[0].subdomains.flatMap((s) => s.contexts)[0];
    expect(alpha.siblingValueObjects).toBeUndefined();
  });
});
