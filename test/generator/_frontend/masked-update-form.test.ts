// A generated client update form leaves a `mask unless` field out (#4845).
//
// The merge-patch `update` refuses a body that carries a masked key from a
// caller who cannot read it (the visibility taint's write gate), and keeps the
// stored value when the key is absent.  A form that asked for every field sent
// the masked one blank on every submit — once a silent overwrite, now a 403 —
// so every frontend's form (and the request schema, and the e2e page object)
// takes `operationFormParams`, which drops the masked keys.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const source = (frontend: string) => `
system R {
  user { id: string  permissions: string[] }
  auth { provider: keycloak  enforcement: opt  oidc { issuer: env("OIDC_ISSUER") clientId: env("OIDC_CLIENT_ID") audience: env("OIDC_AUDIENCE") } }
  subdomain S {
    permissions { readClinical }
    context C {
      aggregate Patient with crudish {
        fullName: string
        insuranceNo: string mask unless currentUser.permissions.contains(permissions.readClinical)
      }
      repository Patients for Patient
    }
  }
  api A from S
  storage db { type: postgres }
  resource st { for: C, kind: state, use: db }
  ui W with scaffold(subdomains: [S]) { api S: A }
  deployable api { platform: node contexts: [C] dataSources: [st] serves: A port: 3000 auth: required }
  deployable web { platform: ${frontend} targets: api ui: W { S: api } port: 3001 }
}`;

async function webFiles(frontend: string): Promise<string> {
  const files = await generateSystemFiles(source(frontend));
  return [...files]
    .filter(([p]) => p.startsWith("web/") && !/locales|\.arb$|\/i18n/.test(p))
    .map(([, c]) => c)
    .join("\n");
}

describe("generated update forms omit masked fields (#4845)", () => {
  it.each([
    "react",
    "vue",
    "svelte",
    "angular",
  ])("%s: no update input for the masked field, and the request key is optional", async (fe) => {
    const web = await webFiles(fe);
    expect(web).not.toContain("op-update-input-insuranceNo");
    // The unmasked field keeps its input.
    expect(web).toContain("op-update-input-fullName");
    expect(web).toMatch(/insuranceNo(?:\?: string;|: z\.string\(\)\.optional\(\))/);
  });

  it("feliz: the update form record carries no masked field", async () => {
    const web = await webFiles("feliz");
    const at = web.indexOf("type UpdatePatientOpForm =");
    expect(at).toBeGreaterThan(-1);
    const update = web.slice(at, web.indexOf("let empty", at));
    expect(update).toContain("fullName");
    expect(update).not.toContain("insuranceNo");
  });

  it("flutter: the update form sends no masked key", async () => {
    const web = await webFiles("flutter");
    const at = web.indexOf("class _UpdatePatientFormState");
    expect(at).toBeGreaterThan(-1);
    const update = web.slice(at, web.indexOf("\nclass ", at + 1));
    expect(update).toContain("'fullName'");
    expect(update).not.toContain("insuranceNo");
  });
});
