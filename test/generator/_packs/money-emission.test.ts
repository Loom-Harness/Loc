import { wireFieldsFor } from "../../../src/ir/enrich/wire-projection.js";
// Phase 5 — per-backend money emission verification.  Uses the
// alignment fixture `examples/money-primitive.ddd` and asserts that
// each of the four backends emits the documented per-platform shape
// for the `money` primitive: domain type, arithmetic, literal,
// wire/Zod/DTO schema, repository hydrate/persist, and column shape.
//
// One fixture, four assertion blocks — keeps the cross-backend
// contract visible in a single file.  The OpenAPI parity check in
// `test/e2e/e2e.test.ts` automatically verifies cross-backend
// agreement on the wire shape under `LOOM_E2E=1`.

import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { renderCsType } from "../../../src/generator/dotnet/render-expr.js";
import { mapTypeToEcto } from "../../../src/generator/elixir/vanilla/schema-emit.js";
import { renderTsType } from "../../../src/generator/typescript/render-expr.js";
import type {
  EnrichedAggregateIR,
  EnrichedBoundedContextIR,
} from "../../../src/ir/types/loom-ir.js";
import { buildLoomModel, enrichedContexts } from "../../_helpers/index.js";

async function billingFixture(): Promise<{
  ctx: EnrichedBoundedContextIR;
  inv: EnrichedAggregateIR;
}> {
  const src = fs.readFileSync(
    path.resolve(__dirname, "..", "../..", "examples/money-primitive.ddd"),
    "utf8",
  );
  const loom = await buildLoomModel(src);
  // The example declares a `system`, which re-parents its contexts under the
  // system's subdomains.
  const ctx = enrichedContexts(loom).find((c) => c.name === "Billing");
  expect(ctx, "Billing context").toBeDefined();
  const inv = ctx!.aggregates.find((a) => a.name === "Invoice")!;
  return { ctx: ctx!, inv };
}

describe("money emission — type mappings per backend", () => {
  it("TS renderTsType('money') → 'Decimal'", () => {
    expect(renderTsType({ kind: "primitive", name: "money" })).toBe("Decimal");
  });

  it(".NET renderCsType('money') → 'decimal'", () => {
    expect(renderCsType({ kind: "primitive", name: "money" })).toBe("decimal");
  });

  it("Phoenix mapTypeToEcto('money') → ':decimal'", () => {
    expect(mapTypeToEcto({ kind: "primitive", name: "money" }, new Map())).toBe(":decimal");
  });
});

describe("money emission — IR binary nodes carry the type stash", () => {
  it("`subtotal + tax` carries leftType=money, resultType=money", async () => {
    const { inv } = await billingFixture();
    const total = inv.derived.find((d) => d.name === "total")!;
    const bin = total.expr as Extract<typeof total.expr, { kind: "binary" }>;
    expect(bin.leftType).toEqual({ kind: "primitive", name: "money" });
    expect(bin.resultType).toEqual({ kind: "primitive", name: "money" });
  });

  it("`subtotal * taxRate` carries leftType=money, resultType=money (scaling)", async () => {
    const { inv } = await billingFixture();
    const tax = inv.derived.find((d) => d.name === "tax")!;
    const bin = tax.expr as Extract<typeof tax.expr, { kind: "binary" }>;
    expect(bin.leftType).toEqual({ kind: "primitive", name: "money" });
    expect(bin.resultType).toEqual({ kind: "primitive", name: "money" });
  });

  it('`subtotal >= money("0.00")` invariant: leftType=money, resultType=bool', async () => {
    const { inv } = await billingFixture();
    const iv = inv.invariants[0]!;
    const bin = iv.expr as Extract<typeof iv.expr, { kind: "binary" }>;
    expect(bin.leftType).toEqual({ kind: "primitive", name: "money" });
    expect(bin.resultType).toEqual({ kind: "primitive", name: "bool" });
  });
});

describe("money emission — Hono Zod schemas", () => {
  it("request zodFor(money) references the shared `moneySchema` helper", async () => {
    const { zodFor } = await import("../../../src/platform/hono/shared/routes-builder.js");
    // The string-to-Decimal transform + format check is factored out
    // to `lib/schemas.ts`; per-route schemas reference it by name
    // rather than redeclaring the chain at every field site.
    const z = zodFor({ kind: "primitive", name: "money" });
    expect(z).toBe("moneySchema");
  });
});

describe("money emission — Drizzle schema column", () => {
  it("emits NUMERIC(19, 4) for money fields via renderSchema", async () => {
    const { renderSchema } = await import("../../../src/generator/typescript/emit.js");
    const { ctx } = await billingFixture();
    const out = renderSchema(ctx);
    expect(out).toContain("numeric");
    expect(out).toContain("precision: 19");
    expect(out).toContain("scale: 4");
  });
});

describe("money emission — Hono lib/schemas.ts helper", () => {
  // The string-to-Decimal Zod transform is factored to one place;
  // routes import `moneySchema` rather than redeclaring the chain.

  async function generateHonoFiles(): Promise<Map<string, string>> {
    const { generateBackendFromFile } = await import("../../_helpers/generate.js");
    return generateBackendFromFile("examples/money-primitive.ddd", "node");
  }

  it("emits `lib/schemas.ts` exporting `moneySchema` when a context uses money", async () => {
    const files = await generateHonoFiles();
    const schemas = files.get("lib/schemas.ts");
    expect(schemas).toBeDefined();
    expect(schemas!).toContain("export const moneySchema");
    expect(schemas!).toContain("z.string().transform");
    // Defensive parse: failures are typed Zod issues, not uncaught
    // throws.  The shared helper is the seam every route inherits.
    expect(schemas!).toContain("ctx.addIssue");
    expect(schemas!).toContain("z.NEVER");
  });

  it("omits `lib/schemas.ts` for projects without any money usage", async () => {
    const { generateBackendFromSource } = await import("../../_helpers/generate.js");
    const files = await generateBackendFromSource(
      `
      context Foo {
        aggregate Bar { name: string }
        repository Bars for Bar { }
      }
    `,
      "node",
    );
    expect(files.get("lib/schemas.ts")).toBeUndefined();
  });

  it("a money-bearing route file imports `moneySchema` from `../lib/schemas`", async () => {
    const files = await generateHonoFiles();
    const route = files.get("http/invoice.routes.ts");
    expect(route).toBeDefined();
    expect(route!).toContain(`import { moneySchema } from "../lib/schemas";`);
    // The route file no longer imports `Decimal` directly — the
    // shared helper owns the decimal.js dep; route handlers receive
    // `Decimal` instances by Zod inference.
    expect(route!).not.toContain(`import Decimal from "decimal.js"`);
    // No more inline `z.string().regex(...).transform(...)` chain at
    // money-field sites.
    expect(route!).toContain("subtotal: moneySchema");
  });
});

describe("money emission — repository persist drops redundant parens", () => {
  it("emits `aggregate.subtotal.toString()` (no wrapping parens)", async () => {
    const { generateBackendFromFile } = await import("../../_helpers/generate.js");
    const files = await generateBackendFromFile("examples/money-primitive.ddd", "node");
    const repo = files.get("db/repositories/invoice-repository.ts");
    expect(repo).toBeDefined();
    // Defensive (value).toString() is gone — money persists as plain
    // <expr>.toString().  Method-call already binds tightly enough
    // for the receiver shape repository-builder constructs.
    expect(repo!).toContain("aggregate.subtotal.toString()");
    expect(repo!).not.toContain("(aggregate.subtotal).toString()");
  });
});

describe("money emission — wire-spec doc", () => {
  it("Invoice's subtotal field is {type: string, format: decimal}", async () => {
    const { jsonPropertyForType } = await import("../../../src/system/wire-spec.js");
    const { inv } = await billingFixture();
    const subtotal = wireFieldsFor(inv).find((f) => f.name === "subtotal");
    expect(subtotal).toBeDefined();
    expect(jsonPropertyForType(subtotal!.type)).toEqual({
      type: "string",
      format: "decimal",
    });
  });
});
