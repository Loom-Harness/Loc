import { describe, expect, it } from "vitest";
import type { TypeIR } from "../../../src/ir/types/loom-ir.js";
import { felizPersistCodec } from "../../../src/ir/util/feliz-persist-codec.js";
import { flutterPersistCodec } from "../../../src/ir/util/flutter-persist-codec.js";

// The two store-persistence classifiers — `persist: local|session|url` — and
// the DIVERGENCES between them.  M-T9.17 slice 4: no test calls either
// function today.
//
// Each answers the same question for its own target ("can a field of this type
// cross the untyped storage boundary and come back?") and each is consulted by
// BOTH halves of its pipeline: the emitter picks the codec, and a validator
// leaf raises the unsupported diagnostic for the types that have none
// (`loom.store-lifetime-target-unsupported`, its `#field` / `#flutter-field`
// message variants).  So a wrong answer is either a field that silently stops
// persisting, or a refused model.
//
// They are written as near-twins, and that is the risk this file is shaped
// around: a copy-paste from one file to the other would erase a deliberate
// disagreement without failing anything else.  The divergence table below is
// the point of the file; the per-type cases exist so a divergence that moves
// says WHICH side moved.
//
// Wave C2 packet 2i drained the F# table toward the union (the fix the
// `feliz-flutter-persist-codec-asymmetry` ledger row asked for): F# grew
// `datetime` / `guid` / `enum` arms and list elements over every scalar, so
// FIVE divergences became ONE — `json`, which F# keeps as raw text and Dart
// refuses.  That last row is the FLUTTER half, and is the only thing left
// between the two tables.

const prim = (name: string): TypeIR => ({ kind: "primitive", name }) as TypeIR;
const arr = (element: TypeIR): TypeIR => ({ kind: "array", element });
const opt = (inner: TypeIR): TypeIR => ({ kind: "optional", inner });
const id = (): TypeIR => ({ kind: "id", targetName: "Order", valueType: "guid" }) as TypeIR;
const enumT = (): TypeIR => ({ kind: "enum", name: "Status" });
const vo = (): TypeIR => ({ kind: "valueobject", name: "Money" });
const entity = (): TypeIR => ({ kind: "entity", name: "Line" });

describe("felizPersistCodec — the F# side", () => {
  it("keeps int and long as SEPARATE scalars", () => {
    // They were one `int` codec until M-T1.22.  `type-fs.ts` spells a Loom
    // `long` `int64`, so the `int` codec's `System.Int32.TryParse` silently
    // refuses (and drops) any persisted value past 2^31 - the store path is
    // total, so a failed parse reads as "absent", not as an error.  The `long`
    // codec parses with `System.Int64.TryParse` instead.
    expect(felizPersistCodec(prim("int"))).toEqual({ kind: "scalar", scalar: "int" });
    expect(felizPersistCodec(prim("long"))).toEqual({ kind: "scalar", scalar: "long" });
  });

  it("maps string and json to the verbatim `string` codec", () => {
    // `json` persists as the raw text — the store path never parses it.
    expect(felizPersistCodec(prim("string"))).toEqual({ kind: "scalar", scalar: "string" });
    expect(felizPersistCodec(prim("json"))).toEqual({ kind: "scalar", scalar: "string" });
  });

  it("keeps decimal and money as SEPARATE scalars", () => {
    // They differ at the wire, not in F#: `decimal` serialises as a JSON
    // number, `money` as a JSON string.  Collapsing them would round-trip one
    // of the two through the wrong JSON shape.
    expect(felizPersistCodec(prim("decimal"))).toEqual({ kind: "scalar", scalar: "decimal" });
    expect(felizPersistCodec(prim("money"))).toEqual({ kind: "scalar", scalar: "money" });
  });

  it("maps bool, and an id to `string`", () => {
    expect(felizPersistCodec(prim("bool"))).toEqual({ kind: "scalar", scalar: "bool" });
    expect(felizPersistCodec(id())).toEqual({ kind: "scalar", scalar: "string" });
  });

  it("carries datetime and guid as their own scalars — both `TryParse` totally", () => {
    // `System.DateTime.TryParse` / `System.Guid.TryParse` never throw, and the
    // written form is the ISO-8601 / canonical string the JS frontends hold in
    // their `string` cell, so the blob round-trips across frontends.
    expect(felizPersistCodec(prim("datetime"))).toEqual({ kind: "scalar", scalar: "datetime" });
    expect(felizPersistCodec(prim("guid"))).toEqual({ kind: "scalar", scalar: "guid" });
  });

  it("maps an ENUM to `string` — `typeToFs` spells one `string` in F#", () => {
    expect(felizPersistCodec(enumT())).toEqual({ kind: "scalar", scalar: "string" });
  });

  it("REFUSES duration and File", () => {
    // `duration` is expression-only (no `PrimitiveType` spelling), so this arm
    // is unreachable from a `state {}` field; `File` spells a `FileRef option`
    // record, not a scalar cell.
    expect(felizPersistCodec(prim("duration"))).toBeUndefined();
    expect(felizPersistCodec(prim("File"))).toBeUndefined();
  });

  it("REFUSES value objects and entities — the store path emits no record codec", () => {
    expect(felizPersistCodec(vo())).toBeUndefined();
    expect(felizPersistCodec(entity())).toBeUndefined();
  });

  it("lists EVERY scalar element it supports, decimal / money / datetime included", () => {
    // Every scalar codec has a total per-CELL conversion, so the element set
    // IS the scalar set — asserted against the scalar cases above, since a
    // table that re-narrowed the element set would still pass any test that
    // only ever checked scalars.
    expect(felizPersistCodec(arr(prim("int")))).toEqual({ kind: "list", element: "int" });
    expect(felizPersistCodec(arr(prim("string")))).toEqual({ kind: "list", element: "string" });
    expect(felizPersistCodec(arr(id()))).toEqual({ kind: "list", element: "string" });
    expect(felizPersistCodec(arr(prim("decimal")))).toEqual({ kind: "list", element: "decimal" });
    expect(felizPersistCodec(arr(prim("money")))).toEqual({ kind: "list", element: "money" });
    expect(felizPersistCodec(arr(prim("datetime")))).toEqual({ kind: "list", element: "datetime" });
    expect(felizPersistCodec(arr(prim("guid")))).toEqual({ kind: "list", element: "guid" });
    expect(felizPersistCodec(arr(enumT()))).toEqual({ kind: "list", element: "string" });
  });

  it("REFUSES a list whose element has no codec, and a nested list", () => {
    expect(felizPersistCodec(arr(prim("File")))).toBeUndefined();
    expect(felizPersistCodec(arr(vo()))).toBeUndefined();
    expect(felizPersistCodec(arr(arr(prim("int"))))).toBeUndefined();
  });
});

describe("flutterPersistCodec — the Dart side", () => {
  it("maps int and long to `int`, decimal to `double`, money to `money`", () => {
    expect(flutterPersistCodec(prim("int"))).toEqual({ kind: "scalar", scalar: "int" });
    expect(flutterPersistCodec(prim("long"))).toEqual({ kind: "scalar", scalar: "int" });
    expect(flutterPersistCodec(prim("decimal"))).toEqual({ kind: "scalar", scalar: "double" });
    expect(flutterPersistCodec(prim("money"))).toEqual({ kind: "scalar", scalar: "money" });
  });

  it("maps bool and datetime", () => {
    expect(flutterPersistCodec(prim("bool"))).toEqual({ kind: "scalar", scalar: "bool" });
    expect(flutterPersistCodec(prim("datetime"))).toEqual({ kind: "scalar", scalar: "datetime" });
  });

  it("maps id and ENUM to `string` — both ride Dart as plain strings", () => {
    expect(flutterPersistCodec(id())).toEqual({ kind: "scalar", scalar: "string" });
    expect(flutterPersistCodec(enumT())).toEqual({ kind: "scalar", scalar: "string" });
  });

  it("falls THROUGH to `string` for string and guid", () => {
    // The Dart table's default arm, not an explicit case — so a new primitive
    // added upstream silently becomes a `String` here.  Pinned so that the
    // fall-through is a decision on record rather than an accident.
    expect(flutterPersistCodec(prim("string"))).toEqual({ kind: "scalar", scalar: "string" });
    expect(flutterPersistCodec(prim("guid"))).toEqual({ kind: "scalar", scalar: "string" });
  });

  it("PERSISTS a `json` cell verbatim; refuses File (the fixed FileRef object)", () => {
    // Widened in wave C2: a `json` cell IS json, so storing the decoded value
    // back is the IDENTITY conversion — the one case that cannot fail.  The JS
    // frontends have always persisted it (Zustand serialises the whole state),
    // so refusing it was a per-target gap rather than a shared limit.
    expect(flutterPersistCodec(prim("json"))).toEqual({ kind: "json" });
    expect(flutterPersistCodec(prim("File"))).toBeUndefined();
  });

  it("PERSISTS an OPTIONAL scalar as a nullable cell — except under `url`", () => {
    // The blob tiers restore an absent key as `null`, which for a nullable cell
    // is the RIGHT value, not a lost one.
    expect(flutterPersistCodec(opt(prim("int")))).toEqual({
      kind: "scalar",
      scalar: "int",
      nullable: true,
    });
    expect(flutterPersistCodec(opt(prim("datetime")), "session")).toEqual({
      kind: "scalar",
      scalar: "datetime",
      nullable: true,
    });
    // `url` is refused on the RESTORE side: `hydrateFromUrl` re-seeds through
    // `copyWith`, whose `x ?? this.x` cannot set a cell to null, so an absent
    // param would silently KEEP the old value — a wrong value, not a missing
    // feature.
    expect(flutterPersistCodec(opt(prim("int")), "url")).toBeUndefined();
    // A nullable COLLECTION / `json` is a second kind of emptiness the flat
    // blob cannot distinguish — still refused.
    expect(flutterPersistCodec(opt(arr(prim("int"))))).toBeUndefined();
    expect(flutterPersistCodec(opt(prim("json")))).toBeUndefined();
    // …and an optional of a type with no codec at all stays refused.
    expect(flutterPersistCodec(opt(vo()))).toBeUndefined();
  });

  it("REFUSES value objects and entities", () => {
    expect(flutterPersistCodec(vo())).toBeUndefined();
    expect(flutterPersistCodec(entity())).toBeUndefined();
  });

  it("lists ANY scalar element it supports, decimal and money included", () => {
    expect(flutterPersistCodec(arr(prim("int")))).toEqual({ kind: "list", element: "int" });
    expect(flutterPersistCodec(arr(prim("decimal")))).toEqual({ kind: "list", element: "double" });
    expect(flutterPersistCodec(arr(prim("money")))).toEqual({ kind: "list", element: "money" });
    expect(flutterPersistCodec(arr(enumT()))).toEqual({ kind: "list", element: "string" });
  });

  it("REFUSES a list whose element has no codec, and a nested list", () => {
    expect(flutterPersistCodec(arr(prim("json")))).toBeUndefined();
    expect(flutterPersistCodec(arr(vo()))).toBeUndefined();
    expect(flutterPersistCodec(arr(arr(prim("int"))))).toBeUndefined();
  });
});

describe("the ONE remaining divergence between the two tables", () => {
  // The reason this file pairs them.  A copy-paste between the two
  // near-identical modules would quietly erase a deliberate disagreement, and
  // nothing else in the suite would notice.  `support` is asserted as a
  // boolean pair so the failure message names the direction that moved.
  const support = (t: TypeIR) => ({
    feliz: felizPersistCodec(t) !== undefined,
    flutter: flutterPersistCodec(t) !== undefined,
  });

  it("json: BOTH persist it now — the one divergence that closed", () => {
    // This row used to point the other way (F# kept the raw text, Dart
    // refused), and was the reason a reader could not conclude "Flutter is
    // simply the more permissive table".  Wave C2 closed the Dart half, which
    // narrows ledger row `feliz-flutter-persist-codec-asymmetry`: `json` is no
    // longer a type that persists on one self-hosting frontend and not the
    // other.  The divergences that REMAIN all point the same way now (Dart
    // permissive, F# not), which is itself worth knowing — see M-T1.20.
    expect(support(prim("json"))).toEqual({ feliz: true, flutter: true });
  });

  it("an OPTIONAL scalar: Dart persists it, F# does not", () => {
    // A new divergence, opened deliberately by the same widening: the F# table
    // has no `optional` arm at all.  Pinned so the asymmetry stays a reviewed
    // fact rather than being discovered by an author whose store moves between
    // the two frontends.
    expect(support(opt(prim("int")))).toEqual({ feliz: false, flutter: true });
    expect(support(opt(prim("string")))).toEqual({ feliz: false, flutter: true });
  });

  it("and they AGREE everywhere else, so `json` is the WHOLE difference", () => {
    // Without this, the row above would be consistent with the two functions
    // having drifted everywhere; pinning the agreement is what makes `json`
    // the exhaustive difference over the types tested here.  The four
    // ex-divergences (enum, datetime, guid, decimal[]/money[]) are in the
    // AGREE list now, which is what the drain has to keep true.
    for (const t of [
      prim("int"),
      prim("long"),
      prim("bool"),
      prim("string"),
      prim("decimal"),
      prim("money"),
      prim("datetime"),
      prim("guid"),
      id(),
      enumT(),
      arr(prim("int")),
      arr(prim("string")),
      arr(prim("decimal")),
      arr(prim("money")),
      arr(prim("datetime")),
      arr(enumT()),
    ]) {
      expect(support(t), JSON.stringify(t)).toEqual({ feliz: true, flutter: true });
    }
    for (const t of [prim("File"), vo(), entity(), arr(vo()), arr(arr(prim("int")))]) {
      expect(support(t), JSON.stringify(t)).toEqual({ feliz: false, flutter: false });
    }
  });
});
