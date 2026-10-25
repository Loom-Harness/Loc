// F-009 — under `auth { enforcement: denyByDefault }` the synthesised
// `GET /api/<plural>/{id}` carries no authorization gate on any backend, and
// before `loom.default-deny-by-id-ungated` the model validated
// "0 error(s), 0 warning(s)": the LIST of secrets was admin-only and an
// INDIVIDUAL secret was readable by anyone holding (or guessing) an id.
//
// The by-id read is gated by the aggregate's read gate —
// `policy { read T requires <expr> }`, the same line that gates the list read
// and every find — and an UNGATED one fails closed at runtime (403 on every
// backend, via the deny gate enrichment synthesises).  The diagnostic stays a
// WARNING for one release (owner decision 2026-10-11) so existing models keep
// building.  A read gate silences it.  See the call-site comment in
// `src/ir/validate/checks/default-deny-checks.ts`.

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { deriveContextOperations } from "../../src/ir/util/api-surface.js";
import { type LoomDiagnostic, validateLoomModel } from "../../src/ir/validate/validate.js";
import { parseString } from "../_helpers/parse.js";

const CODE = "loom.default-deny-by-id-ungated";

async function diagnose(source: string): Promise<LoomDiagnostic[]> {
  const { model } = await parseString(source, { validate: false });
  return validateLoomModel(enrichLoomModel(lowerModel(model)));
}

/** Every command gated admin-only; the reads gated only when `readGate` is
 *  given (the policy line), so without it the by-id read is ungated. */
function vault(opts: {
  enforcement: string;
  authRequired?: boolean;
  readGate?: string;
  finds?: string;
}): string {
  return `
system S {
  user { id: guid  role: string }
  auth { enforcement: ${opts.enforcement}  oidc { issuer: "https://idp.example.com"  clientId: "app" } }
  subdomain D { context Vault {
    aggregate Secret {
      body: string
      create() { requires currentUser.role == "admin" }
    }
    repository Secrets for Secret { ${opts.finds ?? ""} }
    ${opts.readGate ? `policy { read Secret requires ${opts.readGate} }` : ""}
  } }
  api Api from D
  storage pg { type: postgres }
  resource st { for: Vault, kind: state, use: pg }
  deployable api { platform: node contexts: [Vault] dataSources: [st] serves: Api port: 3000${opts.authRequired === false ? "" : " auth: required"} }
}`;
}

describe("loom.default-deny-by-id-ungated — the ungated by-id read warns (and 403s at runtime)", () => {
  it("fires under denyByDefault on an aggregate with no read gate", async () => {
    const diags = await diagnose(vault({ enforcement: "denyByDefault" }));
    // Non-breaking for one release: NOTHING is an error.
    expect(diags.filter((d) => d.severity === "error")).toEqual([]);
    const byId = diags.filter((d) => d.code === CODE);
    expect(byId).toHaveLength(1);
    expect(byId[0]!.severity).toBe("warning");
    // Says plainly what happens now, what fixes it, and what happens later.
    expect(byId[0]!.message).toContain("REFUSED AT RUNTIME (403)");
    expect(byId[0]!.message).toContain("policy { read Secret requires <expr> }");
    expect(byId[0]!.message).toContain("enforcement: opt");
    expect(byId[0]!.message).toContain("becomes an error in a later release");
    // Names the aggregate AND the exact route, so the reader can check it.
    expect(byId[0]!.message).toContain("Secret");
    expect(byId[0]!.message).toContain("/api/secrets/{id}");
  });

  it("reports once per non-abstract aggregate, and never for the abstract base", async () => {
    const diags = await diagnose(`
system S {
  user { id: guid  role: string }
  auth { enforcement: denyByDefault  oidc { issuer: "https://idp.example.com"  clientId: "app" } }
  subdomain Fleet { context Vehicles {
    abstract aggregate Vehicle { name: string }
    aggregate Car extends Vehicle { doors: int }
    aggregate Van extends Vehicle { volume: int }
    repository Cars for Car { }
    repository Vans for Van { }
  } }
  api Api from Fleet
  storage pg { type: postgres }
  resource st { for: Vehicles, kind: state, use: pg }
  deployable api { platform: node contexts: [Vehicles] dataSources: [st] serves: Api port: 3000 auth: required }
}`);
    const named = diags.filter((d) => d.code === CODE).map((d) => d.source);
    expect(named.sort()).toEqual(["Vehicles/Car", "Vehicles/Van"]);
  });

  it("is satisfied by the policy read gate", async () => {
    const source = vault({ enforcement: "denyByDefault", readGate: 'currentUser.role == "admin"' });
    const diags = await diagnose(source);
    expect(diags.filter((d) => d.severity === "error")).toEqual([]);
    expect(diags.filter((d) => d.code === CODE)).toEqual([]);
    // …and the by-id route carries THAT gate, not the synthesised deny.
    const { model } = await parseString(source, { validate: false });
    const ctx = enrichLoomModel(lowerModel(model)).systems[0]!.subdomains[0]!.contexts[0]!;
    const op = deriveContextOperations(ctx).find((o) => o.kind === "getById");
    expect(op?.find?.defaultDenied).toBeUndefined();
    expect(op?.find?.requires?.kind).toBe("binary");
  });

  it("is satisfied by `requires true` — the explicit public escape", async () => {
    const diags = await diagnose(
      vault({
        enforcement: "denyByDefault",
        readGate: "true",
      }),
    );
    expect(diags.filter((d) => d.severity === "error")).toEqual([]);
  });

  it("the undeclared by-id read carries the synthesised DENY gate (runtime 403)", async () => {
    const { model } = await parseString(vault({ enforcement: "denyByDefault" }), {
      validate: false,
    });
    const loom = enrichLoomModel(lowerModel(model));
    const ctx = loom.systems[0]!.subdomains[0]!.contexts[0]!;
    const repo = ctx.repositories.find((r) => r.aggregateName === "Secret");
    expect(repo?.readsDefaultDenied).toBe(true);
    const op = deriveContextOperations(ctx).find((o) => o.kind === "getById");
    expect(op?.find?.defaultDenied).toBe(true);
    expect(op?.find?.requires).toEqual({ kind: "literal", lit: "bool", value: "false" });
    // …and an `enforcement: opt` model serves it ungated, as before.
    const { model: optModel } = await parseString(vault({ enforcement: "opt" }), {
      validate: false,
    });
    const optCtx = enrichLoomModel(lowerModel(optModel)).systems[0]!.subdomains[0]!.contexts[0]!;
    expect(deriveContextOperations(optCtx).find((o) => o.kind === "getById")?.find).toBeUndefined();
  });

  it("a declared `find byId` with no read gate is refused (once, as a find)", async () => {
    const diags = await diagnose(
      vault({ enforcement: "denyByDefault", finds: "find byId(id: Secret id): Secret?" }),
    );
    const errors = diags.filter((d) => d.severity === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0]!.code).toBe("loom.default-deny-ungated");
    expect(errors[0]!.message).toContain("Secrets.byId");
    expect(errors[0]!.message).toContain("policy { read Secret requires <expr> }");
  });

  it("a `find byId` of a different SHAPE is not the by-id read", async () => {
    // Recognition is by name AND shape — `byId` returning a list is an
    // ordinary find and does not gate `GET /secrets/{id}`.
    const diags = await diagnose(
      vault({
        enforcement: "denyByDefault",
        finds: "find byId(id: Secret id): Secret[] where this.id == id",
      }),
    );
    expect(diags.filter((d) => d.code === CODE)).toHaveLength(1);
  });

  // --- non-vacuity ---------------------------------------------------------

  it("stays silent under the default `enforcement: opt`", async () => {
    const diags = await diagnose(vault({ enforcement: "opt" }));
    expect(diags.filter((d) => d.code === CODE)).toEqual([]);
  });

  it("stays silent when no `auth: required` deployable hosts the context", async () => {
    const diags = await diagnose(vault({ enforcement: "denyByDefault", authRequired: false }));
    expect(diags.filter((d) => d.code === CODE)).toEqual([]);
  });
});
