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
// The default principal has FULL ACCESS, with typed deterministic values
// (D-GENERATED-TESTS): a fixed id (the `id` claim, a guid or an `X id`), the
// claim's own name for any other string claim, every permission the system's
// catalogue declares for the `permissions` claim (the catalogue's closure, so
// any `requires currentUser.permissions.contains(…)` passes), the claim's own
// name as the one element of any other string list, zero, `false`, the epoch,
// an enum's first member, and nothing for an optional claim.  A test about
// authorization states its principal with `as { … }`.  How each value is
// spelled is the test framework's leaf table
// (`src/generator/_test/principal-target.ts`).

import type { EnumIR, FieldIR, SystemIR, TestPrincipalIR, TypeIR } from "../types/loom-ir.js";

/** The fixed identity the default principal carries. */
const TEST_PRINCIPAL_ID = "00000000-0000-0000-0000-000000000001";

/** The claim carrying the principal's permissions. */
const PERMISSIONS_CLAIM = "permissions";

/** What a test principal is built from: the system's `user { … }` fields and
 *  every permission its catalogue declares. */
export interface TestPrincipalShape {
  fields: readonly FieldIR[];
  permissions: readonly string[];
}

/** The shape of a system's test principal.  "All permissions" is the whole
 *  catalogue, every subdomain's `permissions { … }` block: holding every
 *  permission is holding the closure of every `implies`. */
export function testPrincipalShape(sys: SystemIR | undefined): TestPrincipalShape {
  return {
    fields: sys?.user?.fields ?? [],
    permissions: [
      ...new Set((sys?.subdomains ?? []).flatMap((m) => m.permissions.map((p) => p.runtimeString))),
    ].sort(),
  };
}
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
  shape: TestPrincipalShape,
  overrides?: TestPrincipalIR,
  enums: readonly EnumIR[] = [],
): PrincipalClaim[] {
  return shape.fields.map((field) => {
    const claim = overrides?.claims.find((c) => c.name === field.name);
    const value =
      claim !== undefined
        ? claimValue(field.type, claim.value)
        : defaultValue(field, shape.permissions, enums);
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

function defaultValue(
  field: FieldIR,
  permissions: readonly string[],
  enums: readonly EnumIR[],
): PrincipalValue {
  if (field.optional || field.type.kind === "optional") return { kind: "absent" };
  const t = field.type;
  if (field.name === "id" && t.kind === "primitive" && t.name === "string") {
    return { kind: "text", value: TEST_PRINCIPAL_ID };
  }
  if (t.kind === "array" && t.element.kind === "primitive" && t.element.name === "string") {
    const values = field.name === PERMISSIONS_CLAIM ? permissions : [field.name];
    return {
      kind: "list",
      element: t.element,
      values: values.map((value) => ({ kind: "text", value })),
    };
  }
  return typeDefault(field.name, t, enums);
}

function typeDefault(name: string, t: TypeIR, enums: readonly EnumIR[]): PrincipalValue {
  switch (t.kind) {
    case "primitive":
      switch (t.name) {
        case "guid":
          return { kind: "guid", value: TEST_PRINCIPAL_ID };
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
          return { kind: "text", value: name };
        default:
          return { kind: "absent" };
      }
    case "id":
      return { kind: "id", targetName: t.targetName, value: TEST_PRINCIPAL_ID };
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
