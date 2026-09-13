import { NodeFileSystem } from "langium/node";
import { parseHelper } from "langium/test";
import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import type { AggregateIR } from "../../src/ir/types/loom-ir.js";
import { sortableFields } from "../../src/ir/util/sortable-fields.js";
import { createDddServices } from "../../src/language/ddd-module.js";
import type { Model } from "../../src/language/generated/ast.js";

// ---------------------------------------------------------------------------
// Server-side sort whitelist (`sortableFields`).
// The whitelist is the set of `?sort=<field>` keys a paged list endpoint
// accepts.  `secret` (client write-only, never read back), `internal`
// (server-managed, excluded from API reads) and `mask unless` (redacted at the
// wire boundary for an unprivileged caller) columns must NOT be sortable —
// otherwise a hidden column becomes a controllable ordering oracle.
//
// The per-BACKEND half of this — that each backend's emitted whitelist really
// omits the masked field — lives in test/platform/mask-sort-allowlist.test.ts.
// ---------------------------------------------------------------------------

const services = createDddServices(NodeFileSystem);
const parse = parseHelper<Model>(services.Ddd);

async function aggregateFrom(src: string, name: string): Promise<AggregateIR> {
  const doc = await parse(src, { validation: true });
  const errors = (doc.diagnostics ?? []).filter((d) => d.severity === 1).map((d) => d.message);
  expect(errors).toEqual([]);
  const enriched = enrichLoomModel(lowerModel(doc.parseResult.value));
  // Top-level contexts (legacy single-deployable mode) AND the ones a `system`
  // nests under its subdomains — `mask unless` needs a `user {}` block, which only
  // a `system` can carry, so the masked fixture takes the second path.
  const contexts = [
    ...enriched.contexts,
    ...enriched.systems.flatMap((s) => s.subdomains.flatMap((m) => m.contexts)),
  ];
  for (const ctx of contexts) {
    const agg = ctx.aggregates.find((a) => a.name === name);
    if (agg) return agg;
  }
  throw new Error(`Aggregate ${name} not found`);
}

const SRC = `
context Accounts {
  aggregate User {
    email: string
    displayName: string
    passwordHash: string secret
    tenantKey: string internal
  }
}
`;

describe("sortableFields — access-modifier exclusions", () => {
  it("excludes secret and internal columns from the sort whitelist", async () => {
    const agg = await aggregateFrom(SRC, "User");
    const keys = sortableFields(agg);
    // Public scalar properties are sortable, id leads.
    expect(keys).toContain("id");
    expect(keys).toContain("email");
    expect(keys).toContain("displayName");
    // A `secret` column is client write-only and never disclosed in a read;
    // it must never be an accepted `?sort=` key (ordering-oracle leak).
    expect(keys).not.toContain("passwordHash");
    // An `internal` column is excluded from API reads by `forApiRead`; it is
    // likewise not a meaningful (or safe) sort dimension.
    expect(keys).not.toContain("tenantKey");
  });
});

// A `mask unless` field is different from `secret`/`internal`: it IS on the
// read wire, just redacted for a caller the predicate rejects.  The whitelist
// is emitted once for every caller, so the privileged reading does not make the
// key safe to accept — an unprivileged caller ordering by it recovers the value
// from the row ORDER (audit #2864 G3 / M-T3.18).
const MASK_SRC = `
system MaskedSort {
  user { id: string  role: string }
  subdomain People {
    context Staff {
      aggregate Employee {
        name: string
        grade: int = 1
        salary: decimal mask unless currentUser.role == "admin"
      }
    }
  }
}
`;

describe("sortableFields — `mask unless` exclusion", () => {
  it("excludes a masked column but keeps its unmasked siblings", async () => {
    const agg = await aggregateFrom(MASK_SRC, "Employee");
    const keys = sortableFields(agg);
    expect(keys).not.toContain("salary");
    // Not "empty the whitelist": the visible scalars stay sortable.
    expect(keys).toEqual(["id", "name", "grade"]);
  });
});
