// `can o.op(args)` passes a leading prefix of the operation's arguments: a
// trailing parameter no gate reads may be left out, and leaving out one a gate
// reads is refused, naming it — even when the earlier ones are unread, since
// there are no gaps.

import { describe, expect, it } from "vitest";
import { parseString } from "../_helpers/parse.js";

const SRC = (call: string) => `system S { subdomain D { context C {
  aggregate Order {
    code: string
    shipped: bool = false
    operation ship(c: string, note: string) requires (c != code) when (!shipped) { shipped := true }
    operation mark(tag: string, c: string) requires (c != code) { shipped := true }
  }
  repository Orders for Order { }
  query Ask { id: Order id }
  queryHandler AskHandler(q: Ask): bool {
    let o = Orders.get(q.id)
    return ${call}
  }
} } }`;

async function canArgCodes(call: string): Promise<string[]> {
  const { diagnostics } = await parseString(SRC(call));
  return diagnostics.filter((d) => d.code === "loom.can-args").map((d) => String(d.message));
}

describe("can o.op(args) takes a leading prefix of the arguments", () => {
  it("leaves out a trailing parameter no gate reads", async () => {
    expect(await canArgCodes(`can o.ship("DHL")`)).toEqual([]);
    expect(await canArgCodes(`can o.ship("DHL", "x")`)).toEqual([]);
  });

  it("refuses leaving out a parameter a gate reads, naming it", async () => {
    const msgs = await canArgCodes(`can o.ship()`);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toContain("'c'");
  });

  it("has no gaps: an unread parameter before a read one is still passed", async () => {
    const msgs = await canArgCodes(`can o.mark()`);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toContain("'c'");
    expect(await canArgCodes(`can o.mark("t", "DHL")`)).toEqual([]);
  });

  it("refuses more arguments than the operation takes", async () => {
    expect(await canArgCodes(`can o.ship("a", "b", "c")`)).toHaveLength(1);
  });
});
