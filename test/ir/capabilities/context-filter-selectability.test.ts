// Phase 1 of "criterion everywhere — full filter targeting".
//
// A `filter <expr>` capability predicate lowers to
// `AggregateIR.contextFilters` and is installed at the query layer by
// every backend (.NET `HasQueryFilter`, Drizzle read-site conjunction,
// Ecto base query).  That makes it a SELECTION position, so the
// predicate must lower to the same queryable subset as a `find` / `view`
// `where` — the validator now runs it through the shared selectability
// oracle (`firstNonQueryableNode`) and emits
// `loom.criterion-not-selectable` when it can't.
//
// `currentUser.<scalar>` is admitted here (row-level soft-delete /
// tenancy filters are the motivating case); behavioural expressions
// (calls, collection ops) are rejected.

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../../src/ir/lower/lower.js";
import { validateLoomModel } from "../../../src/ir/validate/validate.js";
import { parseString } from "../../_helpers/parse.js";

async function filterDiags(source: string): Promise<string[]> {
  const { model } = await parseString(source, { validate: false });
  return validateLoomModel(enrichLoomModel(lowerModel(model)))
    .filter((d) => d.severity === "error" && d.code === "loom.criterion-not-selectable")
    .map((d) => d.message);
}

describe("filter-capability selectability validation", () => {
  it("accepts a column predicate (`filter !this.isDeleted`)", async () => {
    const diags = await filterDiags(`
      system Demo {
        subdomain M { context C {
          aggregate Doc {
            subject: string
            isDeleted: bool
            filter !this.isDeleted
          }
        }}
      }
    `);
    expect(diags).toEqual([]);
  });

  it("accepts a `currentUser.<scalar>` predicate (row-level tenancy)", async () => {
    const diags = await filterDiags(`
      system Demo {
        user { id: string  tenantId: string }
        subdomain M { context C {
          aggregate Doc {
            subject: string
            tenantId: string
            filter this.tenantId == currentUser.tenantId
          }
        }}
      }
    `);
    expect(diags).toEqual([]);
  });

  it("rejects a non-selectable predicate (a function call) with loom.criterion-not-selectable", async () => {
    const diags = await filterDiags(`
      system Demo {
        subdomain M { context C {
          aggregate Doc {
            subject: string
            score: int
            function computeRisk(): int = score + 1
            filter this.computeRisk() > 5
          }
        }}
      }
    `);
    expect(diags.length).toBe(1);
    expect(diags[0]).toContain("not selectable");
  });

  it("rejects a predicate over an unknown field", async () => {
    const diags = await filterDiags(`
      system Demo {
        subdomain M { context C {
          aggregate Doc {
            subject: string
            filter !this.isDeleted
          }
        }}
      }
    `);
    expect(diags.length).toBe(1);
    expect(diags[0]).toContain("unknown field");
  });

  // A PRINCIPAL TERM — a column-free `==` / `!=` over `currentUser.<claim>`
  // and a literal / enum value / claim — is admitted in a capability filter
  // only (`principalTerm`); every backend decides it against the request
  // principal.  It is what lets one row filter say "agents see every row,
  // customers see their own", which also covers the synthesised by-id read.
  const ROLE_USER = `user { id: string  role: string  tier: Tier?  age: int  customerId: Customer id? }`;
  const roleModel = (filter: string) => `
    system Demo {
      ${ROLE_USER}
      subdomain M { context C {
        enum Tier { Gold, Basic }
        aggregate Customer { name: string }
        aggregate Ticket {
          subject: string
          customer: Customer id
          ${filter}
        }
      }}
    }
  `;

  it('accepts a role-branching principal term (`currentUser.role == "agent" || <column test>`)', async () => {
    const diags = await filterDiags(
      roleModel(`filter currentUser.role == "agent" || this.customer == currentUser.customerId`),
    );
    expect(diags).toEqual([]);
  });

  it("accepts principal terms against an enum value and against null", async () => {
    const diags = await filterDiags(
      roleModel(
        `filter currentUser.tier != Gold && (currentUser.customerId == null || this.customer == currentUser.customerId)`,
      ),
    );
    expect(diags).toEqual([]);
  });

  it("still refuses a column-free ORDERING over the principal, naming the admitted shape", async () => {
    const diags = await filterDiags(
      roleModel(`filter currentUser.age > 17 || this.subject == "x"`),
    );
    expect(diags.length).toBe(1);
    expect(diags[0]).toContain("no column on either side ('>')");
    expect(diags[0]).toContain("the one column-free comparison a capability filter admits");
  });

  it("still refuses a column-free comparison with no principal in it (`1 == 1`)", async () => {
    const diags = await filterDiags(roleModel(`filter 1 == 1`));
    expect(diags.length).toBe(1);
    expect(diags[0]).toContain("no column on either side");
  });

  it("does not admit a principal term in a find `where` (that is what `requires` is for)", async () => {
    const { model } = await parseString(
      `
      system Demo {
        ${ROLE_USER}
        subdomain M { context C {
          enum Tier { Gold, Basic }
          aggregate Customer { name: string }
          aggregate Ticket { subject: string  customer: Customer id }
          repository Tickets for Ticket {
            find mine(): Ticket? where currentUser.role == "agent" || customer == currentUser.customerId
          }
        }}
      }
    `,
      { validate: false },
    );
    const codes = validateLoomModel(enrichLoomModel(lowerModel(model)))
      .filter((d) => d.severity === "error")
      .map((d) => d.code);
    expect(codes).toContain("loom.find-where-not-queryable");
  });
});
