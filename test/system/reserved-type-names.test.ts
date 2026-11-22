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

import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { RESERVED_TYPE_NAMES } from "../../src/util/reserved-type-names.js";
import {
  type BoundTarget,
  deriveBoundNames,
  JAVA_ON_DEMAND_PACKAGES,
  javaOnDemandImports,
  REPO_ROOT,
} from "../_helpers/generated-bound-names.js";
import { ADMITTED, UNDECLARABLE } from "./reserved-type-names.data.js";

const derived = deriveBoundNames();
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

  it("every package a Java emitter imports on demand has its members listed", () => {
    // `import pkg.*;` binds every member of pkg without naming one; the
    // derivation can only see them through JAVA_ON_DEMAND_PACKAGES.
    expect(
      javaOnDemandImports().filter((p) => !(p in JAVA_ON_DEMAND_PACKAGES)),
      "list the package's public types in JAVA_ON_DEMAND_PACKAGES (generated-bound-names.ts)",
    ).toEqual([]);
  });

  it("UNDECLARABLE holds only names some emitter binds", () => {
    expect(UNDECLARABLE.filter((n) => !allDerived.has(n))).toEqual([]);
  });

  it("every table entry is a name some emitter binds", () => {
    // A `.dotnet` binding is a BCL or generated name the .NET aliasing does
    // not repair; the derivation reads the other four backends' emitters, so
    // the name must surface there (every .NET entry is a shared name).
    const orphan = RESERVED_TYPE_NAMES.filter((e) => !allDerived.has(e.name)).map((e) => e.name);
    expect(orphan).toEqual([]);
  });

  it("table entries are unique and sorted, each with at least one binding", () => {
    const names = RESERVED_TYPE_NAMES.map((e) => e.name);
    expect(names).toEqual([...new Set(names)].sort());
    for (const e of RESERVED_TYPE_NAMES) expect(e.bindings.length, e.name).toBeGreaterThan(0);
  });

  it("a runtime type name the symbol plan declares is in the table or admitted", () => {
    // The symbol plan's per-target runtime names (`src/generator/_symbols/
    // runtime-names/*`) are names generated code binds in every unit; each
    // one must be classified like an emitter import.
    const dir = path.join(REPO_ROOT, "src", "generator", "_symbols", "runtime-names");
    const declared: string[] = [];
    if (fs.existsSync(dir)) {
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith(".ts")) continue;
        const text = fs.readFileSync(path.join(dir, f), "utf8");
        for (const m of text.matchAll(/"([A-Z][A-Za-z0-9_]*)"/g)) declared.push(m[1]!);
      }
    }
    const admittedAny = new Set(Object.values(ADMITTED).flat());
    expect(declared.filter((n) => !reserved.has(n) && !admittedAny.has(n))).toEqual([]);
  });
});
