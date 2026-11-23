// Completeness of the reserved type-name table (`src/util/reserved-type-names.ts`,
// D-RESERVED-GENERATED-NAMES).
//
// Every simple name the emitters can bind outside the model
// (`test/_helpers/generated-bound-names.ts`) is classified: REFUSED (in the
// table, its break proven by `test/e2e/reserved-type-names-proof.test.ts`),
// ADMITTED (a domain type of that name builds on every backend — the same
// proof compiles them all), or UNDECLARABLE (the `.ddd` grammar or validator
// already refuses the name, so no domain type can take it).  A new import or
// annotation in an emitter fails here until it is classified; a classification
// no emitter needs any more fails too, so the lists cannot rot.

import { describe, expect, it } from "vitest";
import { RESERVED_TYPE_NAMES } from "../../src/util/reserved-type-names.js";
import {
  type BoundTarget,
  deriveBoundNames,
  JAVA_FRAMEWORK_PACKAGES,
  javaOnDemandImports,
} from "../_helpers/generated-bound-names.js";
import { fenceProblem } from "../_helpers/live-fences.js";
import { ADMITTED, PROOF_WAIVERS, UNDECLARABLE } from "./reserved-type-names.data.js";

const derived = deriveBoundNames();

/** Why a deferral is no longer honest parked work (empty when it is). */
function deferralProblem(d: { reviewUntil: string; blockedBy: string }): string {
  const fence = fenceProblem(d.blockedBy);
  if (fence) return fence;
  const today = new Date().toISOString().slice(0, 10);
  if (d.reviewUntil < today) return `the deferral expired on ${d.reviewUntil}`;
  const horizon = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10);
  if (d.reviewUntil > horizon)
    return `reviewUntil ${d.reviewUntil} is parked more than 60 days out`;
  return "";
}
const TARGETS = Object.keys(derived) as BoundTarget[];
const reserved = new Set(RESERVED_TYPE_NAMES.map((e) => e.name));
const allDerived = new Set(TARGETS.flatMap((t) => [...derived[t].keys()]));

describe("reserved type names — completeness against the emitters", () => {
  for (const target of TARGETS) {
    it(`every name the ${target} emitters bind is refused, admitted or undeclarable`, () => {
      const admitted = new Set(ADMITTED[target]);
      const unclassified = [...derived[target].entries()]
        .filter(([n]) => !reserved.has(n) && !admitted.has(n) && !UNDECLARABLE.includes(n))
        .map(([n, binders]) => `${n}  ← ${[...binders].join(", ")}`)
        .sort();
      expect(
        unclassified,
        `classify each name: add it to RESERVED_TYPE_NAMES when a domain type of that name breaks the ${target} build (prove it with LOOM_RESERVED_NAMES_PROOF=1 LOOM_RESERVED_NAMES_CASE=<Name>), else to ADMITTED.${target} in reserved-type-names.data.ts`,
      ).toEqual([]);
    });

    it(`ADMITTED.${target} holds no name the ${target} emitters no longer bind`, () => {
      const stale = ADMITTED[target].filter((n) => !derived[target].has(n));
      expect(stale, "delete the stale admitted names").toEqual([]);
    });

    it(`ADMITTED.${target} and the table do not overlap`, () => {
      expect(ADMITTED[target].filter((n) => reserved.has(n))).toEqual([]);
    });
  }

  it("every on-demand import a Java emitter writes is one the finalizer expands", () => {
    // No generated unit keeps `import pkg.*;` (java-explicit-imports-census):
    // the finalizer replaces it with single-type imports of the members the
    // unit names, and the derivation reads those members from the same list.
    expect(
      javaOnDemandImports().filter((p) => !(p in JAVA_FRAMEWORK_PACKAGES)),
      "list the package's public types in JAVA_FRAMEWORK_PACKAGES (src/generator/_symbols/ambient-java.ts)",
    ).toEqual([]);
  });

  it("UNDECLARABLE holds only names some emitter binds", () => {
    expect(UNDECLARABLE.filter((n) => !allDerived.has(n))).toEqual([]);
  });

  it("every table entry is a name some emitter binds", () => {
    // A `.dotnet` binding of a generated member (`Create`, `Id`) surfaces in
    // the derivation through the runtime's names or another backend's.
    const orphan = RESERVED_TYPE_NAMES.filter((e) => !allDerived.has(e.name)).map((e) => e.name);
    expect(orphan).toEqual([]);
  });

  it("table entries are unique and sorted, each with at least one binding", () => {
    const names = RESERVED_TYPE_NAMES.map((e) => e.name);
    expect(names).toEqual([...new Set(names)].sort());
    for (const e of RESERVED_TYPE_NAMES) expect(e.bindings.length, e.name).toBeGreaterThan(0);
  });
});

describe("reserved type names — an import-style entry is parked work that expires", () => {
  it("an entry carries a deferral exactly when it is import-style", () => {
    const wrong = RESERVED_TYPE_NAMES.filter(
      (e) => (e.category === "import-style") !== (e.deferral !== undefined),
    ).map((e) => e.name);
    expect(wrong).toEqual([]);
  });

  for (const e of RESERVED_TYPE_NAMES.filter((x) => x.deferral)) {
    const d = e.deferral!;
    it(`${e.name} is deferred (blocked by ${d.blockedBy} until ${d.reviewUntil})`, () => {
      expect(deferralProblem(d), e.name).toBe("");
    });
  }
});

describe("reserved type names — the compile proof's waivers expire", () => {
  for (const [key, w] of Object.entries(PROOF_WAIVERS)) {
    it(`${key} is deferred (blocked by ${w.blockedBy} until ${w.reviewUntil})`, () => {
      expect(deferralProblem(w), key).toBe("");
    });
  }
});
