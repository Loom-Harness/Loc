// `loom.page-gate-not-client-evaluable` (audit D2) — a page `requires` gate the
// browser cannot evaluate.
//
// Before this gate, such a `.ddd` reported `0 error(s), 0 warning(s)` and then
// killed `generate system` with a bare JS `Error` out of `renderGateExpr`: no
// `loom.*` code, no page name, no source position, nothing written.  The shape
// that produced it in the audit was not even hand-written — a workflow's header
// `requires currentUser.permissions.contains(permissions.manage)`, which the
// scaffold COPIES onto the synthesised `<W>InstancesList` /
// `<W>InstanceDetail` pages, where `permissions.<name>` no longer resolves
// (a `ui` sits outside the subdomain that owns the catalogue).
//
// Two halves are asserted here:
//   1. the validator refuses the gate, naming the page, the offending
//      sub-expression, and — on a scaffolded instance page — the workflow the
//      gate was copied from;
//   2. the ACCEPTANCE agrees with the renderers: every expression the check
//      lets through renders without throwing on all three gate renderers
//      (JS-family / Feliz / Flutter), and every expression it rejects is one
//      they would have thrown on.  That equivalence is what makes those throws
//      internal invariants rather than the user-facing diagnostic.

import { describe, expect, it } from "vitest";
import { renderGateExpr } from "../../src/generator/_frontend/gate-expr.js";
import { renderFelizGate } from "../../src/generator/feliz/auth-gate.js";
import { renderFlutterGate } from "../../src/generator/flutter/auth-gate.js";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import type { ExprIR } from "../../src/ir/types/loom-ir.js";
import { firstNonUiGateNode } from "../../src/ir/util/ui-gate.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { parseString } from "../_helpers/parse.js";

const CODE = "loom.page-gate-not-client-evaluable";

/** A system with a permission catalogue in subdomain `Warehouse`, one
 *  aggregate, and a react ui — the minimum that reproduces the audit shape. */
function system(opts: { workflowGate?: string; pageGate?: string }): string {
  const wfGate = opts.workflowGate ? `requires ${opts.workflowGate} ` : "";
  const page = opts.pageGate
    ? `
    page Secret {
      route: "/secret"
      requires ${opts.pageGate}
      body: Stack { Text { "hi" } }
    }`
    : "";
  return `
system Shop {
  user { id: string role: string permissions: string[] }
  subdomain Warehouse {
    permissions { manage }
    context Stock {
      event ItemActivated { item: Item id }
      aggregate Item with crudish {
        sku: string
        active: bool
        operation activate() { active := true  emit ItemActivated { item: id } }
      }
      repository Items for Item { }
      workflow Restock ${wfGate}{
        itemId: Item id
        create(ev: ItemActivated) by ev.item { itemId := ev.item }
      }
    }
  }
  api StockApi from Warehouse
  storage primarySql { type: postgres }
  resource stockState { for: Stock, kind: state, use: primarySql }
  deployable api {
    platform: node
    contexts: [Stock]
    dataSources: [stockState]
    serves: StockApi
    auth: required
    port: 8080
  }
  ui WebApp with scaffold(subdomains: [Warehouse]) {
    api Warehouse: StockApi${page}
  }
  deployable webApp {
    platform: static
    targets: api
    auth: ui
    ui: WebApp { Warehouse: api }
    port: 3001
  }
}
`;
}

async function gateDiags(opts: {
  workflowGate?: string;
  pageGate?: string;
}): Promise<{ source: string; message: string }[]> {
  const { model } = await parseString(system(opts), { validate: false });
  return validateLoomModel(enrichLoomModel(lowerModel(model)))
    .filter((d) => d.code === CODE)
    .map((d) => ({ source: d.source, message: d.message }));
}

/** The page `requires` of the named page, lowered — used to hand the SAME IR
 *  node the emitters would see to the three gate renderers. */
async function pageGateIR(opts: {
  workflowGate?: string;
  pageGate?: string;
}): Promise<Record<string, ExprIR>> {
  const { model } = await parseString(system(opts), { validate: false });
  const loom = enrichLoomModel(lowerModel(model));
  const out: Record<string, ExprIR> = {};
  for (const ui of loom.systems[0]!.uis) {
    for (const p of ui.pages) if (p.requires) out[p.name] = p.requires;
  }
  return out;
}

describe("page requires gate — client-evaluable subset", () => {
  it("accepts a claim comparison", async () => {
    expect(await gateDiags({ pageGate: `currentUser.role == "staff"` })).toEqual([]);
  });

  it("accepts membership against a runtime permission string", async () => {
    expect(
      await gateDiags({ pageGate: `currentUser.permissions.contains("warehouse.manage")` }),
    ).toEqual([]);
  });

  it("rejects `permissions.<name>` on a hand-written page, quoting the chain and the runtime string", async () => {
    const ds = await gateDiags({
      pageGate: `currentUser.permissions.contains(permissions.manage)`,
    });
    expect(ds).toHaveLength(1);
    expect(ds[0]!.message).toContain("page 'Secret'");
    // The whole chain, not just the unbound root — `permissions` alone sends
    // the author looking for a reference they never spelled.
    expect(ds[0]!.message).toContain("`permissions.manage` is outside that set");
    // The mechanical rewrite, with the real runtime string filled in.
    expect(ds[0]!.message).toContain(`currentUser.permissions.contains("warehouse.manage")`);
  });

  it("rejects the workflow-instance pages the scaffold copies a header gate onto, and names the workflow", async () => {
    const ds = await gateDiags({
      workflowGate: `currentUser.permissions.contains(permissions.manage)`,
    });
    // Both synthesised instance pages carry the copied gate.
    expect(ds.map((d) => d.message.match(/page '(\w+)'/)?.[1]).sort()).toEqual([
      "RestockInstanceDetail",
      "RestockInstancesList",
    ]);
    for (const d of ds) {
      expect(d.message).toContain("COPY of the header `requires` on workflow 'Restock'");
      expect(d.message).toContain("`permissions.manage` is outside that set");
    }
  });

  it("a legal workflow header gate propagates to the instance pages without a diagnostic", async () => {
    expect(await gateDiags({ workflowGate: `currentUser.role == "staff"` })).toEqual([]);
  });
});

describe("the accepted subset is exactly what the frontend gate renderers can render", () => {
  const RENDERERS: [string, (e: ExprIR) => string][] = [
    ["js-family", (e) => renderGateExpr(e, "currentUser")],
    ["feliz", (e) => renderFelizGate(e, "currentUser")],
    ["flutter", (e) => renderFlutterGate(e, "currentUser")],
  ];

  it("every gate the check ACCEPTS renders on all three renderers", async () => {
    for (const gate of [
      `currentUser.role == "staff"`,
      `currentUser.permissions.contains("warehouse.manage")`,
      `!(currentUser.role == "staff") || currentUser.role == "admin"`,
      `true`,
    ]) {
      const ir = (await pageGateIR({ pageGate: gate })).Secret!;
      expect(firstNonUiGateNode(ir), gate).toBeNull();
      for (const [name, render] of RENDERERS) {
        expect(() => render(ir), `${name}: ${gate}`).not.toThrow();
      }
    }
  });

  it("the gate the check REJECTS is the one all three renderers throw on", async () => {
    const ir = (
      await pageGateIR({ pageGate: `currentUser.permissions.contains(permissions.manage)` })
    ).Secret!;
    expect(firstNonUiGateNode(ir)).not.toBeNull();
    for (const [name, render] of RENDERERS) {
      expect(() => render(ir), name).toThrow();
    }
  });
});
