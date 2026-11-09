// `ddd i18n sync` carries translations across model renames and moves: declared
// ones through `migration` blocks, undeclared ones by the 1:1 text pairing.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runI18nInit, runI18nStatus, runI18nSync } from "../../src/cli/i18n/index.js";
import { readNamespaceDir, writeNamespaceDir } from "../../src/cli/i18n/tree.js";
import type { ReviewEntry } from "../../src/i18n/merge.js";
import { joinCatalog } from "../../src/i18n/namespace.js";

const model = (opts: { order: string; ctx?: string; field?: string; migration?: string }) => `
  system S {
    subdomain M {
      context Sales {
        enum Status { Open, Closed }
        ${opts.ctx === "Sales" || !opts.ctx ? `aggregate ${opts.order} with crudish { ${opts.field ?? "qty"}: int }` : ""}
      }
      context Billing {
        ${opts.ctx === "Billing" ? `aggregate ${opts.order} with crudish { ${opts.field ?? "qty"}: int }` : ""}
      }
    }
    ui WebApp with scaffold(subdomains: [M]) { }
    deployable api { platform: node, contexts: [Sales, Billing], port: 3000 }
    deployable web { platform: static, targets: api, ui: WebApp, port: 3001 }
  }
  ${opts.migration ?? ""}
`;

let tmp: string;
let ddd: string;
let dir: string;
let logs: string[];
let exits: (number | undefined)[];

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loom-i18n-renames-"));
  ddd = path.join(tmp, "app.ddd");
  dir = path.join(tmp, "locales");
  logs = [];
  exits = [];
  vi.spyOn(console, "log").mockImplementation((...a) => void logs.push(a.join(" ")));
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    exits.push(code);
  }) as never);
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const write = (src: string) => fs.writeFileSync(ddd, src);
const locale = (l = "fr") => joinCatalog(readNamespaceDir(path.join(dir, l)));
const nsFile = (ns: string, l = "fr") =>
  readNamespaceDir(path.join(dir, l)).get(ns) as Record<string, string> | undefined;
const reviewOf = (l = "fr") =>
  joinCatalog(
    readNamespaceDir<ReviewEntry>(path.join(dir, ".loom", "review", l)) as never,
  ) as unknown as Record<string, ReviewEntry>;

/** Init + translate every Sales.Order key in `fr`, then settle the lock. */
async function seed(order = "Order") {
  write(model({ order }));
  await runI18nInit(ddd, "fr", { dir });
  const tr: Record<string, string> = {};
  const catalog = joinCatalog(readNamespaceDir(path.join(dir, ".loom", "source.lock")));
  for (const k of Object.keys(catalog)) {
    if (k.startsWith(`Sales.${order}.`)) tr[k] = `fr:${catalog[k]}`;
  }
  const ns = new Map([
    ["Sales", Object.fromEntries(Object.entries(tr).map(([k, v]) => [k.slice(6), v]))],
  ]);
  writeNamespaceDir(path.join(dir, "fr"), ns);
  return tr;
}

describe("ddd i18n sync - declared renames", () => {
  it("an aggregate rename keeps every translation; changed text is flagged for review", async () => {
    const before = await seed();
    expect(Object.keys(before)).toContain("Sales.Order.field.qty");

    write(model({ order: "PurchaseOrder", migration: 'migration "m" { Order -> PurchaseOrder }' }));
    await runI18nStatus(ddd, { dir });
    expect(exits).toEqual([1]); // pending: the move is a file change
    expect(logs.join("\n")).toContain("renamed: Sales.Order.field.qty");

    logs.length = 0;
    await runI18nSync(ddd, { dir });
    const fr = locale();
    expect(fr["Sales.PurchaseOrder.field.qty"]).toBe("fr:Qty");
    expect(fr["Sales.PurchaseOrder.op.create"]).toBe("fr:Create");
    expect(fr["Sales.PurchaseOrder.name.other"]).toBe("fr:Orders");
    expect(Object.keys(fr).some((k) => k.startsWith("Sales.Order."))).toBe(false);
    const out = logs.join("\n");
    expect(out).toContain("(migration block)");
    // the plural name's English changed ("Orders" -> "Purchase Orders"): kept + review
    expect(out).toContain("source text changed, needs review");
    expect(Object.keys(reviewOf()).filter((k) => k.startsWith("Sales."))).toEqual([
      "Sales.PurchaseOrder.name.other",
    ]);
    // the unchanged field needs no review
    expect(reviewOf()["Sales.PurchaseOrder.field.qty"]).toBeUndefined();

    // idempotent: a second sync finds nothing to move
    logs.length = 0;
    await runI18nSync(ddd, { dir });
    expect(logs.join("\n")).not.toContain("renamed:");
    expect(locale()["Sales.PurchaseOrder.field.qty"]).toBe("fr:Qty");
  });

  it("a field rename keeps the translation and flags the changed label", async () => {
    await seed();
    write(
      model({
        order: "Order",
        field: "quantity",
        migration: 'migration "m" { Order.qty -> quantity }',
      }),
    );
    await runI18nSync(ddd, { dir });
    const fr = locale();
    expect(fr["Sales.Order.field.quantity"]).toBe("fr:Qty");
    expect(fr["Sales.Order.field.qty"]).toBeUndefined();
    expect(reviewOf()["Sales.Order.field.quantity"]?.previousSource).toBe("Qty");
    expect(reviewOf()["Sales.Order.field.quantity"]?.source).toBe("Quantity");
  });

  it("a cross-context move refiles the translation in the other namespace file", async () => {
    await seed();
    write(
      model({
        order: "Order",
        ctx: "Billing",
        migration: 'migration "m" { Sales.Order -> Billing.Order }',
      }),
    );
    await runI18nSync(ddd, { dir });
    expect(nsFile("Billing")?.["Order.field.qty"]).toBe("fr:Qty");
    expect(nsFile("Billing")?.["Order.op.create"]).toBe("fr:Create");
    expect(Object.keys(nsFile("Sales") ?? {}).some((k) => k.startsWith("Order."))).toBe(false);
    expect(Object.keys(reviewOf()).filter((k) => /^(Sales|Billing)\./.test(k))).toEqual([]); // text unchanged
  });

  it("carries an open review flag to the new key", async () => {
    await seed();
    // leave a flag open on the field before the rename
    writeNamespaceDir<ReviewEntry>(
      path.join(dir, ".loom", "review", "fr"),
      new Map([
        [
          "Sales",
          { "Order.field.qty": { translation: "fr:Qty", previousSource: "Qty!", source: "Qty" } },
        ],
      ]),
    );
    write(model({ order: "PurchaseOrder", migration: 'migration "m" { Order -> PurchaseOrder }' }));
    await runI18nSync(ddd, { dir });
    expect(reviewOf()["Sales.PurchaseOrder.field.qty"]?.translation).toBe("fr:Qty");
    expect(reviewOf()["Sales.Order.field.qty"]).toBeUndefined();
  });
});

describe("ddd i18n sync - inferred and ambiguous", () => {
  it("an undeclared context move with identical text is paired", async () => {
    await seed();
    write(model({ order: "Order", ctx: "Billing" }));
    await runI18nSync(ddd, { dir });
    expect(nsFile("Billing")?.["Order.field.qty"]).toBe("fr:Qty");
    expect(logs.join("\n")).toContain("inferred");
  });

  it("an undeclared rename whose text changes is left alone", async () => {
    await seed();
    write(model({ order: "PurchaseOrder" }));
    await runI18nSync(ddd, { dir });
    const fr = locale();
    expect(Object.keys(fr).some((k) => k.startsWith("Sales.PurchaseOrder."))).toBe(false);
    expect(logs.join("\n")).not.toContain("renamed:");
  });
});
