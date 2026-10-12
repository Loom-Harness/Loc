// Eval item 22, ruling D5 — under `auth { enforcement: denyByDefault }` the
// aggregate LIST read (`GET /api/<plural>`, backed by the enrichment-injected
// `find all`) served every row to any authenticated caller with no diagnostic:
// an admin-gated create + operation and no explicit `find all` validated with
// only the by-id warning.  Now `loom.default-deny-list-ungated` (a WARNING, the
// by-id read's tier) names the route and the line that gates it.

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { type LoomDiagnostic, validateLoomModel } from "../../src/ir/validate/validate.js";
import { parseString } from "../_helpers/parse.js";

const CODE = "loom.default-deny-list-ungated";

async function diagnose(source: string): Promise<LoomDiagnostic[]> {
  const { model } = await parseString(source, { validate: false });
  return validateLoomModel(enrichLoomModel(lowerModel(model)));
}

function vault(opts: { enforcement?: string; repo?: string }): string {
  const enforcement = opts.enforcement ? `enforcement: ${opts.enforcement}  ` : "";
  return `
system S {
  user { id: guid  role: string }
  auth { ${enforcement}oidc { issuer: "https://idp.example.com"  clientId: "app" } }
  subdomain D { context Vault {
    aggregate Secret {
      body: string
      create() { requires currentUser.role == "admin" }
      operation reveal() requires currentUser.role == "admin" { body := body }
    }
    ${opts.repo ?? ""}
  } }
  api Api from D
  storage pg { type: postgres }
  resource st { for: Vault, kind: state, use: pg }
  deployable api { platform: node contexts: [Vault] dataSources: [st] serves: Api port: 3000 auth: required }
}`;
}

describe("loom.default-deny-list-ungated — the ungated list read is reported", () => {
  it("fires under denyByDefault when the list read is the injected `find all`", async () => {
    const diags = await diagnose(vault({ enforcement: "denyByDefault" }));
    expect(diags.filter((d) => d.severity === "error")).toEqual([]);
    const list = diags.filter((d) => d.code === CODE);
    expect(list).toHaveLength(1);
    expect(list[0]!.severity).toBe("warning");
    expect(list[0]!.source).toBe("Vault/Secret/all");
    // Names the route and the exact line that gates it.
    expect(list[0]!.message).toContain("GET /api/secrets");
    expect(list[0]!.message).toContain("find all(): Secret[] requires <expr>");
    expect(list[0]!.message).toContain("repository Secrets for Secret");
  });

  it("fires under the DEFAULT enforcement (an auth block with no `enforcement:`)", async () => {
    const diags = await diagnose(vault({}));
    expect(diags.filter((d) => d.code === CODE)).toHaveLength(1);
  });

  it("fires for an author-declared `find all` that carries no gate", async () => {
    const diags = await diagnose(
      vault({
        enforcement: "denyByDefault",
        repo: "repository Vaulted for Secret { find all(): Secret[] }",
      }),
    );
    const list = diags.filter((d) => d.code === CODE);
    expect(list).toHaveLength(1);
    expect(list[0]!.message).toContain("repository Vaulted for Secret");
  });

  it("is silenced by a gated explicit `find all`, or `requires true`", async () => {
    for (const gate of ['currentUser.role == "admin"', "true"]) {
      const diags = await diagnose(
        vault({
          enforcement: "denyByDefault",
          repo: `repository Secrets for Secret { find all(): Secret[] requires ${gate} }`,
        }),
      );
      expect(diags.filter((d) => d.code === CODE)).toEqual([]);
    }
  });

  it("is silent under `enforcement: opt`", async () => {
    const diags = await diagnose(vault({ enforcement: "opt" }));
    expect(diags.filter((d) => d.code === CODE)).toEqual([]);
  });
});
