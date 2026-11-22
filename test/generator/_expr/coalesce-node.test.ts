// `a ?? b` is a `coalesce` node, so it stays one through any IR rewrite.
//
// It used to be a ternary whose null test and `otherwise` branch shared ONE
// object, recognised by identity at render time.  `mapExprChildren` rebuilds
// each child separately, so after a rewrite (a param rename, a ref
// substitution — the inlining paths on elixir / .NET / python / feliz) the
// identity was gone and the left operand rendered twice.  What is asserted:
// the left operand's text appears exactly once on every ExprTarget, before and
// after a rewrite (spelling: a double evaluation of a pure read has no
// observable wire effect, so no booted tier can see it).

import { describe, expect, it } from "vitest";
import { renderCsExpr } from "../../../src/generator/dotnet/render-expr.js";
import { renderExpr as renderExExpr } from "../../../src/generator/elixir/render-expr.js";
import { renderJavaExpr } from "../../../src/generator/java/render-expr.js";
import { renderPyExpr } from "../../../src/generator/python/render-expr.js";
import { renderTsExpr } from "../../../src/generator/typescript/render-expr.js";
import type { ExprIR, TypeIR } from "../../../src/ir/types/loom-ir.js";
import { mapExprChildren } from "../../../src/ir/util/walk.js";

const STRING: TypeIR = { kind: "primitive", name: "string" };
const OPT_STRING: TypeIR = { kind: "optional", inner: STRING };

const param = (name: string): ExprIR => ({ kind: "ref", name, refKind: "param", type: OPT_STRING });
const noteOf = (p: string): ExprIR => ({
  kind: "member",
  receiver: param(p),
  member: "note",
  receiverType: { kind: "record", name: "P" } as unknown as TypeIR,
  memberType: OPT_STRING,
});
const coalesce = (left: ExprIR): ExprIR => ({
  kind: "coalesce",
  left,
  fallback: { kind: "literal", lit: "string", value: "none" },
  leftType: OPT_STRING,
});

/** Rename every `p` ref to `cart` — the shape of the inlining rewrites. */
function rename(e: ExprIR): ExprIR {
  if (e.kind === "ref" && e.name === "p") return { ...e, name: "cart" };
  return mapExprChildren(e, rename);
}

// HEEx renders through the same `renderExprWith` `coalesce` arm; its refs need
// a full page-walk context, so it is not driven from here.
const RENDERERS: Record<string, (e: ExprIR) => string> = {
  node: (e) => renderTsExpr(e),
  dotnet: (e) => renderCsExpr(e),
  java: (e) => renderJavaExpr(e),
  python: (e) => renderPyExpr(e),
  elixir: (e) => renderExExpr(e),
};

const count = (text: string, needle: RegExp): number => (text.match(needle) ?? []).length;

describe("a coalesce node survives an IR rewrite on every ExprTarget", () => {
  const original = coalesce(noteOf("p"));
  const rewritten = rename(original);

  it("the rewrite keeps the node a coalesce", () => {
    expect(rewritten.kind).toBe("coalesce");
  });

  for (const [target, render] of Object.entries(RENDERERS)) {
    it(`${target}: the left operand is rendered once, before and after the rewrite`, () => {
      const before = render(original);
      const after = render(rewritten);
      expect(count(before, /\bp\b/g)).toBe(1);
      expect(count(after, /\bcart\b/g)).toBe(1);
      expect(after).toBe(before.replace(/\bp\b/, "cart"));
    });
  }
});
