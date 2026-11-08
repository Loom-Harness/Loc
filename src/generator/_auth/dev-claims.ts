// The dev-stub `x-loom-dev-claims` header contract every backend's stub
// verifier implements.  The field classifier lives in `src/util/dev-claims.ts`
// because IR validation reads it too (a `test e2e` principal travels in this
// header); it is re-exported here for the backend emitters.

export { type DevClaimKind, devClaimFields, devClaimKind } from "../../util/dev-claims.js";

// ---------------------------------------------------------------------------
// A PRESENT-BUT-UNDECODABLE header (ruling D6, eval-closure item #23).
//
// Every stub used to swallow a decode failure and fall back to the built-in
// identity — which is the admin-shaped principal.  So a permission test that
// meant to run as a narrow principal and sent a typo'd header ran as the
// built-in one instead and could false-green.  An absent (or empty) header
// still means "the built-in identity"; a header that IS there but is not a
// base64-encoded JSON OBJECT answers 400 on all five stubs, with this one
// problem document — the same title/status/detail everywhere so the wire
// differential sees one answer.
// ---------------------------------------------------------------------------

/** The dev-claims header's name — the single spelling every stub reads. */
export const DEV_CLAIMS_HEADER = "x-loom-dev-claims";

/** The RFC 7807 `detail` a malformed dev-claims header answers 400 with. */
export const MALFORMED_DEV_CLAIMS_DETAIL = `malformed ${DEV_CLAIMS_HEADER} header: expected a base64-encoded JSON object`;
