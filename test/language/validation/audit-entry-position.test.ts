// `AuditEntry` — the record a history read answers — stands only as a
// queryHandler's `AuditEntry[]` return, and only in a context that keeps a
// trail (an audited aggregate), where every backend emits the entry record.

import { describe, expect, it } from "vitest";
import { validate } from "../../../src/api/index.js";

const SRC = (
  audited: boolean,
  ret = "AuditEntry[]",
  body = "let h = Orders.history(orderId)\n return h",
) => `
system S {
  subdomain Sales {
    context Ordering {
      aggregate Order with crudish {
        code: string
        operation rename(c: string) ${audited ? "audited " : ""}{ code := c }
      }
      repository Orders for Order
      queryHandler OrderTrail(orderId: Order id): ${ret} {
        ${audited ? body : "return []"}
      }
    }
  }
  api A from Sales { route GET "/orders/{orderId}/trail" -> Ordering.OrderTrail }
  storage pg { type: postgres }
  resource st { for: Ordering, kind: state, use: pg }
  deployable d { platform: node contexts: [Ordering] dataSources: [st] serves: A port: 4000 }
}`;

async function messages(src: string): Promise<{ code: string; message: string }[]> {
  return (await validate(src)).diagnostics
    .filter((d) => d.code === "loom.audit-entry-position")
    .map((d) => ({ code: d.code, message: d.message }));
}

describe("loom.audit-entry-position", () => {
  it("admits an AuditEntry[] return of the history read in an audited context", async () => {
    expect(await messages(SRC(true))).toEqual([]);
  });

  it("refuses an AuditEntry[] return in a context with no audited aggregate", async () => {
    const found = await messages(SRC(false));
    expect(found).toHaveLength(1);
    expect(found[0]!.message).toContain("no aggregate in context 'Ordering' keeps a trail");
  });

  it("refuses a single AuditEntry return", async () => {
    const found = await messages(
      SRC(true, "AuditEntry", "let h = Orders.history(orderId)\n return h"),
    );
    expect(found.some((d) => d.message.includes("answers a list"))).toBe(true);
  });
});
