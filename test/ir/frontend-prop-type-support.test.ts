// The frontend prop-type predicate and the two emitters it describes.
//
// `src/ir/util/frontend-prop-type.ts` says which declared types the shared
// TypeScript prop layer can spell; `_frontend/component-prop-type.ts` and
// `_frontend/extern-functions.ts` do the spelling.  Two copies of one fact, one
// on each side of the `ir → generator` layer boundary (the validator cannot
// import the emitter), which is exactly the arrangement that drifts.
//
// So the predicate is pinned AGAINST the emitters, behaviourally: for every
// type this file names, the emitter is driven directly and its verdict compared
// with the predicate's.  A type the predicate calls spellable that the emitter
// throws on, or vice versa, fails here — which is the drift the gate exists to
// make impossible.

import { describe, expect, it } from "vitest";
import { componentPropTsType } from "../../src/generator/_frontend/component-prop-type.js";
import { buildExternFunctionSignature } from "../../src/generator/_frontend/extern-functions.js";
import type { AggregateIR, TypeIR, UiFunctionIR } from "../../src/ir/types/loom-ir.js";
import { PRIMITIVES } from "../../src/ir/types/loom-ir.js";
import {
  unsupportedFrontendParamType,
  unsupportedFrontendPropType,
} from "../../src/ir/util/frontend-prop-type.js";

const prim = (name: string): TypeIR => ({ kind: "primitive", name: name as never });

/** Every type a component param / extern signature can carry, as a flat list —
 *  the domain the two sides are compared over.  Built from `PRIMITIVES` rather
 *  than a hand-kept list, so a NEW primitive joins the comparison automatically
 *  (which is the day the two sides would otherwise drift apart in silence). */
const DOMAIN: { label: string; type: TypeIR }[] = [
  ...PRIMITIVES.map((name) => ({ label: `primitive ${name}`, type: prim(name) })),
  { label: "duration (expression-only)", type: prim("duration") },
  { label: "enum", type: { kind: "enum", name: "Status" } },
  { label: "id", type: { kind: "id", targetName: "Order", valueType: "guid" } },
  { label: "entity", type: { kind: "entity", name: "Order" } },
  { label: "valueobject", type: { kind: "valueobject", name: "Address" } },
  { label: "none", type: { kind: "none" } },
  { label: "array of money", type: { kind: "array", element: prim("money") } },
  { label: "array of string", type: { kind: "array", element: prim("string") } },
  { label: "optional money", type: { kind: "optional", inner: prim("money") } },
  { label: "optional string", type: { kind: "optional", inner: prim("string") } },
  {
    label: "union",
    type: { kind: "union", variants: [prim("string"), { kind: "none" }] },
  },
];

const AGGS: ReadonlyMap<string, AggregateIR> = new Map();

/** Does the COMPONENT-PROP emitter accept this type?  Runs it. */
function emitterAcceptsProp(t: TypeIR): boolean {
  try {
    componentPropTsType(t, AGGS, new Map());
    return true;
  } catch {
    return false;
  }
}

/** Does the EXTERN-SIGNATURE emitter accept this type?  Runs it, as a param. */
function emitterAcceptsSignature(t: TypeIR): boolean {
  const fn: UiFunctionIR = {
    name: "fmt",
    params: [{ name: "x", type: t }],
    returnType: prim("string"),
    externPath: "./lib/fmt",
  };
  try {
    buildExternFunctionSignature(fn);
    return true;
  } catch {
    return false;
  }
}

describe("frontend prop-type support — the predicate matches the emitters", () => {
  it("scans a real domain (a vacuous comparison would pass trivially)", () => {
    expect(DOMAIN.length).toBeGreaterThan(15);
    // Both verdicts must actually SPLIT the domain, or the comparison below is
    // "true === true" for every row.
    const accepted = DOMAIN.filter((r) => emitterAcceptsProp(r.type)).length;
    expect(accepted).toBeGreaterThan(4);
    expect(accepted).toBeLessThan(DOMAIN.length);
  });

  for (const { label, type } of DOMAIN) {
    it(`${label}: predicate and component-prop emitter agree`, () => {
      const predicate = unsupportedFrontendPropType(type) === undefined;
      expect(predicate, `predicate says ${predicate}, emitter says the opposite`).toBe(
        emitterAcceptsProp(type),
      );
    });

    it(`${label}: predicate and extern-signature emitter agree`, () => {
      const predicate = unsupportedFrontendPropType(type) === undefined;
      expect(predicate).toBe(emitterAcceptsSignature(type));
    });
  }

  it("names the offending thing the way the emitters' messages did", () => {
    expect(unsupportedFrontendPropType(prim("money"))).toBe("primitive 'money'");
    expect(unsupportedFrontendPropType(prim("File"))).toBe("primitive 'File'");
    expect(unsupportedFrontendPropType({ kind: "valueobject", name: "Address" })).toBe(
      "type kind 'valueobject'",
    );
    // Recursion reports the INNER offender, not the wrapper.
    expect(unsupportedFrontendPropType({ kind: "array", element: prim("money") })).toBe(
      "primitive 'money'",
    );
  });
});

describe("the param-level wrapper admits the two marker kinds", () => {
  it("`slot` and a bare `action` are param shapes, not data", () => {
    expect(unsupportedFrontendParamType({ kind: "slot" })).toBeUndefined();
    expect(unsupportedFrontendParamType({ kind: "action" })).toBeUndefined();
    expect(
      unsupportedFrontendParamType({ kind: "optional", inner: { kind: "action" } }),
    ).toBeUndefined();
  });

  it("but an `action(T)` still has to spell T — the callback arg is a real type", () => {
    expect(unsupportedFrontendParamType({ kind: "action", arg: prim("string") })).toBeUndefined();
    expect(unsupportedFrontendParamType({ kind: "action", arg: prim("money") })).toBe(
      "primitive 'money'",
    );
  });
});
