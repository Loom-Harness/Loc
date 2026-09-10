// Cross-backend render pin for variant-`match` (variant-match.md).
//
// TWO shapes, one per describe below, and the difference is `subjectShape`:
//
//   1. the TAGGED union — a real discriminated union (a `payload F = A | B`, an
//      operation's `or`-return, a domainService return).  Every variant has a
//      wire tag and, on the nominally-typed backends, an emitted
//      `<Union>_<Variant>` carrier record.  Each backend dispatches on that:
//      TS/Python probe the `type` tag, .NET/Java pattern-match the carrier,
//      Elixir cases the `{:ok,…}`/`{:error,tag,…}` tuple.  An `error` variant
//      is a variant like any other here — it carries fields and BINDS
//      (audit F59: .NET and Java used to collapse a one-success/one-error
//      union to `_ =>` / `case null ->` and lose the binding);
//
//   2. the ABSENCE shape (`subjectShape: "absence"`, second describe) — a
//      union-returning repository FIND, which every backend represents as its
//      OPTIONAL TWIN (the success aggregate, error variant standing for
//      absence).  No carrier records are emitted for a find, so every backend
//      renders a presence check.  Lowering stamps this; renderers never
//      re-derive it, which is why the tagged fixture below must NOT be read as
//      a find.
//
// Pure string-emission unit tests (no IO) — the lowest altitude that catches a
// per-backend variant-match regression.  Mirrors render-expr-kinds.test.ts.

import { describe, expect, it } from "vitest";
import { renderCsExpr } from "../../src/generator/dotnet/render-expr.js";
import { renderExpr as renderElixirExpr } from "../../src/generator/elixir/render-expr.js";
import { renderJavaExpr } from "../../src/generator/java/render-expr.js";
import { renderPyExpr } from "../../src/generator/python/render-expr.js";
import { renderTsExpr } from "../../src/generator/typescript/render-expr.js";
import type { ExprIR, TypeIR } from "../../src/ir/types/loom-ir.js";

const STRING: TypeIR = { kind: "primitive", name: "string" };
const A: TypeIR = { kind: "entity", name: "A" };
const NF: TypeIR = { kind: "entity", name: "NF" };

// `<binding>.<field>` where the receiver is the variant binding.
const fieldOf = (binding: string, field: string): ExprIR => ({
  kind: "member",
  receiver: { kind: "ref", name: binding, refKind: "match-binding" },
  member: field,
  receiverType: A,
  memberType: STRING,
});

const lit = (value: string): ExprIR => ({ kind: "literal", lit: "string", value });

// `match outcome { A a => a.code, NF => "gone" }` over a TAGGED union — NF is
// the `error` variant, and this arm happens to bind nothing and read no field.
const MATCH: ExprIR = {
  kind: "match",
  arms: [],
  subject: { kind: "ref", name: "outcome", refKind: "let" },
  subjectType: { kind: "union", variants: [A, NF] },
  variantArms: [
    { varType: A, binding: "a", value: fieldOf("a", "code"), isError: false },
    { varType: NF, binding: undefined, value: lit("gone"), isError: true },
  ],
  otherwise: undefined,
};

describe("variant-match over a TAGGED union — per-backend rendering", () => {
  it("TS: discriminated-union conditional, binding aliased to the scrutinee", () => {
    expect(renderTsExpr(MATCH)).toBe('(outcome.type === "A" ? outcome.code : "gone")');
  });

  it("Python: conditional on the tagged dict, cast subscript reads", () => {
    expect(renderPyExpr(MATCH)).toBe(
      '(cast(str, outcome["code"]) if outcome["type"] == "A" else "gone")',
    );
  });

  it("Java: sealed-union switch over the emitted carrier records", () => {
    const out = renderJavaExpr(MATCH);
    expect(out).toContain("switch (outcome)");
    expect(out).toContain("case AOrNF_A a -> a.code();");
    // The `error` variant is a carrier pattern like any other — NOT a `case
    // null` collapse, which declares no binding (audit F59).  The absence
    // shape, which really has no carriers, is the second describe below.
    expect(out).toContain('case AOrNF_NF __unused -> "gone";');
    expect(out).not.toContain("case null ->");
  });

  it(".NET: switch expression over the emitted carrier records", () => {
    const out = renderCsExpr(MATCH);
    expect(out).toContain("outcome switch");
    expect(out).toContain("AOrNF_A a => a.Code,");
    expect(out).toContain('AOrNF_NF _unused => "gone",');
    // The trailing discard is the mandatory non-exhaustiveness tail, never an
    // arm standing in for the error variant.
    expect(out).not.toContain('_ => "gone",');
  });

  it("Elixir: case over the asymmetric {:ok,…}/{:error,tag,…} tuple", () => {
    const out = renderElixirExpr(MATCH, { thisName: "record", contextModule: "MyApp" });
    expect(out).toContain("case outcome do");
    expect(out).toContain("{:ok, a} -> a.code");
    expect(out).toContain('{:error, "NF", _} -> "gone"');
  });

  it("Java: binderless success arm gets a named throwaway binder, never `_` (preview-only on JDK 21)", () => {
    const binderless: ExprIR = {
      ...MATCH,
      variantArms: [
        { varType: A, binding: undefined, value: lit("yes"), isError: false },
        { varType: NF, binding: undefined, value: lit("gone"), isError: true },
      ],
    };
    const out = renderJavaExpr(binderless);
    expect(out).toContain('case AOrNF_A __unused -> "yes";');
    expect(out).not.toMatch(/case _ /);
  });
});

// A match over a repository union-FIND result (`subjectShape: "absence"`,
// payloads.md §Union finds): the runtime value is the bare
// aggregate-or-absent, so every backend renders a presence check — never a
// discriminator probe / native type switch.  Post-lowering, the success
// binding is already an alias of the subject (a plain `let` ref narrowed to
// the variant), so the arm value below reads off `outcome` directly.
const SUBJECT_A: ExprIR = { kind: "ref", name: "outcome", refKind: "let", type: A };
const ABSENCE_MATCH: ExprIR = {
  kind: "match",
  arms: [],
  subject: { kind: "ref", name: "outcome", refKind: "let" },
  subjectType: { kind: "union", variants: [A, NF] },
  subjectShape: "absence",
  variantArms: [
    {
      varType: A,
      binding: "a",
      value: {
        kind: "member",
        receiver: SUBJECT_A,
        member: "code",
        receiverType: A,
        memberType: STRING,
      },
      isError: false,
    },
    { varType: NF, value: { kind: "literal", lit: "string", value: "missing" }, isError: true },
  ],
  otherwise: undefined,
};

describe("variant-match over a union find (absence shape) — per-backend rendering", () => {
  it("TS: null check, no `.type` probe", () => {
    expect(renderTsExpr(ABSENCE_MATCH)).toBe('outcome !== null ? outcome.code : "missing"');
  });

  it("Python: `is not None` (E711-clean), attribute read, no cast/subscript", () => {
    expect(renderPyExpr(ABSENCE_MATCH)).toBe(
      '(outcome.code if outcome is not None else "missing")',
    );
  });

  it("Java: null check, no sealed-union switch (no carrier types exist for finds)", () => {
    expect(renderJavaExpr(ABSENCE_MATCH)).toBe('outcome != null ? outcome.code() : "missing"');
  });

  it(".NET: `is not null` ternary, no switch over wrapper records", () => {
    expect(renderCsExpr(ABSENCE_MATCH)).toBe('outcome is not null ? outcome.Code : "missing"');
  });

  it("Elixir: nil check, no {:ok,…} tuple case (the facade tuple is already unwrapped)", () => {
    expect(renderElixirExpr(ABSENCE_MATCH, { thisName: "record", contextModule: "MyApp" })).toBe(
      // Parenthesized: Elixir's keyword-list `if` swallows everything after it
      // up to the enclosing terminator, so the leaf self-wraps (see
      // ELIXIR_TARGET.ternary).
      '(if outcome != nil, do: outcome.code, else: "missing")',
    );
  });
});

// ---------------------------------------------------------------------------
// Nested variant-`match` — an INNER arm reading an OUTER arm's binding.
//
// `match outer { A a => match inner { B b => a.code, NF => "gone" }, NF => "x" }`
//
// The shared dispatcher installed each arm's binding as a FRESH single-entry
// `matchBindings` map, so entering the inner match ERASED `a`.  The inner
// arm's `a.code` then missed the side-channel and fell back to formatting the
// bare `.ddd` name — an identifier no target ever declares.  On TS that is
// especially invisible: `a` is a plausible-looking local, and the emitted
// project fails with TS2304, which this repo's own `tsc` never sees.
// Native-pattern backends escaped only by coincidence — their bound name IS
// the source name, so the fallback happened to be right; that coincidence is
// exactly why the bug survived.
const B: TypeIR = { kind: "entity", name: "B" };

type MatchExpr = Extract<ExprIR, { kind: "match" }>;

const innerMatch = (armValue: ExprIR): MatchExpr => ({
  kind: "match",
  arms: [],
  subject: { kind: "ref", name: "inner", refKind: "let" },
  subjectType: { kind: "union", variants: [B, NF] },
  variantArms: [
    { varType: B, binding: "b", value: armValue, isError: false },
    { varType: NF, binding: undefined, value: lit("gone"), isError: true },
  ],
  otherwise: undefined,
});

const nestedMatch = (innerArmValue: ExprIR): MatchExpr => ({
  kind: "match",
  arms: [],
  subject: { kind: "ref", name: "outer", refKind: "let" },
  subjectType: { kind: "union", variants: [A, NF] },
  variantArms: [
    { varType: A, binding: "a", value: innerMatch(innerArmValue), isError: false },
    { varType: NF, binding: undefined, value: lit("x"), isError: true },
  ],
  otherwise: undefined,
});

describe("nested variant-match keeps the enclosing arm's bindings in scope", () => {
  it("TS: the inner arm's `a.code` still resolves to the OUTER scrutinee", () => {
    // `a` is aliased to `outer` (TS has no expression-level pattern binding),
    // so the inner arm must read `outer.code` — never the undeclared `a.code`.
    const out = renderTsExpr(nestedMatch(fieldOf("a", "code")));
    expect(out).toContain("outer.code");
    expect(out).not.toMatch(/(^|[^.\w])a\.code/);
  });

  it("Python: the inner arm reads the outer subject, not a bare name", () => {
    const out = renderPyExpr(nestedMatch(fieldOf("a", "code")));
    expect(out).toContain('outer["code"]');
    expect(out).not.toMatch(/(^|[^.\w])a\["code"\]/);
  });

  it("the inner arm's OWN binding is still installed alongside the outer one", () => {
    // The half the single-entry map got right, pinned so the spread never
    // drops it: `b` still aliases the INNER scrutinee.
    expect(renderTsExpr(nestedMatch(fieldOf("b", "code")))).toContain("inner.code");
  });
});
