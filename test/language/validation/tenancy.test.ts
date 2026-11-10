// AST-level tenancy declaration checks (multi-tenancy Phase 1a, slice 1a.3 —
// https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/old/plans/multi-tenancy-implementation.md §1): duplicate `tenancy by`
// declarations, plus the LINKING errors that replaced the existence checks
// in 1b.1 — the claim / registry bindings are real cross-references now, so
// an unknown user field or aggregate is a parse-level "Could not resolve
// reference …" diagnostic (formerly `loom.tenancy-unknown-claim` /
// `loom.tenancy-registry-unknown`).  The stance checks need the merged IR
// and are covered by `test/ir/tenancy-checks.test.ts`.

import { describe, expect, it } from "vitest";
import { parseString } from "../../_helpers/parse.js";

describe("tenancy by — AST validation", () => {
  it("flags a second `tenancy by` declaration (loom.tenancy-duplicate)", async () => {
    const { errors } = await parseString(`
      system Billder {
        user { id: guid  tenantId: string  orgId: string }
        tenancy by user.tenantId of Organization
        tenancy by user.orgId of Organization
        subdomain Billing {
          context Accounts {
            aggregate Organization { name: string }
            repository Organizations for Organization { }
          }
        }
      }
    `);
    expect(errors.some((e) => /more than one 'tenancy by' line/.test(e))).toBe(true);
    // Only the extra is flagged — exactly one duplicate error for two decls.
    expect(errors.filter((e) => /more than one 'tenancy by'/.test(e))).toHaveLength(1);
  });

  it("a claim that is not a user field is a linking error (cross-ref since 1b.1)", async () => {
    const { errors } = await parseString(`
      system Billder {
        user { id: guid  email: string }
        tenancy by user.orgId of Organization
        subdomain Billing {
          context Accounts {
            aggregate Organization { name: string }
            repository Organizations for Organization { }
          }
        }
      }
    `);
    expect(
      errors.some((e) => /Could not resolve reference to UserField named 'orgId'/.test(e)),
    ).toBe(true);
  });

  it("a tenancy declaration without any user block is a linking error on the claim", async () => {
    const { errors } = await parseString(`
      system Billder {
        tenancy by user.tenantId of Organization
        subdomain Billing {
          context Accounts {
            aggregate Organization { name: string }
            repository Organizations for Organization { }
          }
        }
      }
    `);
    // No `user { … }` block ⇒ the claim scope is empty ⇒ the reference
    // cannot link.  Same fix as before: declare the claim field.
    expect(
      errors.some((e) => /Could not resolve reference to UserField named 'tenantId'/.test(e)),
    ).toBe(true);
  });

  it("a registry naming no aggregate is a linking error (cross-ref since 1b.1)", async () => {
    const { errors } = await parseString(`
      system Billder {
        user { id: guid  tenantId: string }
        tenancy by user.tenantId of Organization
        subdomain Billing {
          context Invoicing {
            aggregate Invoice with tenantOwned { number: string }
            repository Invoices for Invoice { }
          }
        }
      }
    `);
    expect(
      errors.some((e) => /Could not resolve reference to Aggregate named 'Organization'/.test(e)),
    ).toBe(true);
  });

  it("does not offer user fields outside the tenancy claim position (targeted scope)", async () => {
    // A bare user-field name in a type position must NOT resolve to the
    // `user { … }` field — the scope arm is claim-slot-only.
    const { errors } = await parseString(`
      system Billder {
        user { id: guid  tenantId: string }
        subdomain Billing {
          context Accounts {
            aggregate Organization { field: tenantId }
            repository Organizations for Organization { }
          }
        }
      }
    `);
    // A type position that does not resolve — `tenantId` is a user CLAIM, not
    // a field type — reports as "Unknown type" (`ddd-linker.ts`).
    expect(errors.some((e) => /Unknown type 'tenantId'/.test(e))).toBe(true);
  });

  it("accepts a single tenancy declaration whose claim is a declared user field", async () => {
    const { errors } = await parseString(`
      system Billder {
        user { id: guid  email: string  tenantId: string }
        tenancy by user.tenantId of Organization
        subdomain Billing {
          context Accounts {
            aggregate Organization { name: string }
            aggregate Invoice with tenantOwned { number: string }
            repository Organizations for Organization { }
            repository Invoices for Invoice { }
          }
        }
      }
    `);
    expect(errors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The removed materialized-path surface (D-TENANCY-FLAT).  Each read gets a
// named error with its replacement instead of a generic unknown name/member.
// ---------------------------------------------------------------------------

const removedSurface = (body: string, user = "id: guid  tenantId: string"): string => `
  system Shop {
    user { ${user} }
    tenancy by user.tenantId of Org
    subdomain S {
      context C {
        aggregate Doc with tenantOwned {
          owner: string?
          ${body}
        }
        aggregate Org { name: string  implements tenantRegistry }
        repository Docs for Doc { }
        repository Orgs for Org { }
      }
    }
  }
`;

async function codesOf(src: string): Promise<string[]> {
  const { diagnostics } = await parseString(src);
  return diagnostics
    .filter((d) => d.severity === 1)
    .map((d) => String(d.code))
    .sort();
}

describe("the removed materialized-path surface — AST validation", () => {
  it.each([
    "operation m() { owner := currentUser.orgPath }",
    "operation m() { owner := currentUser.rootOrg }",
    "operation m() { owner := organizationContext.orgPath }",
  ])("`%s` → loom.tenancy-principal-member-removed, and nothing else", async (body) => {
    expect(await codesOf(removedSurface(body))).toEqual(["loom.tenancy-principal-member-removed"]);
  });

  it.each([
    'operation m() { dataKey := "x" }',
    "operation m() { owner := dataKey }",
    "filter this.dataKey == currentUser.tenantId",
  ])("`%s` → loom.tenancy-data-key-removed, and nothing else", async (body) => {
    expect(await codesOf(removedSurface(body))).toEqual(["loom.tenancy-data-key-removed"]);
  });

  it("a `user { }` claim named `orgPath` is an ordinary declared claim", async () => {
    expect(
      await codesOf(
        removedSurface(
          "operation m() { owner := currentUser.orgPath }",
          "id: guid  tenantId: string  orgPath: string",
        ),
      ),
    ).toEqual([]);
  });
});
