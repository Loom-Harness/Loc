// Phase ⑥ composition of `policy` level rules and row rules (D-SHARING): the
// IR shape the five backends render.  What the composed scope DOES at runtime
// is the `policy-row-rules` corpus fixture's job; this pins the composition's
// structure — which slot it takes, what stays byte-neutral, and the negated
// fallback arm — none of which a booted tier can name.
import { describe, expect, it } from "vitest";
import type { AggregateIR, ExprIR } from "../../src/ir/types/loom-ir.js";
import { walkExprDeep } from "../../src/ir/util/walk.js";
import { buildLoomModel } from "../_helpers/ir.js";

const system = (policy: string, extra = "") => `
system S {
  user { id: string  tenantId: string  role: string }
  tenancy by user.tenantId of Org
  subdomain M {
    context C {
      aggregate Org with crudish { name: string }
      aggregate Doc with tenantOwned, auditable, crudish { title: string  owner: string }
      aggregate Tag with tenantOwned, crudish { doc: Doc id  grantee: string }
      ${extra}
      policy { ${policy} }
    }
  }
}`;

async function doc(policy: string): Promise<AggregateIR> {
  const m = await buildLoomModel(system(policy));
  return m.systems[0]!.subdomains[0]!.contexts[0]!.aggregates.find((a) => a.name === "Doc")!;
}

function kinds(e: ExprIR | undefined): string[] {
  const out: string[] = [];
  walkExprDeep(e, (x) => out.push(x.kind === "binary" ? x.op : x.kind));
  return out;
}

describe("policy scope composition", () => {
  it("leaves an aggregate with only `allow local` byte-neutral", async () => {
    const plain = await doc("");
    const local = await doc("allow local on Doc  allow write local on Doc");
    expect(local.contextFilters).toEqual(plain.contextFilters);
    expect(local.writeScopeFilter).toBeUndefined();
  });

  it("ORs a row rule into the tenantOwned slot and gives the aggregate a write scope", async () => {
    const plain = await doc("");
    const ruled = await doc(
      "allow on Doc as d where exists Tag as t where t.doc == d.id && t.grantee == currentUser.tenantId",
    );
    const slot = ruled.contextFilterOrigins.indexOf("tenantOwned");
    expect(slot).toBe(plain.contextFilterOrigins.indexOf("tenantOwned"));
    expect(ruled.contextFilters).toHaveLength(plain.contextFilters.length);
    const composed = ruled.contextFilters[slot]!;
    expect(composed.kind === "binary" && composed.op).toBe("||");
    expect(kinds(composed)).toContain("exists");
    // A read rule never widens writes: the write scope is the floor alone.
    expect(ruled.writeScopeFilter).toEqual(plain.contextFilters[slot]);
  });

  it("guards `when` arms and keeps `local` for the callers no `when` admits", async () => {
    const d = await doc(`allow own on Doc when currentUser.role == "clerk"`);
    const composed = d.contextFilters[d.contextFilterOrigins.indexOf("tenantOwned")]!;
    const ops = kinds(composed);
    expect(ops).toContain("==");
    // The negated fallback is pushed down to `!=`, never a `!` over a claim.
    expect(ops).toContain("!=");
    expect(ops).not.toContain("unary");
  });

  it("composes a registry row rule onto its self-scope", async () => {
    const m = await buildLoomModel(system(`allow on Org as o where o.name == currentUser.role`));
    const org = m.systems[0]!.subdomains[0]!.contexts[0]!.aggregates.find((a) => a.name === "Org")!;
    const slot = org.contextFilterOrigins.indexOf("tenancy");
    expect(slot).toBeGreaterThanOrEqual(0);
    const composed = org.contextFilters[slot]!;
    expect(composed.kind === "binary" && composed.op).toBe("||");
  });

  it("an unconditional `own` replaces `local` for every caller", async () => {
    const d = await doc("allow own on Doc");
    const ops = kinds(d.contextFilters[d.contextFilterOrigins.indexOf("tenantOwned")]);
    expect(ops).not.toContain("||");
    expect(ops.filter((o) => o === "==")).toHaveLength(2);
  });
});
