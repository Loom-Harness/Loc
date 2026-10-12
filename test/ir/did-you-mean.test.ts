// "Did you mean …?" on the IR-phase (⑦) unknown-name diagnostics.
//
// A newcomer who typed `sort: [titel asc]` got
//   retrieval 'TasksInProject': sort references unknown field 'titel' on aggregate 'Task'.
// and nothing else — while the AST-level `Unknown type 'Projet'` already said
// "Did you mean 'Project'?".  Every IR check that reports an unknown name
// against a candidate set it already holds now runs the same `nearestName`
// (src/util/edit-distance.ts) over that set and appends the suggestion through
// the catalog's one `didYouMean` builder.
//
// One case per code: each misspells ONE name by one or two edits and asserts the
// exact suggestion, so a site that stops passing `suggestion:` fails here by
// name.  A control asserts that a name with no near miss stays suggestion-free.

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import type { LoomDiagnostic } from "../../src/ir/validate/checks/diagnostic.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { parseString } from "../_helpers/parse.js";

interface Slots {
  agg?: string;
  repo?: string;
  ctx?: string;
  resource?: string;
  test?: string;
  ui?: string;
}

const sys = (s: Slots): string => `
system S {
  subdomain M {
    context C {
      enum Priority { Low, High }
      valueobject Addr { city: string }
      event Done { order: Order id  total: int }
      aggregate Order with crudish {
        title: string
        total: int
        priority: Priority
        addr: Addr
        operation bump() { total := total + 1 }
        ${s.agg ?? ""}
      }
      repository Orders for Order { ${s.repo ?? ""} }
      workflow Fulfillment {
        orderId: Order id
        status: string
        create(orderId: Order id) { status := "Pending" }
      }
      ${s.ctx ?? ""}
    }
  }
  api A from M
  ${s.ui ?? ""}
  storage pg { type: postgres }
  resource st { for: C, kind: state, use: pg ${s.resource ?? ""} }
  deployable d { platform: node, contexts: [C], dataSources: [st], serves: A, port: 4000 }
  ${s.test ? `test e2e "t" against d { ${s.test} }` : ""}
}`;

async function irDiags(s: Slots): Promise<LoomDiagnostic[]> {
  const { model } = await parseString(sys(s), { validate: false });
  return validateLoomModel(enrichLoomModel(lowerModel(model)));
}

/** The message of the one diagnostic carrying `code`. */
async function messageOf(code: string, s: Slots): Promise<string> {
  const hits = (await irDiags(s)).filter((d) => d.code === code);
  expect(hits.map((d) => d.code)).toEqual([code]);
  return hits[0]!.message;
}

const ORDER = `let o = api.orders.create({ title: "t", total: 1, priority: "Low", addr: { city: "x" } })`;

describe("IR unknown-name diagnostics suggest the nearest real name", () => {
  it("loom.retrieval-sort-unknown-field — the newcomer repro", async () => {
    const m = await messageOf("loom.retrieval-sort-unknown-field", {
      ctx: `criterion Hi of Order = priority == High
            retrieval R of Order { where: Hi  sort: [titel asc] }`,
    });
    expect(m).toContain("unknown field 'titel' on aggregate 'Order'. Did you mean 'title'?");
  });

  it("loom.retrieval-where-unknown-field", async () => {
    const m = await messageOf("loom.retrieval-where-unknown-field", {
      ctx: `criterion ByT(t: string) of Order = this.titel == t
            retrieval R(t: string) of Order { where: ByT(t) }`,
    });
    expect(m).toContain("Did you mean 'this.title'?");
  });

  it("loom.find-where-unknown-field", async () => {
    const m = await messageOf("loom.find-where-unknown-field", {
      repo: `find byTitle(t: string): Order? where this.titel == t`,
    });
    expect(m).toContain("Did you mean 'this.title'?");
  });

  it("loom.find-where-unknown-field — a value-object sub-field", async () => {
    const m = await messageOf("loom.find-where-unknown-field", {
      repo: `find byCity(c: string): Order? where this.addr.cty == c`,
    });
    expect(m).toContain("Did you mean 'this.addr.city'?");
  });

  it("loom.criterion-not-selectable (unknown field in a filter capability)", async () => {
    const m = await messageOf("loom.criterion-not-selectable", {
      agg: `filter this.totl > 0`,
    });
    expect(m).toContain("unknown field 'this.totl'");
    expect(m).toContain("Did you mean 'this.total'?");
  });

  it("loom.projection-key-unknown", async () => {
    const m = await messageOf("loom.projection-key-unknown", {
      ctx: `projection P keyed by ordr {
              order: Order id
              on(e: Done) { order := e.order }
            }`,
    });
    expect(m).toContain("not a declared state field. Did you mean 'order'?");
  });

  it("loom.resource-index-unknown-column", async () => {
    const m = await messageOf("loom.resource-index-unknown-column", {
      resource: `, index: [Order.titel]`,
    });
    expect(m).toContain("Did you mean 'title'?");
  });

  it("loom.config-key-unknown", async () => {
    const m = await messageOf("loom.config-key-unknown", {
      ui: `storage files { type: s3, config: { buckt: "app-files" } }`,
    });
    expect(m).toContain("Did you mean 'bucket'?");
  });

  it("loom.workflow-emit-unknown-field", async () => {
    const m = await messageOf("loom.workflow-emit-unknown-field", {
      ctx: `workflow W { create(orderId: Order id) { emit Done { order: orderId, total: 1, totl: 2 } } }`,
    });
    expect(m).toContain("unknown field 'totl'. Did you mean 'total'?");
  });

  it("loom.workflow-create-unknown-field", async () => {
    const m = await messageOf("loom.workflow-create-unknown-field", {
      ctx: `workflow W { create(orderId: Order id) {
              let n = Order.create({ title: "t", total: 1, priority: Low, addr: Addr { city: "x" }, titel: "u" })
            } }`,
    });
    expect(m).toContain("unknown field 'titel'. Did you mean 'title'?");
  });

  it("loom.workflow-unknown-repository-method", async () => {
    const m = await messageOf("loom.workflow-unknown-repository-method", {
      ctx: `workflow W { create(orderId: Order id) { let o = Orders.getByld(orderId) } }`,
    });
    expect(m).toContain("has no method 'getByld'. Did you mean 'getById'?");
  });

  it("loom.workflow-unknown-operation", async () => {
    const m = await messageOf("loom.workflow-unknown-operation", {
      ctx: `workflow W { create(orderId: Order id) { let o = Orders.getById(orderId)  o.bmp() } }`,
    });
    expect(m).toContain("has no operation 'bmp'. Did you mean 'bump'?");
  });

  it("loom.e2e-unknown-body-key (create)", async () => {
    const m = await messageOf("loom.e2e-unknown-body-key", {
      test: `api.orders.create({ titel: "t", total: 1, priority: "Low", addr: { city: "x" } })`,
    });
    expect(m).toContain("not a create field of 'Order'. Did you mean 'title'?");
  });

  it("loom.e2e-unknown-body-key (operation)", async () => {
    const m = await messageOf("loom.e2e-unknown-body-key", {
      agg: `operation rename(newTitle: string) { title := newTitle }`,
      test: `${ORDER}  api.orders.rename(o, { newTitel: "u" })`,
    });
    expect(m).toContain("not a parameter of 'rename'. Did you mean 'newTitle'?");
  });

  it("loom.e2e-unknown-body-key (workflow run)", async () => {
    const m = await messageOf("loom.e2e-unknown-body-key", {
      test: `api.fulfillment.run({ ordrId: "11111111-1111-4111-8111-111111111111" })`,
    });
    expect(m).toContain("not a parameter of workflow 'Fulfillment'. Did you mean 'orderId'?");
  });

  it("loom.e2e-unknown-response-field (aggregate read)", async () => {
    const m = await messageOf("loom.e2e-unknown-response-field", {
      test: `${ORDER}  let g = api.orders.getById(o)  expect(g.titel).toBe("t")`,
    });
    expect(m).toContain("does not carry. Did you mean 'title'?");
  });

  it("loom.e2e-unknown-response-field (workflow instance)", async () => {
    const m = await messageOf("loom.e2e-unknown-response-field", {
      test: `${ORDER}  api.fulfillment.run({ orderId: o.id })
             let one = api.fulfillment.instance(o)  expect(one.statsu).toBe("x")`,
    });
    expect(m).toContain("does not carry. Did you mean 'status'?");
  });

  it("loom.page-primitive-unknown-arg", async () => {
    const m = await messageOf("loom.page-primitive-unknown-arg", {
      ui: `ui Web { framework: react  page X { route: "/x"  body: Card { varient: "outline" } } }`,
    });
    expect(m).toContain("has no `varient:` argument. Did you mean 'variant'?");
  });

  it("control — no near miss, no suggestion", async () => {
    const m = await messageOf("loom.retrieval-sort-unknown-field", {
      ctx: `criterion Hi of Order = priority == High
            retrieval R of Order { where: Hi  sort: [zzzzzz asc] }`,
    });
    expect(m).not.toContain("Did you mean");
  });
});
