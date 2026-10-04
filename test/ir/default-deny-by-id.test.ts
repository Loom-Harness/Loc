// F-009 — under `auth { enforcement: denyByDefault }` the synthesised
// `GET /api/<plural>/{id}` carries no authorization gate on any backend, and
// before `loom.default-deny-by-id-ungated` the model validated
// "0 error(s), 0 warning(s)": the LIST of secrets was admin-only and an
// INDIVIDUAL secret was readable by anyone holding (or guessing) an id.
//
// It was a WARNING while the by-id read had no author surface.  M-T3.19 gave
// it one — `find byId(id: T id): T? requires <expr>` in the repository, the
// same spelling the list read's `find all` gate uses — so it is now an ERROR
// (fail closed: the build is refused rather than the route served open), and
// a declared gate silences it.  See the call-site comment in
// `src/ir/validate/checks/default-deny-checks.ts`.

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { type LoomDiagnostic, validateLoomModel } from "../../src/ir/validate/validate.js";
import { parseString } from "../_helpers/parse.js";

const CODE = "loom.default-deny-by-id-ungated";

async function diagnose(source: string): Promise<LoomDiagnostic[]> {
  const { model } = await parseString(source, { validate: false });
  return validateLoomModel(enrichLoomModel(lowerModel(model)));
}

/** The repro: every command AND the list read gated admin-only, so the only
 *  ungated surface left is the by-id read. */
function vault(opts: { enforcement: string; authRequired?: boolean; byId?: string }): string {
  return `
system S {
  user { id: guid  role: string }
  auth { enforcement: ${opts.enforcement}  oidc { issuer: "https://idp.example.com"  clientId: "app" } }
  subdomain D { context Vault {
    aggregate Secret {
      body: string
      create() { requires currentUser.role == "admin" }
    }
    repository Secrets for Secret {
      find all(): Secret[] requires currentUser.role == "admin"${opts.byId ? `\n      ${opts.byId}` : ""}
    }
  } }
  api Api from D
  storage pg { type: postgres }
  resource st { for: Vault, kind: state, use: pg }
  deployable api { platform: node contexts: [Vault] dataSources: [st] serves: Api port: 3000${opts.authRequired === false ? "" : " auth: required"} }
}`;
}

describe("loom.default-deny-by-id-ungated — the ungated by-id read refuses the build", () => {
  it("fires under denyByDefault on an aggregate whose every other surface IS gated", async () => {
    const diags = await diagnose(vault({ enforcement: "denyByDefault" }));
    const errors = diags.filter((d) => d.severity === "error");
    expect(errors.map((d) => d.code)).toEqual([CODE]);
    const byId = diags.filter((d) => d.code === CODE);
    expect(byId).toHaveLength(1);
    expect(byId[0]!.severity).toBe("error");
    // The remedy names a surface that exists.
    expect(byId[0]!.message).toContain("find byId(id: Secret id): Secret? requires <expr>");
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
    repository Cars for Car { find all(): Car[] requires true }
    repository Vans for Van { find all(): Van[] requires true }
  } }
  api Api from Fleet
  storage pg { type: postgres }
  resource st { for: Vehicles, kind: state, use: pg }
  deployable api { platform: node contexts: [Vehicles] dataSources: [st] serves: Api port: 3000 auth: required }
}`);
    const named = diags.filter((d) => d.code === CODE).map((d) => d.source);
    expect(named.sort()).toEqual(["Vehicles/Car", "Vehicles/Van"]);
  });

  it("is satisfied by a gated `find byId` — the M-T3.19 surface", async () => {
    const diags = await diagnose(
      vault({
        enforcement: "denyByDefault",
        byId: 'find byId(id: Secret id): Secret? requires currentUser.role == "admin"',
      }),
    );
    expect(diags.filter((d) => d.severity === "error")).toEqual([]);
    expect(diags.filter((d) => d.code === CODE)).toEqual([]);
  });

  it("is satisfied by `requires true` — the explicit public escape", async () => {
    const diags = await diagnose(
      vault({ enforcement: "denyByDefault", byId: "find byId(id: Secret id): Secret? requires true" }),
    );
    expect(diags.filter((d) => d.severity === "error")).toEqual([]);
  });

  it("a declared but UNGATED `find byId` is still refused (once, as a find)", async () => {
    const diags = await diagnose(
      vault({ enforcement: "denyByDefault", byId: "find byId(id: Secret id): Secret?" }),
    );
    const errors = diags.filter((d) => d.severity === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0]!.code).toBe("loom.default-deny-ungated");
    expect(errors[0]!.message).toContain("Secrets.byId");
  });

  it("a `find byId` of a different SHAPE is not the by-id read", async () => {
    // Recognition is by name AND shape — `byId` returning a list is an
    // ordinary find and does not gate `GET /secrets/{id}`.
    const diags = await diagnose(
      vault({
        enforcement: "denyByDefault",
        byId: "find byId(id: Secret id): Secret[] requires true where this.id == id",
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
