// ---------------------------------------------------------------------------
// Java backend — a TPH (`sharedTable`) CONCRETE's static capability filter
// (soft-delete et al.) is hoisted onto the hierarchy ROOT, discriminator-
// guarded.
//
// Hibernate refuses `@SQLRestriction` on a subclass of a SINGLE_TABLE
// hierarchy — the restriction is a property of the shared table's mapping and
// only its root may declare it — so the concrete-level annotation the plain
// relational root gets (`sqlRestriction` in `renderJavaEntity`) BOOTED into an
// `AnnotationException` on `tph-crossings.ddd` (behavioral-java, PR #2907:
// "java -jar exited early (code 1)" out of `AnnotationBinder.bindClass`).  The
// compile tier could not see it: the annotation is legal Java.
//
// The root now declares ONE restriction that guards each subtype's fragment by
// its discriminator — `(kind <> 'Parcel' or (not (is_deleted)))` — so a
// sibling kind's rows are untouched by a filter that is not theirs (the java
// twin of the EF adapter's discriminator-guarded root filter).  Proven by the
// booted app: `node test/behavioral/run-java.mjs tph-crossings` errors at boot
// on the pre-fix emitter and passes on this one.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";
import { corpusSourceFor } from "../../fixtures/corpus/harness.js";

const SRC = corpusSourceFor("tph-crossings", "java");
const ROOT = "d/src/main/java/com/loom/d";

async function files(): Promise<Map<string, string>> {
  return generateSystemFiles(SRC);
}

describe("java generator — TPH subtype capability filter is hoisted to the root", () => {
  it("the soft-deletable concrete carries NO @SQLRestriction of its own", async () => {
    const parcel = (await files()).get(`${ROOT}/features/parcels/Parcel.java`)!;
    expect(parcel).toBeDefined();
    expect(parcel).toContain('@DiscriminatorValue("Parcel")');
    expect(parcel).not.toContain("@SQLRestriction");
    expect(parcel).not.toContain("import org.hibernate.annotations.SQLRestriction;");
  });

  it("the abstract root declares the fragment, guarded by the subtype's discriminator", async () => {
    const base = (await files()).get(`${ROOT}/features/shipments/Shipment.java`)!;
    expect(base).toBeDefined();
    expect(base).toContain("import org.hibernate.annotations.SQLRestriction;");
    expect(base).toContain("@Inheritance(strategy = InheritanceType.SINGLE_TABLE)");
    expect(base).toContain(`@SQLRestriction("(kind <> 'Parcel' or (not (is_deleted)))")`);
  });

  it("the capability-less sibling concrete is untouched", async () => {
    const crate = (await files()).get(`${ROOT}/features/crates/Crate.java`)!;
    expect(crate).toBeDefined();
    expect(crate).not.toContain("@SQLRestriction");
  });
});
