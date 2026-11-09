// ---------------------------------------------------------------------------
// The baseline HTTP hardening every generated backend applies, as data — one
// list the five backend emitters render in their own idiom, so the set of
// headers (and the cookie `Secure` gate) cannot drift between backends.
//
//   * The four always-on response headers below ride EVERY response: API
//     answers, errors, the OpenAPI document, the Swagger/HEEx/SPA pages.  None
//     of them is a Content-Security-Policy: the served UIs (Swagger UI, LiveView,
//     an embedded SPA) load inline scripts and styles a strict CSP would block.
//   * `Strict-Transport-Security` and the `Secure` attribute on the OIDC
//     cookies follow `LOOM_SECURE_TRANSPORT` — on unless it is set to a false
//     spelling.  The local compose stack serves plain http and sets it `false`;
//     every other deployment (the k8s chart, a bare `docker run`) keeps the
//     production default.  HSTS received over plain http is ignored by browsers
//     (RFC 6797 §8.1), so the default is harmless on an http listener.
// ---------------------------------------------------------------------------

/** The deploy flag: is this service reached over TLS (directly or through a
 *  TLS-terminating proxy)?  Read at runtime by every backend; `false`, `0`,
 *  `off` and `no` (any case) turn it off, anything else — unset included —
 *  leaves it on. */
export const SECURE_TRANSPORT_ENV = "LOOM_SECURE_TRANSPORT";

/** The spellings that turn {@link SECURE_TRANSPORT_ENV} off (compared
 *  lower-cased and trimmed) — the same convention `LOOM_OPENAPI_UI` reads. */
export const SECURE_TRANSPORT_OFF_VALUES: readonly string[] = ["false", "0", "off", "no"];

/** The response headers set on every response, unconditionally. */
export const BASELINE_SECURITY_HEADERS: readonly (readonly [name: string, value: string])[] = [
  ["X-Content-Type-Options", "nosniff"],
  ["X-Frame-Options", "DENY"],
  ["Referrer-Policy", "strict-origin-when-cross-origin"],
  ["Permissions-Policy", "camera=(), microphone=(), geolocation=()"],
];

/** The HSTS header, set only while {@link SECURE_TRANSPORT_ENV} is on.  No
 *  `includeSubDomains`: the service does not own its parent domain's other
 *  hosts. */
export const HSTS_HEADER: readonly [name: string, value: string] = [
  "Strict-Transport-Security",
  "max-age=31536000",
];
