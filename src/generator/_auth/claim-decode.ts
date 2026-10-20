// Which declared `user { … }` claims an OIDC verifier must DECODE rather than
// pass through, decided once for node / python / elixir.
//
// A signed token can still carry a claim that is not what the model declares:
// `agentId: "demo-agent-id"` for an `Agent id?` whose ids are UUIDs.  Passed
// through raw, that value is non-null, so `requires currentUser.agentId != null`
// admits it and the first query on it fails.  The .NET and Java verifiers
// decode typed claims into their CLR / JVM types and get the rule below from
// that decode; these three backends have no typed decode, so they check the
// wire value's FORMAT instead and apply the same rule:
//
//   - optional claim, absent or malformed  → null / None / nil
//   - required claim, absent or malformed  → the token is rejected (401)
//   - list claim → malformed elements are dropped; absent → the empty list
//
// Only identifier-shaped claims are checked: a `guid`, or an `X id` whose id
// value type is `guid` — every aggregate id lowers to one — must be a UUID.
// Any other id value type has no format checked here.

import type { FieldIR, TypeIR } from "../../ir/types/loom-ir.js";
import { claimPathFor } from "./claim-types.js";

/** The wire format a claim must match. */
export type ClaimFormat = "uuid";

export interface ClaimShape {
  readonly field: FieldIR;
  /** The token path the claim is read from (`claims:` mapping, `id` → `sub`). */
  readonly path: string;
  readonly optional: boolean;
  /** A list claim (`X id[]`): the format applies per element. */
  readonly list: boolean;
  /** Null when the claim is passed through unchecked. */
  readonly format: ClaimFormat | null;
}

/** One shape per declared user field, in declaration order. */
export function claimShapes(
  fields: readonly FieldIR[],
  auth: { claims: ReadonlyArray<{ field: string; path: string }> },
): ClaimShape[] {
  return fields.map((field) => {
    const optional = field.optional || field.type.kind === "optional";
    const bare = field.type.kind === "optional" ? field.type.inner : field.type;
    const list = bare.kind === "array";
    const element = bare.kind === "array" ? bare.element : bare;
    return {
      field,
      path: claimPathFor(field.name, auth),
      optional,
      list,
      format: formatOf(element),
    };
  });
}

function formatOf(t: TypeIR): ClaimFormat | null {
  if (t.kind === "primitive" && t.name === "guid") return "uuid";
  if (t.kind === "id" && t.valueType === "guid") return "uuid";
  return null;
}

/** The UUID shape every backend checks against (any version, case-insensitive). */
export const UUID_PATTERN =
  "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$";
