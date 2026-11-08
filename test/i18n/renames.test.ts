import { describe, expect, it } from "vitest";
import { detectRenames, moveKeys } from "../../src/i18n/renames.js";

const pairs = (moves: ReturnType<typeof detectRenames>) =>
  Object.fromEntries(moves.map((m) => [m.from, `${m.to} (${m.via})`]));

describe("detectRenames - declared", () => {
  it("follows an aggregate rename on every facet of the type", () => {
    const base = {
      "Sales.Order.name.one": "Order",
      "Sales.Order.name.other": "Orders",
      "Sales.Order.field.qty": "Qty",
      "Sales.Order.op.close": "Close",
    };
    const theirs = {
      "Sales.PurchaseOrder.name.one": "Purchase Order",
      "Sales.PurchaseOrder.name.other": "Purchase Orders",
      "Sales.PurchaseOrder.field.qty": "Qty",
      "Sales.PurchaseOrder.op.close": "Close",
    };
    const moves = detectRenames(base, theirs, {
      columns: [],
      tables: [{ from: "Order", to: "PurchaseOrder" }],
    });
    expect(moves).toHaveLength(4);
    expect(pairs(moves)["Sales.Order.field.qty"]).toBe("Sales.PurchaseOrder.field.qty (declared)");
  });

  it("follows a field rename, composed with a type rename", () => {
    const base = { "Sales.Order.field.qty": "Qty" };
    const theirs = { "Sales.PurchaseOrder.field.quantity": "Quantity" };
    const moves = detectRenames(base, theirs, {
      columns: [{ context: "Sales", aggregate: "PurchaseOrder", from: "qty", to: "quantity" }],
      tables: [{ from: "Order", to: "PurchaseOrder" }],
    });
    expect(pairs(moves)).toEqual({
      "Sales.Order.field.qty": "Sales.PurchaseOrder.field.quantity (declared)",
    });
  });

  it("follows a cross-context move, and only for the named source context", () => {
    const base = { "Sales.Order.field.qty": "Qty", "Other.Order.field.qty": "Qty" };
    const theirs = { "Billing.Order.field.qty": "Qty", "Other.Order.field.qty": "Qty" };
    const moves = detectRenames(base, theirs, {
      columns: [],
      tables: [{ from: "Order", to: "Order", fromContext: "Sales", toContext: "Billing" }],
    });
    expect(pairs(moves)).toEqual({
      "Sales.Order.field.qty": "Billing.Order.field.qty (declared)",
    });
  });

  it("is inert once carried: a step whose old key is gone moves nothing", () => {
    const keys = { "Sales.PurchaseOrder.field.qty": "Qty" };
    expect(
      detectRenames(keys, keys, { columns: [], tables: [{ from: "Order", to: "PurchaseOrder" }] }),
    ).toEqual([]);
  });
});

describe("detectRenames - inferred 1:1", () => {
  // The default English text is humanize(identifier), so an inferred pair needs
  // the text to survive the rename: an explicit label, or a move that keeps the
  // identifier.  These fixtures model the former.
  it.each([
    ["name.one", "Sales.Order.name.one", "Sales.Purchase.name.one"],
    ["name.other", "Sales.Order.name.other", "Sales.Purchase.name.other"],
    ["field", "Sales.Order.field.qty", "Sales.Order.field.quantity"],
    ["op", "Sales.Order.op.close", "Sales.Order.op.finish"],
    ["value", "Sales.Status.value.Open", "Sales.Status.value.Opened"],
    ["rule", "Sales.Order.rule.positive", "Sales.Order.rule.positiveQty"],
    ["message", "Sales.OutOfStock.message", "Sales.SoldOut.message"],
  ])("pairs a %s rename with the same text", (_facet, from, to) => {
    const moves = detectRenames({ [from]: "Same text" }, { [to]: "Same text" });
    expect(pairs(moves)).toEqual({ [from]: `${to} (inferred)` });
  });

  it("pairs a context move that keeps the type and the text", () => {
    const moves = detectRenames(
      { "Sales.Order.field.qty": "Qty" },
      { "Billing.Order.field.qty": "Qty" },
    );
    expect(pairs(moves)).toEqual({
      "Sales.Order.field.qty": "Billing.Order.field.qty (inferred)",
    });
  });

  it("leaves a pair with different text alone", () => {
    expect(
      detectRenames({ "Sales.Order.op.close": "Close" }, { "Sales.Order.op.end": "End" }),
    ).toEqual([]);
  });

  it("leaves an ambiguous group alone: two out, two in, same text", () => {
    const moves = detectRenames(
      { "Sales.Order.field.a": "X", "Sales.Order.field.b": "X" },
      { "Sales.Order.field.c": "X", "Sales.Order.field.d": "X" },
    );
    expect(moves).toEqual([]);
  });

  it("leaves one-out-two-in alone", () => {
    const moves = detectRenames(
      { "Sales.Order.field.a": "X" },
      { "Sales.Order.field.c": "X", "Sales.Order.field.d": "X" },
    );
    expect(moves).toEqual([]);
  });

  it("ignores non-identity keys", () => {
    expect(detectRenames({ "chrome.a": "X" }, { "chrome.b": "X" })).toEqual([]);
  });
});

describe("moveKeys", () => {
  const names = new Set(["Sales", "Billing"]);
  it("refiles a key under the new namespace file", () => {
    const out = moveKeys(
      new Map([["Sales", { "Order.name.other": "Commandes", "Order.field.x": "x" }]]),
      new Map([["Sales.Order.name.other", "Billing.Order.name.other"]]),
      names,
    );
    expect(out.get("Billing")).toEqual({ "Order.name.other": "Commandes" });
    expect(out.get("Sales")).toEqual({ "Order.field.x": "x" });
  });

  it("never overwrites an entry already at the target", () => {
    const out = moveKeys(
      new Map([["Sales", { "A.field.x": "old", "A.field.y": "mine" }]]),
      new Map([["Sales.A.field.x", "Sales.A.field.y"]]),
      names,
    );
    expect(out.get("Sales")).toEqual({ "A.field.x": "old", "A.field.y": "mine" });
  });
});
