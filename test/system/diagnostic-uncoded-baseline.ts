// The UNCODED diagnostic sites — the drain list for M-T9.56.
//
// A diagnostic that reaches the user with no `loom.*` code is stamped
// `loom.unknown` by `src/api/report.ts`, and `loom.unknown` is not a catalog
// key: no wording entry, no docs anchor, no firing-census bucket, no fix hint
// in the Problems panel.  Every condition below therefore collapses onto one
// meaningless string on the wire, and the user cannot tell two of them apart.
//
// `docs/architecture/diagnostic-catalog.md` states the opposite rule
// normatively — every user-visible diagnostic carries a catalogued code — so
// this is a BACKLOG, not a convention.  It is drained by M-T9.56's drain half
// (Wave C4): move the wording into `src/diagnostics/messages.ts`, attach the
// code at the site, give it a docs anchor in `src/diagnostics/code-docs.ts` (or
// list it in `diagnostic-docs-undocumented.ts`), and LOWER THE ROW HERE in the
// same change.
//
// WHY A PER-FILE COUNT AND NOT A WAIVER LIST.  A code-less site has no stable
// key to waive: line numbers churn under every edit above them and the message
// text is reworded as the check evolves, so a per-site waiver table would be
// stale within a week and its staleness would read as a pass.  A per-file EXACT
// count has no such key — it is pinned by construction, and it ratchets in both
// directions:
//
//   GROWS  → a new uncoded condition landed; the gate names the site.
//   SHRINKS→ a site was drained but its row was not lowered; the gate says so,
//            which is what makes a fix delete its own slack.
//   ZERO   → the row must be DELETED, not left at 0 (same rule as every other
//            ratchet here: `legacy-generate-path-ratchet.test.ts`,
//            `allowlist-ratchet.test.ts`).
//
// Pinned by `diagnostic-catalog.test.ts` (invariant 5).  Measured 2026-09-11 on
// the scanner that lives there: 129 sites (118 errors, 11 warnings) across 12
// files; this slice drained one of them (`loom.emit-unknown-field`) as the proof
// that the drain path works, leaving 128.  The IR check leaves
// (`src/ir/validate/checks/`), the macro expander and the `src/api/` entry
// points are already clean and hold no row.

/**
 * `<file> → number of diagnostic sites in it that attach NO code`, exact.
 *
 * The scanner counts the two shapes a user-visible diagnostic is built in:
 * Langium's `accept(severity, message, opts)` with no `code` in `opts` (or no
 * `opts` at all), and the IR/macro `{ severity, message, … }` object literal
 * with no `code` property.
 */
export const UNCODED_SITES: Readonly<Record<string, number>> = {
  "src/language/ddd-validator.ts": 6,
  "src/language/validators/_shared.ts": 1,
  "src/language/validators/datasource.ts": 9,
  "src/language/validators/deployable.ts": 24,
  "src/language/validators/match.ts": 12,
  "src/language/validators/repository.ts": 1,
  "src/language/validators/statements.ts": 22,
  "src/language/validators/structural.ts": 7,
  "src/language/validators/toplevel-function.ts": 1,
  "src/language/validators/traceability.ts": 9,
  "src/language/validators/types.ts": 15,
  "src/language/validators/ui.ts": 21,
};

/** The one number to watch shrink.  Derived, so a row edit cannot forget it. */
export const UNCODED_TOTAL: number = Object.values(UNCODED_SITES).reduce((n, c) => n + c, 0);

/**
 * The fixtures in `diagnostic-firing-census.test.ts` that STILL raise
 * `loom.unknown` alongside the code they are proving — i.e. sources on which
 * the generic code demonstrably reaches a user today.
 *
 * Shrink-only, and each entry names the site it hits so the drain can aim.  The
 * assertion lives in `diagnostic-firing-census.test.ts`; an entry that stops
 * raising `loom.unknown` fails as stale, so the fix deletes its own row.
 */
export const FIXTURES_RAISING_UNKNOWN: Readonly<Record<string, string>> = {};
