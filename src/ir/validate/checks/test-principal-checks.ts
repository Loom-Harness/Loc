// -------------------------------------------------------------------------
// The `as { … }` test principal — the claim map a context integration `test`
// or a `test e2e` block runs as.  The AST validator has already narrowed every
// value to a string literal or a list of string literals and refused a clause
// on any other test; this leaf checks the claims against the system's
// `user { … }` block, which may be declared in another file:
//
//   - a clause on a system with no `user` block has nothing to bind;
//   - every claim names a declared user field;
//   - the value's shape matches the field's type: a string for a `string`,
//     `guid` or `<Agg> id` claim (a UUID for the latter two), a list of
//     strings for a `string[]` claim.  Other claim types are not settable.
//
// A `test e2e` principal additionally travels as the dev-stub
// `x-loom-dev-claims` header, so it is refused where that header cannot carry
// it: under `auth { oidc }` (the running backend verifies tokens, not the
// header), on a `ui` (Playwright) block (the browser session is signed in
// once, not per block), and for a claim the dev stub does not decode
// (`devClaimKind` — non-optional `string` / `string[]` only).
// -------------------------------------------------------------------------

import { diagMessage } from "../../../diagnostics/messages.js";
import { devClaimKind } from "../../../util/dev-claims.js";
import type {
  FieldIR,
  LoomModel,
  SystemIR,
  TestPrincipalIR,
  TestStmtIR,
  UserIR,
} from "../../types/loom-ir.js";
import { allContexts } from "../../types/loom-ir.js";
import type { LoomDiagnostic } from "./diagnostic.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The value shape a claim of this field type takes, or undefined when a test
 *  principal cannot set it. */
export function principalClaimShape(f: FieldIR): "string" | "uuid" | "stringList" | undefined {
  const t = f.type.kind === "optional" ? f.type.inner : f.type;
  if (t.kind === "primitive" && t.name === "string") return "string";
  if (t.kind === "primitive" && t.name === "guid") return "uuid";
  if (t.kind === "id") return "uuid";
  if (t.kind === "array" && t.element.kind === "primitive" && t.element.name === "string") {
    return "stringList";
  }
  return undefined;
}

function checkClaims(
  principal: TestPrincipalIR,
  user: UserIR | undefined,
  source: string,
  diags: LoomDiagnostic[],
  e2e: boolean,
): void {
  if (!user) {
    diags.push({
      severity: "error",
      code: "loom.test-principal-no-user",
      source,
      origin: principal.origin,
      message: diagMessage("loom.test-principal-no-user", { test: source }),
    });
    return;
  }
  for (const claim of principal.claims) {
    const field = user.fields.find((f) => f.name === claim.name);
    const at = { source, origin: claim.origin ?? principal.origin };
    if (!field) {
      diags.push({
        severity: "error",
        code: "loom.test-principal-unknown-claim",
        ...at,
        message: diagMessage("loom.test-principal-unknown-claim", {
          name: claim.name,
          fields: user.fields.map((f) => f.name).join(", "),
        }),
      });
      continue;
    }
    const shape = principalClaimShape(field);
    const isList = typeof claim.value !== "string";
    const ok =
      shape === "stringList"
        ? isList
        : shape === "string"
          ? !isList
          : shape === "uuid"
            ? !isList && UUID.test(claim.value as string)
            : false;
    if (!ok) {
      diags.push({
        severity: "error",
        code: "loom.test-principal-claim-type",
        ...at,
        message: diagMessage("loom.test-principal-claim-type", {
          name: claim.name,
          shape: shape ?? "unsettable",
        }),
      });
      continue;
    }
    if (e2e && devClaimKind(field) === undefined) {
      diags.push({
        severity: "error",
        code: "loom.e2e-principal-claim-not-carried",
        ...at,
        message: diagMessage("loom.e2e-principal-claim-not-carried", { name: claim.name }),
      });
    }
  }
}

/** Every context integration test's principal, against the user block of the
 *  system hosting its context (none for a context outside every system). */
export function validateTestPrincipals(loom: LoomModel, diags: LoomDiagnostic[]): void {
  const userOf = new Map<string, UserIR | undefined>();
  for (const sys of loom.systems) {
    for (const sd of sys.subdomains) for (const c of sd.contexts) userOf.set(c.name, sys.user);
  }
  for (const c of allContexts(loom)) {
    for (const t of c.tests) {
      for (const p of principalsOf(t)) {
        checkClaims(p, userOf.get(c.name), `${c.name}/${t.name}`, diags, false);
      }
    }
  }
  for (const sys of loom.systems) validateE2EPrincipals(sys, diags);
}

/** A test's head clause, then every `as { … }` body line, in source order. */
export function principalsOf(t: {
  principal?: TestPrincipalIR;
  statements: readonly TestStmtIR[];
}): TestPrincipalIR[] {
  const out: TestPrincipalIR[] = t.principal ? [t.principal] : [];
  for (const s of t.statements) if (s.kind === "principal") out.push(s.principal);
  return out;
}

function validateE2EPrincipals(sys: SystemIR, diags: LoomDiagnostic[]): void {
  // A fullstack block lowers once per kind; report each block once.
  const seen = new Set<string>();
  for (const t of sys.e2eTests) {
    const principals = principalsOf(t);
    const first = principals[0];
    if (!first) continue;
    const source = `${sys.name}/${t.name}`;
    if (t.kind === "ui") {
      diags.push({
        severity: "error",
        code: "loom.e2e-principal-ui",
        source,
        origin: first.origin,
        message: diagMessage("loom.e2e-principal-ui", { test: t.name }),
      });
      continue;
    }
    if (seen.has(source)) continue;
    seen.add(source);
    if (sys.auth) {
      diags.push({
        severity: "error",
        code: "loom.e2e-principal-oidc",
        source,
        origin: first.origin,
        message: diagMessage("loom.e2e-principal-oidc", { test: t.name }),
      });
      continue;
    }
    for (const p of principals) checkClaims(p, sys.user, source, diags, true);
  }
}
