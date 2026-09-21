// `loom.unknown-user-claim` — `currentUser.<field>` where the field is NOT
// declared in the system's `user { … }` block.
//
// The defect this closes (audit `docs/audits/2026-09-10-claimshub-dev-experience.md`
// §D2): both member-typing sites — `type-system.ts`'s `lookupUserMember` and the
// IR layer's `memberType` — fail OPEN on the principal, resolving an unknown
// claim to `string`.  So `requires currentUser.totallyBogusField == "x"` parsed,
// validated and GENERATED clean, and the mistake surfaced only when the emitted
// project failed its own compile:
//
//     error TS2339: Property 'totallyBogusField' does not exist on type 'UserClaims'
//
// `UserClaims` is emitted from exactly these `user { }` fields
// (`platform/hono/*/auth-emit.ts`), so "declared in `user { }`" is the whole
// membership rule — which makes this checkable at the AST layer, where there is
// still a CST node to point at.
//
// FAIL-OPEN OBLIGATIONS, all pinned below:
//   • `orgPath` / `rootOrg` are DERIVED tenancy members, not claims — always OK
//     (referencing them without `tenancy by` is `loom.orgpath-without-tenancy`).
//   • the `tenantOwned` prelude capability splices `currentUser.tenantId` as a
//     placeholder that phase ⑥ rewrites to the declared claim — it is spliced
//     without a CST node, and only source-written accesses are judged.
//   • no `user { }` block in scope ⇒ `currentUser` is `unknown`, nothing fires.

import { describe, expect, it } from "vitest";
import { parseString } from "../../_helpers/index.js";

const wrap = (agg: string, opts: { user?: string; extra?: string } = {}) => `system S {
  user { ${opts.user ?? "id: string  role: string"} }
  subdomain M {
    permissions { approve, manage }
    context C {
      ${agg}
      ${opts.extra ?? ""}
    }
  }
}`;

const errs = async (agg: string, opts: { user?: string; extra?: string } = {}): Promise<string[]> =>
  (await parseString(wrap(agg, opts), { validate: true })).errors;

/** Only the new code's diagnostics — its wording is unique to it. */
const claimErrs = (e: string[]) => e.filter((s) => /is not a claim on the principal/.test(s));

describe("loom.unknown-user-claim — undeclared principal claim", () => {
  it("flags an undeclared claim in an operation `requires` gate", async () => {
    const e = await errs(`aggregate Widget with crudish { name: string
        operation touch() { requires currentUser.totallyBogusField == "x" } }`);
    expect(claimErrs(e), e.join("\n")).toHaveLength(1);
    expect(e.join("\n")).toMatch(/'totallyBogusField' is not a claim on the principal/);
    // The message names the claims that ARE declared, and the fix.
    expect(e.join("\n")).toMatch(/id, role/);
    expect(e.join("\n")).toMatch(/user \{ \}/);
    // ONE diagnostic for one mistake: `loom.unknown-member` must stay silent —
    // its fix ("correct the typo on the record") is the wrong advice here.
    expect(
      e.filter((s) => /is not a member of/.test(s)),
      e.join("\n"),
    ).toHaveLength(0);
  });

  it("flags the real-world trigger — a permission gate with no `permissions` claim", async () => {
    // `requires currentUser.permissions.contains(permissions.approve)` written
    // against a `user { }` that never declared `permissions: string[]`.  This
    // generated clean and broke the emitted backend's own compile.
    const e = await errs(`aggregate Widget with crudish { name: string
        operation approveIt() requires currentUser.permissions.contains(permissions.approve) { name := "a" } }`);
    expect(claimErrs(e), e.join("\n")).toHaveLength(1);
    expect(e.join("\n")).toMatch(/'permissions' is not a claim on the principal/);
  });

  it("flags an undeclared claim in a repository `find` gate", async () => {
    const e = await errs(`aggregate Ticket with crudish { status: string }`, {
      extra: `repository Tickets for Ticket {
        find secure(): Ticket[] requires currentUser.nickname == "x" where status == "open"
      }`,
    });
    expect(claimErrs(e), e.join("\n")).toHaveLength(1);
    expect(e.join("\n")).toMatch(/'nickname' is not a claim on the principal/);
  });

  it("reports the bad claim once, without cascading down the chain", async () => {
    const e = await errs(`aggregate Widget with crudish { name: string
        operation touch() { requires currentUser.bogus.deeper == "x" } }`);
    expect(claimErrs(e), e.join("\n")).toHaveLength(1);
  });

  // --- fail-open / no false positives -------------------------------------

  it("accepts every declared claim, including a non-string one", async () => {
    const e = await errs(
      `aggregate Widget with crudish { name: string
        operation touch() requires currentUser.permissions.contains(permissions.approve) { name := currentUser.role } }`,
      { user: "id: string  role: string  permissions: string[]" },
    );
    expect(claimErrs(e), e.join("\n")).toHaveLength(0);
  });

  it("accepts the derived `orgPath` / `rootOrg` tenancy members", async () => {
    const src = `system S {
  user { id: string  orgId: string }
  tenancy by user.orgId of Org
  subdomain M { context C {
    aggregate Org with crudish, tenantRegistry { name: string }
    aggregate Doc with crudish { title: string
      operation tag() { requires currentUser.orgPath != "" && currentUser.rootOrg != "" } }
    repository Docs for Doc { }
  } }
}`;
    const e = (await parseString(src, { validate: true })).errors;
    expect(claimErrs(e), e.join("\n")).toHaveLength(0);
  });

  it("does not flag the `tenantOwned` capability's `currentUser.tenantId` placeholder", async () => {
    // The prelude capability hardcodes `tenantId` on the principal side of its
    // stamp and filter; phase ⑥ (`bindTenancyClaim`) rewrites it to the
    // DECLARED claim — here `orgId`, which is deliberately NOT `tenantId`
    // (the shape of `test/fixtures/corpus/tenancy-claim-name.ddd`).  Judging
    // that spliced, CST-less node would fail every tenancy model in the corpus.
    const src = `system S {
  user { id: guid  orgId: string }
  tenancy by user.orgId of Organization
  subdomain Core {
    context Billing {
      aggregate Invoice with tenantOwned, crudish { number: string }
      repository Invoices for Invoice { }
    }
    context Accounts {
      aggregate Organization with crudish { name: string }
    }
  }
}`;
    const e = (await parseString(src, { validate: true })).errors;
    expect(claimErrs(e), e.join("\n")).toHaveLength(0);
  });

  it("does not fire when the model declares no `user { }` block", async () => {
    // Without a principal shape `currentUser` types as `unknown` — there is
    // nothing to check against, so the check must stay silent rather than
    // reporting every claim as absent.
    const src = `system S { subdomain M { context C {
      aggregate Widget with crudish { name: string
        operation touch() { requires currentUser.anything == "x" } }
      repository Widgets for Widget { }
    } } }`;
    const e = (await parseString(src, { validate: true })).errors;
    expect(claimErrs(e), e.join("\n")).toHaveLength(0);
  });
});
