// The type relations validators judge with (`src/language/typing/relations.ts`),
// over the typing pass's own `Ty`. The union and `option` cases are the ones a
// second, lossy type view got wrong: it read a union as its first variant.

import { AstUtils } from "langium";
import { beforeAll, describe, expect, it } from "vitest";
import {
  type Aggregate,
  isAggregate,
  isPayloadDecl,
  type Model,
  type PayloadDecl,
} from "../../../src/language/generated/ast.js";
import {
  comparable,
  isAssignable,
  ternaryJoin,
  typesEqual,
  typeToString,
} from "../../../src/language/typing/relations.js";
import type { Ty } from "../../../src/language/typing/ty.js";
import { parseString } from "../../_helpers/index.js";

const prim = (name: "int" | "long" | "decimal" | "money" | "string" | "guid"): Ty => ({
  kind: "primitive",
  name,
});
const opt = (inner: Ty): Ty => ({ kind: "optional", inner });
const union = (...variants: Ty[]): Ty => ({ kind: "union", variants });
const NONE: Ty = { kind: "none" };
const NULL_LIT: Ty = opt({ kind: "never" });

let order: Ty;
let notFound: Ty;
let orderResponse: Ty;

beforeAll(async () => {
  const model = (
    await parseString(
      `system S { subdomain D { context C {
        error NotFound { resource: string }
        response OrderResponse { code: string }
        aggregate Order { code: string }
      } } }`,
      { validate: false },
    )
  ).model as Model;
  const nodes = [...AstUtils.streamAst(model)];
  const agg = nodes.find(isAggregate) as Aggregate;
  const payloads = nodes.filter(isPayloadDecl) as PayloadDecl[];
  const named = (n: string) => payloads.find((p) => p.name === n) as PayloadDecl;
  order = { kind: "record", shape: { of: "aggregate", ref: agg } };
  notFound = { kind: "record", shape: { of: "payload", ref: named("NotFound") } };
  orderResponse = { kind: "record", shape: { of: "payload", ref: named("OrderResponse") } };
});

describe("isAssignable", () => {
  it("keeps the scalar lattice: widening, the guid/string bridge, null into T?", () => {
    expect(isAssignable(prim("int"), prim("long"))).toBe(true);
    expect(isAssignable(prim("long"), prim("int"))).toBe(false);
    expect(isAssignable(prim("int"), prim("money"))).toBe(false);
    expect(isAssignable(prim("guid"), prim("string"))).toBe(true);
    expect(isAssignable(NULL_LIT, opt(prim("string")))).toBe(true);
    expect(isAssignable(opt(prim("int")), opt(prim("string")))).toBe(false);
  });

  it("a union value fits a slot only when every variant does", () => {
    // The lossy view read `Order or NotFound` as `Order` and admitted this.
    expect(isAssignable(union(order, notFound), order)).toBe(false);
    expect(isAssignable(union(order, order), order)).toBe(true);
  });

  it("a union slot takes a value that fits one of its variants", () => {
    expect(isAssignable(order, union(order, notFound))).toBe(true);
    expect(isAssignable(prim("int"), union(prim("long"), prim("string")))).toBe(true);
    expect(isAssignable(prim("money"), union(order, notFound))).toBe(false);
  });

  it("an aggregate fits its `<Agg>Response` wire record, element-wise through `[]`", () => {
    expect(isAssignable(order, orderResponse)).toBe(true);
    expect(
      isAssignable({ kind: "array", element: order }, { kind: "array", element: orderResponse }),
    ).toBe(true);
    expect(isAssignable(order, notFound)).toBe(false);
    expect(isAssignable(orderResponse, order)).toBe(false);
  });

  it("`null` is not an option's absent case", () => {
    expect(isAssignable(NULL_LIT, union(order, NONE))).toBe(false);
    expect(isAssignable(order, union(order, NONE))).toBe(true);
  });
});

describe("typesEqual / comparable / ternaryJoin", () => {
  it("union identity is the variant set", () => {
    expect(typesEqual(union(order, notFound), union(notFound, order))).toBe(true);
    expect(typesEqual(union(order, notFound), union(order, NONE))).toBe(false);
  });

  it("a union compares with what one of its variants compares with", () => {
    expect(comparable(union(prim("int"), prim("string")), prim("long"))).toBe(true);
    expect(comparable(union(order, notFound), prim("int"))).toBe(false);
    expect(comparable(union(order, notFound), NULL_LIT)).toBe(true);
  });

  it("joins a ternary's branches", () => {
    expect(ternaryJoin(prim("int"), prim("long"))).toEqual(prim("long"));
    expect(ternaryJoin(NULL_LIT, prim("int"))).toEqual(opt(prim("int")));
    expect(ternaryJoin(prim("int"), prim("string"))).toBeUndefined();
  });
});

describe("typeToString", () => {
  it("prints a type as it is written", () => {
    expect(typeToString(union(order, notFound))).toBe("Order or NotFound");
    expect(typeToString(union(order, NONE))).toBe("Order option");
    expect(typeToString({ kind: "generic", ctor: "paged", arg: order })).toBe("Order paged");
    expect(typeToString(opt({ kind: "array", element: prim("int") }))).toBe("int[]?");
    expect(typeToString({ kind: "primitive", name: "string", sensitivity: ["pii"] })).toBe(
      "string!{pii}",
    );
  });
});
