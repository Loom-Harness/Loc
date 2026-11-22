// Which `user { … }` fields the dev-stub `x-dev-claims` header can carry —
// the ONE classifier all five backends' stub verifiers read.
//
// WHY THIS EXISTS.  It used to be four independent copies of
// `f.type.kind === "primitive" && f.type.name === "string"`, one per backend
// (dotnet, python, java, elixir), each deciding for itself what the header may
// carry.  Hono had no such filter and spread the decoded JSON wholesale.  So a
// `permissions: string[]` claim rode the header on node and was silently
// discarded on the other four, leaving the field at its built-in EMPTY LIST —
// which made every `requires currentUser.permissions.contains(…)` gate fail
// closed there no matter what the caller sent, with no diagnostic and no test
// reaching it.  `docs/auth.md` meanwhile promised the header "drives every
// generated backend identically".
//
// One predicate with five readers cannot drift that way; five predicates did.
// (`experience_gathered.md` §89 — two halves of one contract computed
// independently — one layer up: N halves of one contract.)
//
// NOT the OIDC path.  A verified token carries real JSON, and every backend
// already maps `string[]` there (`ClaimStringList` / `claimStringList` /
// `_claim(...) or []` / `get_claim(...) || []`).  This governs the dev stub
// only.

import type { FieldIR, TypeIR } from "../ir/types/loom-ir.js";
import { RUNTIME_ENV, RUNTIME_HEADERS } from "./runtime-wire-names.js";

/** How a backend must decode one dev-claim from the header's JSON. */
export type DevClaimKind =
  /** A JSON string onto a `string` field. */
  | "string"
  /** A JSON array of strings onto a `string[]` field. */
  | "stringList";

// OPTIONAL CLAIMS AND ABSENCE (ruling 312: an absent claim is absent).
//
// A carried claim is decoded from the header by its key:
//
//   * key omitted            → the claim keeps its built-in stub value (an
//                              optional claim's is null, so omitting it IS the
//                              principal lacking it);
//   * key present, right shape → the claim takes the value;
//   * key present, JSON null → an OPTIONAL claim is absent (null); a REQUIRED
//                              claim makes the header describe no principal,
//                              and the stub refuses the request (401) — the
//                              same answer every OIDC verifier gives a token
//                              that lacks a required claim.  Never the
//                              built-in value: that would turn "lacking the
//                              claim" into the admin-shaped identity.
//
// Any other value (a wrong shape) keeps the built-in value, as before.

/** One carried claim: its decode kind and whether it may be absent. */
export interface DevClaimField {
  readonly field: FieldIR;
  readonly kind: DevClaimKind;
  /** True for an optional (`T?`) claim: a JSON null makes it absent. */
  readonly optional: boolean;
}

/**
 * The claim kind a field can be carried as, or `undefined` when the dev stub
 * cannot represent it and the field must keep its built-in stub value.
 *
 * Deliberately narrow: `string` and `string[]` (each optional or not) are the
 * shapes an author can actually gate on (`requires currentUser.role == …`,
 * `currentUser.permissions.contains(…)`, `where q.customer ==
 * currentUser.customerId`), and they map onto every target without a
 * per-backend parse. Numbers, bools, enums, ids and datetimes are NOT
 * carried — adding one means teaching all five decoders, so it stays an
 * explicit decision rather than a silent per-backend accident.
 */
export function devClaimKind(field: FieldIR): DevClaimKind | undefined {
  const t: TypeIR = field.type.kind === "optional" ? field.type.inner : field.type;
  if (t.kind === "primitive" && t.name === "string") return "string";
  if (t.kind === "array" && t.element.kind === "primitive" && t.element.name === "string") {
    return "stringList";
  }
  return undefined;
}

/** True when the field is declared optional (`T?`), however the IR spells it. */
export function devClaimOptional(field: FieldIR): boolean {
  return field.optional || field.type.kind === "optional";
}

/** The carryable fields, in declaration order. Empty ⇒ emit no merge at all. */
export function devClaimFields(fields: readonly FieldIR[] | undefined): DevClaimField[] {
  return (fields ?? []).flatMap((field) => {
    const kind = devClaimKind(field);
    return kind ? [{ field, kind, optional: devClaimOptional(field) }] : [];
  });
}

// ---------------------------------------------------------------------------
// The dev-stub ON switch.
//
// A system with `auth: required` + a `user { … }` block but no `auth { oidc }`
// gets the dev-stub verifier: it accepts every request as a built-in identity
// and lets the caller rewrite that identity through `x-dev-claims`.  That
// is a development login, never a production one, so every backend's stub
// answers only when this variable is exactly `"1"`; otherwise the stub refuses
// every request (401) and the app logs `DEV_AUTH_DISABLED_LOG` once at startup.
// The generated dev `docker-compose.yml` sets it, so a local stack works out of
// the box while a deployed build that forgot it fails closed.
// ---------------------------------------------------------------------------

/** The env var that switches the dev-stub verifier on (value `"1"`). */
export const DEV_AUTH_ENV = RUNTIME_ENV.devAuth;

/** The header carrying the dev-stub principal. */
export const DEV_CLAIMS_HEADER = RUNTIME_HEADERS.devClaims;

/** The one startup line a backend logs when the dev stub is installed but off. */
export const DEV_AUTH_DISABLED_LOG = `${DEV_AUTH_ENV} is not 1: the dev-stub verifier is off and every authenticated request answers 401 (this system declares no auth { oidc } block; set ${DEV_AUTH_ENV}=1 for a development login)`;

/** The one startup line a backend logs when the dev stub is on. */
export const DEV_AUTH_ENABLED_LOG = `${DEV_AUTH_ENV}=1: the dev-stub verifier accepts every request as a built-in identity and honours ${DEV_CLAIMS_HEADER}; development only`;
