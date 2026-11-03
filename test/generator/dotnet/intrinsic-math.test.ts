// A3 math batch of the scalar-intrinsic catalogue (https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/old/plans/stdlib.md):
// numeric abs/min/max ({int,long,decimal,money}) + round/floor/ceil
// ({decimal,money}) on the .NET backend — in-memory rendering in domain
// bodies AND the EF query position (a criterion's expression tree).  The catalogue rows live in
// src/util/intrinsics.ts; the C# snippets in render-expr.ts.
//
// The one .NET-specific wrinkle is `round`: the catalogue contract is
// HALF-AWAY-FROM-ZERO (commercial rounding), so domain bodies force
// `MidpointRounding.AwayFromZero` (native Math.Round defaults to banker's
// half-even) — but EF Core/Npgsql cannot translate the MidpointRounding
// overloads, so the query position (CS_INTRINSIC_QUERY_RENDERERS) drops the
// mode and relies on Postgres round(numeric[, n]) already being
// half-away-from-zero (verified via ToQueryString, EF 10.0.9/Npgsql 10.0.2).
// Math.Abs/Min/Max/Floor/Ceiling all translate as-is (abs/LEAST/GREATEST/
// floor/ceiling), so no other numeric row carries a query override.

import { describe, expect, it } from "vitest";
import { generateBackendFiles } from "../../_helpers/generate.js";
import { parseString } from "../../_helpers/parse.js";

const SRC = `
  context Billing {
    aggregate Invoice {
      amount: money
      budget: money
      rate: decimal
      qty: int
      big: long
      derived roundedAmount: money = amount.round(2)
      derived wholeAmount: money = amount.round()
      derived absQty: int = qty.abs()
      derived minAmount: money = amount.min(budget)
      derived flooredRate: decimal = rate.floor()
      derived ceiledRate: decimal = rate.ceil()
      operation reprice(delta: money) {
        amount := amount.max(delta).round(2)
      }
    }
    repository Invoices for Invoice
    criterion InvoicesPricierThan(q: money) of Invoice = this.amount.round(2) > q
    criterion InvoicesWholeAbove(q: money) of Invoice = this.amount.round() > q
    criterion InvoicesByAbsQty(n: int) of Invoice = this.qty.abs() > n
    criterion InvoicesCappedAt(q: money) of Invoice = this.amount.min(q) == q
    criterion InvoicesByMaxBig(l: long) of Invoice = this.big.max(l) == l
    criterion InvoicesByRateBand(r: decimal) of Invoice = this.rate.floor() <= r && this.rate.ceil() >= r
  }
`;

describe("dotnet generator — numeric math intrinsics (stdlib A3)", () => {
  it("parses + validates cleanly (receiver-typed, queryable where)", async () => {
    const { errors } = await parseString(SRC);
    expect(errors).toEqual([]);
  });

  it("renders round in-memory with MidpointRounding.AwayFromZero (both arities)", async () => {
    const domain = (await generateBackendFiles(SRC, "dotnet")).get("Domain/Invoices/Invoice.cs")!;
    expect(domain).toContain("Math.Round(this.Amount, 2, MidpointRounding.AwayFromZero)");
    expect(domain).toContain("Math.Round(this.Amount, MidpointRounding.AwayFromZero)");
  });

  it("renders abs/min/floor/ceil in-memory via System.Math", async () => {
    const domain = (await generateBackendFiles(SRC, "dotnet")).get("Domain/Invoices/Invoice.cs")!;
    expect(domain).toContain("Math.Abs(this.Qty)");
    expect(domain).toContain("Math.Min(this.Amount, this.Budget)");
    expect(domain).toContain("Math.Floor(this.Rate)");
    expect(domain).toContain("Math.Ceiling(this.Rate)");
  });

  it("renders chained intrinsics in an operation body (max then round)", async () => {
    const domain = (await generateBackendFiles(SRC, "dotnet")).get("Domain/Invoices/Invoice.cs")!;
    expect(domain).toContain(
      "Math.Round(Math.Max(this.Amount, delta), 2, MidpointRounding.AwayFromZero)",
    );
  });

  /** The criterion's EF expression tree — the query position. */
  const queryOf = (files: Map<string, string>, criterion: string): string => {
    const src = files.get(`Domain/Criteria/${criterion}Criterion.cs`)!;
    const m = /ToExpression\(\) => candidate => (.*);/.exec(src);
    expect(m, `${criterion}: no ToExpression`).not.toBeNull();
    return m![1]!;
  };

  it("renders round in the criterion expression WITHOUT MidpointRounding (EF-translatable form)", async () => {
    const files = await generateBackendFiles(SRC, "dotnet");
    // Query override: MidpointRounding overloads don't translate; Postgres
    // round() is half-away-from-zero anyway, so the contract holds.
    expect(queryOf(files, "InvoicesPricierThan")).toBe("Math.Round(candidate.Amount, 2) > q");
    expect(queryOf(files, "InvoicesWholeAbove")).toBe("Math.Round(candidate.Amount, 0) > q");
    for (const c of ["InvoicesPricierThan", "InvoicesWholeAbove"]) {
      expect(files.get(`Domain/Criteria/${c}Criterion.cs`)).not.toContain("MidpointRounding");
    }
  });

  it("renders abs/min/max/floor/ceil in criterion expressions as-is (EF translates them natively)", async () => {
    const files = await generateBackendFiles(SRC, "dotnet");
    expect(queryOf(files, "InvoicesByAbsQty")).toBe("Math.Abs(candidate.Qty) > n");
    expect(queryOf(files, "InvoicesCappedAt")).toBe("Math.Min(candidate.Amount, q) == q");
    expect(queryOf(files, "InvoicesByMaxBig")).toBe("Math.Max(candidate.Big, l) == l");
    expect(queryOf(files, "InvoicesByRateBand")).toBe(
      "Math.Floor(candidate.Rate) <= r && Math.Ceiling(candidate.Rate) >= r",
    );
  });
});
