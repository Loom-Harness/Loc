// Census: generated Java imports every type by its single name — no unit keeps
// an on-demand import (`import <pkg>.*;`, `import static <class>.*;`).
//
// An on-demand import binds every type of its package in the unit, so a domain
// type that shares a simple name with any of them (a value object `Column`
// beside `jakarta.persistence.*`, an enum `Mapping` beside Spring's
// `web.bind.annotation.*`) makes the unit ambiguous even where it never names
// the framework type.  The finalizer (`src/generator/_imports/java.ts`)
// replaces each on-demand import an emitter writes with the single-type
// imports the unit's code needs; this census reads the OUTPUT, over every
// corpus fixture that generates on java, so an emitter or unit shape the
// finalizer misses fails here rather than in a user's build.
//
// Import hygiene (no compile tier observes an import's style): asserted on the
// emitted text.

import { describe, expect, it } from "vitest";
import { generateCorpusCase } from "../../fixtures/corpus/harness.js";
import { CORPUS } from "../../fixtures/corpus/manifest.js";

const JAVA_CASES = CORPUS.filter((f) => f.backends.includes("java")).map((f) => f.id);
const ON_DEMAND = /^import\s+(?:static\s+)?[\w.]+\.\*\s*;/m;

describe("java explicit-imports census — emitted units", () => {
  it("covers a real population", () => {
    expect(JAVA_CASES.length).toBeGreaterThan(80);
  });

  it.each(JAVA_CASES)("%s: no generated unit imports on demand", async (feature) => {
    const files = await generateCorpusCase(feature, "java");
    const units = [...files].filter(([p]) => p.endsWith(".java"));
    expect(units.length).toBeGreaterThan(0);
    const offenders = units
      .filter(([, c]) => ON_DEMAND.test(c))
      .map(([p, c]) => `${p}: ${ON_DEMAND.exec(c)![0]}`);
    expect(offenders).toEqual([]);
  });
});
