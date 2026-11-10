// `allow share on X` (D-SHARING) gates the lifecycle of X's share aggregate:
// its canonical `create` and its `revoke` operation each lead with the rules'
// conditions as a `requires`.  What the gate DOES on a booted app (403 for a
// caller it refuses) is the `shareable` fixture's job
// (`test/e2e/tenancy-org-context.test.ts`); this pins the derived statement —
// which operations carry it, and the deny-by-default with no rule — that no
// booted tier can name.
import { describe, expect, it } from "vitest";
import type { AggregateIR, ExprIR } from "../../src/ir/types/loom-ir.js";
import { buildLoomModel } from "../_helpers/ir.js";

const system = (policy: string) => `
system S {
  user { id: string  tenantId: string  role: string }
  tenancy by user.tenantId of Org
  subdomain M {
    context C {
      aggregate Org with crudish { name: string  implements tenantRegistry }
      aggregate Doc with tenantOwned, shareable, crudish { title: string }
      ${policy}
    }
  }
}`;

async function share(policy: string): Promise<AggregateIR> {
  const m = await buildLoomModel(system(policy));
  return m.systems[0]!.subdomains[0]!.contexts[0]!.aggregates.find((a) => a.name === "DocShare")!;
}

function gate(agg: AggregateIR, op: "create" | "revoke"): ExprIR | undefined {
  const action = op === "create" ? agg.creates[0] : agg.operations.find((o) => o.name === op);
  const first = action?.statements[0];
  return first?.kind === "requires" ? first.expr : undefined;
}

describe("allow share on X", () => {
  it("unfolds the share aggregate with a create and a revoke", async () => {
    const s = await share("");
    expect(s.capabilities).toContain("tenantOwned");
    expect(s.fields.map((f) => f.name)).toEqual(
      expect.arrayContaining(["doc", "granteeKind", "org", "user", "write", "revoked"]),
    );
    expect(s.operations.map((o) => o.name)).toContain("revoke");
  });

  it("denies sharing when no rule names the aggregate", async () => {
    const s = await share("");
    expect(gate(s, "create")).toEqual({ kind: "literal", lit: "bool", value: "false" });
    expect(gate(s, "revoke")).toEqual({ kind: "literal", lit: "bool", value: "false" });
  });

  it("gates create and revoke on the rule's caller condition", async () => {
    const s = await share(`policy { allow share on Doc when currentUser.role == "manager" }`);
    for (const op of ["create", "revoke"] as const) {
      const g = gate(s, op);
      expect(g?.kind === "binary" && g.op).toBe("==");
    }
  });

  it("an unconditional rule admits every caller", async () => {
    const s = await share("policy { allow share on Doc }");
    expect(gate(s, "create")).toEqual({ kind: "literal", lit: "bool", value: "true" });
  });

  it("requires write access to the row in the sharer's org, as one synthesized read per gate", async () => {
    const m = await buildLoomModel(
      system(`policy {
        allow share on Doc when currentUser.role == "manager"
        allow write own on Doc when currentUser.role == "manager"
      }`).replace("tenantOwned, shareable", "tenantOwned, auditable, shareable"),
    );
    const ctx = m.systems[0]!.subdomains[0]!.contexts[0]!;
    const s = ctx.aggregates.find((a) => a.name === "DocShare")!;
    for (const op of ["create", "revoke"] as const) {
      const action = op === "create" ? s.creates[0]! : s.operations.find((o) => o.name === op)!;
      const req = action.statements[1];
      expect(req?.kind === "requires" && req.expr.kind === "exists" && req.expr.forWrite).toBe(
        true,
      );
    }
    const reads = ctx.repositories
      .flatMap((r) => r.finds)
      .filter((f) => f.name.startsWith("existsForDocShare"));
    // One read per gate: the share rule nested in Doc's write scope is part of
    // that read's filter, never a read of its own.
    expect(reads.map((f) => f.name).sort()).toEqual([
      "existsForDocShareCreate0",
      "existsForDocShareRevoke0",
    ]);
    const gateRead = (op: "create" | "revoke") => {
      const action = op === "create" ? s.creates[0]! : s.operations.find((o) => o.name === op)!;
      const req = action.statements[1]!;
      return req.kind === "requires" && req.expr.kind === "exists" ? req.expr.read : undefined;
    };
    for (const op of ["create", "revoke"] as const) {
      const read = gateRead(op)!;
      // Only the gate's own values are lifted: no argument names a quantified
      // row (the nested share's `s`), and the find keeps the write level's
      // principal test, so the request principal is passed last.
      for (const a of read.args) expect(JSON.stringify(a)).not.toContain('"refKind":"row"');
      expect(read.args.at(-1)).toMatchObject({ kind: "ref", refKind: "current-user" });
    }
  });
});
