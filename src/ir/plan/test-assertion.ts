// What a value assertion in a `test` body means: which comparison
// `expect(subject).<matcher>(expected)` makes, and how the expected literal is
// built at the subject's type.
//
// The same `.ddd` assertion must pass or fail the same way on every backend.
// Each backend's native equality disagrees with the others on exactly the
// types a domain test asserts about: `money` (Java's `BigDecimal.equals` and
// Elixir's `==` are scale-sensitive), `datetime` (a struct in Elixir, an
// object in TypeScript, so `<`/`==` are not chronological), value objects and
// collections (vitest's `toBe` is reference identity), and `X id` (a typed id
// record on .NET and Java never equals its string).  So the comparison kind is
// decided here, once, from the subject's type, and each test framework renders
// it from a leaf table (`src/generator/_test/assertion-target.ts`).
//
// The expected literal follows the rule every literal in a test body follows
// (`decideLiteralCoercion`): an ISO string at a `datetime`/`date` subject is
// that date, a numeric literal at a `money` subject is an exact decimal built
// from its digits, a string at an `X id` subject is that id.  The rule applies
// to the ordering matchers as well as `toBe`.

import { bodyTypeOf } from "../../util/expr-body-type.js";
import { unionInstanceName, variantTag } from "../stdlib/unions.js";
import type { ExprIR, TypeIR } from "../types/loom-ir.js";

/** What coercion a literal in a typed position needs, if any. */
export type LiteralCoercion =
  | { kind: "id"; targetName: string }
  | { kind: "datetime" }
  | { kind: "date" }
  | { kind: "money"; digits: string }
  | { kind: "none" };

/** Decide the coercion for `value` written in a position declared `type`.
 *
 *  Only a raw literal is ever coerced: a string at an id/date/datetime
 *  position, a number at a `money` position.  Everything else already renders
 *  at the target type and wrapping it would BREAK the emission: `now` renders
 *  as the backend's current instant, a `ref` to a let-binding or parameter is
 *  already typed.  That guard is why this is a decision function and not a
 *  type lookup. */
export function decideLiteralCoercion(type: TypeIR | undefined, value: ExprIR): LiteralCoercion {
  if (value.kind === "literal" && isMoneyType(type) && NUMERIC_LITS.has(value.lit)) {
    return { kind: "money", digits: value.value };
  }
  if (value.kind !== "literal" || value.lit !== "string") return { kind: "none" };
  // An optional position is still that position: `X?` reaches the call as
  // `X | undefined`, so a bare literal there needs the same wrap.
  const t = unwrapOptional(type);
  if (t?.kind === "id") return { kind: "id", targetName: t.targetName };
  if (t?.kind === "primitive" && t.name === "datetime") return { kind: "datetime" };
  if (t?.kind === "primitive" && t.name === "date") return { kind: "date" };
  return { kind: "none" };
}

/** The numeric literal kinds a `money` position takes as written. */
const NUMERIC_LITS: ReadonlySet<string> = new Set(["int", "long", "decimal", "money"]);

function isMoneyType(type: TypeIR | undefined): boolean {
  const t = unwrapOptional(type);
  return t?.kind === "primitive" && t.name === "money";
}

function unwrapOptional(t: TypeIR | undefined): TypeIR | undefined {
  return t?.kind === "optional" ? t.inner : t;
}

/** How the subject and the expected value are compared.
 *
 *  - `scalar`: the language's own equality / ordering (int, string, bool,
 *    enum, an id against an id, and every `toBe(null)`).
 *  - `decimal`: by numeric value, scale-insensitive (`15.00` equals `15`).
 *  - `instant`: by point in time.
 *  - `date`: by calendar day.
 *  - `structural`: a record (value object, aggregate, entity part) by value,
 *    field by field, with any decimal inside compared by numeric value.
 *  - `sequence`: a collection element by element, in order, each element by
 *    value. */
export type AssertionCompare =
  | "scalar"
  | "decimal"
  | "instant"
  | "date"
  | "structural"
  | "sequence";

/** The relation an equality or ordering matcher asserts. */
export type AssertionRelation = "eq" | "gt" | "ge" | "lt" | "le";

const RELATIONS: Readonly<Record<string, AssertionRelation>> = {
  toBe: "eq",
  toBeGreaterThan: "gt",
  toBeGreaterThanOrEqual: "ge",
  toBeLessThan: "lt",
  toBeLessThanOrEqual: "le",
};

/** One value assertion, decided. */
export type AssertionPlan =
  | {
      kind: "compare";
      relation: AssertionRelation;
      compare: AssertionCompare;
      negate: boolean;
      /** The asserted expression, `.not` and parentheses peeled. */
      subject: ExprIR;
      /** The subject may be absent (an optional field or binding). */
      optional: boolean;
      expected: ExprIR;
      /** How the expected literal is built at the subject's type. */
      expectedLiteral: LiteralCoercion;
    }
  | { kind: "null"; negate: boolean; subject: ExprIR }
  /** `expect(<call>).toBe(<ErrorArm>)`: which arm of the union the call
   *  returned, the declared error named by its bare name.  Tag only — the
   *  arm's fields are not compared. */
  | {
      kind: "tag";
      negate: boolean;
      subject: ExprIR;
      /** The union's instance name (`stringOrClosed`), which names its arm
       *  classes on the backends that generate one per arm. */
      union: string;
      /** The arm's tag (`Closed`). */
      tag: string;
    }
  | {
      kind: "contain";
      /** Element membership in a collection, or substring of a string. */
      within: "collection" | "string";
      negate: boolean;
      subject: ExprIR;
      expected: ExprIR;
    };

/** The plan for `expect(subject).<matcher>(expected)` (or `.not.<matcher>`), or
 *  `undefined` when `expr` is not a value matcher the unit and integration
 *  tiers render (a bare boolean `expect(x)` is not one). */
export function assertionPlan(expr: ExprIR): AssertionPlan | undefined {
  if (expr.kind !== "method-call" || !expr.isIntrinsicMatcher) return undefined;
  let receiver = expr.receiver;
  let negate = false;
  let subjectType = expr.receiverType;
  if (receiver.kind === "member" && receiver.member === "not") {
    negate = true;
    subjectType = receiver.receiverType;
    receiver = receiver.receiver;
  }
  const subject = receiver.kind === "paren" ? receiver.inner : receiver;
  const expected = expr.args[0];
  if (expr.member === "toBeNull") return { kind: "null", negate, subject };
  const arm = expr.member === "toBe" ? returnedErrorArm(subjectType, expected) : undefined;
  if (arm) return { kind: "tag", negate, subject, ...arm };
  if (expr.member === "toContain" && expected) {
    const t = unwrapOptional(subjectType) ?? unwrapOptional(bodyTypeOf(subject));
    const within = t?.kind === "primitive" && t.name === "string" ? "string" : "collection";
    return { kind: "contain", within, negate, subject, expected };
  }
  const relation = RELATIONS[expr.member];
  if (relation === undefined || expected === undefined) return undefined;
  const type = assertedType(subjectType, subject, expected);
  return {
    kind: "compare",
    relation,
    compare: compareKind(type, relation, expected),
    negate,
    subject,
    optional: subjectType?.kind === "optional" || bodyTypeOf(subject)?.kind === "optional",
    expected,
    expectedLiteral: decideLiteralCoercion(type, expected),
  };
}

/** The type the comparison is made at: the matcher's resolved subject type
 *  when it names a comparison other than `scalar`, else the subject
 *  expression's own type, else what the expected value says (a decimal
 *  literal, `now`). */
function assertedType(
  subjectType: TypeIR | undefined,
  subject: ExprIR,
  expected: ExprIR,
): TypeIR | undefined {
  const candidates = [subjectType, bodyTypeOf(subject), expectedType(expected)];
  return candidates.find((t) => t !== undefined && typeCompare(t) !== "scalar") ?? subjectType;
}

function expectedType(e: ExprIR): TypeIR | undefined {
  if (e.kind !== "literal") return bodyTypeOf(e);
  if (e.lit === "money" || e.lit === "decimal") return { kind: "primitive", name: e.lit };
  if (e.lit === "now") return { kind: "primitive", name: "datetime" };
  return undefined;
}

function compareKind(
  type: TypeIR | undefined,
  relation: AssertionRelation,
  expected: ExprIR,
): AssertionCompare {
  if (expected.kind === "literal" && expected.lit === "null") return "scalar";
  const kind = type === undefined ? "scalar" : typeCompare(type);
  // A record or collection has no order; only equality compares it by value.
  if ((kind === "structural" || kind === "sequence") && relation !== "eq") return "scalar";
  return kind;
}

function typeCompare(type: TypeIR): AssertionCompare {
  const t = unwrapOptional(type) ?? type;
  switch (t.kind) {
    case "primitive":
      if (t.name === "money" || t.name === "decimal") return "decimal";
      if (t.name === "datetime") return "instant";
      if (t.name === "date") return "date";
      return "scalar";
    case "valueobject":
    case "entity":
    case "genericInstance":
      return "structural";
    case "array":
      return "sequence";
    default:
      return "scalar";
  }
}

/** The declared-error arm `expected` names by its bare name, when the subject
 *  is a union with that arm: `toBe(Closed)` over `string or Closed`. */
function returnedErrorArm(
  subjectType: TypeIR | undefined,
  expected: ExprIR | undefined,
): { union: string; tag: string } | undefined {
  if (subjectType?.kind !== "union" || expected?.kind !== "ref") return undefined;
  const arm = subjectType.variants.find(
    (v) => v.kind === "entity" && v.declKind === "error" && v.name === expected.name,
  );
  return arm ? { union: unionInstanceName(subjectType.variants), tag: variantTag(arm) } : undefined;
}
