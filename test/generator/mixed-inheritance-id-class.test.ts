// ---------------------------------------------------------------------------
// A `shape: document` / `persistedAs: eventLog` concrete under a `sharedTable`
// (TPH) base owns its OWN id class — on every backend that emits a typed id.
//
// This hierarchy is legal and sanctioned: such a concrete cannot share the
// base's single table, so the language FORCES the explicit
// `inheritanceUsing: ownTable` opt-out (`loom.es-tph-forced-own-table`,
// src/language/validators/inheritance.ts Rule 4).  The base stays a TPH base —
// its other concretes still share its table — while THIS subtype is table-wise
// and identity-wise standalone.
//
// The java and .NET emitters asked two different questions about that:
//
//   * the id class every service / repository / controller signature names came
//     from `tableOwnerName(agg)`, which asks `isTphConcrete(AGG)` → `<Agg>Id`;
//   * the ENTITY's own id came from `isTphBase(BASE)` → `<Base>Id`.
//
// They agree for every hierarchy whose members agree, and diverge for exactly
// this one — so the service returned `aggregate.id()` (a `<Base>Id`) from a
// method declared `<Agg>Id`.  On java that is
// `error: incompatible types: ThingBaseId cannot be converted to ThingId`,
// caught by the pairwise `compile oracle (java)` on `main` (#2797) and by
// nothing cheaper.  This is that cheaper thing.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

/** One TPH base with TWO concretes: `Solid` shares the table (the untouched
 *  TPH path), `Doc` is forced onto its own by `shape: document`. */
const src = (platform: string) => `system Mix {
  subdomain Core {
    context Main {
      abstract aggregate Thing inheritanceUsing: sharedTable {
        note: string
      }
      aggregate Solid extends Thing with crudish {
        label: string
      }
      aggregate Doc extends Thing shape: document, inheritanceUsing: ownTable, with crudish {
        label: string
      }
      repository Solids for Solid { }
      repository Docs for Doc { }
    }
  }
  api MainApi from Core
  storage primary { type: postgres }
  resource mainState { for: Main, kind: state, use: primary }
  deployable d {
    platform: ${platform}
    contexts: [Main]
    dataSources: [mainState]
    serves: MainApi
    port: 4000
  }
}`;

/** Every id class named anywhere in the files whose path contains `needle`. */
function idClassesIn(files: Map<string, string>, needle: string, ext: string): Set<string> {
  const found = new Set<string>();
  for (const [path, content] of files) {
    if (!path.endsWith(ext) || !path.includes(needle)) continue;
    for (const m of content.matchAll(/\b(Thing|Solid|Doc)Id\b/g)) found.add(m[1]);
  }
  return found;
}

describe("a forced-ownTable concrete under a TPH base owns its own id class", () => {
  it("java: the document concrete names DocId, the shared concrete names ThingId", async () => {
    const files = await generateSystemFiles(src("java"));
    // The document concrete: entity, service and controller agree on `DocId`,
    // and the base's `ThingId` never appears in any of them.
    for (const dir of ["features/docs/"]) {
      expect(idClassesIn(files, dir, ".java")).toEqual(new Set(["Doc"]));
    }
    // The genuine TPH concrete is untouched: it shares the base's id.
    expect(idClassesIn(files, "features/solids/", ".java")).toEqual(new Set(["Thing"]));
    const doc = files.get("d/src/main/java/com/loom/d/features/docs/Doc.java") as string;
    expect(doc).toContain("public DocId id()");
    expect(doc).not.toContain("extends Thing");
  });

  it("dotnet: same split", async () => {
    const files = await generateSystemFiles(src("dotnet"));
    expect(idClassesIn(files, "Domain/Docs/", ".cs")).toEqual(new Set(["Doc"]));
    expect(idClassesIn(files, "Domain/Solids/", ".cs")).toEqual(new Set(["Thing"]));
    const doc = files.get("d/Domain/Docs/Doc.cs") as string;
    expect(doc).toContain("public DocId Id");
    expect(doc).not.toContain(": Thing");
  });
});
