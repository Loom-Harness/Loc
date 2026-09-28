// `uiUsesCodeBlock` — the predicate that decides whether a generated frontend
// carries the `highlight.js` dependency and the `src/lib/highlight.ts` module.
//
// It used to be a hand-rolled `switch (expr.kind)` recursion inside
// `src/generator/react/pages-emitter.ts` (waived twice in the ir-walk census).
// That copy enumerated its own children and therefore had blind spots: a
// `CodeBlock` reachable only through a `list` literal, a `call`'s `style:`
// entries, a `match`'s VARIANT arms, or an `i18nFormat` hole was invisible —
// the app emitted the markup and shipped no highlighter.  It now rides
// `walkExprDeep`, whose child enumeration is `never`-checked against `ExprIR`.
//
// Each case below is a slot the hand-rolled version dropped.

import { describe, expect, it } from "vitest";
import type { ExprIR } from "../../src/ir/types/loom-ir.js";
import { bodyUsesCodeBlock } from "../../src/ir/util/code-block.js";

const codeBlock = (): ExprIR => ({ kind: "call", name: "CodeBlock", args: [] }) as ExprIR;
const other = (name: string, args: ExprIR[] = []): ExprIR =>
  ({ kind: "call", name, args }) as ExprIR;

describe("bodyUsesCodeBlock", () => {
  it("finds a direct call", () => {
    expect(bodyUsesCodeBlock(codeBlock())).toBe(true);
  });

  it("is false for a body with no CodeBlock, and for no body at all", () => {
    expect(bodyUsesCodeBlock(other("Stack", [other("Text")]))).toBe(false);
    expect(bodyUsesCodeBlock(undefined)).toBe(false);
  });

  it("finds one nested in a plain argument", () => {
    expect(bodyUsesCodeBlock(other("Stack", [other("Card", [codeBlock()])]))).toBe(true);
  });

  it("finds one inside a `list` literal", () => {
    const body = other("Tabs", [{ kind: "list", elements: [codeBlock()] } as unknown as ExprIR]);
    expect(bodyUsesCodeBlock(body)).toBe(true);
  });

  it("finds one inside a `match` VARIANT arm", () => {
    const body = {
      kind: "match",
      arms: [],
      variantArms: [{ value: codeBlock() }],
    } as unknown as ExprIR;
    expect(bodyUsesCodeBlock(body)).toBe(true);
  });

  it("finds one inside an i18n-wrapped hole", () => {
    const body = { kind: "i18nFormat", inner: codeBlock() } as unknown as ExprIR;
    expect(bodyUsesCodeBlock(body)).toBe(true);
  });

  it("finds one inside a block-bodied lambda's statements", () => {
    const body = {
      kind: "lambda",
      block: [{ kind: "expression", expr: codeBlock() }],
    } as unknown as ExprIR;
    expect(bodyUsesCodeBlock(body)).toBe(true);
  });
});
