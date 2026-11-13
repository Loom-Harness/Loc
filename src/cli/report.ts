// The CLI's diagnostic printing — the phase-④ / phase-⑦ lines and the single
// summary footer every command that validates prints.

import * as fs from "node:fs";
import { isAdvisoryCode } from "../diagnostics/advisory.js";
import {
  irDiagnosticSourceRef,
  type LoomDiagnostic,
  offsetToPosition,
} from "../ir/validate/validate.js";
import { warningLines } from "./warning-lines.js";

/** What one phase found — the unit `printSummary` adds up. */
export interface PhaseTally {
  errors: number;
  warnings: number;
}

/**
 * THE summary line.  Singular, deliberately.
 *
 * `parse` printed two, and they contradicted each other:
 *
 *     0 error(s), 0 warning(s).        ← phase ④, the AST validator
 *     loom.named-lifecycle-dropped …
 *     1 error(s).                      ← phase ⑦, the IR validator
 *
 * A user who reads the first line stops there and concludes the model is
 * clean — the command's own footer said so — and the second line reads as
 * belonging to whatever came after it.  Two footers for one question is worse
 * than either alone: one of them is always wrong about the file (audit #2864
 * § Papercuts / M-T9.60).
 *
 * So each phase now RETURNS its tally instead of footering itself, and the
 * command that runs them prints one line, once, after the last phase it ran —
 * counting every phase that ran.  A command that exits early (AST errors abort
 * before lowering) still prints exactly one summary, covering the phases that
 * got to run.
 *
 * Advisory diagnostics (`src/diagnostics/advisory.ts`) stay out of the counts
 * and keep their own `Suggestions (N):` heading — they are not warnings and
 * never gate anything.
 */
export function printSummary(...phases: readonly PhaseTally[]): void {
  let errors = 0;
  let warnings = 0;
  for (const p of phases) {
    errors += p.errors;
    warnings += p.warnings;
  }
  console.error(`${errors} error(s), ${warnings} warning(s).`);
}

/** The AST-diagnostic (phase ④) lines.  Returns its tally for `printSummary`; the
 *  footer is NOT this function's to print. */
export function printAstDiagnostics(result: {
  diagnostics: readonly string[];
  errorCount: number;
  warningCount: number;
}): PhaseTally {
  for (const d of result.diagnostics) console.error(d);
  return { errors: result.errorCount, warnings: result.warningCount };
}

/** The `path:line:col ` prefix for a phase-⑦ diagnostic that carries an
 *  `origin` (eval item 28) — the same shape the AST-phase lines lead with, so
 *  an editor / terminal link jumps to the construct the diagnostic is about.
 *  Empty when the check attached no origin (a system-level construct) or the
 *  source text is unavailable.  Texts come from the loaded documents; a path
 *  outside that map is read from disk once and cached. */
function irDiagnosticLocator(
  sourceTexts: ReadonlyMap<string, string> | undefined,
): (d: LoomDiagnostic) => string {
  const cache = new Map<string, string | undefined>(sourceTexts ?? []);
  const textOf = (p: string): string | undefined => {
    if (!cache.has(p)) {
      let text: string | undefined;
      try {
        text = fs.readFileSync(p, "utf8");
      } catch {
        text = undefined;
      }
      cache.set(p, text);
    }
    return cache.get(p);
  };
  return (d) => {
    const ref = irDiagnosticSourceRef(d);
    if (!ref) return "";
    const text = textOf(ref.path);
    if (text === undefined) return `${ref.path} `;
    const pos = offsetToPosition(text, ref.span.start);
    return `${ref.path}:${pos.line + 1}:${pos.character + 1} `;
  };
}

/** The phase-⑦ (IR) diagnostic report, printed IDENTICALLY by `parse` and by
 *  `generate system`.
 *
 *  It was not: `generate` had its own copy that printed every non-error
 *  diagnostic under one `N warning(s).` footer — so the 12 advisory
 *  `loom.index-suggestion` hints, which `parse` prints under their own
 *  `Suggestions (N):` heading and deliberately does NOT count as warnings,
 *  came out of `generate` labelled `warning`.  The two commands then disagreed
 *  about the same file (`3 warning(s).` + `Suggestions (12):` vs
 *  `15 warning(s).`), which is exactly the pre-flight-disagrees-with-the-real-
 *  command failure `runParse`'s own doc comment exists to prevent.  One
 *  printer, one wording, both callers.
 *
 *  It prints LINES, not a footer.  Its `N error(s).` / `N warning(s).` footers
 *  were the second half of `parse`'s contradictory pair (see `printSummary`);
 *  the caller now folds this phase's counts into the single summary.
 *
 *  Returns the split so the caller can tally it and decide about exit codes
 *  (errors gate; warnings and suggestions never do). */
export function printIrDiagnostics(
  diagnostics: readonly LoomDiagnostic[],
  sourceTexts?: ReadonlyMap<string, string>,
  opts: { allWarnings?: boolean } = {},
): {
  errors: LoomDiagnostic[];
  warnings: LoomDiagnostic[];
  hints: LoomDiagnostic[];
} {
  const at = irDiagnosticLocator(sourceTexts);
  const errors = diagnostics.filter((d) => d.severity === "error");
  for (const d of errors) console.error(`${at(d)}${d.code} ${d.source}: ${d.message}`);

  // Phase ⑦ computes 18 warning codes (findall-no-page,
  // cross-tenant-without-tenancy, …).  A warning never affects the exit code;
  // it just has to be VISIBLE.  (The ADVISORY codes are excluded here — they
  // keep their own `Suggestions:` footer below, and would otherwise print
  // twice.  The set lives in `src/diagnostics/advisory.ts`, not as a literal
  // here: with a literal, the second advisory code to arrive silently came out
  // labelled `warning` and inflated the count.)
  const warnings = diagnostics.filter((d) => d.severity === "warning" && !isAdvisoryCode(d.code));
  for (const line of warningLines(warnings, at, opts.allWarnings ?? false)) console.error(line);

  // Advisory only — the codes in `ADVISORY_CODES` keep their own heading and
  // never fail the command.  `loom.update-gate-suggestion` is deliberately NOT
  // one of them: an operation that can rewrite a gated field is a security
  // finding, so it prints and counts as a warning above.
  const hints = diagnostics.filter((d) => isAdvisoryCode(d.code));
  if (hints.length > 0) {
    console.error(`\nSuggestions (${hints.length}):`);
    for (const d of hints) console.error(`  ${at(d)}${d.source}: ${d.message}`);
  }
  return { errors, warnings, hints };
}

export const ALL_WARNINGS_FLAG = "--all-warnings";

export const ALL_WARNINGS_HELP =
  "print every repeated warning in full (by default a warning code that fires more than 3 times prints once plus a summary line naming the rest)";
