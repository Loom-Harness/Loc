// A nullable `money?` / `decimal?` in a comparison (follow-up to banking eval
// B-13, #3139).  Money is an OBJECT on node (decimal.js `Decimal`), java
// (`BigDecimal`) and elixir (`%Decimal{}`), so each backend dispatches money
// comparisons through a method — and that method had no null story:
//
//   * node   — `subtotal == fee` rendered `subtotal.eq(fee)`: decimal.js throws
//              `[DecimalError] Invalid argument: null` (and tsc TS2345); a
//              nullable LEFT fell to reference `===` and native `>` (which
//              compares `valueOf()` STRINGS on a Decimal).
//   * java   — `fee == null` rendered `fee.compareTo(null) == 0`: an NPE on
//              every call, present or absent.
//   * elixir — `subtotal == fee` rendered `Decimal.compare(subtotal, nil)`,
//              which raises; a nullable LEFT fell to struct `==` (10 ≠ 10.00)
//              and Erlang term ordering for `>`.
//
// .NET (`decimal?` lifted operators) and python (`Decimal == None` is False)
// were already right and are pinned unchanged.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

const SOURCE = (platform: string) => `
system R {
  subdomain S { context C {
    aggregate Inv with crudish {
      subtotal: money
      fee: money?
      rate: decimal?
      function hasFee(): bool = fee != null
      function noFee(): bool = fee == null
      function hasSubtotal(): bool = subtotal != null
      function feeIsSubtotal(): bool = fee == subtotal
      function subtotalIsFee(): bool = subtotal == fee
      function feeIs(x: money?): bool = fee == x
      function rateIs(r: decimal): bool = r == rate
      operation charge() {
        precondition fee == null || fee > money("0")
        subtotal := subtotal + money("1")
      }
    }
    repository Invs for Inv { }
  } }
  storage pg { type: postgres }
  resource st { for: C, kind: state, use: pg }
  deployable api { platform: ${platform}, contexts: [C], dataSources: [st], port: 3000 }
}
`;

async function file(platform: string, suffix: string): Promise<string> {
  const files = await generateSystemFiles(SOURCE(platform));
  const hit = [...files.entries()].find(([p]) => p.endsWith(suffix));
  if (!hit) throw new Error(`no generated file ending in ${suffix}`);
  return hit[1];
}

describe("node — a `money?` comparison is null-safe", () => {
  it("`x == null` / `x != null` are plain null checks, never `x.eq(null)`", async () => {
    const inv = await file("node", "domain/inv.ts");
    expect(inv).toContain("public hasFee(): boolean { return this._fee !== null; }");
    expect(inv).toContain("public noFee(): boolean { return this._fee === null; }");
    // A plain `money` vs the `null` literal — the shape that rendered
    // `this._subtotal.eq(null)` (the left stamp is the bare `money`).
    expect(inv).toContain("public hasSubtotal(): boolean { return this._subtotal !== null; }");
    expect(inv).not.toMatch(/\.eq\(null\)/);
  });

  it("a nullable side compares canonical text on either side, not `.eq` / `===`", async () => {
    const inv = await file("node", "domain/inv.ts");
    expect(inv).toContain("return (this._fee)?.toString() === (this._subtotal).toString();");
    expect(inv).toContain("return (this._subtotal).toString() === (this._fee)?.toString();");
    expect(inv).toContain("return (this._fee)?.toString() === (x)?.toString();");
    expect(inv).not.toContain(".eq(this._fee)");
  });

  it("an ordering on a `money?` dispatches through the Decimal method", async () => {
    const inv = await file("node", "domain/inv.ts");
    expect(inv).toContain('this._fee === null || (this._fee)!.gt(new Decimal("0"))');
  });

  it("`decimal?` (a JS number) keeps native strict equality", async () => {
    const inv = await file("node", "domain/inv.ts");
    expect(inv).toContain("return r === this._rate;");
  });
});

describe("java — a `money?`/`decimal?` comparison never reaches compareTo(null)", () => {
  it("`x == null` is a reference null check", async () => {
    const inv = await file("java", "/Inv.java");
    expect(inv).toContain("return this.fee != null;");
    expect(inv).toContain("return this.fee == null;");
    expect(inv).toContain("return this.subtotal != null;");
    expect(inv).toContain('this.fee == null || this.fee.compareTo(new BigDecimal("0")) > 0');
    expect(inv).not.toMatch(/compareTo\(null\)/);
  });

  it("a nullable side compares through a nulls-first comparator", async () => {
    const inv = await file("java", "/Inv.java");
    const cmp =
      "java.util.Comparator.nullsFirst(java.util.Comparator.<java.math.BigDecimal>naturalOrder())";
    expect(inv).toContain(`return ${cmp}.compare(this.fee, this.subtotal) == 0;`);
    expect(inv).toContain(`return ${cmp}.compare(this.subtotal, this.fee) == 0;`);
    expect(inv).toContain(`return ${cmp}.compare(r, this.rate) == 0;`);
  });
});

describe("elixir — a `money?`/`decimal?` comparison never reaches Decimal.compare(_, nil)", () => {
  it("a nullable side is nil-safe value equality, a nil clause only on the nullable side", async () => {
    const inv = await file("elixir", "lib/api/c.ex");
    expect(inv).toContain(
      "(case {record.fee, record.subtotal} do {nil, _} -> false; {loom_l, loom_r} -> Decimal.equal?(loom_l, loom_r) end)",
    );
    expect(inv).toContain(
      "(case {record.subtotal, record.fee} do {_, nil} -> false; {loom_l, loom_r} -> Decimal.equal?(loom_l, loom_r) end)",
    );
    expect(inv).toContain(
      "(case {record.fee, x} do {nil, nil} -> true; {nil, _} -> false; {_, nil} -> false; {loom_l, loom_r} -> Decimal.equal?(loom_l, loom_r) end)",
    );
    expect(inv).not.toMatch(/Decimal\.compare\([^)]*, record\.(fee|rate)\)/);
  });

  it("an ordering on a `money?` goes through Decimal.compare, not term order", async () => {
    const inv = await file("elixir", "lib/api/c.ex");
    expect(inv).toContain(
      'is_nil(record.fee) or Decimal.compare(record.fee, Decimal.new("0")) == :gt',
    );
  });
});

describe(".NET and python were already null-safe — pinned unchanged", () => {
  it(".NET `decimal?` lifted operators", async () => {
    const inv = await file("dotnet", "/Inv.cs");
    expect(inv).toContain("public bool SubtotalIsFee() => this.Subtotal == this.Fee;");
    expect(inv).toContain("public bool NoFee() => this.Fee == null;");
  });

  it("python `Decimal == None` is False", async () => {
    const inv = await file("python", "domain/inv.py");
    expect(inv).toContain("return self._subtotal == self._fee");
    expect(inv).toContain("return self._fee is None");
  });
});
