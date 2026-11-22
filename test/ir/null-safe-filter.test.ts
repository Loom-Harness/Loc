// `nullSafeFilter` (owner ruling 172): a negated or inequality filter on an
// optional column is rewritten so SQL answers what memory answers.  The
// behaviour on every backend is the `null-safe-filters` corpus fixture; this
// pins the rewrite's shape — including what it must leave alone (positive
// comparisons, required columns, principal terms).

import { describe, expect, it } from "vitest";
import type { ExprIR, TypeIR } from "../../src/ir/types/loom-ir.js";
import { nullSafeFilter } from "../../src/ir/util/null-safe-filter.js";

const str = { kind: "primitive", name: "string" } as TypeIR;
const opt = (inner: TypeIR) => ({ kind: "optional", inner }) as TypeIR;
const col = (name: string, optional: boolean): ExprIR =>
  ({ kind: "ref", name, refKind: "this-prop", type: optional ? opt(str) : str }) as ExprIR;
const param = (name: string): ExprIR =>
  ({ kind: "ref", name, refKind: "param", type: str }) as ExprIR;
const bin = (op: string, left: ExprIR, right: ExprIR): ExprIR =>
  ({ kind: "binary", op, left, right }) as ExprIR;
const not = (operand: ExprIR): ExprIR => ({ kind: "unary", op: "!", operand }) as ExprIR;

/** A compact rendering of the rewritten tree. */
function show(e: ExprIR): string {
  switch (e.kind) {
    case "ref":
      return e.name;
    case "member":
      return e.member;
    case "literal":
      return e.value;
    case "unary":
      return `!${show(e.operand)}`;
    case "paren":
      return show(e.inner);
    case "binary":
      return `(${show(e.left)} ${e.op} ${show(e.right)})`;
    default:
      return e.kind;
  }
}

describe("nullSafeFilter", () => {
  it("guards an inequality on an optional column", () => {
    expect(show(nullSafeFilter(bin("!=", col("memo", true), param("q"))))).toBe(
      "((memo == null) || (memo != q))",
    );
  });

  it("pushes a negation through && and guards each comparison it decides", () => {
    const e = not(
      bin(
        "&&",
        bin("==", col("title", false), param("t")),
        bin("==", col("memo", true), param("q")),
      ),
    );
    expect(show(nullSafeFilter(e))).toBe("((title != t) || ((memo == null) || (memo != q)))");
  });

  it("guards a negated ordering", () => {
    const e = not(bin(">", col("memo", true), param("q")));
    expect(show(nullSafeFilter(e))).toBe("((memo == null) || !(memo > q))");
  });

  it("leaves positive comparisons, required columns and null tests unchanged", () => {
    for (const e of [
      bin("==", col("memo", true), param("q")),
      bin("!=", col("title", false), param("q")),
      bin("!=", col("memo", true), { kind: "literal", lit: "null", value: "null" } as ExprIR),
    ]) {
      expect(nullSafeFilter(e)).toBe(e);
    }
  });

  it("leaves a comparison that reads the principal exactly as written", () => {
    const claim = {
      kind: "member",
      receiver: { kind: "ref", name: "currentUser", refKind: "current-user" },
      member: "team",
      receiverType: str,
      memberType: opt(str),
    } as ExprIR;
    const e = bin("!=", col("team", true), claim);
    expect(nullSafeFilter(e)).toBe(e);
  });
});

describe("nullSafeFilter in enrichment — the author's predicate only", () => {
  // The same `memo != "x"` shape in three places: a capability filter (an
  // authorization-side scope, ruling 312), a projection's own `where`, and a
  // find.  Only the author's reads are rewritten; the capability scope keeps
  // its own rule, and nothing the plan adds to a projection's source read is
  // folded into `query.filter`.
  const source = `
system S {
  subdomain Desk {
    context Tickets {
      criterion NotX of Ticket = this.memo != "x"
      aggregate Ticket with crudish {
        title: string
        memo: string?
        filter NotX
      }
      repository Tickets for Ticket { }
      criterion MemoIsNot(q: string) of Ticket = this.memo != q
      projection NotY {
        n: int
        from Ticket as t
        where t.memo != "y"
        select n = count()
      }
    }
  }
}`;

  it("rewrites the projection's own where and the criterion, not the capability scope", async () => {
    const { buildLoomModel, enrichedContexts } = await import("../_helpers/ir.js");
    const loom = await buildLoomModel(source);
    const ctx = enrichedContexts(loom).find((c) => c.name === "Tickets")!;
    const proj = ctx.projections.find((p) => p.name === "NotY")!;
    expect(show(proj.query!.filter!)).toMatch(/== null\) \|\| /);
    const crit = ctx.criteria.find((c) => c.name === "MemoIsNot")!;
    expect(show(crit.body)).toBe("((memo == null) || (memo != q))");
    const agg = ctx.aggregates.find((a) => a.name === "Ticket")!;
    const scopes = JSON.stringify(agg.contextFilters ?? []);
    expect(scopes).toContain('"op":"!="'); // the same shape is there …
    expect(scopes).not.toContain('"lit":"null"'); // … and left as written
  });
});
