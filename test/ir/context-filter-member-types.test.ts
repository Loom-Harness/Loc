// A context-level `filter` is lowered once and propagated onto every aggregate
// of the context; each propagated copy must carry the HOST aggregate's member
// types (the single typing pass types the one AST per aggregate it lands on),
// never a `string` placeholder.

import { describe, expect, it } from "vitest";
import type { ExprIR, TypeIR } from "../../src/ir/types/loom-ir.js";
import { walkExprDeep } from "../../src/ir/util/walk.js";
import { buildLoomModel } from "../_helpers/index.js";

const SRC = `
system S {
  subdomain M {
    context C {
      filter !this.isDeleted
      aggregate Order { isDeleted: bool  total: int }
      aggregate Note { isDeleted: bool  title: string }
    }
  }
}`;

describe("context-level filter member types", () => {
  it("`!this.isDeleted` carries the host aggregate as receiver and `bool` as member type", async () => {
    const model = await buildLoomModel(SRC);
    const ctx = model.systems[0]!.subdomains[0]!.contexts[0]!;
    expect(ctx.aggregates.map((a) => a.name).sort()).toEqual(["Note", "Order"]);
    for (const agg of ctx.aggregates) {
      const seen: { receiver: TypeIR; member: TypeIR }[] = [];
      for (const f of agg.contextFilters ?? []) {
        walkExprDeep(f as ExprIR, (n) => {
          if (n.kind === "member" && n.member === "isDeleted") {
            seen.push({ receiver: n.receiverType, member: n.memberType });
          }
        });
      }
      expect(seen, `${agg.name} has no isDeleted read in its context filters`).toHaveLength(1);
      expect(seen[0]).toEqual({
        receiver: { kind: "entity", name: agg.name },
        member: { kind: "primitive", name: "bool" },
      });
    }
  });
});
