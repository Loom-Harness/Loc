// Pinned findings for the EMITTED-SOURCE authorization census
// (`authz-emitted-census.test.ts`, M-T9.41).
//
// Every entry is a defect the census FOUND in emitted code and this packet —
// test-only by charter (wave C3) — handed off rather than fixed.  The register
// RATCHETS both ways, like `authz-gate-census-pins.ts`: a new finding fails
// until it is fixed or pinned here, and a pin whose finding no longer
// reproduces fails as STALE, so the fix deletes its pin in the same change.
//
// Keys are `<case> <variant>` → `{ <finding key>: <reason> }`, the finding key
// exactly as the census prints it (`findingKey` in `authz-emitted-census.ts`),
// so a failure message can be pasted here verbatim.

/** Reason classes — one per distinct defect, shared by every cell it shows up in.
 *  Empty: no emitted-source finding is pinned. */
export const R = {} as const;

export const EMITTED_FINDING_PINS: Readonly<Record<string, Readonly<Record<string, string>>>> = {};

/** How many pins each reason carries — recomputed from the pins by the gate and
 *  compared both ways (a prose tally is a cache with no invalidation). */
export const PIN_CLASS_CENSUS: Readonly<Record<string, number>> = {};
