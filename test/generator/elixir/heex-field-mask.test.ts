// `mask unless` on Phoenix LiveView pages (#3720) — the visibility taint's HEEx
// reader (`src/ir/enrich/mask-taint.ts`).  LiveView renders straight off the
// Ecto struct, which holds the CLEAR value, so every page read of a masked
// field (or a derived computed from one) applies the field's predicate against
// `@current_user`, nil-guarded — the same answer the JSON serializer gives the
// same principal.  The merge-patch update form renders the masked input only
// for a caller who can read it, so it neither pre-fills the clear value nor
// submits a key the mask write gate would refuse.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const SOURCE = `
system R {
  user { id: string  permissions: string[] }
  auth { provider: keycloak  enforcement: opt  oidc { issuer: env("OIDC_ISSUER") clientId: env("OIDC_CLIENT_ID") audience: env("OIDC_AUDIENCE") } }
  subdomain S {
    permissions { readClinical }
    context C {
      aggregate Patient with crudish {
        fullName: string
        insuranceNo: string mask unless currentUser.permissions.contains(permissions.readClinical)
        derived card: string = fullName + " / " + insuranceNo
      }
      repository Patients for Patient
    }
  }
  api A from S
  storage db { type: postgres }
  resource st { for: C, kind: state, use: db }
  ui W with scaffold(subdomains: [S]) { api S: A }
  deployable api { platform: elixir contexts: [C] dataSources: [st] serves: A port: 3000 auth: required ui: W { S: api } }
}`;

const PRED = `@current_user != nil and (Enum.member?(@current_user.permissions, "s.readClinical"))`;

function live(files: Map<string, string>, suffix: string): string {
  for (const [p, c] of files) if (p.endsWith(suffix)) return c;
  throw new Error(`no ${suffix}`);
}

describe("HEEx — mask unless on LiveView pages (#3720)", () => {
  it("the list and detail read a masked field only under its predicate", async () => {
    const files = await generateSystemFiles(SOURCE);
    const list = live(files, "live/patient_list_live.ex");
    const detail = live(files, "live/patient_detail_live.ex");
    expect(list).toContain(`(if ${PRED}, do: o.insurance_no, else: nil)`);
    expect(detail).toContain(`(if ${PRED}, do: @data.insurance_no, else: nil)`);
    // No bare read of the clear value survives anywhere on either page.
    for (const page of [list, detail]) {
      expect(page.replaceAll(/\(if [\s\S]*?, else: nil\)/g, "")).not.toMatch(
        /(?:o|@data)\.insurance_no\b/,
      );
    }
  });

  it("the update form renders the masked input only for a caller who can read it", async () => {
    const detail = live(await generateSystemFiles(SOURCE), "live/patient_detail_live.ex");
    expect(detail).toContain(`<%= if ${PRED} do %><.input field={@update_form[:insurance_no]}`);
    // The unmasked field's input stays unconditional.
    expect(detail).toMatch(/^\s*<\.input field=\{@update_form\[:full_name\]\}/m);
  });
});
