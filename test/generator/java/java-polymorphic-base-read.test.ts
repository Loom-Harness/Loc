// ---------------------------------------------------------------------------
// Java backend — the polymorphic base read (`polymorphicReadFor`): a TPH base
// reads `from <Base>` once, under the root-hosted kind-guarded restrictions,
// ordered by id and paged in SQL; a TPC base (a `@MappedSuperclass`, which
// JPQL cannot select from) merges each concrete's own scoped read in id order,
// then pages.  The runtime proof is `test/behavioral/polymorphic-read.mjs`
// over HTTP (`LOOM_POLY_BASE`) and the `inheritance-base-reads` corpus case.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";
import { corpusSourceFor } from "../../fixtures/corpus/harness.js";

const ROOT = "d/src/main/java/com/loom/d/features";

async function files(id: string): Promise<Map<string, string>> {
  return generateSystemFiles(corpusSourceFor(id, "java"));
}

describe("java generator — polymorphic base read", () => {
  it("TPH: one query over the root, ordered by id, paged in SQL, plus a by-id query", async () => {
    const ctl = (await files("inheritance-base-reads")).get(
      `${ROOT}/equipments/EquipmentsController.java`,
    )!;
    expect(ctl).toContain('@RequestMapping("/api/equipments")');
    expect(ctl).toContain('"select e from Equipment e order by e.id"');
    expect(ctl).toContain(".setFirstResult((page - 1) * pageSize)");
    expect(ctl).toContain('"select count(e) from Equipment e"');
    expect(ctl).toContain('"select e from Equipment e where e.id = :id"');
    // Each row is tagged with its own subtype's name over that subtype's body.
    expect(ctl).toContain(
      'if (row instanceof Crane __row) return tag("Crane", CraneResponse.from(__row));',
    );
    expect(ctl).toContain(
      'if (row instanceof Forklift __row) return tag("Forklift", ForkliftResponse.from(__row));',
    );
    // No hand-written kind or restriction predicate: the entity hosts them.
    expect(ctl).not.toMatch(/kind|archived/);
  });

  it("TPC: each concrete's scoped findAll, merged in id order, then paged", async () => {
    const ctl = (await files("inheritance-base-reads")).get(`${ROOT}/crews/CrewsController.java`)!;
    expect(ctl).toContain('@RequestMapping("/api/crews")');
    expect(ctl).toContain("drivers.findAll()");
    expect(ctl).toContain("dispatchers.findAll()");
    expect(ctl).toContain("merged.sort(");
    expect(ctl).not.toContain('@GetMapping("/{id}")');
  });

  it("a hierarchy under tenancy is routed: the tenant filter is on the root entity", async () => {
    const all = await files("inheritance-read-restrictions");
    const ctl = all.get(`${ROOT}/vehicles/VehiclesController.java`)!;
    expect(ctl).toContain('"select e from Vehicle e order by e.id"');
    expect(ctl).not.toMatch(/tenantId|currentUser/);
    expect(all.get(`${ROOT}/vehicles/Vehicle.java`)!).toContain(
      '@Filter(name = "Vehicle_tenantOwned", condition = "tenant_id = :__cuTenantId")',
    );
    expect(all.get(`${ROOT}/crews/CrewsController.java`)).toBeDefined();
  });
});
