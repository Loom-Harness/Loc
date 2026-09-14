// One `.ddd` line, five backends: `criterion Assigned() of WorkOrder =
// this.technicianId != null` must reach SQL's IS [NOT] NULL on every one of
// them.
//
// This exists because F-007 was found on ONE backend and the first question was
// "which of the other four have it too?".  The answer was three already correct
// and one (Python) lint-dirty — but that answer was a one-off observation, and
// an observation does not survive the next emitter refactor.  The per-backend
// tests pin node (`test/generator/typescript/criterion-null-compare.test.ts`)
// and python (`test/generator/python/python-criterion-null-and-principal.test.ts`)
// in detail; this pins the CROSS-BACKEND claim, in one place, so a future
// "which backends handle this?" is read off a test rather than re-derived.
//
// It also pins the VALIDATOR half.  `firstNonQueryableNode` admits a null
// literal in a comparison, so this shape reaches codegen with `0 error(s)` —
// which is correct (it is everywhere in a real schema: "unassigned", "not yet
// invoiced") but is the reason the defect was silent.  `generateSystemFiles`
// runs phases ①/④/⑦, so every case here would throw rather than assert if the
// queryable-subset gate ever started rejecting it.
//
// NON-VACUITY: each case asserts the backend emitted the criterion at all
// before asserting its shape, and the `eq`/`==`-style spellings that would mean
// "the null literal got bound as a value" are asserted ABSENT.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/index.js";

function system(platform: string): string {
  return `system Acme {
  subdomain Core {
    context Ops {
      aggregate Tech with crudish { name: string }
      repository Techs for Tech { }
      aggregate WorkOrder with crudish {
        title: string
        technicianId: Tech id?
      }
      criterion Assigned() of WorkOrder = this.technicianId != null
      criterion Unassigned() of WorkOrder = this.technicianId == null
      retrieval AssignedOrders() of WorkOrder { where: Assigned() }
      retrieval UnassignedOrders() of WorkOrder { where: Unassigned() }
      repository WorkOrders for WorkOrder { }
    }
  }
  api OpsApi from Core
  storage primary { type: postgres }
  resource opsState { for: Ops, kind: state, use: primary }
  deployable opsSvc {
    platform: ${platform}  contexts: [Ops]  dataSources: [opsState]  serves: OpsApi  port: 3000
  }
}`;
}

/** Every emitted file whose text mentions the criterion, joined — the backends
 *  put it in different places (a repository const, a Specification class, a
 *  retrieval module), and this test is about the SHAPE, not the file layout.
 *
 *  `needle` only SELECTS files.  Elixir puts each retrieval in its own module
 *  and .NET each criterion in its own class file, so it has to match the
 *  `Unassigned` half as well — hence the case-insensitive form, which `Un`
 *  + `assigned…` satisfies. */
async function emitted(platform: string, needle: RegExp): Promise<string> {
  const files = await generateSystemFiles(system(platform));
  const hits = [...files]
    .filter(([, content]) => needle.test(content))
    .map(([path, content]) => `// ${path}\n${content}`);
  expect(
    hits.length,
    `${platform}: nothing emitted matching ${needle} — the fixture, not the assertion, is broken`,
  ).toBeGreaterThan(0);
  return hits.join("\n");
}

describe("`x != null` / `x == null` reaches IS [NOT] NULL on every backend", () => {
  it("node (Drizzle) — isNotNull / isNull", async () => {
    const src = await emitted("node", /assignedCriterion/i);
    expect(src).toContain("isNotNull(schema.workOrders.technicianId)");
    expect(src).toContain("isNull(schema.workOrders.technicianId)");
    // Drizzle's `eq`/`ne` have no `null` in their value union — binding it is
    // TS2769 at compile time, which is the defect this whole file is about.
    expect(src).not.toMatch(/\b(?:eq|ne)\(schema\.\w+\.\w+, null\)/);
  }, 60_000);

  it("python (SQLAlchemy) — .is_not(None) / .is_(None)", async () => {
    const src = await emitted("python", /run_(?:un)?assigned_orders/);
    expect(src).toContain("WorkOrderRow.technician_id.is_not(None)");
    expect(src).toContain("WorkOrderRow.technician_id.is_(None)");
    // `col != None` is valid SQLAlchemy but ruff E711 on a project whose own
    // pyproject declares ruff.
    expect(src).not.toMatch(/[!=]= None\b/);
  }, 60_000);

  it("java (JPA Criteria) — cb.isNotNull / cb.isNull", async () => {
    const src = await emitted("java", /WorkOrderCriteria/);
    expect(src).toContain('cb.isNotNull(root.<TechId>get("technicianId"))');
    expect(src).toContain('cb.isNull(root.<TechId>get("technicianId"))');
  }, 60_000);

  it("elixir (Ecto) — is_nil / not is_nil", async () => {
    const src = await emitted("elixir", /assignedOrders/i);
    expect(src).toContain("where: not is_nil(record.technician_id)");
    expect(src).toContain("where: is_nil(record.technician_id)");
  }, 60_000);

  it("dotnet (EF Core) — a C# `!= null` the provider translates", async () => {
    // The one backend where the HOST-LANGUAGE spelling is already the right
    // one: the criterion is a `Expression<Func<T,bool>>` and EF Core turns
    // `x.TechnicianId != null` into `IS NOT NULL` itself.  Pinned so a future
    // rewrite towards an explicit spelling is a deliberate change.
    const src = await emitted("dotnet", /assignedCriterion/i);
    expect(src).toContain("candidate.TechnicianId != null");
    expect(src).toContain("candidate.TechnicianId == null");
  }, 60_000);
});
