// `ignoring …` on `Repo.find(<Criterion>)` / `Repo.findById(id)` through
// lowering, enrichment and IR validation.
//
// The widened read names a method of its own (`bypassReadMethodName`) and
// carries a `BypassReadIR`; enrichment derives that method as a `synthesized`
// find with the read's stance, so every backend's find emitter drops exactly
// the filters it names.  The plain `find(C)` keeps riding the criterion's
// shared `findAllBy<C>` retrieval.

import { describe, expect, it } from "vitest";
import type {
  EnrichedBoundedContextIR,
  ExprIR,
  FindIR,
  WorkflowStmtIR,
} from "../../src/ir/types/loom-ir.js";
import { walkStmtExprsDeep } from "../../src/ir/util/walk.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { bypassReadMethodName } from "../../src/util/repository-contract.js";
import { buildLoomModel, buildLoomModelUnchecked, enrichedContexts } from "../_helpers/ir.js";

const SRC = `
  system S { subdomain M { context C {
    aggregate Product with crudish, softDeletable {
      sku: string  region: string  price: int
      operation reprice(to: int) { price := to }
    }
    repository Products for Product { }
    criterion InRegion(region: string) of Product = this.region == region
    domainService Q {
      operation ever(id: Product id): bool { return Products.findById(id) ignoring softDeletable != null }
      operation used(r: string): bool { return Products.find(InRegion(r)) ignoring * != null }
    }
    workflow w {
      create(r: string) {
        if let p = Products.find(InRegion(r)) ignoring softDeletable { p.reprice(1) }
        if let q = Products.find(InRegion(r)) { q.reprice(2) }
      }
    }
  }}}`;

async function ctx(src = SRC): Promise<EnrichedBoundedContextIR> {
  const loom = await buildLoomModel(src);
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

function serviceReads(c: EnrichedBoundedContextIR): ExprIR[] {
  const out: ExprIR[] = [];
  for (const op of c.domainServices![0]!.operations) {
    for (const st of op.body) {
      walkStmtExprsDeep(st, (e) => {
        if (e.kind === "call" && e.callKind === "repo-read") out.push(e);
      });
    }
  }
  return out;
}

describe("method naming", () => {
  it("names the source and the stance; capability order never changes the name", () => {
    expect(bypassReadMethodName({ kind: "id" }, { bypassAll: true })).toBe("findByIdIgnoringAll");
    expect(
      bypassReadMethodName(
        { kind: "criterion", name: "InRegion" },
        { bypassCaps: ["tenantOwned", "softDeletable"] },
      ),
    ).toBe("findFirstInRegionIgnoringSoftDeletableAndTenantOwned");
  });
});

describe("lowering", () => {
  it("a widened `if let` source calls its own method and runs no retrieval", async () => {
    const [widened, plain] = stmts(await ctx());
    expect(widened).toMatchObject({
      kind: "if-let",
      op: "select-one",
      findMethod: "findFirstInRegionIgnoringSoftDeletable",
      retrievalName: "",
      synthCriterion: { name: "InRegion" },
      bypassRead: {
        source: { kind: "criterion", name: "InRegion" },
        bypassCaps: ["softDeletable"],
      },
    });
    expect(plain).toMatchObject({ kind: "if-let", retrievalName: "findAllByInRegion" });
    expect(plain).not.toHaveProperty("findMethod");
    expect(plain).not.toHaveProperty("bypassRead");
  });

  it("a domain-service read names the widened method, with no retrieval", async () => {
    const [byId, crit] = serviceReads(await ctx());
    expect(byId).toMatchObject({
      repoRead: {
        op: "load-optional",
        method: "findByIdIgnoringSoftDeletable",
        bypassRead: { source: { kind: "id" }, bypassCaps: ["softDeletable"] },
      },
    });
    expect(crit).toMatchObject({
      repoRead: {
        op: "select-one",
        method: "findFirstInRegionIgnoringAll",
        bypassRead: { source: { kind: "criterion", name: "InRegion" }, bypassAll: true },
      },
    });
    expect(crit.kind === "call" && crit.repoRead?.retrievalName).toBeFalsy();
  });
});

describe("enrichment", () => {
  it("derives one synthesized find per widened read, with its stance", async () => {
    const c = await ctx();
    expect(find(c, "findFirstInRegionIgnoringSoftDeletable")).toMatchObject({
      params: [{ name: "region" }],
      returnType: { kind: "optional", inner: { kind: "entity", name: "Product" } },
      criterionRef: { name: "InRegion" },
      bypassCaps: ["softDeletable"],
      takeFirst: true,
      synthesized: true,
    });
    expect(find(c, "findFirstInRegionIgnoringAll")).toMatchObject({ bypassAll: true });
    const byId = find(c, "findByIdIgnoringSoftDeletable");
    expect(byId).toMatchObject({
      params: [{ name: "id", type: { kind: "id", targetName: "Product" } }],
      filter: {
        kind: "binary",
        op: "==",
        left: { kind: "member", member: "id" },
        right: { kind: "ref", name: "id", refKind: "param" },
      },
      bypassCaps: ["softDeletable"],
      synthesized: true,
    });
    expect(byId).not.toHaveProperty("takeFirst");
    // The plain read still materialises the shared retrieval.
    expect(c.retrievals.map((r) => r.name)).toContain("findAllByInRegion");
  });
});

describe("validation", () => {
  it("a widened `find(C)` still checks its criterion", async () => {
    // Phase ④ refuses the arity too; the subject here is that the phase-⑦
    // criterion checks are not skipped for a source that has a `findMethod`.
    const loom = await buildLoomModelUnchecked(
      SRC.replace(
        "if let p = Products.find(InRegion(r)) ignoring softDeletable",
        "if let p = Products.find(InRegion(r, r)) ignoring softDeletable",
      ),
      "the AST arity check also fires; this pins the IR-level one behind it",
    );
    const codes = validateLoomModel(loom)
      .filter((d) => d.severity === "error")
      .map((d) => d.code);
    expect(codes).toContain("loom.findall-criterion-arity");
  });
});
