// Position × backend census for resource operations (M-T9.80).
//
// `RESOURCE_OP_SITES` (`src/ir/validate/checks/resource-op-positions.ts`) is
// the ONE list of where a resource-op (`salesFiles.get(k)`) may appear, keyed
// by the expression-site ids `forEachContextExpr` reports.  The placement gate
// reads it, and this census reads it too:
//
//   - every LEGAL site has a case here, and that case generates on all five
//     backends without a throw and (node / python) with the helper imported
//     into the file that calls it — so declaring a site legal is a claim this
//     file proves, not one the table can make on its own;
//   - every OWNED site has a case its owning check refuses;
//   - the refused cases (the census sites that once crashed codegen, plus the
//     source-reachable neighbours) are refused with the site's own wording;
//   - a site the table does not name is refused (fail-closed), and the table
//     names no site the model walk does not know.
//
// Each case also checks that its resource-op is reached through the site it is
// filed under, so a case cannot silently drift to proving a different position.

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import type { BoundedContextIR } from "../../src/ir/types/loom-ir.js";
import { forEachContextExpr, SITES } from "../../src/ir/util/model-exprs.js";
import {
  RESOURCE_OP_SITES,
  resourceOpSitePolicy,
} from "../../src/ir/validate/checks/resource-op-positions.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { generateSystemFiles } from "../_helpers/generate.js";
import { parseString } from "../_helpers/parse.js";

const BACKENDS = ["node", "python", "java", "dotnet", "elixir"] as const;

/** One `Sales` context with an objectStore resource `salesFiles`. */
const wrap = (ctxBody: string, platform: string, apiBody = ""): string => `
system RP {
  subdomain D {
    context Sales {
      aggregate Order with crudish {
        name: string
        operation place() { emit OrderPlaced { orderRef: id, label: name } }
      }
      repository Orders for Order {
        find byName(name: string): Order[] where this.name == name
      }
      event OrderPlaced { orderRef: Order id  label: string }
      ${ctxBody}
    }
  }
  api A from D${apiBody ? ` {\n${apiBody}\n  }` : ""}
  storage pg { type: postgres }
  storage files { type: s3, config: { bucket: "app-files" } }
  resource salesState { for: Sales, kind: state, use: pg }
  resource salesFiles { for: Sales, kind: objectStore, use: files }
  deployable d {
    platform: ${platform}
    contexts: [Sales]
    dataSources: [salesState, salesFiles]
    serves: A
    port: 4000
  }
}`;

interface Case {
  body: string;
  api?: string;
}

/** A case per LEGAL and OWNED site — required (asserted below). */
const POSITIVE_CASES: Record<string, Case> = {
  "WorkflowIR.statements": {
    body: `workflow keep { create(name: string) { salesFiles.put("k/" + name, name) } }`,
  },
  // An EVENT-triggered starter — rendered by each backend's dispatcher, not
  // its workflow service, so it is its own position.
  "CreateIR.statements": {
    body: `workflow track {
      orderRef: Order id
      create(e: OrderPlaced) by e.orderRef {
        orderRef := e.orderRef
        salesFiles.put("k/" + e.label, e.label)
      }
    }`,
  },
  "OnIR.statements": {
    body: `workflow track {
      orderRef: Order id
      create(e: OrderPlaced) by e.orderRef { orderRef := e.orderRef }
      on(e: OrderPlaced) by e.orderRef { salesFiles.put("k/" + e.label, e.label) }
    }`,
  },
  "HandleIR.statements": {
    body: `workflow track {
      orderRef: Order id
      create(o: Order id) { orderRef := o }
      handle stash(name: string) { salesFiles.put("k/" + name, name) }
    }`,
  },
  "CommandHandlerIR.statements": {
    body: `commandHandler Stash(name: string): int {
      let matches = Orders.byName(name)
      salesFiles.put("k/" + name, name)
      return matches.count
    }`,
    api: `route POST "/stash/{name}" -> Sales.Stash`,
  },
  "QueryHandlerIR.statements": {
    body: `queryHandler Peek(name: string): int {
      let matches = Orders.byName(name)
      let blob = salesFiles.get("k/" + name)
      return matches.count
    }`,
    api: `route GET "/peek/{name}" -> Sales.Peek`,
  },
  // OWNED by loom.projection-fold-impure — the census repro.
  "ProjectionOnIR.statements": {
    body: `projection Board keyed by orderRef {
      orderRef: Order id
      blob: string
      on(e: OrderPlaced) { orderRef := e.orderRef  blob := salesFiles.get("x") }
    }`,
  },
};

/** Refused positions with a source spelling — the census repros first. */
const REFUSED_CASES: Record<string, Case> = {
  // A workflow `function` — the .NET census repro.
  "FunctionBodyIR.expr": {
    body: `workflow archive {
      function peek(k: string): string = salesFiles.get(k)
      create(name: string) { let x = peek(name) }
    }`,
  },
  "FunctionBodyIR.stmts": {
    body: `workflow archive {
      function peek(k: string): string { let v = salesFiles.get(k)  return v }
      create(name: string) { let x = peek(name) }
    }`,
  },
  "OperationIR.statements": {
    body: `aggregate Box { label: string  operation stash() { salesFiles.put("k", this.label) } }
      repository Boxes for Box { }`,
  },
  "DerivedIR.expr": {
    body: `aggregate Box { label: string  derived url: string = salesFiles.signedUrl(this.label) }
      repository Boxes for Box { }`,
  },
  "InvariantIR.expr": {
    body: `aggregate Box { label: string  invariant salesFiles.list("k").count == 0 }
      repository Boxes for Box { }`,
  },
  "DomainServiceOperationIR.body": {
    body: `domainService Archiver {
      operation stash(name: string): bool { let existing = salesFiles.list("k/" + name)  return true }
    }`,
  },
  "CommandHandlerIR.returnValue": {
    body: `commandHandler Stash(name: string): string {
      let matches = Orders.byName(name)
      return salesFiles.get("k/" + name)
    }`,
    api: `route POST "/stash/{name}" -> Sales.Stash`,
  },
};

async function enriched(src: string) {
  const { model, errors } = await parseString(src);
  if (errors.length) throw new Error(`parse errors:\n${errors.join("\n")}`);
  return enrichLoomModel(lowerModel(model));
}

function salesContext(m: Awaited<ReturnType<typeof enriched>>): BoundedContextIR {
  return m.systems[0]!.subdomains[0]!.contexts[0]!;
}

/** The sites through which the case model's resource-ops are reached. */
function resourceOpSites(ctx: BoundedContextIR): Set<string> {
  const sites = new Set<string>();
  forEachContextExpr(ctx, ({ expr, site }) => {
    if (expr.kind === "call" && expr.callKind === "resource-op") sites.add(site);
  });
  return sites;
}

async function diagnose(c: Case) {
  const m = await enriched(wrap(c.body, "node", c.api));
  return { sites: resourceOpSites(salesContext(m)), diags: validateLoomModel(m) };
}

describe("RESOURCE_OP_SITES — the declared position list", () => {
  it("names only sites the model-expression walk knows", () => {
    const stale = Object.keys(RESOURCE_OP_SITES).filter((s) => !SITES.visited.has(s));
    expect(stale).toEqual([]);
  });

  it("refuses a site it does not name (fail-closed)", () => {
    expect(resourceOpSitePolicy("NewThingIR.expr").verdict).toBe("refused");
  });

  it("every legal and owned site has a census case, and nothing else does", () => {
    const needCase = Object.entries(RESOURCE_OP_SITES)
      .filter(([, p]) => p.verdict !== "refused")
      .map(([s]) => s)
      .sort();
    expect(Object.keys(POSITIVE_CASES).sort()).toEqual(needCase);
  });

  it("every refused case is filed under a refused site", () => {
    for (const site of Object.keys(REFUSED_CASES)) {
      expect(resourceOpSitePolicy(site).verdict, site).toBe("refused");
    }
  });
});

describe("each case reaches its resource-op through the site it is filed under", () => {
  for (const [site, c] of Object.entries({ ...POSITIVE_CASES, ...REFUSED_CASES })) {
    it(site, async () => {
      const { sites } = await diagnose(c);
      expect([...sites]).toContain(site);
    });
  }
});

describe("refused positions fire their declared code", () => {
  for (const [site, c] of Object.entries(REFUSED_CASES)) {
    it(site, async () => {
      const policy = resourceOpSitePolicy(site);
      if (policy.verdict !== "refused") throw new Error("unreachable");
      const d = (await diagnose(c)).diags.find(
        (x) => x.code === "loom.resource-op-outside-workflow",
      );
      expect(d?.severity).toBe("error");
      expect(d?.message).toContain(`(${policy.what})`);
    });
  }

  for (const [site, c] of Object.entries(POSITIVE_CASES)) {
    const policy = RESOURCE_OP_SITES[site]!;
    if (policy.verdict !== "owned") continue;
    it(`${site} (owned by ${policy.code})`, async () => {
      const { diags } = await diagnose(c);
      expect(diags.map((d) => d.code)).toContain(policy.code);
      // The owner refuses it; the placement gate stays silent (no duplicate).
      expect(diags.map((d) => d.code)).not.toContain("loom.resource-op-outside-workflow");
    });
  }
});

/** node / python: every emitted file that CALLS the helper imports it. */
function assertHelperImported(platform: string, files: Map<string, string>): void {
  const [call, importRe] =
    platform === "node"
      ? ["salesFiles$", /^import \{[^}]*salesFiles\$/m]
      : platform === "python"
        ? ["sales_files_", /^from \S+ import [^\n]*sales_files_/m]
        : [undefined, undefined];
  if (!call || !importRe) return;
  let callers = 0;
  for (const [path, text] of files) {
    if (/\/resources\//.test(path) || !text.includes(`${call}`)) continue;
    // Skip the client module itself (it defines, not calls).
    if (platform === "python" && /^async def sales_files_/m.test(text)) continue;
    if (platform === "node" && /export (async )?function salesFiles\$/.test(text)) continue;
    callers++;
    expect(importRe.test(text), `${path} calls ${call}… without importing it`).toBe(true);
  }
  expect(callers, `no ${platform} file calls the resource helper`).toBeGreaterThan(0);
}

describe("legal positions render on every backend", () => {
  for (const [site, c] of Object.entries(POSITIVE_CASES)) {
    if (RESOURCE_OP_SITES[site]?.verdict !== "legal") continue;
    for (const platform of BACKENDS) {
      it(`${site} × ${platform}`, async () => {
        const files = await generateSystemFiles(wrap(c.body, platform, c.api));
        assertHelperImported(platform, files);
      });
    }
  }
});

// A raw verb on an `api` resource bound to an IN-SYSTEM api is a vocabulary
// question, not a position one: no backend has a raw-verb client for it (the
// client module is derived from the callee's operations), so node/python
// emitted an undefined helper and .NET/Java/Phoenix threw.  Refused at every
// position; the typed spelling stays clean.
describe("loom.resource-verb-invalid — raw verb on an in-system-bound api resource", () => {
  const apiSrc = (call: string) => `
system AC {
  subdomain D {
    context Orders {
      aggregate Order with crudish { code: string }
      repository Orders for Order { }
    }
    context Shipping {
      aggregate Shipment with crudish { orderCode: string }
      repository Shipments for Shipment { }
      workflow fulfil {
        create(code: string) {
          let fetched = ${call}
          let s = Shipment.create({ orderCode: code })
        }
      }
    }
  }
  api OrdersApi from D
  storage pg { type: postgres }
  resource ordersState   { for: Orders,   kind: state, use: pg }
  resource shippingState { for: Shipping, kind: state, use: pg }
  resource orders        { for: Shipping, kind: api,   use: OrdersApi }
  deployable ordersSvc { platform: elixir contexts: [Orders] dataSources: [ordersState] serves: OrdersApi port: 4000 }
  deployable shippingSvc { platform: elixir contexts: [Shipping] dataSources: [shippingState, orders] port: 4001 }
}`;

  it("refuses `orders.get(...)` once, naming the bound api", async () => {
    const diags = validateLoomModel(await enriched(apiSrc(`orders.get("/orders")`)));
    const hits = diags.filter((d) => d.code === "loom.resource-verb-invalid");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.message).toContain("in-system api 'OrdersApi'");
    expect(hits[0]!.message).not.toContain("Available: get, post");
  });

  it("an unknown operation name gets the api-bound wording, not the raw-verb list", async () => {
    const diags = validateLoomModel(await enriched(apiSrc(`orders.bogus("/orders")`)));
    const hits = diags.filter((d) => d.code === "loom.resource-verb-invalid");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.message).toContain("no raw 'bogus' verb");
  });

  it("the typed spelling is clean", async () => {
    const diags = validateLoomModel(await enriched(apiSrc(`orders.allOrder()`)));
    expect(diags.filter((d) => d.severity === "error")).toEqual([]);
  });
});
