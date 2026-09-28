// `uiUsesCodeBlock` — the predicate that decides whether a generated frontend
// carries the `highlight.js` dependency and the `src/lib/highlight.ts` module.
//
// It used to be a hand-rolled `switch (expr.kind)` recursion inside
// `src/generator/react/pages-emitter.ts` (waived twice in the ir-walk census).
// That copy enumerated its own children and therefore had blind spots: a
// `CodeBlock` reachable only through a `list` literal, a `match`'s VARIANT
// arms, or an `i18nFormat` hole was invisible — the app emitted the markup and
// shipped no highlighter.  It now rides `walkExprDeep`, whose child
// enumeration is `never`-checked against `ExprIR`.
//
// Every case below except the first two is a slot the hand-rolled version
// dropped on the floor.

import { describe, expect, it } from "vitest";
import { bodyUsesCodeBlock } from "../../src/ir/util/code-block.js";
import { type ExprOf, STRING_T } from "../_helpers/ir-builders.js";

/** A walker-primitive call — `CodeBlock { … }` when `name` says so.  Page
 *  primitives resolve to no declaration, so they lower as `callKind: "free"`. */
const primitive = (name: string, args: ExprOf<"call">["args"] = []): ExprOf<"call"> => ({
  kind: "call",
  callKind: "free",
  name,
  args,
});

const codeBlock = (): ExprOf<"call"> => primitive("CodeBlock");

describe("bodyUsesCodeBlock", () => {
  it("finds a direct call", () => {
    expect(bodyUsesCodeBlock(codeBlock())).toBe(true);
  });

  it("is false for a body with no CodeBlock, and for no body at all", () => {
    expect(bodyUsesCodeBlock(primitive("Stack", [primitive("Text")]))).toBe(false);
    expect(bodyUsesCodeBlock(undefined)).toBe(false);
  });

  it("finds one nested in a plain argument", () => {
    expect(bodyUsesCodeBlock(primitive("Stack", [primitive("Card", [codeBlock()])]))).toBe(true);
  });

  it("finds one inside a `list` literal", () => {
    const list: ExprOf<"list"> = { kind: "list", elements: [codeBlock()] };
    expect(bodyUsesCodeBlock(primitive("Tabs", [list]))).toBe(true);
  });

  it("finds one inside a `match` VARIANT arm", () => {
    const match: ExprOf<"match"> = {
      kind: "match",
      arms: [],
      variantArms: [{ varType: STRING_T, value: codeBlock() }],
    };
    expect(bodyUsesCodeBlock(match)).toBe(true);
  });

  it("finds one inside an i18n-wrapped hole", () => {
    const wrapped: ExprOf<"i18nFormat"> = {
      kind: "i18nFormat",
      inner: codeBlock(),
      format: ", number",
    };
    expect(bodyUsesCodeBlock(wrapped)).toBe(true);
  });

  it("finds one inside a block-bodied lambda's statements", () => {
    const lambda: ExprOf<"lambda"> = {
      kind: "lambda",
      param: "e",
      block: [{ kind: "expression", expr: codeBlock() }],
    };
    expect(bodyUsesCodeBlock(lambda)).toBe(true);
  });
});
