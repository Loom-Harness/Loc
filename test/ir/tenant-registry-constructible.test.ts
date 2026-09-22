// A tenant registry nothing can create is a signup loop that cannot start.
//
// `tenancy by user.<claim> of <Registry>` makes the registry's id the tenant
// identity: a principal's claim IS a registry row's id.  So onboarding is
// create a registry row -> issue a token whose claim is that id -> read it
// back.  An aggregate with no `create` emits a read-only API, which breaks the
// loop at step one, and nothing said so (F-005).
//
// `docs/tenancy.md` promises exactly this bootstrap — "POST /organizations
// works for any authenticated principal … closing the signup loop" — while its
// own inline example omitted the `with crudish` that makes the route exist.
// The fixture that same doc cites as the end-to-end pin (`tenancy-owned.ddd`)
// declares it.  Both halves are fixed; this pins the check.
//
// WARNING, not error, and NARROW.  The same check written for every aggregate
// fires on 233 of 496 tracked `.ddd` — an aggregate with no create is
// ordinary — which would be noise, and noise trains people to ignore
// diagnostics.  Restricted to the registry it fires on 7, every one a genuine
// dead-end.
import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { parseString } from "../_helpers/parse.js";

const CODE = "loom.tenant-registry-not-constructible";

const sys = (registry: string, extra = "") => `
system Billder {
  user { id: guid  email: string  tenantId: string }
  tenancy by user.tenantId of Organization
  subdomain Billing {
    context Invoicing {
      aggregate Invoice with tenantOwned { number: string  amountDue: decimal }
      repository Invoices for Invoice { }
    }
    context Accounts {
      ${registry}
      repository Organizations for Organization { }
${extra}
    }
  }
  storage primary { type: postgres }
  resource a { for: Invoicing, kind: state, use: primary }
  resource b { for: Accounts, kind: state, use: primary }
  deployable api { platform: node, contexts: [Invoicing, Accounts], dataSources: [a, b], auth: required, port: 3000 }
}
`;

async function codes(source: string): Promise<string[]> {
  const { model } = await parseString(source, { validate: false });
  return validateLoomModel(enrichLoomModel(lowerModel(model))).map((d) => d.code ?? "");
}

describe("the tenant registry must be constructible", () => {
  it("warns when nothing can create one", async () => {
    expect(await codes(sys("aggregate Organization { name: string }"))).toContain(CODE);
  });

  it("is a WARNING, not an error — an out-of-band registry is coherent", async () => {
    const { model } = await parseString(sys("aggregate Organization { name: string }"), {
      validate: false,
    });
    const d = validateLoomModel(enrichLoomModel(lowerModel(model))).find((x) => x.code === CODE)!;
    expect(d.severity).toBe("warning");
  });

  it("a declared create satisfies it", async () => {
    expect(await codes(sys("aggregate Organization with crudish { name: string }"))).not.toContain(
      CODE,
    );
  });

  it("a SEED satisfies it — tenants may be provisioned out of band", async () => {
    // The message offers this as an alternative, so it has to be true.
    const withSeed = sys(
      "aggregate Organization { name: string }",
      `      seed { Organization { name: "Acme" } }`,
    );
    expect(await codes(withSeed)).not.toContain(CODE);
  });

  it("does not fire on an ordinary non-registry aggregate", async () => {
    // The whole reason the check is narrowed: `Invoice` in every fixture above
    // has no `create` either, and that is unremarkable.
    const out = await codes(sys("aggregate Organization with crudish { name: string }"));
    expect(out).not.toContain(CODE);
  });
});
