// `can o.op(args)` lowers to the operation's own gates, rebound to `o` and to
// the arguments — no new IR node, so every target renders it.  These pin the
// rebinding the behavioural fixture (`corpus/can-permission-query`) cannot
// observe arm by arm: a field, a parameter, the `when`, the aggregate's own
// function, and the ungated operation.

import { describe, expect, it } from "vitest";
import { lowerModel } from "../../src/ir/lower/lower.js";
import type { ExprIR } from "../../src/ir/types/loom-ir.js";
import { parseString } from "../_helpers/parse.js";

const SRC = (op: string) => `system S { subdomain D { context C {
  aggregate Order {
    code: string
    shipped: bool = false
    function isOpen(): bool = !shipped
    ${op}
  }
  repository Orders for Order { }
  query Ask { id: Order id  carrier: string }
  queryHandler AskHandler(q: Ask): bool {
    let o = Orders.get(q.id)
    return can o.ship(q.carrier)
  }
} } }`;

async function answer(op: string): Promise<ExprIR> {
  const { model } = await parseString(SRC(op), { validate: false });
  const ctx = lowerModel(model)
    .systems[0]!.subdomains.flatMap((d) => d.contexts)
    .find((c) => c.name === "C")!;
  const h = (ctx.queryHandlers ?? []).find((x) => x.name === "AskHandler")!;
  return h.returnValue!;
}

const text = (e: ExprIR): string => JSON.stringify(e);

describe("can o.op(args) lowers to the operation's gates on o", () => {
  it("rebinds a field to the receiver and a parameter to the argument", async () => {
    const e = text(await answer(`operation ship(c: string) requires (c != code) { }`));
    expect(e).toContain('"kind":"member","receiver":{"kind":"ref","name":"o"');
    expect(e).toContain('"member":"code"');
    expect(e).toContain('"member":"carrier"');
    expect(e).not.toContain('"refKind":"this-prop"');
    expect(e).not.toContain('"refKind":"param","name":"c"');
  });

  it("joins the `when` after the `requires`", async () => {
    const e = await answer(`operation ship(c: string) requires (c != code) when (!shipped) { }`);
    expect(e.kind).toBe("paren");
    const inner = (e as { inner: ExprIR }).inner;
    expect(inner).toMatchObject({ kind: "binary", op: "&&" });
    expect(text(inner)).toContain('"member":"shipped"');
  });

  it("calls the aggregate's own function on the receiver", async () => {
    const e = text(await answer(`operation ship(c: string) when isOpen() { }`));
    expect(e).toContain('"kind":"method-call","receiver":{"kind":"ref","name":"o"');
    expect(e).toContain('"member":"isOpen"');
    expect(e).not.toContain('"callKind":"function"');
  });

  it("answers true for an operation with no gate", async () => {
    expect(await answer(`operation ship(c: string) { }`)).toMatchObject({
      kind: "literal",
      lit: "bool",
      value: "true",
    });
  });
});
