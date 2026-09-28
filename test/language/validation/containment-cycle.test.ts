// Cyclic entity containment (`loom.containment-cycle`).
//
// `contains` is OWNERSHIP — the part row carries a `parentId` FK to its owner
// and every backend hydrates a part by recursing down that edge.  Two parts
// that contain each other describe a graph with no bottom.  Nothing rejected
// it: `ddd parse` reported `0 error(s), 0 warning(s)` and `generate system`
// then died with `RangeError: Maximum call stack size exceeded` inside
// `nestedContainLoads` (`src/generator/typescript/repository-find-builder.ts`)
// — an internal stack trace naming an `out/**.js` frame, with no `.ddd` line
// anywhere in it.
//
// `checkContainmentCycles` (`src/language/validators/structural.ts`) now
// refuses the declaration, names the loop, and hangs the diagnostic on the
// `contains` clause that closes it.

import { describe, expect, it } from "vitest";
import { parseString } from "../../_helpers/index.js";

const parse = (source: string) => parseString(source);

describe("validator: containment cycles", () => {
  it("flags a two-part mutual cycle and names the loop", async () => {
    const { errors } = await parse(`
      system S { subdomain M { context C {
        aggregate A {
          n: string
          contains xs: X[]
          derived display: string = n
          entity X { contains ys: Y[] }
          entity Y { contains zs: X[] }
        }
        repository As for A {}
      } } }
    `);
    expect(
      errors.some((e) => /Cyclic containment in aggregate 'A': X → Y → X/.test(e)),
      errors.join("\n"),
    ).toBe(true);
    // Reported ONCE per loop, not once per entry point into it.
    const hits = errors.filter((e) => /Cyclic containment/.test(e));
    expect(hits.length, errors.join("\n")).toBe(1);
  });

  it("flags a part that contains itself", async () => {
    const { errors } = await parse(`
      system S { subdomain M { context C {
        aggregate A {
          n: string
          contains xs: X[]
          derived display: string = n
          entity X { contains kids: X[] }
        }
        repository As for A {}
      } } }
    `);
    expect(
      errors.some((e) => /Cyclic containment in aggregate 'A': X → X/.test(e)),
      errors.join("\n"),
    ).toBe(true);
  });

  it("flags a three-part cycle and names the whole path", async () => {
    const { errors } = await parse(`
      system S { subdomain M { context C {
        aggregate A {
          n: string
          contains xs: X[]
          derived display: string = n
          entity X { contains ys: Y[] }
          entity Y { contains zs: Z[] }
          entity Z { contains back: X[] }
        }
        repository As for A {}
      } } }
    `);
    expect(
      errors.some((e) => /Cyclic containment in aggregate 'A': X → Y → Z → X/.test(e)),
      errors.join("\n"),
    ).toBe(true);
  });

  it("flags the cycle spelled in the `contains`-less sugar too", async () => {
    // `ys: Y[]` without the `contains` keyword is an INFERRED containment
    // (`isInferredContainment`) and lowers to the same ContainmentIR, so it
    // crashes the same emitter — it has to be an edge in the same graph.
    const { errors } = await parse(`
      system S { subdomain M { context C {
        aggregate A {
          n: string
          contains xs: X[]
          derived display: string = n
          entity X { ys: Y[] }
          entity Y { xs: X[] }
        }
        repository As for A {}
      } } }
    `);
    expect(
      errors.some((e) => /Cyclic containment in aggregate 'A': X → Y → X/.test(e)),
      errors.join("\n"),
    ).toBe(true);
  });

  // NON-VACUITY — the gate must not simply refuse every containment graph.
  it("accepts a deep acyclic containment tree with ZERO diagnostics", async () => {
    const { errors, warnings } = await parse(`
      system S { subdomain M { context C {
        aggregate Order {
          code: string
          contains lines: Line[]
          derived display: string = code
          entity Line { sku: string  contains fees: Fee[] }
          entity Fee { label: string }
        }
        repository Orders for Order {}
      } } }
    `);
    expect(errors, errors.join("\n")).toEqual([]);
    expect(warnings, warnings.join("\n")).toEqual([]);
  });

  it("accepts a DIAMOND — two parts containing the same leaf is not a cycle", async () => {
    const { errors } = await parse(`
      system S { subdomain M { context C {
        aggregate A {
          n: string
          contains ls: L[]
          contains rs: R[]
          derived display: string = n
          entity L { contains notes: Note[] }
          entity R { contains notes: Note[] }
          entity Note { text: string }
        }
        repository As for A {}
      } } }
    `);
    expect(errors, errors.join("\n")).toEqual([]);
  });
});
