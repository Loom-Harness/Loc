// The `auth` family of the code → docs-anchor map: the `loom.*` codes whose
// first segment the `auth` message family owns (`../messages/auth.ts`).
// `../code-docs.ts` merges every family into `CODE_DOCS_ANCHORS`, and
// `test/system/diagnostic-catalog.test.ts` fails on a code filed under the
// wrong family.

export const anchors: Readonly<Record<string, string>> = {
  // --- src/language/validators/structural.ts (M-T9.56 drain) --------------
  "loom.audited-no-command": "22-macros.md#audit--the-built-in-capability-auditable",

  // --- src/language/validators/_shared.ts (M-T9.56 drain) -----------------
  "loom.sensitivity-drop": "03-domain-modeling.md#sensitive",

  // --- src/language/validators/types.ts (M-T9.56 drain) --------------------
  "loom.mask-unless-not-bool":
    "07-invariants-derived-functions.md#mask-unless--field-read-redaction",
  "loom.field-mask-principal-without-auth":
    "07-invariants-derived-functions.md#mask-unless--field-read-redaction",
  "loom.field-mask-event-channel":
    "07-invariants-derived-functions.md#mask-unless--field-read-redaction",
  "loom.field-mask-on-part": "07-invariants-derived-functions.md#mask-unless--field-read-redaction",
  "loom.field-mask-on-value-object":
    "07-invariants-derived-functions.md#mask-unless--field-read-redaction",
  "loom.field-mask-unique-oracle":
    "07-invariants-derived-functions.md#mask-unless--field-read-redaction",

  // --- src/language/validators/statements.ts (M-T9.56 drain) ---------------
  "loom.requires-not-bool":
    "06-behavior-and-statements.md#guards--requires-403-vs-when-409-vs-precondition-422",
  "loom.requires-private-operation":
    "06-behavior-and-statements.md#guards--requires-403-vs-when-409-vs-precondition-422",
  "loom.audited-private-operation": "22-macros.md#audit--the-built-in-capability-auditable",

  // --- src/language/validators/traceability.ts (M-T9.56 drain) ------------
  "loom.auth-missing-issuer": "17-auth.md#auth-----oidc-config",
  "loom.auth-unknown-claim-field": "17-auth.md#auth-----oidc-config",
  "loom.auth-oidc-no-audience": "17-auth.md#auth-----oidc-config",
  "loom.auth-without-user": "17-auth.md#auth-required--per-deployable-middleware--verifier-seam",
  "loom.currentuser-not-in-request-scope": "17-auth.md#currentuser--claim-access-in-domain-logic",
  "loom.auth-unknown-provider": "17-auth.md#errors",
  "loom.default-deny-ungated": "17-auth.md#requires--the-authorization-gate-http-403",
  "loom.policy-read-gate-not-current-user": "17-auth.md#read--who-may-read-an-aggregate",
  "loom.policy-unknown-rule": "17-auth.md#read--who-may-read-an-aggregate",
  "loom.policy-level-removed": "17-auth.md#policy-----the-local-floor-and-deny",
  "loom.default-deny-by-id-ungated": "17-auth.md#requires--the-authorization-gate-http-403",
  "loom.default-deny-list-ungated": "17-auth.md#requires--the-authorization-gate-http-403",
  "loom.policy-out-of-scope": "17-auth.md#named-policy-functions",
  "loom.default-deny-es-create-ungateable": "17-auth.md#requires--the-authorization-gate-http-403",
  "loom.sensitive-wire-unsupported": "17-auth.md#sensitive--field-tagging",
  "loom.user-duplicate-field": "17-auth.md#user--the-principal-claim-shape",
  "loom.user-reserved-field": "17-auth.md#user--the-principal-claim-shape",
  "loom.auth-dev-login-only": "17-auth.md#dev-stub-verifier-x-loom-dev-claims",
};
