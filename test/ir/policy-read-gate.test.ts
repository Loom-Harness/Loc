// `policy { read X requires <expr> }` — who may read aggregate X.
//
// Lowering puts the rule on the context (`policyReadGates`); enrichment puts
// its gate on every read of X through the carrier the emitters already read —
// each declared find and the injected list read `all`, from which the by-id
// route (`byIdRouteFind`) and the audit history read take it.  Phase ⑦ keeps
// the old find gate's restriction (it runs before the load, so `currentUser`
// and constants only) and rejects a duplicate or unknown target.

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { deriveContextOperations } from "../../src/ir/util/api-surface.js";
import { byIdRouteFind, listReadGate } from "../../src/ir/util/read-gates.js";
import { type LoomDiagnostic, validateLoomModel } from "../../src/ir/validate/validate.js";
import { parseString } from "../_helpers/parse.js";

const src = (policy: string, repoBody = "find openOnes(): Ticket[] where open == true") => `
system Sys {
  user { id: string role: string }
  subdomain S {
    context Tickets {
      aggregate Ticket audited with crudish { subject: string open: bool }
      repository Tickets for Ticket {
        ${repoBody}
      }
      ${policy}
    }
  }
  storage primary { type: postgres }
  resource st { for: Tickets, kind: state, use: primary }
  api Api from S
  deployable api { platform: node contexts: [Tickets] serves: Api dataSources: [st] port: 8080 auth: required }
}
`;

async function enriched(source: string) {
  const { model } = await parseString(source, { validate: false });
  return enrichLoomModel(lowerModel(model));
}

async function diagnose(source: string): Promise<LoomDiagnostic[]> {
  return validateLoomModel(await enriched(source));
}

const GATE = 'policy { read Ticket requires currentUser.role == "agent" }';

describe("policy read gate — lowering and enrichment", () => {
  it("lowers the rule onto the context", async () => {
    const { model } = await parseString(src(GATE), { validate: false });
    const ctx = lowerModel(model).systems[0]!.subdomains[0]!.contexts[0]!;
    expect(ctx.policyReadGates).toHaveLength(1);
    expect(ctx.policyReadGates![0]!.aggregate).toBe("Ticket");
    expect(ctx.policyReadGates![0]!.gate.kind).toBe("binary");
    // A find declares no gate of its own.
    expect(ctx.repositories[0]!.finds[0]!.requires).toBeUndefined();
  });

  it("gates every read of the aggregate: each find, the list, the by-id and history", async () => {
    const ctx = (await enriched(src(GATE))).systems[0]!.subdomains[0]!.contexts[0]!;
    const repo = ctx.repositories.find((r) => r.aggregateName === "Ticket")!;
    const gate = JSON.stringify(ctx.policyReadGates![0]!.gate);
    expect(JSON.stringify(repo.finds.find((f) => f.name === "openOnes")!.requires)).toBe(gate);
    expect(JSON.stringify(listReadGate(repo))).toBe(gate);
    expect(JSON.stringify(repo.historyFind?.requires)).toBe(gate);
    const byId = byIdRouteFind(repo, "guid");
    expect(JSON.stringify(byId?.requires)).toBe(gate);
    expect(byId?.defaultDenied).toBeUndefined();
    // …and the derived route list hands that find to every backend.
    const op = deriveContextOperations(ctx).find((o) => o.kind === "getById");
    expect(JSON.stringify(op?.find?.requires)).toBe(gate);
  });

  it("each carrier is its own node (IR nodes are not shared)", async () => {
    const ctx = (await enriched(src(GATE))).systems[0]!.subdomains[0]!.contexts[0]!;
    const repo = ctx.repositories.find((r) => r.aggregateName === "Ticket")!;
    expect(listReadGate(repo)).not.toBe(repo.finds.find((f) => f.name === "openOnes")!.requires);
  });

  it("leaves another aggregate's reads alone, and an ungated model ungated", async () => {
    const ctx = (await enriched(src(""))).systems[0]!.subdomains[0]!.contexts[0]!;
    const repo = ctx.repositories.find((r) => r.aggregateName === "Ticket")!;
    expect(repo.finds.every((f) => f.requires === undefined)).toBe(true);
    expect(byIdRouteFind(repo, "guid")).toBeUndefined();
  });
});

describe("policy read gate — validation", () => {
  const codes = (diags: LoomDiagnostic[]) =>
    diags.filter((d) => d.severity === "error").map((d) => d.code);

  it("accepts a currentUser gate and `requires true`", async () => {
    expect(codes(await diagnose(src(GATE)))).toEqual([]);
    expect(codes(await diagnose(src("policy { read Ticket requires true }")))).toEqual([]);
  });

  it("rejects a gate referencing the source row (loom.policy-read-gate-not-current-user)", async () => {
    const diags = await diagnose(src("policy { read Ticket requires open == true }"));
    const hit = diags.filter((d) => d.code === "loom.policy-read-gate-not-current-user");
    expect(hit).toHaveLength(1);
    expect(hit[0]!.message).toContain("read Ticket requires");
    expect(hit[0]!.message).toContain("open");
    expect(hit[0]!.message).toContain("currentUser");
  });

  it("rejects two read gates for one aggregate (loom.policy-duplicate-target)", async () => {
    const diags = await diagnose(
      src("policy { read Ticket requires true\n read Ticket requires false }"),
    );
    expect(codes(diags)).toEqual(["loom.policy-duplicate-target"]);
  });

  it("rejects a gate naming no aggregate of the context (loom.policy-unknown-aggregate)", async () => {
    const diags = await diagnose(src("policy { read Ghost requires true }"));
    expect(codes(diags)).toEqual(["loom.policy-unknown-aggregate"]);
  });

  it("a non-bool gate is refused at the AST layer (loom.requires-not-bool)", async () => {
    const { diagnostics } = await parseString(src("policy { read Ticket requires 42 }"));
    expect(diagnostics.some((d) => d.code === "loom.requires-not-bool")).toBe(true);
  });
});
