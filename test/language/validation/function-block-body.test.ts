// Validator coverage for the `function` block body (domain-services.md rev. 4).
// The AST-layer checks type the block's pure statement subset (let bindings,
// precondition / requires bool gates) and validate each `return`'s value
// against the declared return type; a block with no `return` is rejected
// (loom.function-block-no-return).  The IR-layer purity / non-queryability
// gate (loom.function-block-impure, loom.find-where-not-queryable) is covered
// in test/ir/function-block-body.test.ts.

import { describe, expect, it } from "vitest";
import { parseString } from "../../_helpers/parse.js";

const ctx = (fn: string) => `
  context Sales {
    aggregate Cart {
      weight: decimal
      surcharge: decimal
      domestic: bool
      ${fn}
    }
    repository Carts for Cart { }
  }
`;

describe("validator — function block body", () => {
  it("accepts a well-typed pure block body", async () => {
    const { errors } = await parseString(
      ctx(`
        function shippingFor(extra: decimal): decimal {
          let base = weight
          precondition base >= 0
          return (domestic ? base : base + surcharge) + extra
        }
      `),
    );
    expect(errors).toEqual([]);
  });

  it("rejects a block body whose `return` mismatches the declared type", async () => {
    const { errors } = await parseString(
      ctx(`
        function bad(): decimal {
          return domestic
        }
      `),
    );
    expect(errors.join("\n")).toMatch(/returns 'bool' but is declared to return 'decimal'/);
  });

  it("rejects a non-bool precondition in a block body", async () => {
    const { errors } = await parseString(
      ctx(`
        function bad(): decimal {
          precondition weight
          return weight
        }
      `),
    );
    expect(errors.join("\n")).toMatch(/'precondition' must be of type 'bool'/);
  });

  it("rejects a block body with no `return`", async () => {
    const { errors } = await parseString(
      ctx(`
        function bad(): decimal {
          let base = weight
        }
      `),
    );
    expect(errors.join("\n")).toMatch(/must 'return' a value/);
  });

  // -------------------------------------------------------------------------
  // A `return` nested in an `if` (wave C2, packet 2f).
  //
  // `checkFunction` used to scan `fn.block` ONE LEVEL DEEP, so the ordinary
  // branch-and-return shape below was refused at phase ④ on ALL FIVE backends
  // — every one of which renders it (node/dotnet/java/python through the
  // shared `_stmt/target.ts` `if` arm, elixir through `renderPureBlock`'s,
  // whose own `elixirIfRefusal(…, "value")` gate already admitted a TAIL `if`
  // carrying an `else` with every `return` in tail position).  The identical
  // shape in a `domainService` operation validated and rendered, which is what
  // made it a validator bug rather than a capability gap.
  //
  // `if` is the ONLY nesting channel a function block can carry:
  // `checkStatementPlacement` refuses `match` / `if let` / `for` in every
  // `domain` zone, so there is no second traversal to keep in step.
  // -------------------------------------------------------------------------
  it("accepts a block body whose `return`s sit inside an if/else", async () => {
    const { errors } = await parseString(
      ctx(`
        function tierOf(bonus: decimal): string {
          if weight + bonus > 10 { return "gold" } else { return "bronze" }
        }
      `),
    );
    expect(errors).toEqual([]);
  });

  it("accepts a `let` preamble before the branching tail", async () => {
    const { errors } = await parseString(
      ctx(`
        function tierOf(bonus: decimal): string {
          let total = weight + bonus
          if total > 10 { return "gold" } else { return "bronze" }
        }
      `),
    );
    expect(errors).toEqual([]);
  });

  it("accepts an `else if` chain that ends in an `else`", async () => {
    const { errors } = await parseString(
      ctx(`
        function tierOf(bonus: decimal): string {
          if weight > 20 { return "plat" } else if weight > 10 { return "gold" } else { return "bronze" }
        }
      `),
    );
    expect(errors).toEqual([]);
  });

  // Path-sensitivity: an `if` with no `else` leaves the false path with no
  // value at all, so it must STILL be refused — accepting it would trade the
  // false refusal for a silent `nil`/`undefined` return.  This is the same
  // line `returnsAreTailOnly` (if-stmt-checks.ts) draws for the elixir
  // renderer, so the two layers agree on which shapes reach codegen.
  it("still rejects an `if` with no `else`", async () => {
    const { errors } = await parseString(
      ctx(`
        function tierOf(bonus: decimal): string {
          if weight > 10 { return "gold" }
        }
      `),
    );
    expect(errors.join("\n")).toMatch(/must 'return' a value/);
  });

  it("still rejects an `else if` chain with no terminal `else`", async () => {
    const { errors } = await parseString(
      ctx(`
        function tierOf(bonus: decimal): string {
          if weight > 20 { return "plat" } else if weight > 10 { return "gold" }
        }
      `),
    );
    expect(errors.join("\n")).toMatch(/must 'return' a value/);
  });

  // The nested `return`'s VALUE was never type-checked either — the flat scan
  // could not see it, so an ill-typed branch reached the emitters.
  it("type-checks a `return` nested in a branch against the declared type", async () => {
    const { errors } = await parseString(
      ctx(`
        function tierOf(bonus: decimal): string {
          if weight > 10 { return domestic } else { return "bronze" }
        }
      `),
    );
    expect(errors.join("\n")).toMatch(/returns 'bool' but is declared to return 'string'/);
  });

  // Each statement's construction / call arguments are checked with
  // `AstUtils.streamAst`, which already covers a nested statement — so the
  // recursion must NOT re-run them, or every diagnostic inside an `if` is
  // reported twice.
  it("reports a bad call inside a branch exactly once", async () => {
    const { errors } = await parseString(
      ctx(`
        function two(a: int, b: int): int = a + b
        function tierOf(bonus: decimal): string {
          if weight > 10 { return two(1).toString } else { return "bronze" }
        }
      `),
    );
    expect(errors.filter((e) => /'two' expects 2 arguments/.test(e)).length).toBe(1);
  });
});
