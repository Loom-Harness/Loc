import type { TypeIR } from "../../../ir/types/loom-ir.js";
import { numericEncode } from "../../_numeric/target.js";
import { JAVA_NUMERIC } from "../numeric-codec.js";
import { javaValueTypeForId } from "../render-expr.js";
import { JAVA_PROVENANCED_RECORD } from "./provenance.js";

// ---------------------------------------------------------------------------
// Wire-type mapping for the Java DTO layer.  The cross-backend wire
// contract (see the dotnet Requests/Responses emitters):
//
//   money    → STRING on the wire (precise-decimal string; parsed with
//              `new BigDecimal(s)` inbound, `toPlainString()` outbound)
//   decimal  → JSON NUMBER (RS-24), and — RESPONSE ONLY — a `double`.  The
//              domain keeps `BigDecimal` (a `/` runs at
//              `MathContext.DECIMAL128`), so an un-narrowed response shipped
//              34 significant digits where the other four backends ship a
//              double's ≤17.  See `wireJavaType` for the full note.
//   datetime → STRING (ISO-8601; `Instant.parse` / `toString`)
//   id       → the bare id value (uuid string / int / long)
//   enum     → the enum (serialises by name — DSL casing IS the wire)
//   VO       → nested `<Vo>Request` / `<Vo>Response` record
//
// DTOs are records, so component order is declaration order — the
// emitters declare them in wireShape order and Jackson preserves it.
// ---------------------------------------------------------------------------

export type WireDir = "Request" | "Response";

/** The Java primitives a wire component can be. `@NotNull` on one of these is
 *  inert — a primitive is never null — and so is a `x == null` guard, which
 *  additionally does not COMPILE. Every emitter that asks "can this component
 *  actually be null?" reads this one set. */
export const JAVA_PRIMITIVES: ReadonlySet<string> = new Set([
  "int",
  "long",
  "double",
  "float",
  "boolean",
  "short",
  "byte",
]);

/** True when the request component for `t` is a Java REFERENCE — i.e. it can
 *  hold `null`, so `component == null` both compiles and can be true.
 *
 *  `boxed` is the DTO's own boxing decision for this slot (an operation body
 *  boxes every non-optional param per RS-26; a create body leaves them
 *  unboxed), passed in rather than re-derived so the answer cannot drift from
 *  the record the validator is actually reading. */
export function wireComponentNullable(t: TypeIR, boxed: boolean): boolean {
  const inner: TypeIR = boxed && t.kind !== "optional" ? { kind: "optional", inner: t } : t;
  return !JAVA_PRIMITIVES.has(wireJavaType(inner, "Request"));
}

/** True when the wire form of this type is a nested RECORD — a value object or
 *  an entity — so a Bean Validation walk needs `@Valid` to descend into it.
 *  Without that the outer `@NotNull` is checked and the members inside are not,
 *  which is the difference between refusing `{"price":{"amount":null}}` and
 *  NPE-ing on it. */
export function bearsNestedRecord(t: TypeIR): boolean {
  switch (t.kind) {
    case "valueobject":
    case "entity":
      return true;
    case "array":
      return bearsNestedRecord(t.element);
    case "optional":
      return bearsNestedRecord(t.inner);
    default:
      return false;
  }
}

/** The Java type a domain type takes inside a request/response record. */
export function wireJavaType(t: TypeIR, dir: WireDir, boxed = false): string {
  switch (t.kind) {
    case "primitive":
      switch (t.name) {
        case "int":
          return boxed ? "Integer" : "int";
        case "long":
          return boxed ? "Long" : "long";
        case "bool":
          return boxed ? "Boolean" : "boolean";
        case "decimal":
          // RS-24 narrowing, RESPONSE ONLY (#2563 on node, #2575 on .NET,
          // M-T6.46 here).  A plain `decimal` is a JSON NUMBER, and the other
          // four backends all carry that number through an IEEE-754 double —
          // node `Number(...)`, python `float(...)`, elixir `Decimal.to_float`,
          // .NET's response-side `double`.  Java's domain type is `BigDecimal`
          // and a `derived` division renders through `MathContext.DECIMAL128`,
          // so an un-narrowed response record serialized all 34 significant
          // digits: `0.3333333333333333333333333333333333` against everyone
          // else's `0.3333333333333333`.
          //
          // The REQUEST side deliberately stays `BigDecimal` (the same
          // asymmetry #2575 chose): a `double` request component would accept a
          // JSON number outside `BigDecimal`'s useful range and then fail
          // converting it to the domain type — a 500 where the current parse
          // gives a 400.  A client may send more precision than it reads back,
          // which is already true of every other backend.
          if (dir === "Response") return boxed ? "Double" : "double";
          return "BigDecimal";
        case "money":
        case "datetime":
          return "String";
        case "string":
          return "String";
        case "guid":
          return "UUID";
        case "json":
          return "JsonNode";
        case "File":
          // Passive wire-only leaf — the shared FileRef record is both the
          // domain and the wire shape, so no conversion (M-T1.2).
          return "FileRef";
      }
      return "Object";
    case "id":
      return javaValueTypeForId(t.valueType);
    case "enum":
      return t.name;
    case "valueobject":
      return `${t.name}${dir}`;
    case "entity":
      // Containments carry the part's response record.
      return `${t.name}Response`;
    case "array":
      return `List<${wireJavaType(t.element, dir, true)}>`;
    case "optional":
      return wireJavaType(t.inner, dir, true);
    case "genericInstance":
      // `Provenanced<Integer>` (M-T6.12).  The carried type is BOXED — a Java
      // generic argument cannot be a primitive — which is also why the value
      // keeps its identity in the published schema instead of collapsing to
      // the `Object` the default arm would have produced.
      if (t.ctor === "provenanced") {
        return `${JAVA_PROVENANCED_RECORD}<${wireJavaType(t.arg, dir, true)}>`;
      }
      return "Object";
    default:
      return "Object";
  }
}

/** Imports the wire type needs (java.* only; generated records are
 *  package-local or wildcard-imported).
 *
 *  Direction-aware for the same reason `wireJavaType` is: a RESPONSE `decimal`
 *  is a `double`/`Double`, so the record must not import a `BigDecimal` it no
 *  longer names (javac warns on nothing, but an unused import is noise the
 *  emitter has never shipped elsewhere).  A REQUEST `decimal` still needs it. */
export function collectWireImports(t: TypeIR, into: Set<string>, dir: WireDir): Set<string> {
  switch (t.kind) {
    case "primitive":
      if (t.name === "decimal" && dir === "Request") into.add("java.math.BigDecimal");
      if (t.name === "guid") into.add("java.util.UUID");
      if (t.name === "json") into.add("tools.jackson.databind.JsonNode");
      return into;
    case "id":
      if (t.valueType === "guid") into.add("java.util.UUID");
      return into;
    case "array":
      into.add("java.util.List");
      return collectWireImports(t.element, into, dir);
    case "optional":
      return collectWireImports(t.inner, into, dir);
    case "genericInstance":
      // The carrier itself is a generated `domain.common` record — imported by
      // the DTO emitter, which knows the base package.  Only its ARGUMENT can
      // pull in a java.* import.
      return collectWireImports(t.arg, into, dir);
    default:
      return into;
  }
}

/** Expression converting a DOMAIN value (`expr`, already a typed Java
 *  expression) to its wire form for a response record. */
export function domainToWire(t: TypeIR, expr: string): string {
  switch (t.kind) {
    case "primitive":
      // money → wire string at the FIXED money scale (RS-12): bare
      // `toPlainString()` echoes the value's own scale (`12.5` vs `12.50`), so
      // pin it to the canonical `NUMERIC(19,4)` scale for a wire value
      // byte-consistent with the other backends.
      if (t.name === "money") return numericEncode(JAVA_NUMERIC, "money", "dto-map", expr);
      if (t.name === "datetime") return `${expr}.toString()`;
      // decimal → the response's `double` component (RS-24 / M-T6.46).  The
      // narrowing is the wire boundary's job, exactly as on .NET (#2575): the
      // DOMAIN value keeps every digit `MathContext.DECIMAL128` produced.
      if (t.name === "decimal") return numericEncode(JAVA_NUMERIC, "decimal", "dto-map", expr);
      return expr;
    case "id":
      return `${expr}.value()`;
    case "valueobject":
      return `${t.name}Response.from(${expr})`;
    case "entity":
      // Single containments start null (created empty, filled by an op).
      return `${expr} == null ? null : ${t.name}Response.from(${expr})`;
    case "array": {
      const mapped = elementMapper(t.element);
      return mapped ? `${expr}.stream().map(${mapped}).toList()` : expr;
    }
    case "optional": {
      const inner = domainToWire(t.inner, "__v");
      if (inner === "__v") return expr;
      return `${expr} == null ? null : ${domainToWire(t.inner, `(${expr})`)}`;
    }
    default:
      return expr;
  }
}

function elementMapper(element: TypeIR): string | null {
  switch (element.kind) {
    case "primitive":
      if (element.name === "money")
        return `__x -> ${numericEncode(JAVA_NUMERIC, "money", "dto-map", "__x")}`;
      if (element.name === "datetime") return "__x -> __x.toString()";
      // `decimal[]` → `List<Double>` (RS-24 / M-T6.46): the element narrows on
      // the response exactly as a scalar decimal component does.
      if (element.name === "decimal")
        return `__x -> ${numericEncode(JAVA_NUMERIC, "decimal", "dto-map", "__x")}`;
      return null;
    case "id":
      return "__x -> __x.value()";
    case "valueobject":
      return `${element.name}Response::from`;
    case "entity":
      return `${element.name}Response::from`;
    default:
      return null;
  }
}

/** Expression converting a WIRE value (`expr`, a request-record read) to
 *  its domain form.
 *
 *  `pointer` is the RFC 6901 path of the field being converted (`/price`,
 *  `/lines/0/unitPrice`) and is REQUIRED, deliberately (M-T6.48): a money
 *  conversion can now FAIL, and its refusal carries the pointer so the advice
 *  renders the same `errors: [{pointer, message}]` entry the other four
 *  backends send.  Making it a required argument rather than an optional one
 *  is the point — a new call site cannot reintroduce a bare, un-pointed parse
 *  by simply forgetting to pass it.  (The .NET arm took the same decision for
 *  the same reason.) */
export function wireToDomain(t: TypeIR, expr: string, pointer: string): string {
  switch (t.kind) {
    case "primitive":
      // Total, and pointed: `new BigDecimal("12,50")` threw
      // `NumberFormatException` out of the service and answered 500.
      if (t.name === "money")
        return `WireFormatException.money(${expr}, ${JSON.stringify(pointer)})`;
      // Guarded for the same reason and in the same shape as `money` above:
      // `Instant.parse("")` / `Instant.parse("not-a-date")` threw
      // `DateTimeParseException` out of the service, which no advice arm
      // matched, so the caller got 500 for input the server itself refused
      // (schemathesis F19 — money's half landed with M-T6.48 and left this one).
      if (t.name === "datetime")
        return `WireFormatException.instant(${expr}, ${JSON.stringify(pointer)})`;
      return expr;
    case "id":
      return `new ${t.targetName}Id(${expr})`;
    case "valueobject":
      return `to${t.name}(${expr})`;
    case "array": {
      const el = t.element;
      // The element pointer keeps the RFC 6901 index wildcard shape the
      // nested-errors work (M-T9.25) established for collections.
      const mapped = wireToDomain(el, "__x", `${pointer}/0`);
      if (mapped === "__x") return expr;
      // MUTABLE copy, not `Stream.toList()`.  This value is assigned straight
      // onto a domain field, and on a value-object collection that field is a
      // JPA `@ElementCollection`.  Hibernate's merge REPLACES a collection in
      // place — `CollectionType.replaceElements` calls `clear()` on the target
      // — so an immutable `Stream.toList()` result made every UPDATE of an
      // aggregate with a `Money[]`-shaped field answer 500
      // (`UnsupportedOperationException` from `ImmutableCollections.uoe`).
      // CREATE never hit it: a fresh entity is persisted, never merged, which
      // is why the compile tier and the create-only e2e both stayed green.
      // Found by the caller census's `update` drain on `value-collections`.
      return `new java.util.ArrayList<>(${expr}.stream().map(__x -> ${mapped}).toList())`;
    }
    case "optional": {
      const inner = wireToDomain(t.inner, expr, pointer);
      if (inner === expr) return expr;
      return `${expr} == null ? null : ${inner}`;
    }
    default:
      return expr;
  }
}

/** True when converting this type at the WIRE BOUNDARY emits a guarded parse —
 *  i.e. the type tree carries a `money` or `datetime`, the two primitives that
 *  cross as strings and are parsed rather than bound. Call sites use it to add
 *  the `WireFormatException` import only where the guard is actually emitted,
 *  so a file with no such field keeps its import block byte-identical. */
export function wireToDomainGuards(t: TypeIR): boolean {
  switch (t.kind) {
    case "primitive":
      return t.name === "money" || t.name === "datetime";
    case "array":
      return wireToDomainGuards(t.element);
    case "optional":
      return wireToDomainGuards(t.inner);
    default:
      return false;
  }
}

/** Imports the inbound conversion needs. */
export function collectWireToDomainImports(
  t: TypeIR,
  into: Set<string>,
  basePkg: string,
): Set<string> {
  switch (t.kind) {
    case "primitive":
      if (t.name === "money") {
        into.add("java.math.BigDecimal");
        // The guarded parse `wireToDomain` emits (M-T6.48).  REQUIRED, and
        // `basePkg` is required with it: emitting the call without the import
        // is a `cannot find symbol` that no string-level test sees — the
        // generated-java compile caught exactly that here.
        into.add(`${basePkg}.domain.common.WireFormatException`);
      }
      if (t.name === "datetime") {
        into.add("java.time.Instant");
        // Same reason as `money`: the guarded parse names a type this file has
        // to import, and a missing import is a `cannot find symbol` no
        // string-level test sees — only the generated-java compile does.
        into.add(`${basePkg}.domain.common.WireFormatException`);
      }
      return into;
    case "array":
      return collectWireToDomainImports(t.element, into, basePkg);
    case "optional":
      return collectWireToDomainImports(t.inner, into, basePkg);
    default:
      return into;
  }
}

/** Value objects referenced (transitively) by a list of wire types —
 *  drives nested `<Vo>Request`/`<Vo>Response` record emission. */
export function referencedValueObjects(types: readonly TypeIR[], into: Set<string>): Set<string> {
  for (const t of types) {
    if (t.kind === "valueobject") into.add(t.name);
    else if (t.kind === "array") referencedValueObjects([t.element], into);
    else if (t.kind === "optional") referencedValueObjects([t.inner], into);
  }
  return into;
}
