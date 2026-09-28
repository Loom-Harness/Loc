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
import {
  componentPropTsType,
  takeMoneyPropImport,
} from "../../src/generator/_frontend/component-prop-type.js";
import { buildExternFunctionSignature } from "../../src/generator/_frontend/extern-functions.js";
import type {
  AggregateIR,
  TypeIR,
  UiFunctionIR,
  ValueObjectIR,
} from "../../src/ir/types/loom-ir.js";
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

/** The one declared value object the domain below names.
 *
 *  A `valueobject` prop is spelled STRUCTURALLY from its fields, so the emitter
 *  genuinely needs the declaration — handing it an empty index is an emit-time
 *  floor, not the supported path, and comparing the predicate against THAT
 *  would pin the wrong answer.  `street: string` plus `total: money` so the
 *  recursion through a VO field is exercised too. */
const VOS: ReadonlyMap<string, ValueObjectIR> = new Map([
  [
    "Address",
    {
      name: "Address",
      fields: [
        { name: "street", type: prim("string") },
        { name: "total", type: prim("money") },
      ],
      derived: [],
      invariants: [],
      functions: [],
      tests: [],
    } as unknown as ValueObjectIR,
  ],
]);

/** Does the COMPONENT-PROP emitter accept this type?  Runs it. */
function emitterAcceptsProp(t: TypeIR): boolean {
  try {
    componentPropTsType(t, AGGS, new Map(), VOS);
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
    buildExternFunctionSignature(fn, undefined, VOS);
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

  it("the three shapes wave C2 taught the prop layer are no longer refused", () => {
    // Each of these WAS the gate's reason to exist, and each now has a
    // spelling — `Decimal`, the four-field file ref, and the VO's own fields.
    expect(unsupportedFrontendPropType(prim("money"))).toBeUndefined();
    expect(unsupportedFrontendPropType(prim("File"))).toBeUndefined();
    expect(unsupportedFrontendPropType({ kind: "valueobject", name: "Address" })).toBeUndefined();
    expect(unsupportedFrontendPropType({ kind: "array", element: prim("money") })).toBeUndefined();
  });

  it("names the offending thing the way the emitters' messages do", () => {
    // What remains refused is the CARRIER kinds — whose emission is blocked a
    // layer up by their own gates, which is why the register row is a seam.
    expect(unsupportedFrontendPropType({ kind: "union", variants: [prim("string")] })).toBe(
      "type kind 'union'",
    );
    // Recursion reports the INNER offender, not the wrapper.
    expect(unsupportedFrontendPropType({ kind: "array", element: { kind: "none" } })).toBe(
      "type kind 'none'",
    );
  });

  it("every declared PRIMITIVE now has a prop spelling", () => {
    // The whole `PrimitiveName` union, driven through the emitter.  This is the
    // assertion that fails the day a new primitive is minted without teaching
    // the prop layer to spell it — the drift this module exists to stop, in the
    // direction the register row was opened for.
    for (const name of PRIMITIVES) {
      expect(unsupportedFrontendPropType(prim(name)), `primitive ${name}`).toBeUndefined();
      expect(emitterAcceptsProp(prim(name)), `primitive ${name}`).toBe(true);
    }
  });

  it("money spells `Decimal` and asks for decimal.js; File and a VO are structural", () => {
    // The SPELLINGS, not just the acceptance — a prop the api module hands a
    // `Decimal` must not be typed `number`, and the VO must be assignable from
    // `z.infer<typeof AddressSchema>`.
    const sink = new Map<string, string>();
    expect(componentPropTsType(prim("money"), AGGS, sink, VOS)).toBe("Decimal");
    expect(takeMoneyPropImport(sink), "money requests decimal.js").toBe(true);
    expect(takeMoneyPropImport(sink), "…exactly once").toBe(false);
    expect(componentPropTsType(prim("File"), AGGS, new Map(), VOS)).toBe(
      "{ url: string; key: string; contentType: string; size: number }",
    );
    // Recursive: the VO's own money field spells `Decimal` too.
    expect(
      componentPropTsType({ kind: "valueobject", name: "Address" }, AGGS, new Map(), VOS),
    ).toBe("{ street: string; total: Decimal }");
  });

  it("an UNDECLARED value object is an emit-time floor, not a silent `unknown`", () => {
    // The floor is the whole reason this layer throws instead of emitting
    // `any`: a prop the frontend cannot type voids the contract the escape
    // hatch exists to enforce.
    expect(() =>
      componentPropTsType({ kind: "valueobject", name: "Nowhere" }, AGGS, new Map(), new Map()),
    ).toThrow(/Nowhere/);
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
    // `money` used to be the counter-example here; it is spellable now
    // (`(arg: Decimal) => void`), so the counter-example moves to a carrier
    // kind — the argument still has to be a type the prop layer can write.
    expect(unsupportedFrontendParamType({ kind: "action", arg: prim("money") })).toBeUndefined();
    expect(unsupportedFrontendParamType({ kind: "action", arg: { kind: "none" } })).toBe(
      "type kind 'none'",
    );
  });
});
