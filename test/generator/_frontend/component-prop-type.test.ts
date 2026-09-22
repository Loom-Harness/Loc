// ---------------------------------------------------------------------------
// `src/generator/_frontend/component-prop-type.ts` — the ONE Loom-type → TS
// spelling used for a `component`'s props on all three JS-embedding frontends
// (React `interface XProps`, Vue `defineProps<{…}>`, Svelte `$props()`).
//
// It exists because the three copies had drifted: React's was a stub that
// returned `"string"` for every non-entity param, so `component Badge(level:
// int)` produced `level: string` (TS2365 on `level > 2`, TS2322 on `<Badge
// level={count} />`).  The module's stated contract is therefore twofold:
//
//   * every supported kind gets its DECLARED type's spelling, not `string`;
//   * an unsupported shape THROWS rather than silently emitting `string` —
//     "a prop the frontend cannot type is a generation-time error, not
//     something to paper over".
//
// Both halves are pinned here, kind by kind, plus the `dtoImports` side effect
// (an aggregate param records the `import type { XResponse } from "../api/x"`
// line its caller emits) and `paramPropTsType`'s `action` / `action(T)`
// callback shape.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import {
  componentPropTsType,
  paramPropTsType,
  takeMoneyPropImport,
} from "../../../src/generator/_frontend/component-prop-type.js";
import type { AggregateIR, ParamIR, PrimitiveName, TypeIR } from "../../../src/ir/types/loom-ir.js";

const prim = (name: PrimitiveName): TypeIR => ({ kind: "primitive", name });
const opt = (inner: TypeIR): TypeIR => ({ kind: "optional", inner });
const arr = (element: TypeIR): TypeIR => ({ kind: "array", element });

/** Only `.has` / `.get` on the NAME is read, so a name-keyed stub is the
 *  whole dependency. */
const aggs = (...names: string[]): ReadonlyMap<string, AggregateIR> =>
  new Map(names.map((n) => [n, { name: n } as AggregateIR]));

const noImports = () => new Map<string, string>();

describe("componentPropTsType — scalars", () => {
  it("maps each numeric primitive to `number`, not `string`", () => {
    for (const n of ["int", "long", "decimal"] as PrimitiveName[]) {
      expect(componentPropTsType(prim(n), aggs(), noImports())).toBe("number");
    }
  });

  it("maps bool → boolean, the string-shaped scalars → string, json → unknown", () => {
    expect(componentPropTsType(prim("bool"), aggs(), noImports())).toBe("boolean");
    for (const n of ["string", "datetime", "guid"] as PrimitiveName[]) {
      expect(componentPropTsType(prim(n), aggs(), noImports())).toBe("string");
    }
    expect(componentPropTsType(prim("json"), aggs(), noImports())).toBe("unknown");
  });

  it("maps `X id` and an enum to `string`", () => {
    const id: TypeIR = { kind: "id", targetName: "Order", valueType: "guid" };
    expect(componentPropTsType(id, aggs(), noImports())).toBe("string");
    expect(componentPropTsType({ kind: "enum", name: "Status" }, aggs(), noImports())).toBe(
      "string",
    );
  });
});

describe("componentPropTsType — aggregates and the dtoImports side effect", () => {
  it("types a KNOWN aggregate as its wire DTO and records the import line", () => {
    const imports = noImports();
    expect(componentPropTsType({ kind: "entity", name: "Order" }, aggs("Order"), imports)).toBe(
      "OrderResponse",
    );
    expect([...imports.entries()]).toEqual([["OrderResponse", "../api/order"]]);
  });

  it("falls back to `unknown` for an entity that is not an aggregate — and records NO import", () => {
    const imports = noImports();
    expect(componentPropTsType({ kind: "entity", name: "Line" }, aggs("Order"), imports)).toBe(
      "unknown",
    );
    expect(imports.size).toBe(0);
  });

  it("records the import once even when the aggregate is reached through wrappers", () => {
    const imports = noImports();
    const t = opt(arr({ kind: "entity", name: "Order" }));
    expect(componentPropTsType(t, aggs("Order"), imports)).toBe("OrderResponse[] | undefined");
    expect([...imports.keys()]).toEqual(["OrderResponse"]);
  });
});

describe("componentPropTsType — wrappers", () => {
  it("renders a list as `T[]` and an optional as `T | undefined`", () => {
    expect(componentPropTsType(arr(prim("int")), aggs(), noImports())).toBe("number[]");
    expect(componentPropTsType(opt(prim("string")), aggs(), noImports())).toBe(
      "string | undefined",
    );
  });

  it("nests wrappers in declaration order", () => {
    // `int?[]` canonicalises as optional(array(int)).
    expect(componentPropTsType(opt(arr(prim("int"))), aggs(), noImports())).toBe(
      "number[] | undefined",
    );
    expect(componentPropTsType(arr(arr(prim("bool"))), aggs(), noImports())).toBe("boolean[][]");
  });
});

describe("componentPropTsType — the loud-failure contract", () => {
  // The throw is still the contract — emitting `any` would void the very check
  // the generated props interface exists to perform — but the WORDING moved
  // into the catalog (Wave C1 packet 1d-ii).  It now names the phase-⑦ gate
  // that makes it unreachable through `ddd generate`
  // (`loom.frontend-prop-type-unsupported`), so a reader of the stack trace has
  // a code to look up instead of a sentence.
  const FLOOR = /internal: the frontend prop layer has no TypeScript spelling for/;

  it("THROWS on a value-object param it has never SEEN — the floor, not a silent `unknown`", () => {
    // Wave C2 packet 2k taught this layer to spell a value object STRUCTURALLY,
    // from the VO's own `fields` — so the floor moved rather than disappearing:
    // it now fires for a VO the caller did not hand over (an unvalidated model,
    // or a caller that forgot to build the index), which is exactly the case
    // where emitting `unknown` would void the contract.
    expect(() =>
      componentPropTsType({ kind: "valueobject", name: "Address" }, aggs(), noImports()),
    ).toThrow(FLOOR);
    expect(() =>
      componentPropTsType({ kind: "valueobject", name: "Address" }, aggs(), noImports()),
    ).toThrow(/value object 'Address'/);
  });

  it("THROWS on a slot param — the call sites handle `slot` before delegating here", () => {
    expect(() => componentPropTsType({ kind: "slot" }, aggs(), noImports())).toThrow(
      /type kind 'slot'/,
    );
  });

  it("SPELLS `money` and `File` — they were the floor until wave C2 packet 2k", () => {
    const sink = noImports();
    expect(componentPropTsType(prim("money"), aggs(), sink)).toBe("Decimal");
    // `Decimal` arrives through the file's single default import, requested by
    // sentinel rather than by an import line — see `takeMoneyPropImport`.
    expect(takeMoneyPropImport(sink)).toBe(true);
    expect(componentPropTsType(prim("File"), aggs(), noImports())).toBe(
      "{ url: string; key: string; contentType: string; size: number }",
    );
  });

  it("still THROWS on a primitive with no spelling at all", () => {
    // `duration` is expression-only — it has no wire form, so it is the one
    // primitive-shaped thing left below the floor.  Keeping a live case here is
    // what stops the arm from rotting into unreachable code.
    expect(() => componentPropTsType(prim("duration"), aggs(), noImports())).toThrow(
      /primitive 'duration'/,
    );
  });
});

// ---------------------------------------------------------------------------
// THE GAP — opened by Wave C1 packet 1d-ii, CLOSED by Wave C2 packet 2k.
//
// The history, because the spelling below only makes sense against it.  The
// note here once said "`File` and value-object params are HONEST gaps — phase
// ④ rejects both, so they never reach the emitter; `money` is the hole."
// Measured, that was wrong in both directions: all four shapes validated
// `0 error(s), 0 warning(s)` and then crashed mid-generate —
//
//   component Price(amount: money)   component Doc(f: File)
//   component Ship(at: Address)      function fmt(m: money): string extern from "./fmt"
//
// 1d-ii replaced the crash with a refusal (`loom.frontend-prop-type-unsupported`
// at phase ⑦, driven by the shared predicate in
// `src/ir/util/frontend-prop-type.ts`, pinned AGAINST this emitter by running
// it in `test/ir/frontend-prop-type-support.test.ts`).  2k replaced the refusal
// with the feature, on all four TS-prop frontends:
//
//   money         `Decimal` — what `moneySchema` parses the wire string into,
//                 so it is what `<Agg>Response["price"]` HOLDS.  Requested
//                 through a sentinel, because decimal.js binds by DEFAULT
//                 import and each file may carry exactly one.
//   File          the four-field ref object, spelled structurally — there is no
//                 emitted `FileRef` alias to import.
//   valueobject   also structural, from `vo.fields` — a `<VO>Schema` lives
//                 inside whichever aggregate's api module reaches it, so there
//                 is no import path a standalone prop could name.
//
// The `it.fails` placeholder that used to sit here proposed
// `number | string | { toString(): string }` for the money arm.  That is NOT
// what landed, and deliberately: a union that admits a bare `string` lets a
// prop be handed an unparsed wire value, which is the bug `moneySchema` exists
// to prevent.  `Decimal` is the parsed type the api module actually produces.
//
// The register row is now `kind: "seam"` (`MAX_OPEN_GAPS` 20 → 19); what still
// reaches the gate is the carrier kinds, and the only one a param position can
// spell (`A or B`) is independently refused by `loom.union-position`.
// ---------------------------------------------------------------------------
describe("componentPropTsType — the gap, now closed", () => {
  it("types a `money` component param as the PARSED value, not a wire union", () => {
    expect(componentPropTsType(prim("money"), aggs(), noImports())).toBe("Decimal");
  });
});

describe("paramPropTsType — the action callback shape", () => {
  const param = (name: string, type: TypeIR): ParamIR => ({ name, type });

  it("renders a bare `action` as a zero-arg void callback", () => {
    expect(paramPropTsType(param("onPick", { kind: "action" }), aggs(), noImports())).toBe(
      "() => void",
    );
  });

  it("renders `action(T)` as a one-arg void callback, typed by the same data rule", () => {
    const imports = noImports();
    const t: TypeIR = { kind: "action", arg: { kind: "entity", name: "Order" } };
    expect(paramPropTsType(param("onPick", t), aggs("Order"), imports)).toBe(
      "(arg: OrderResponse) => void",
    );
    expect([...imports.keys()]).toEqual(["OrderResponse"]);
    expect(
      paramPropTsType(param("onN", { kind: "action", arg: prim("int") }), aggs(), noImports()),
    ).toBe("(arg: number) => void");
  });

  it("unwraps an OPTIONAL action to the same callback type (the `?` lands on the prop, not the type)", () => {
    const t: TypeIR = { kind: "optional", inner: { kind: "action", arg: prim("string") } };
    expect(paramPropTsType(param("onPick", t), aggs(), noImports())).toBe("(arg: string) => void");
  });

  it("delegates every non-action param straight to componentPropTsType", () => {
    for (const t of [prim("int"), arr(prim("string")), opt(prim("bool"))]) {
      expect(paramPropTsType(param("p", t), aggs(), noImports())).toBe(
        componentPropTsType(t, aggs(), noImports()),
      );
    }
  });
});
