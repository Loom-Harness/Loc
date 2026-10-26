// ---------------------------------------------------------------------------
// Java backend — every restriction of a TPH (`sharedTable`) hierarchy is
// hosted on the ROOT entity, and a by-id read of a restricted aggregate is a
// query.
//
// Hibernate applies a `@Filter` declared on a SINGLE_TABLE subclass only to
// queries OF that subclass: `from Car` honours it, but `from Vehicle` and
// `find(Vehicle.class, id)` return the row it hides (verified against
// Hibernate 7.4.1).  So a concrete-level filter is a leak the moment anything
// reads the base, and Hibernate refuses a subclass `@SQLRestriction` outright.
// The root therefore hosts the root's own restrictions unguarded and each
// concrete's own guarded by its discriminator, bypassable ones as named
// `<Concrete>_<cap>` filters the concrete's `ignoring` reads disable.
//
// A primary-key `find` of a row the session already manages answers from the
// persistence context without SQL, so no restriction is consulted; the
// restricted aggregates' `findById` is a JPQL query instead.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";
import { corpusSourceFor } from "../../fixtures/corpus/harness.js";

const ROOT = "d/src/main/java/com/loom/d";

/** Every corpus fixture with a TPH hierarchy. */
const TPH_FIXTURES = [
  "inheritance-base-reads",
  "inheritance-read-restrictions",
  "inheritance",
  "projection-tph-source",
  "tph-crossings",
  "tph",
  "vo-cross-context",
] as const;

const RESTRICTION_ANNOTATION = /^@(SQLRestriction|Filter|FilterDef)\(/m;

describe("java generator — TPH restrictions are root-hosted", () => {
  it.each(TPH_FIXTURES)("%s: no TPH concrete declares a restriction of its own", async (id) => {
    const files = await generateSystemFiles(corpusSourceFor(id, "java"));
    const concretes = [...files].filter(
      ([p, src]) => p.endsWith(".java") && /^@DiscriminatorValue\(/m.test(src),
    );
    expect(concretes.length, "vacuity: the fixture emits TPH concretes").toBeGreaterThan(0);
    for (const [path, src] of concretes) {
      expect(src, path).not.toMatch(RESTRICTION_ANNOTATION);
    }
  });

  it("the root hosts a subtype's bypassable filter, kind-guarded, and the subtype's bypass disables it", async () => {
    const files = await generateSystemFiles(
      corpusSourceFor("inheritance-read-restrictions", "java"),
    );
    const vehicle = files.get(`${ROOT}/features/vehicles/Vehicle.java`)!;
    expect(vehicle).toContain(
      '@FilterDef(name = "Car_softDeletable", autoEnabled = true, applyToLoadByKey = true)',
    );
    expect(vehicle).toContain(
      `@Filter(name = "Car_softDeletable", condition = "(kind <> 'Car' or (not (is_deleted)))")`,
    );
    // The never-bypassed subtype-only-column filter stays always-on.
    expect(vehicle).toContain(`@SQLRestriction("(kind <> 'Car' or (seats > 0))")`);
    const impl = files.get(`${ROOT}/features/cars/CarRepositoryImpl.java`)!;
    const byPlateAll = impl.slice(impl.indexOf("public Car byPlateAll("));
    expect(byPlateAll.slice(0, byPlateAll.indexOf("\n    }\n"))).toContain(
      '__session.disableFilter("Car_softDeletable");',
    );
    // The sibling's reads disable nothing of Car's.
    expect(files.get(`${ROOT}/features/trucks/TruckRepositoryImpl.java`)!).not.toContain(
      "disableFilter",
    );
  });

  it("a base capability is hosted once, unguarded, on the root", async () => {
    const files = await generateSystemFiles(corpusSourceFor("inheritance-base-reads", "java"));
    for (const base of ["vehicles/Vehicle", "equipments/Equipment"]) {
      expect(files.get(`${ROOT}/features/${base}.java`)!).toContain(
        '@SQLRestriction("not (archived)")',
      );
    }
  });

  it("a restricted aggregate's by-id read is a query, not a session lookup", async () => {
    const files = await generateSystemFiles(corpusSourceFor("inheritance-base-reads", "java"));
    expect(files.get(`${ROOT}/features/cranes/CraneJpaRepository.java`)!).toContain(
      '@Query("select e from Crane e where e.id = :id")',
    );
    expect(files.get(`${ROOT}/features/drivers/DriverJpaRepository.java`)!).toContain(
      '@Query("select e from Driver e where e.id = :id")',
    );
  });
});
