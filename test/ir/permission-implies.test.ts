// Permission `implies` — closure stamped on the IR + `contains` gate expanded
// to accept a broader permission (authorization.md §6, M-T3.2 item 7).

import { describe, expect, it } from "vitest";
import { renderCsExpr } from "../../src/generator/dotnet/render-expr.js";
import { renderExpr as renderExUnit } from "../../src/generator/elixir/render-expr.js";
import { renderJavaExpr } from "../../src/generator/java/render-expr.js";
import { renderPyExpr } from "../../src/generator/python/render-expr.js";
import { renderTsExpr } from "../../src/generator/typescript/render-expr.js";
import type { ExprIR, StmtIR } from "../../src/ir/types/loom-ir.js";
import { buildLoomModel } from "../_helpers/ir.js";

const SRC = `
system P {
  user { id: string  permissions: string[] }
  subdomain M {
    permissions { read, edit implies read, approve implies edit }
    context C {
      aggregate Order with crudish {
        status: string
        amt: int
        cap: int
        operation viewIt() requires currentUser.permissions.contains(permissions.read) { status := "x" }
        operation guarded() requires currentUser.permissions.contains(permissions.read) && amt <= cap { status := "x" }
      }
    }
  }
}`;

/** Collect every string literal appearing anywhere in an ExprIR tree. */
function stringLits(e: ExprIR, out: string[] = []): string[] {
  if (e.kind === "literal" && e.lit === "string") out.push(String(e.value));
  for (const v of Object.values(e as Record<string, unknown>)) {
    if (!v || typeof v !== "object") continue;
    if (Array.isArray(v)) {
      for (const x of v) if (x && typeof x === "object") stringLits(x as ExprIR, out);
    } else if ("kind" in (v as object)) {
      stringLits(v as ExprIR, out);
    }
  }
  return out;
}

describe("permission implies — IR closure + gate expansion", () => {
  it("stamps impliedBy runtime strings on the catalogue", async () => {
    const ir = await buildLoomModel(SRC);
    const perms = ir.systems[0]!.subdomains[0]!.permissions;
    const read = perms.find((p) => p.name === "read")!;
    // read is implied (transitively) by edit and approve
    expect(read.impliedBy?.sort()).toEqual(["m.approve", "m.edit"]);
    const edit = perms.find((p) => p.name === "edit")!;
    expect(edit.impliedBy).toEqual(["m.approve"]);
    const approve = perms.find((p) => p.name === "approve")!;
    expect(approve.impliedBy).toBeUndefined(); // nothing implies approve
  });

  it("expands a `contains(read)` gate to accept read || edit || approve", async () => {
    const ir = await buildLoomModel(SRC);
    const op = ir.systems[0]!.subdomains[0]!.contexts[0]!.aggregates[0]!.operations.find(
      (o) => o.name === "viewIt",
    )!;
    const gate = op.statements.find((s: StmtIR) => s.kind === "requires");
    expect(gate).toBeDefined();
    const lits = new Set(stringLits((gate as { expr: ExprIR }).expr));
    expect(lits.has("m.read")).toBe(true);
    expect(lits.has("m.edit")).toBe(true);
    expect(lits.has("m.approve")).toBe(true);
  });

  it("groups the implies expansion so a following `&&` binds the whole closure", async () => {
    const ir = await buildLoomModel(SRC);
    const op = ir.systems[0]!.subdomains[0]!.contexts[0]!.aggregates[0]!.operations.find(
      (o) => o.name === "guarded",
    )!;
    const gate = (op.statements.find((s: StmtIR) => s.kind === "requires") as { expr: ExprIR })
      .expr;
    expect(gate.kind).toBe("binary");
    const bin = gate as Extract<ExprIR, { kind: "binary" }>;
    expect(bin.op).toBe("&&");
    expect(bin.left.kind).toBe("paren");
    const inner = (bin.left as Extract<ExprIR, { kind: "paren" }>).inner;
    expect(inner.kind).toBe("binary");
    expect((inner as Extract<ExprIR, { kind: "binary" }>).op).toBe("||");

    // Every backend renders the group: the `||` chain sits inside parentheses
    // that close before the `&&` / `and`.
    const rendered = {
      ts: renderTsExpr(gate),
      cs: renderCsExpr(gate),
      py: renderPyExpr(gate),
      java: renderJavaExpr(gate),
      ex: renderExUnit(gate),
    };
    for (const [target, out] of Object.entries(rendered)) {
      expect(out.startsWith("("), target).toBe(true);
      let depth = 0;
      let close = -1;
      for (let k = 0; k < out.length && close < 0; k++) {
        if (out[k] === "(") depth++;
        else if (out[k] === ")" && --depth === 0) close = k;
      }
      const group = out.slice(0, close + 1);
      expect(group, target).toMatch(/\|\||\bor\b/);
      expect(out.slice(close + 1).trimStart(), target).toMatch(/^(&&|and\b)/);
    }
  });
});
