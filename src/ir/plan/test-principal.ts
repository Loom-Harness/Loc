// The principal a generated test runs as.
//
// A domain unit test calls an operation that reads `currentUser` with no
// request around it, and a context-integration test binds an ambient principal
// for the repositories it drives.  Both run as ONE principal: the dev-stub
// identity, built from the system's `user { … }` block field by field, with a
// test's `as { … }` claims replacing the fields they name.  Every claim the
// block declares is present at its declared type, so an operation reading
// `currentUser.email` sees a string on every backend and a positional `User`
// record is constructed with all of its components.
//
// The values are the dev-stub identity every backend's dev verifier already
// serves: `"admin"` for a string, the zero guid for a guid or an `X id`, an
// empty list, zero, `false`, the epoch, an enum's first member, and nothing
// for an optional claim.  How each value is spelled is the test framework's
// leaf table (`src/generator/_test/principal-target.ts`).

import type { EnumIR, FieldIR, TestPrincipalIR, TypeIR } from "../types/loom-ir.js";

/** The zero identity a dev-stub principal carries for a guid or strong id. */
const TEST_PRINCIPAL_ZERO_GUID = "00000000-0000-0000-0000-000000000000";

/** The value a string claim takes when no `as { … }` claim sets it. */
const TEST_PRINCIPAL_TEXT = "admin";

/** One claim value at its declared type. */
export type PrincipalValue =
  | { kind: "text"; value: string }
  | { kind: "guid"; value: string }
  | { kind: "id"; targetName: string; value: string }
  | { kind: "int" }
  /** `money` or `decimal`, which some languages spell as different types. */
  | { kind: "decimal"; money: boolean }
  | { kind: "bool" }
  /** The epoch, `1970-01-01T00:00:00Z`. */
  | { kind: "datetime" }
  /** The epoch day, `1970-01-01`. */
  | { kind: "date" }
  | { kind: "enum"; name: string; member: string }
  /** A list claim; `element` is the declared element type. */
  | { kind: "list"; element: TypeIR; values: PrincipalValue[] }
  /** An optional claim nothing sets, or a type with no dev-stub value. */
  | { kind: "absent" };

export interface PrincipalClaim {
  /** The `user { … }` field. */
  field: FieldIR;
  value: PrincipalValue;
}

/** The principal a test runs as: every `user { … }` field, in declared order,
 *  at its dev-stub value or the value `overrides` gives it. */
export function testPrincipal(
  user: readonly FieldIR[],
  overrides?: TestPrincipalIR,
  enums: readonly EnumIR[] = [],
): PrincipalClaim[] {
  return user.map((field) => {
    const claim = overrides?.claims.find((c) => c.name === field.name);
    const value =
      claim !== undefined ? claimValue(field.type, claim.value) : stubValue(field, enums);
    return { field, value };
  });
}

/** An `as { … }` claim at the field's type.  `loom.test-principal-claim-type`
 *  admits only a string, a guid or `X id` (a uuid string) and a string list. */
function claimValue(type: TypeIR, value: string | readonly string[]): PrincipalValue {
  const t = type.kind === "optional" ? type.inner : type;
  if (typeof value !== "string") {
    const element =
      t.kind === "array" ? t.element : ({ kind: "primitive", name: "string" } as const);
    return { kind: "list", element, values: value.map((v) => ({ kind: "text", value: v })) };
  }
  if (t.kind === "id") return { kind: "id", targetName: t.targetName, value };
  if (t.kind === "primitive" && t.name === "guid") return { kind: "guid", value };
  return { kind: "text", value };
}

function stubValue(field: FieldIR, enums: readonly EnumIR[]): PrincipalValue {
  if (field.optional || field.type.kind === "optional") return { kind: "absent" };
  return typeStub(field.type, enums);
}

function typeStub(t: TypeIR, enums: readonly EnumIR[]): PrincipalValue {
  switch (t.kind) {
    case "primitive":
      switch (t.name) {
        case "guid":
          return { kind: "guid", value: TEST_PRINCIPAL_ZERO_GUID };
        case "int":
        case "long":
          return { kind: "int" };
        case "decimal":
        case "money":
          return { kind: "decimal", money: t.name === "money" };
        case "bool":
          return { kind: "bool" };
        case "datetime":
          return { kind: "datetime" };
        case "date":
          return { kind: "date" };
        case "string":
          return { kind: "text", value: TEST_PRINCIPAL_TEXT };
        default:
          return { kind: "absent" };
      }
    case "id":
      return { kind: "id", targetName: t.targetName, value: TEST_PRINCIPAL_ZERO_GUID };
    case "array":
      return { kind: "list", element: t.element, values: [] };
    case "enum": {
      const member = enums.find((e) => e.name === t.name)?.values[0];
      return member === undefined ? { kind: "absent" } : { kind: "enum", name: t.name, member };
    }
    default:
      return { kind: "absent" };
  }
}
