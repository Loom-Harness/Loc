// Translator-tooling round trips through the real CLI entry points:
//
//   - `sync` re-keys the source-language overrides and the parked-stale
//     sidecar with a rename, and refuses an unqualified step two contexts match;
//   - `extract` refuses a model whose systems declare different source languages;
//   - `export` carries the `.ddd` file:line of a page literal and of a
//     model-identity key (XLIFF `<context>` and PO `#:`);
//   - the catalog holds a `label(…)` that only an action body uses.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extractProject } from "../../src/cli/i18n/extract.js";
import {
  runI18nExport,
  runI18nInit,
  runI18nStatus,
  runI18nSync,
} from "../../src/cli/i18n/index.js";
import { readNamespaceDir, writeNamespaceDir } from "../../src/cli/i18n/tree.js";
import { joinCatalog } from "../../src/i18n/namespace.js";

const model = (opts: { order: string; migration?: string; page?: string }) => `
  system S {
    subdomain M {
      context Sales {
        aggregate ${opts.order} with crudish { qty: int }
      }
    }
    ui WebApp with scaffold(subdomains: [M]) {
      ${opts.page ?? ""}
    }
    deployable api { platform: node, contexts: [Sales], port: 3000 }
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
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loom-i18n-w5-"));
  ddd = path.join(tmp, "app.ddd");
  dir = path.join(tmp, "locales");
  logs = [];
  exits = [];
  vi.spyOn(console, "log").mockImplementation((...a) => void logs.push(a.join(" ")));
  vi.spyOn(console, "error").mockImplementation((...a) => void logs.push(a.join(" ")));
  vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    exits.push(code);
  }) as never);
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const write = (src: string) => fs.writeFileSync(ddd, src);
const flat = (...parts: string[]) =>
  joinCatalog(readNamespaceDir<string>(path.join(dir, ...parts)) as never);

describe("ddd i18n sync - renames reach the overrides and the stale sidecar", () => {
  it("re-keys a source override and a parked translation with a declared rename", async () => {
    write(model({ order: "Order" }));
    await runI18nInit(ddd, "fr", { dir });
    // The translator rewords the English of one field and keeps a parked French
    // translation of it in the stale sidecar.
    writeNamespaceDir(path.join(dir, "en"), new Map([["Sales", { "Order.field.qty": "Amount" }]]));
    writeNamespaceDir(
      path.join(dir, ".loom", "stale", "fr"),
      new Map([["Sales", { "Order.field.qty": "Montant" }]]),
    );
    await runI18nSync(ddd, { dir });

    write(model({ order: "PurchaseOrder", migration: 'migration "m" { Order -> PurchaseOrder }' }));
    await runI18nStatus(ddd, { dir });
    expect(exits).toEqual([1]);
    expect(logs.join("\n")).toContain("override(s) to re-key");
    expect(logs.join("\n")).toContain("parked translation(s) to re-key");

    await runI18nSync(ddd, { dir });
    expect(flat("en")["Sales.PurchaseOrder.field.qty"]).toBe("Amount");
    expect(flat("en")["Sales.Order.field.qty"]).toBeUndefined();
    expect(flat(".loom", "stale", "fr")["Sales.PurchaseOrder.field.qty"]).toBe("Montant");
    expect(flat(".loom", "stale", "fr")["Sales.Order.field.qty"]).toBeUndefined();
    // The lock carries the override's text under the new key, so the next
    // `sync` sees no source change.
    expect(flat(".loom", "source.lock")["Sales.PurchaseOrder.field.qty"]).toBe("Amount");
  });

  it("carries nothing for an unqualified step that two contexts both satisfy", async () => {
    const two = (name: string, migration = "") => `
      system S {
        subdomain M {
          context Sales { aggregate ${name} { qty: int  invariant qtyBound: qty >= 0 } }
          context Billing { aggregate ${name} { qty: int  invariant qtyBound: qty >= 0 } }
        }
        deployable api { platform: node, contexts: [Sales, Billing], port: 3000 }
      }
      ${migration}`;
    write(two("Order"));
    await runI18nInit(ddd, "fr", { dir });
    writeNamespaceDir(
      path.join(dir, "fr"),
      new Map([
        ["Sales", { "Order.rule.qtyBound": "Bornee" }],
        ["Billing", { "Order.rule.qtyBound": "Bornee" }],
      ]),
    );
    await runI18nSync(ddd, { dir });
    expect(flat("fr")["Sales.Order.rule.qtyBound"]).toBe("Bornee");

    write(two("Invoice", 'migration "m" { Order -> Invoice }'));
    logs.length = 0;
    await runI18nSync(ddd, { dir });
    expect(logs.join("\n")).toContain("ambiguous rename: Order -> Invoice");
    expect(flat("fr")["Sales.Invoice.rule.qtyBound"]).toBeUndefined();
    expect(flat("fr")["Billing.Invoice.rule.qtyBound"]).toBeUndefined();
  });
});

describe("ddd i18n extract - source language", () => {
  it("rejects systems that declare different source languages", async () => {
    write(`
      system A { i18n { source: "en" }
        subdomain M { context C { } }
        ui WebA { page P { route: "/a" body: Heading { "Hello" } } }
        deployable api { platform: node, contexts: [C], port: 3000 }
        deployable web { platform: static, targets: api, ui: WebA, port: 3001 }
      }
      system B { i18n { source: "de" }
        subdomain N { context D { } }
        ui WebB { page Q { route: "/b" body: Heading { "Hallo" } } }
        deployable api2 { platform: node, contexts: [D], port: 3010 }
        deployable web2 { platform: static, targets: api2, ui: WebB, port: 3011 }
      }
    `);
    await expect(extractProject(ddd, { dir })).rejects.toThrow(
      /different i18n source languages: en \(A\); de \(B\)/,
    );
  });
});

describe("ddd i18n export - source locations", () => {
  const page = `page Hello {
        route: "/hello"
        action done() { toast(label(Order)) }
        body: Stack { Heading { "Welcome aboard" }, Button { "Done", onClick: done } }
      }`;

  it("writes file:line for a page literal and a model-identity key", async () => {
    write(model({ order: "Order", page }));
    await runI18nInit(ddd, "fr", { dir });
    const lines = fs.readFileSync(ddd, "utf8").split("\n");
    const literalLine = lines.findIndex((l) => l.includes('Heading { "Welcome aboard" }')) + 1;
    const orderLine = lines.findIndex((l) => l.includes("aggregate Order")) + 1;

    await runI18nExport(ddd, { dir, locale: "fr", format: "xliff", out: path.join(tmp, "fr.xlf") });
    const xlf = fs.readFileSync(path.join(tmp, "fr.xlf"), "utf8");
    const unit = (id: string): string =>
      new RegExp(`<trans-unit id="${id.replace(/\./g, "\\.")}"[\\s\\S]*?</trans-unit>`).exec(
        xlf,
      )![0];
    const literalKey = /id="(WebApp\.page\.Hello\.heading\.[^"]+)"/.exec(xlf)![1]!;
    expect(unit(literalKey)).toContain('<context context-type="sourcefile">app.ddd</context>');
    expect(unit(literalKey)).toContain(
      `<context context-type="linenumber">${literalLine}</context>`,
    );
    expect(unit("Sales.Order.name.one")).toContain(
      `<context context-type="linenumber">${orderLine}</context>`,
    );

    await runI18nExport(ddd, { dir, locale: "fr", format: "po", out: path.join(tmp, "fr.po") });
    const po = fs.readFileSync(path.join(tmp, "fr.po"), "utf8");
    expect(po).toContain(`#: app.ddd:${literalLine}\n`);
    expect(po).toContain(`#: app.ddd:${orderLine}\n`);
  });
});

describe("ddd i18n extract - action bodies", () => {
  const plain = (action: string) => `
    system S {
      subdomain M { context Sales { aggregate Order with crudish { qty: int } } }
      ui WebApp {
        page Hello {
          route: "/hello"
          ${action}
          body: Stack { Heading { "Hi" }, Button { "Go", onClick: done } }
        }
      }
      deployable api { platform: node, contexts: [Sales], port: 3000 }
      deployable web { platform: static, targets: api, ui: WebApp, port: 3001 }
    }`;

  it("catalogues a label(…) that only an action body uses", async () => {
    write(plain("action done() { toast(label(Order.qty)) }"));
    const { catalog } = await extractProject(ddd, { dir });
    expect(catalog["Sales.Order.field.qty"]).toBe("Qty");
  });

  it("has no such entry when no action names it", async () => {
    write(plain('action done() { toast("x") }'));
    const { catalog } = await extractProject(ddd, { dir });
    expect(catalog["Sales.Order.field.qty"]).toBeUndefined();
  });
});
