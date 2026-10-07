// ---------------------------------------------------------------------------
// The ADVISORY diagnostic codes — the `Suggestions:` channel.
//
// A handful of phase-⑦ checks emit ADVICE rather than a verdict: the model is
// legal, the compiler has spotted a shape that is usually a mistake, and the
// author decides.  These ride the normal `validateLoomModel` output at
// WARNING severity (so every surface already carries them — LSP squiggles,
// the playground's Problems rows, `parse --json`, `generate --json`) but are
// deliberately kept OUT of the `N warning(s).` count and printed under their
// own `Suggestions (N):` heading by `ddd parse` / `ddd generate system`.
//
// This set is the one place that decides which codes get that treatment.  It
// was a pair of `d.code !== "loom.index-suggestion"` literals in
// `src/cli/main.ts` — which meant the second advisory to arrive would silently
// come out labelled `warning` and inflate the count, the exact
// parse-disagrees-with-generate failure the shared IR printer exists to
// prevent.
//
// Pure, import-free leaf like its siblings `messages.ts` and `code-docs.ts`:
// consumed by the browser playground, so it must stay Node-free.
// ---------------------------------------------------------------------------

/** Codes whose diagnostics are advice, never a verdict.  Each is
 *  warning-severity, never affects an exit code, and prints under
 *  `Suggestions:` rather than among the warnings. */
export const ADVISORY_CODES: ReadonlySet<string> = new Set([
  // A query-filtered column with no covering leading-column index
  // (`src/ir/validate/checks/index-suggestion-checks.ts`).
  "loom.index-suggestion",
  // An aggregate no code path can construct — legal, sometimes deliberate
  // (a read-only table fed out of band, or a fixture that only pins emission)
  // and worth saying out loud either way
  // (`src/ir/validate/checks/aggregate-constructible-checks.ts`).
  "loom.aggregate-not-constructible",
]);

/** True when a diagnostic code belongs to the advisory `Suggestions:`
 *  channel rather than the warning count. */
export function isAdvisoryCode(code: string | undefined): boolean {
  return code !== undefined && ADVISORY_CODES.has(code);
}
