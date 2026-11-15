// Built-in capability prelude (typed-capabilities.md, Phase 3).
//
// The `auditable` capability ships with the toolchain (src/macros/prelude.ts) —
// available by name with nothing declared, the way the former audit macros were.
// These tests prove the delivery mechanism: the built-in resolves, produces the
// combined fields + stamps, and a user-declared capability of the same name
// overrides it.

import { describe, expect, it } from "vitest";
import type { AggregateIR } from "../../src/ir/types/loom-ir.js";
import { buildHostedModel, buildLoomModel, responseRows } from "../_helpers/ir.js";
import { parseString } from "../_helpers/parse.js";

function findAgg(
  ir: { systems: { subdomains: { contexts: { aggregates: AggregateIR[] }[] }[] }[] },
  name: string,
): AggregateIR {
  for (const s of ir.systems)
    for (const m of s.subdomains)
      for (const c of m.contexts) for (const a of c.aggregates) if (a.name === name) return a;
  throw new Error(`aggregate ${name} not found`);
}

describe("built-in capability prelude (typed-capabilities.md Phase 3)", () => {
  it("`with auditable` resolves with nothing declared (built-in)", async () => {
    const ir = await buildHostedModel(`
      system D {
        user { id: string }
        subdomain M { context C {
          aggregate Order with auditable { subject: string }
        }}
      }
    `);
    const agg = findAgg(ir, "Order");
    expect(responseRows(ir, agg).map((f) => f.name)).toEqual(
      expect.arrayContaining(["createdAt", "updatedAt", "createdBy", "updatedBy"]),
    );
    expect(agg.contextStamps?.length).toBe(2);
  });

  it("the built-in `auditable` needs no `user {}` block — `User` resolves leniently like the old macro", async () => {
    const { errors } = await parseString(`
      system D { subdomain M { context C {
        aggregate Order with auditable { subject: string }
      }}}
    `);
    expect(errors).toEqual([]);
  });

  it("a non-bool user `isDeleted` under softDeletable is refused (loom.softdelete-field-collision)", async () => {
    // The G2 seam on the filter member (corpus-mutation M1.aggregate.isDeleted):
    // `filter !this.isDeleted` would negate a string on every backend, and the
    // node query-projection arm rightly cannot lower it — so the collision is
    // refused at expansion, naming both ways out.
    const { errors } = await parseString(`
      system D { subdomain M { context C {
        aggregate Order with softDeletable { isDeleted: string }
      }}}
    `);
    expect(errors.some((e) => e.includes("isDeleted") && e.includes("softDeletable"))).toBe(true);
  });

  it("a BOOL user `isDeleted` under softDeletable is the spliced flag — accepted", async () => {
    const ir = await buildLoomModel(`
      system D { subdomain M { context C {
        aggregate Order with softDeletable { isDeleted: bool }
      }}}
    `);
    const agg = findAgg(ir, "Order");
    expect(agg.contextFilters?.length).toBe(1);
  });

  it("`with softDeletable` resolves the built-in (state + filter)", async () => {
    const ir = await buildHostedModel(`
      system D { subdomain M { context C {
        aggregate Order with softDeletable { subject: string }
      }}}
    `);
    const agg = findAgg(ir, "Order");
    // `isDeleted` is the internal filter flag: a domain member, not an API-read row.
    expect(agg.fields.map((f) => f.name)).toEqual(
      expect.arrayContaining(["isDeleted", "deletedAt"]),
    );
    expect(responseRows(ir, agg).map((f) => f.name)).toContain("deletedAt");
    expect(responseRows(ir, agg).map((f) => f.name)).not.toContain("isDeleted");
    expect(agg.contextFilters?.length).toBe(1);
  });

  it("`with tenantOwned` splices the tenantId field + onCreate stamp + tenant filter", async () => {
    const ir = await buildHostedModel(`
      system D {
        user { id: guid  tenantId: string }
        tenancy by user.tenantId of Org
        subdomain M { context C {
          aggregate Invoice with tenantOwned { number: string }
          aggregate Org { name: string }
        }}
      }
    `);
    const agg = findAgg(ir, "Invoice");
    // Fields (internal access keeps it out of client create/update inputs):
    const tenantId = agg.fields.find((f) => f.name === "tenantId")!;
    expect(tenantId).toBeDefined();
    expect(tenantId.access).toBe("internal");
    // The row is `internal`: a domain member, never an API-read row.
    expect(responseRows(ir, agg).map((f) => f.name)).not.toContain("tenantId");
    // Rows carry `tenantId` only — no materialized path.
    expect(agg.fields.map((f) => f.name)).not.toContain("dataKey");
    // Stamp: onCreate { tenantId := currentUser.tenantId }:
    expect(agg.contextStamps?.length).toBe(1);
    const stamp = agg.contextStamps![0]!;
    expect(stamp.event).toBe("create");
    expect(stamp.assignments.map((a) => a.field)).toEqual(["tenantId"]);
    // Filter: this.tenantId == currentUser.tenantId:
    expect(agg.contextFilters?.length).toBe(1);
    // Capability provenance (drives the `ignoring tenantOwned` bypass surface):
    expect(agg.contextFilterOrigins).toEqual(["tenantOwned"]);
  });

  it("a user-declared `capability auditable` overrides the built-in", async () => {
    const ir = await buildHostedModel(`
      capability auditable { archived: bool }
      system D { subdomain M { context C {
        aggregate Order with auditable { subject: string }
      }}}
    `);
    const agg = findAgg(ir, "Order");
    // The user's definition wins: `archived`, not the built-in audit fields.
    expect(responseRows(ir, agg).some((f) => f.name === "archived")).toBe(true);
    expect(responseRows(ir, agg).some((f) => f.name === "createdAt")).toBe(false);
  });
});
