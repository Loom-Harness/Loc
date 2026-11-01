// Natural-key reads (D-REPO-KEY-LOOKUP) through lowering and enrichment.
//
// `Products.getBy(sku: s)` lowers to a `load-by-key` read naming the method
// `getBySku`; enrichment derives that method as a `synthesized` find (one
// equality per tuple column, the read's `ignoring` stance) so every backend's
// repository emitter renders it.  The arguments follow the TUPLE's declared
// column order, so argument order at the call never picks a different method.

import { describe, expect, it } from "vitest";
import type {
  EnrichedBoundedContextIR,
  FindIR,
  WorkflowStmtIR,
} from "../../src/ir/types/loom-ir.js";
import { workflowCanAnswerNotFound } from "../../src/ir/types/loom-ir.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { keyLookupMethodName } from "../../src/util/repository-contract.js";
import { buildLoomModel, enrichedContexts } from "../_helpers/ir.js";

const SRC = `
  system S { subdomain M { context C {
    aggregate Product with crudish, softDeletable {
      sku: string  name: string  region: string  price: int
      unique (sku)
      unique (region, name)
      operation reprice(to: int) { price := to }
    }
    repository Products for Product { }
    domainService Q {
      operation taken(sku: string): bool { return Products.findBy(sku: sku) != null }
    }
    workflow byKey {
      create(s: string, n: string, r: string) {
        let p = Products.getBy(sku: s)
        p.reprice(1)
        let q = Products.getBy(name: n, region: r) ignoring *
        q.reprice(2)
        if let o = Products.findBy(name: n, region: r) { o.reprice(3) }
      }
    }
  }}}`;

async function ctx(): Promise<EnrichedBoundedContextIR> {
  const loom = await buildLoomModel(SRC);
  const errs = validateLoomModel(loom).filter((d) => d.severity === "error");
  expect(errs).toEqual([]);
  return enrichedContexts(loom)[0]!;
}

function stmts(c: EnrichedBoundedContextIR): WorkflowStmtIR[] {
  return c.workflows[0]!.creates![0]!.statements;
}

function find(c: EnrichedBoundedContextIR, name: string): FindIR | undefined {
  return c.repositories[0]!.finds.find((f) => f.name === name);
}

describe("method naming", () => {
  it("joins the tuple's columns, and names the ignoring stance", () => {
    expect(keyLookupMethodName("findBy", ["sku"])).toBe("findBySku");
    expect(keyLookupMethodName("getBy", ["region", "name"])).toBe("getByRegionAndName");
    expect(keyLookupMethodName("getBy", ["sku"], { bypassAll: true })).toBe("getBySkuIgnoringAll");
    expect(
      keyLookupMethodName("getBy", ["sku"], { bypassCaps: ["tenantOwned", "softDeletable"] }),
    ).toBe("getBySkuIgnoringSoftDeletableAndTenantOwned");
  });
});

describe("lowering", () => {
  it("a `let` getBy is a load-by-key repo-let with the tuple's argument order", async () => {
    const c = await ctx();
    const [p, , q, , o] = stmts(c);
    expect(p).toMatchObject({
      kind: "repo-let",
      op: "load-by-key",
      method: "getBySku",
      key: { columns: ["sku"] },
      returnType: { kind: "entity", name: "Product" },
    });
    // `name:` was written first; the tuple declares `region` first.
    expect(q).toMatchObject({
      kind: "repo-let",
      op: "load-by-key",
      method: "getByRegionAndNameIgnoringAll",
      key: { columns: ["region", "name"], bypassAll: true },
    });
    expect((q as { args: { name?: string }[] }).args.map((a) => a.name)).toEqual(["r", "n"]);
    expect(o).toMatchObject({
      kind: "if-let",
      op: "load-by-key-optional",
      findMethod: "findByRegionAndName",
      key: { columns: ["region", "name"] },
    });
  });

  it("a domain-service read carries the op and key on its repo-read call", async () => {
    const c = await ctx();
    const body = c.domainServices![0]!.operations[0]!.body[0]!;
    expect(JSON.stringify(body)).toContain('"op":"load-by-key-optional"');
    expect(JSON.stringify(body)).toContain('"method":"findBySku"');
  });
});

describe("enrichment — one synthesized method per used (verb, tuple, stance)", () => {
  it("derives each method with its equality filter, return shape and stance", async () => {
    const c = await ctx();
    const get = find(c, "getBySku")!;
    expect(get).toMatchObject({
      synthesized: true,
      params: [{ name: "sku", type: { kind: "primitive", name: "string" } }],
      returnType: { kind: "entity", name: "Product" },
      filter: {
        kind: "binary",
        op: "==",
        left: { kind: "member", member: "sku" },
        right: { kind: "ref", name: "sku", refKind: "param" },
      },
    });
    expect(get.bypassAll).toBeUndefined();
    expect(find(c, "findBySku")).toMatchObject({
      returnType: { kind: "optional", inner: { kind: "entity", name: "Product" } },
    });
    expect(find(c, "getByRegionAndNameIgnoringAll")).toMatchObject({
      bypassAll: true,
      params: [{ name: "region" }, { name: "name" }],
      filter: { kind: "binary", op: "&&" },
    });
    expect(find(c, "findByRegionAndName")).toBeDefined();
    // Nothing nobody calls.
    expect(find(c, "findByRegionAndNameIgnoringAll")).toBeUndefined();
    expect(find(c, "getByRegionAndName")).toBeUndefined();
  });

  it("a getBy read can answer not-found", async () => {
    const c = await ctx();
    expect(workflowCanAnswerNotFound(c.workflows[0]!, c.repositories)).toBe(true);
  });
});

describe("ignoring on an `if let` source", () => {
  it("names its own method and carries the bypass onto it", async () => {
    const loom = await buildLoomModel(
      SRC.replace(
        "if let o = Products.findBy(name: n, region: r) {",
        "if let o = Products.findBy(name: n, region: r) ignoring softDeletable {",
      ),
    );
    const c = enrichedContexts(loom)[0]!;
    expect(stmts(c)[4]).toMatchObject({
      kind: "if-let",
      findMethod: "findByRegionAndNameIgnoringSoftDeletable",
    });
    expect(find(c, "findByRegionAndNameIgnoringSoftDeletable")).toMatchObject({
      bypassCaps: ["softDeletable"],
      synthesized: true,
    });
  });
});

describe("refused shapes", () => {
  it("getBy is not an `if let` source (it never answers absence)", async () => {
    const loom = await buildLoomModel(
      SRC.replace(
        "if let o = Products.findBy(name: n, region: r)",
        "if let o = Products.getBy(name: n, region: r)",
      ),
    ).catch((e: Error) => e);
    const codes =
      loom instanceof Error ? [loom.message] : validateLoomModel(loom).map((d) => d.code ?? "");
    expect(codes.join("\n")).toContain("loom.iflet-bad-source");
  });

  it("a findBy bound by a `let` binds `T?`, so an op-call on it un-narrowed is refused", async () => {
    const loom = await buildLoomModel(
      SRC.replace("let p = Products.getBy(sku: s)", "let p = Products.findBy(sku: s)"),
    ).catch((e: Error) => e);
    const codes =
      loom instanceof Error ? [loom.message] : validateLoomModel(loom).map((d) => d.code ?? "");
    expect(codes.join("\n")).toContain("loom.nullable-receiver");
  });
});
