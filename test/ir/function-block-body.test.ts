// Block-body `function` — purity + non-queryability gate
// (domain-services.md rev. 4, "`function` — let it do a bit more").
//
// A `function` gains a block body alternative:
//   function f(p): T { let x = …  precondition …  return … }
// alongside the unchanged expression form (`= Expression`).  The block form
// stays PURE — no mutation, no `emit`, no operation / repository / domain-service
// / extern call — and is NOT queryable (a function CALL already lowers to a
// `call` ExprIR that `firstNonQueryableNode` rejects in a `where`/`criterion`).

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { parseString } from "../_helpers/parse.js";

async function irCodes(source: string): Promise<string[]> {
  const { model } = await parseString(source, { validate: false });
  return validateLoomModel(enrichLoomModel(lowerModel(model)))
    .filter((d) => d.severity === "error")
    .map((d) => d.code ?? "");
}

const wrap = (aggBody: string, repoBody = "") => `
  system S { subdomain M {
    context C {
      event E { at: datetime }
      aggregate A {
        n: int
        weight: decimal
        surcharge: decimal
        domestic: bool
        ${aggBody}
      }
      repository R for A { ${repoBody} }
    }
  } }
`;

describe("block-body function — purity gate (loom.function-block-impure)", () => {
  it("accepts a pure block body (let + precondition + return)", async () => {
    const codes = await irCodes(
      wrap(`
        function shippingFor(extra: decimal): decimal {
          let base = weight
          precondition base >= 0
          return (domestic ? base : base + surcharge) + extra
        }
      `),
    );
    expect(codes).not.toContain("loom.function-block-impure");
  });

  it("rejects a `this`-write (mutation) in a block body", async () => {
    const codes = await irCodes(wrap(`function bad(): int { n := 5  return n }`));
    expect(codes).toContain("loom.function-block-impure");
  });

  it("rejects an `emit` in a block body", async () => {
    const codes = await irCodes(wrap(`function bad(): int { emit E { at: now() }  return n }`));
    expect(codes).toContain("loom.function-block-impure");
  });

  it("rejects a call to a mutating operation in a block body", async () => {
    const codes = await irCodes(
      wrap(`
        operation bump() { n := n + 1 }
        function bad(): int { bump()  return n }
      `),
    );
    expect(codes).toContain("loom.function-block-impure");
  });

  it("allows a call to another pure function from a block body", async () => {
    const codes = await irCodes(
      wrap(`
        function plusOne(): int = n + 1
        function bad(): int { let x = plusOne()  return x }
      `),
    );
    expect(codes).not.toContain("loom.function-block-impure");
  });

  // ---------------------------------------------------------------------
  // Impurity NESTED IN A BRANCH (wave C2, packet 2f).
  //
  // The purity sweep walked `fn.body.stmts` one level deep on the STATEMENT
  // channel, which was harmless only for as long as a function block could
  // not contain an `if` at all — the AST gate
  // (`loom.function-block-no-return`) refused every branching body because it
  // counted top-level `return`s only.  Unlocking that shape unlocked the
  // hole with it: each mutation below was ACCEPTED in a branch while its
  // top-level twin (the three cases above) was refused, which is the
  // silent-gap trade this repo's rules exist to prevent.  The sweep now rides
  // `walkStmtsDeep`, so the branch and the top level answer identically.
  // ---------------------------------------------------------------------
  it("rejects a `this`-write nested in an `if` branch", async () => {
    const codes = await irCodes(
      wrap(`
        function bad(): int {
          if weight > 10 { n := 5  return n } else { return n }
        }
      `),
    );
    expect(codes).toContain("loom.function-block-impure");
  });

  it("rejects an `emit` nested in an `if` branch", async () => {
    const codes = await irCodes(
      wrap(`
        function bad(): int {
          if weight > 10 { emit E { at: now() }  return n } else { return n }
        }
      `),
    );
    expect(codes).toContain("loom.function-block-impure");
  });

  it("rejects a mutating operation call nested in an `if` branch", async () => {
    const codes = await irCodes(
      wrap(`
        operation bump() { n := n + 1 }
        function bad(): int {
          if weight > 10 { bump()  return n } else { return n }
        }
      `),
    );
    expect(codes).toContain("loom.function-block-impure");
  });

  it("still accepts a PURE branching body", async () => {
    const codes = await irCodes(
      wrap(`
        function tier(): int {
          if weight > 10 { let x = n + 1  return x } else { return n }
        }
      `),
    );
    expect(codes).not.toContain("loom.function-block-impure");
  });

  // The expression sweep was ALREADY deep, so it must not start double-
  // reporting now that the statement sweep is too: exactly one diagnostic per
  // offending call, not one per enclosing `if`.
  it("reports an impure call nested two `if`s deep exactly once", async () => {
    const { model } = await parseString(
      wrap(`
        operation bump() { n := n + 1 }
        function bad(): int {
          if weight > 10 {
            if surcharge > 1 { bump()  return n } else { return n }
          } else { return n }
        }
      `),
      { validate: false },
    );
    const impure = validateLoomModel(enrichLoomModel(lowerModel(model))).filter(
      (d) => d.code === "loom.function-block-impure",
    );
    expect(impure.length).toBe(1);
  });
});

describe("block-body function — non-queryable", () => {
  it("rejects a block-body function call in a find `where`", async () => {
    const codes = await irCodes(
      wrap(`function big(): bool { let t = n  return t > 100 }`, `find heavy(): A[] where big()`),
    );
    expect(codes).toContain("loom.find-where-not-queryable");
  });
});
