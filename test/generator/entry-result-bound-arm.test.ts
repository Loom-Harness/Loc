// An expected-failure entry point that answers a BOUND union arm — `match r {
// Order v => { return v }  Unsettled v => { return v } }`, the shape
// `scaffoldHandlers` mints over an operation's `T or E` — rather than a record
// it constructs.  The arm is the operation's own result: on each backend its
// error / payload fields are read off the bound value, and the aggregate's own
// arm is built (in the domain method) from the aggregate's wire fields and read
// back after the save, so the answer carries the saved version.  The
// behavioural witness is corpus `scaffold-handlers-or-e`.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

const files = (platform: string) =>
  generateSystemFiles(
    readFileSync("test/fixtures/corpus/scaffold-handlers-or-e.ddd", "utf8").replace(
      "__PLATFORM__",
      platform,
    ),
  );

const ending = (all: Map<string, string>, suffix: string): string => {
  const key = [...all.keys()].find((k) => k.endsWith(suffix));
  expect(key, `no file ending in ${suffix}`).toBeDefined();
  return all.get(key!)!;
};

describe("a bound union arm answered by an entry point", () => {
  it("node: the own arm reads the getters; a bound error keeps its fields", async () => {
    const all = await files("node");
    expect(ending(all, "domain/order.ts")).toContain(
      'return { type: "Order", id: this.id, code: this.code, paid: this.paid, version: this.version };',
    );
    const routes = ending(all, "http/shopApi-routes.ts");
    expect(routes).toContain(
      'handlerResult = { type: "Unsettled", ...(v as Record<string, unknown>) }',
    );
    expect(routes).toContain("getById(Ids.OrderId(String(v.id)))");
  });

  it(".NET: the own arm is the projection of `this`, re-read once after the save", async () => {
    const all = await files("dotnet");
    expect(ending(all, "Domain/Orders/Order.cs")).toContain(
      "return new OrderOrUnsettled_Order(this.Id.Value, this.Code, this.Paid, this.Version);",
    );
    const h = ending(all, "CloseOrderHandler.cs");
    expect(h).toContain(
      "(await _orderRepo.GetByIdAsync(new global::D.Domain.Ids.OrderId(v.Id), cancellationToken))! is var __saved",
    );
    expect(h).toContain("OrderOrUnsettled_Unsettled(v.Code)");
    // A handler answering an expected failure needs the unit of work registered.
    expect(ending(all, "Program.cs")).toContain("IUnitOfWork");
  });

  it("java: a bound error reads its accessors; the own arm is re-read", async () => {
    const all = await files("java");
    const h = ending(all, "CloseOrderHandler.java");
    expect(h).toContain("ordersRepository.getById(v.id()).code()");
    expect(h).toContain("OrderOrUnsettledResponse_Unsettled(v.code())");
  });

  it("python: a bound arm reads the subject's keys; the own arm carries its id", async () => {
    const all = await files("python");
    expect(ending(all, "app/domain/order.py")).toContain('return {"type": "Order", "id": self.id}');
    const h = ending(all, "app/application/close_order.py");
    // Read off the subject, never a rebinding: one name bound to a dict here
    // and to a scalar in a sibling arm fails mypy --strict.
    expect(h).toContain('handler_result = {"type": "Unsettled", "code": r["code"]}');
    expect(h).toContain('get_by_id(cast(OrderId, r["id"]))');
    expect(h).not.toMatch(/^\s*v = r$/m);
  });
});
