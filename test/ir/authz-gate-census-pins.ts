// Pinned gaps for the AUTHORIZATION-GATE CENSUS (`authz-gate-census.test.ts`)
// — M-T9.28 slice 2.

import { CORPUS } from "../fixtures/corpus/manifest.js";
//
// Slice 1 (#2515) minted the second principal in both auth flavours
// (`DEV_CLAIMS_UNAUTHORIZED`, `oidc.unauthorizedToken`) so the behavioural tier
// could finally express "authenticated but NOT authorized".  It did not answer
// the census question, which is the one #2446 got wrong: for every
// authorization gate the pipeline EMITS, is there a caller anywhere that must
// be REFUSED?  A gate emitted as a NO-OP passes every authorized-side
// assertion, every compile tier and every spec-parity diff identically — that
// is exactly how a guarded `create` shipped on an open route with every gate
// green.
//
// This register is the residue of that census: one entry per gated route
// surface with no refused caller, plus the reason.  It RATCHETS like
// `api-caller-census-pins.ts`, the file it is modelled on:
//
//   • a NEW gated surface with no refusal arm fails until it gets one or a pin;
//   • a pin that stops matching — the surface gained a refusal arm, or the
//     route was renamed / removed — fails as STALE, so a drain deletes its pin
//     in the same change.
//
// The per-class counts are NOT written anywhere: they are a pure function of
// the pins, and a hand-kept tally of them is one line every pinning change
// edits.  The gate prints them.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE CENSUS, AS MEASURED (the gate recomputes every figure; these are the
// values at the time of writing, and the gate — not this comment — is what
// fails when they move):
//   87 sources censused (58 corpus fixtures, 5 shared behavioural systems,
//   23 `examples/*.ddd`, 2 booted `broad/` cases; 1 excluded as non-parsing).
//   125 gated route surfaces in them.  Of those: 31 inside fixtures already
//   exempt on `E2E_LESS_CORPUS_FIXTURES` (`projection-agg-filters`,
//   `tenancy-hierarchy`), 10 with a refused caller on record, 84 pinned below.
//   The refused count was 7 before this change — see findings 1 and 4.
//
// WHAT THE CENSUS FOUND (the reason to write it, recorded here because each
// item is a live gap nothing else surfaces):
//
//  1. `lifecycle-guard` carried THREE `requires` gates and the ladder refused
//     ONE of them.  `Shipment.create` — the principal-only create gate, the
//     literal #2446 shape, "a `requires` in a create parsed clean, emitted
//     nothing, and left the route OPEN" in that fixture's own words — had no
//     refusal arm on any leg.  Its `test e2e` drives the authorized side of all
//     three gates, so a no-op create gate was green everywhere.  DRAINED here:
//     the ladder now refuses the guarded create, and that arm is what the
//     mutation proof (finding 8) fires.
//
//  2. DRAINED (wave C3 packet 3c): a ladder surface may now carry its OWN
//     `seed`, and `Shipment.destroy` is refused on its own seeded shipment —
//     `R.oneSeededId` has no pins left.  The original finding, kept as the
//     record: `Shipment.destroy` (the principal-AND-row gate) had no refusal arm,
//     and the blocker is the HARNESS, not the fixture: a ladder spec carries
//     exactly ONE seeded id (`__authzLadder`'s `{id}` is the first id any seed
//     step returns) and `lifecycle-guard`'s is the crate's.  Addressing a second
//     row needs multi-id seeding in the shared recorder preamble.  Pinned as
//     `R.oneSeededId` — actionable, and it names the change.
//
//  3. The `policy` and `tenancy` classes are NOT DISCRIMINABLE by the second
//     principal, and the fixtures say so at the site.  `policy { deny … }` is
//     always-false for every caller (principal-FREE by construction — it routes
//     to each backend's STATIC filter path), and the tenant floor keys on
//     `tenantId`, which `DEV_CLAIMS_UNAUTHORIZED` SHARES
//     with `DEV_CLAIMS` deliberately.  So there is no 403 arm to assert, and the
//     refusal that IS assertable is the one each fixture's own `test e2e`
//     already makes (`toThrow(404)` on the denied surfaces).
//     `policy-document.ddd` states this verbatim — "NO ladder entry accompanies
//     this … both stances are principal-free with respect to the arms a ladder
//     varies" — and it is right: a second-identity 404 beside an existing
//     first-identity 404 asserts nothing.  These are pinned under
//     `R.principalFreeGate` / `R.sharedTenancyIdentity` rather than given
//     theatre arms.  (This is the one place this packet's plan row and the head
//     disagreed: the row named `policy-deny` and `policy-document` as ladder
//     work.  `policy-deny` got the arms that DO say something new — finding 4 —
//     and `policy-document` did not, because its own recorded argument holds.)
//
//  4. What a ladder on those fixtures CAN say — and what nothing said before —
//     is the CONTROL: on a surface with NO gate, the second principal must NOT
//     be refused.  Without it the whole ladder tier can be green for the wrong
//     reason: if the dev-stub verifier ever began answering 403 for an
//     unrecognised role, every `unauthorized: 403` arm in `auth-simple`,
//     `auth-oidc`, `read-gates` and `lifecycle-guard` would pass while proving
//     nothing about any gate.  Added on `field-mask` (auth-required, no gate on
//     the probed read) and on `policy-deny`'s write-denied `Account`, whose READ
//     seam must stay open while its writes are refused — one identity, one row,
//     both answers, which no single surface can show.
//
//  5. `mask unless` cannot be refused at the STATUS level at all — its refusal
//     is field-level redaction inside a 200 — and it cannot be discriminated
//     either: `field-mask`'s predicate reads `permissions.contains(unmask)`,
//     which NEITHER harness principal carries (deliberate; the fixture records
//     that the privileged side needs a claim shape only some backends map).  So
//     the mask surfaces are pinned `R.maskIsNotAStatus`, and the control arm at
//     least puts the redacted body on the wire for the second identity too,
//     where the golden pins it.
//
//  6. `union-find-absence` was on this packet's ladder list and CANNOT carry
//     one: it declares no authorization gate at all (so the census finds no
//     surface there to refuse), and its deployable declares no `auth`, so
//     `unauthorizedCredentials` returns `null` and every runner SKIPS the ladder
//     for it.  Recorded rather than silently dropped — a fixture that later
//     gains `auth: required` plus a gate becomes a real candidate.
//
//  7. HANDED OFF, outside this packet's tree:
//     (a) `web/src/examples/auth-capabilities.ddd` carries two `requires` gates
//         and no runner boots it, so it sits outside the census population
//         entirely (see the note at `loadPopulation`) — an authorization surface
//         with no runtime caller of either polarity.
//
//  8. MUTATION PROOF (the packet's required shape — the LADDER catches a no-op
//     `requires`, the e2e does not).  Seeded the #2446 defect in the Hono
//     create-route emitter: `src/platform/hono/shared/routes-builder.ts`'s
//     `lines.push(...lifecycleGateLines(agg.canonicalCreate, "      "))` — the
//     one line that renders a canonical create's gate — replaced by
//     `lines.push(...[])`, i.e. a `requires` that parses, lowers, type-checks
//     and emits NOTHING.  `npm run build` still exit 0.  Then the node
//     behavioural leg on `lifecycle-guard`:
//
//       ✓ [api] the manage permission opens all three gates, and the ungated
//           control needs none against d
//       ✗ [authz] authz ladder: guarded create (principal-only, no row yet) —
//           authenticated-but-unauthorized → 403
//               expected 403, got 201: {"id":"01a0689f-…"}
//       ✓ [authz] authz ladder: guarded destroy (principal-only, audited row) —
//           authenticated-but-unauthorized → 403
//       → 4 passed, 1 failed, 2 skipped
//
//     Exactly the split the census exists to create, and note WHICH assertion
//     failed: the fixture's own `test e2e` — the only thing watching this gate
//     before — passes with the gate gone, the sibling destroy arm passes
//     (the seed was scoped to the create), and the one arm this change added is
//     the one that fires.  With the emitter restored by FILE COPY (never
//     `git checkout -- <path>`, which would have discarded the census files in
//     the same tree — §84) the three ladder cases are green and their
//     rebaselined goldens match: 17 passed, 0 failed, 7 skipped, 3 cases
//     compared, 0 divergences.

/** The three un-refusable classes below (`principalFreeGate`,
 *  `sharedTenancyIdentity`, `maskIsNotAStatus`) waive the RUNTIME refusal only.
 *  Whether each such gate is APPLIED is proved on emitted code, per backend, by
 *  the emitted-source census (M-T9.41): its "pin redirect" block requires every
 *  corpus pin of these classes to name an aggregate whose scope conjuncts (or
 *  mask closure) that census finds applied on every backend the fixture
 *  declares — so a pin here can no longer hide an emission defect. */
export const REDIRECTED_TO_EMITTED_CENSUS =
  " — its APPLICATION is proved per backend on emitted code by `authz-emitted-census.test.ts` (M-T9.41)";

/**
 * Reason classes.  Shared constants rather than 84 hand-written sentences: the
 * gaps fall into a handful of classes and the CLASS is the honest explanation.
 * The distinction that matters is the one `api-caller-census-pins` draws — an
 * un-authored pin is work, an unreachable pin is a finding.  Every class below
 * is currently a finding; none of them is "nobody wrote the test".
 */
export const R = {
  /** UNREACHABLE (harness).  `__authzLadder` substitutes ONE `{id}`, taken from
   *  the first seed step's response, so one spec cannot address two different
   *  aggregates' rows.  Drain = multi-id seeding in the shared recorder
   *  preamble (`test/behavioral/wire-differential.mjs`), then the arm. */
  oneSeededId:
    "the ladder spec carries ONE seeded id and this surface addresses a different aggregate's " +
    "row; needs multi-id seeding in `__authzLadder` before an arm can be written",
  /** UNREACHABLE (by construction).  `policy { deny … }` is always-false for
   *  every caller — it routes to each backend's STATIC (principal-free) filter
   *  path — so the second principal is refused exactly as the first is, and a
   *  ladder arm would restate the fixture's own `toThrow(404)`.  The refusal IS
   *  asserted: by that `test e2e`. */
  /** COVERED (by the fixture).  An in-app `exists` gate decides on OTHER rows
   *  (a share, a sibling, a seal), not on who is calling: the fixture's own
   *  `test e2e` drives the refused arm (403 / 409) and the admitted arm with the
   *  same principal, by changing those rows.  A second principal would restate
   *  the data arm, not discriminate a missing gate. */
  rowDataGate:
    "row-data gate (an in-app `exists` over other rows), so the refusal turns on data, not on the " +
    "caller; the fixture's own `test e2e` drives both the refused (403/409) and the admitted arm " +
    "— see the gate-position block in the .ddd",
  principalFreeGate:
    "principal-FREE gate (`policy deny` renders an always-false filter for every caller), so a " +
    "second principal cannot be discriminated; the refusal is asserted by the fixture's own " +
    "`test e2e` (`toThrow(404)`) — see the note at the site in the .ddd" +
    REDIRECTED_TO_EMITTED_CENSUS,
  /** UNREACHABLE (harness identity).  A tenant floor or a registry self-scope
   *  keys on `tenantId`, and
   *  `DEV_CLAIMS_UNAUTHORIZED` shares it with `DEV_CLAIMS` by design — that is
   *  what makes a 403 elsewhere mean "the gate denied" rather than "the tenant
   *  differs".  Discriminating these needs a second TENANCY identity, which is
   *  `tenancy-e2e.yml`'s shape, not this tier's. */
  sharedTenancyIdentity:
    "tenancy predicate keyed on a claim `DEV_CLAIMS_UNAUTHORIZED` SHARES with `DEV_CLAIMS` by " +
    "design, so neither identity this census reads can be refused by it.  The tier DOES now have " +
    "a second tenancy identity (`DEV_CLAIMS_OTHER_TENANT`, wave-3 row 3.3) — but a tenancy " +
    "statement is not an authorization refusal, and counting one as the other would let a gated " +
    "surface look covered while its `requires` went unexercised, so the cross-tenant rung is " +
    "deliberately not a refusal arm here" +
    REDIRECTED_TO_EMITTED_CENSUS,
  /** UNREACHABLE (harness identity).  A row filter keyed on `currentUser.id`
   *  (`exists Share as s where s.grantee == currentUser.id`): both harness
   *  identities carry the dev stub's built-in zero-guid id, so neither can be
   *  refused by it.  The refused side is asserted by the fixture itself — a
   *  row its filter hides reads `toThrow(404)`. */
  sharedPrincipalId:
    "row filter keyed on `currentUser.id`, which both harness identities share (the dev stub's " +
    "zero guid), so neither can be refused by it; the fixture's own `toThrow(404)` reads of a " +
    "hidden row assert the refused side" +
    REDIRECTED_TO_EMITTED_CENSUS,
  /** UNREACHABLE (shape).  A read mask redacts a FIELD inside a 200; there is no
   *  refusal status to assert.  Nor are the two identities distinguishable here
   *  — neither carries the unmasking claim. */
  maskIsNotAStatus:
    "`mask unless` refuses a FIELD inside a 200, not a request — no refusal status exists to " +
    "assert, and neither harness principal carries the unmasking claim" +
    REDIRECTED_TO_EMITTED_CENSUS,
  /** UNREACHABLE (population).  Nothing boots this source, so no ladder can name
   *  a caller for it at all; its gates are watched at the COMPILE tier only. */
  notABehaviouralCase:
    "not a behavioural case — no runner boots this source, so no ladder can name a caller of " +
    "either polarity; its gates are watched at the compile tier only",
  /** The `requires` predicate is a PRINCIPAL-FREE domain-service calculation
   *  that no input can turn false (`FeeQuote.forAmount(balance).amount >= 0`):
   *  it exists to gate the IMPORT the guard needs (ledger row F2-CB-C7, Wave C1
   *  packet 1e-i — `domain-service-gate-import-parity.test.ts`), not to refuse
   *  anyone, so there is no refused caller to name. */
  /** COVERED (by the golden).  `GET /{id}/can_<op>` folds the operation's own
   *  `requires` into `{ allowed: false }` — a 200 — so there is no refusal
   *  status to assert.  The ladder's unauthorized arm requests it and the
   *  recorded wire golden pins the `false` body on every backend. */
  probeAnswersFalse:
    "`can_<op>` answers the operation's own `requires` as `{ allowed: false }` (a 200), so no " +
    "refusal status exists; the ladder's unauthorized arm drives it and the wire golden pins the " +
    "false body",
  importGateOnly:
    "the `requires` predicate is a principal-free domain-service calculation no input turns " +
    "false — it gates the guard's IMPORT (F2-CB-C7), not a caller; the emitted import is the " +
    "assertion, in `domain-service-gate-import-parity.test.ts`",
} as const;

// WAVE C3 PACKET 3c (M-T9.28 residue): the CROSS-TENANT rung now counts as
// the refusal of a surface whose ONLY gate is the tenancy predicate
// (`isSurfaceRefused` in the census) — the argument below against counting it
// was about surfaces that ALSO carry a `requires` / policy stance / mask, and
// it still holds for those.  Twelve `sharedTenancyIdentity` pins drained on
// that rule (by-id read, update and destroy on `tenancy-owned`,
// `tenancy-claim-name`, `tenancy-filter` and `policy-deny`'s `Ledger`), each
// refused by a booted-app 404 on all seven behavioural legs.  What remains
// in the class: every `create` (a foreign tenant creating stamps its OWN
// tenant — nothing to refuse), every list `find` (a leak answers 200 — status
// cannot see it; the rows are the `test e2e`'s to assert), and the
// tenant-REGISTRY aggregates' surfaces, whose self-scope keys `id` on the
// tenancy claim: the harness principals' `tenantId` is not a registry row id,
// so no identity can read a registry row at all — the ~20 surfaces #2976's
// registry-ROW principal exists for (not built here: that draft's claim).

/**
 * `<case key> → { <surface key>: reason }`.
 *
 * Case keys match `POPULATION` in `authz-gate-census.test.ts`; surface keys are
 * `<route class> <METHOD> <path>` exactly as the census prints them, so a
 * failure message can be pasted verbatim.
 *
 * A corpus fixture's pins live in its sidecar
 * (`test/fixtures/corpus/<id>.corpus.json`, `authzGate`, naming an `R` class),
 * so two changes pinning different fixtures edit different files; only a
 * non-corpus source's pins are written here.
 */
export const AUTHZ_GATE_PINS: Record<string, Record<string, string>> = {
  // ── the showcase example — five `requires` and no runtime caller ─────────
  // `examples/showcase.ddd` is the repo's broadest sample and no runner boots
  // it, so its two guarded operations, two guarded workflow starters and one
  // `tenantOwned` aggregate have no caller of EITHER polarity.  Pinned per
  // surface rather than per file on purpose: adding a `requires` to a sample
  // then fails here until someone writes it down.
  "examples/showcase": {
    "create POST /api/engineers": R.notABehaviouralCase,
    "destroy DELETE /api/engineers/{id}": R.notABehaviouralCase,
    "find GET /api/engineers": R.notABehaviouralCase,
    "explicitHandler GET /api/engineers/by_handle": R.notABehaviouralCase,
    "getById GET /api/engineers/{id}": R.notABehaviouralCase,
    "operation POST /api/builds/{id}/promote": R.notABehaviouralCase,
    "operation POST /api/engineers/{id}/update": R.notABehaviouralCase,
    "operation POST /api/projects/{id}/archive": R.notABehaviouralCase,
    "operation POST /api/projects/{id}/rename": R.notABehaviouralCase,
    "workflow POST /api/workflows/promote_to_production": R.notABehaviouralCase,
    "workflow POST /api/workflows/register_project": R.notABehaviouralCase,
  },

  ...Object.fromEntries(
    CORPUS.filter((f) => f.authzGate).map((f) => [
      `corpus/${f.id}`,
      Object.fromEntries(
        Object.entries(f.authzGate ?? {})
          .filter(([surface]) => surface !== "//")
          .map(([surface, cls]) => {
            if (!Object.hasOwn(R, cls))
              throw new Error(
                `${f.id}.corpus.json: authzGate["${surface}"] names no R class (${cls})`,
              );
            return [surface, R[cls as keyof typeof R]];
          }),
      ),
    ]),
  ),
};

/**
 * Sources in the census POPULATION that do not parse on this head.
 *
 * Recorded rather than skipped: a `.ddd` in the repo the toolchain cannot read
 * is a bigger finding than an ungated route, and it is invisible today —
 * `generated-react-build.yml` iterates `examples/acme.ddd` plus
 * `web/src/examples/**`, so nothing else under `examples/` is parsed by any
 * gate.  Ratchets both ways: a repaired source drops out (and joins the census
 * with its own pins), a newly-broken one fails here first.
 */
export const NON_PARSING_SOURCES: readonly string[] = [];
