// ---------------------------------------------------------------------------
// The ONE way a walker says "I could not render this".
//
// Every unrenderable construct in the body walker ends the same way: a comment
// in markup-child position, so the page still compiles and the gap is visible to
// whoever reads the generated source.  What was missing is a way for a TEST to
// find those comments without knowing their wording.
//
// `frontend-showcase-render.test.ts` — the cross-frontend matrix whose whole job
// is catching silent degradation — used to scan for a hand-kept list of four
// give-up wordings.  There are 36 distinct ones.  It saw ONE:
//
//   • `Timeline: not yet supported on …` does not contain the substring
//     "not supported" that the list looked for;
//   • the `Icon` fallback is built from a variable (`unknown icon name 'star'`
//     vs `Icon needs name: or svg:`), so it has no static prefix to list at all;
//   • the other 33 were simply never added.
//
// Flutter was the exception, and its `extraScan` says why: it reuses
// `analyzeFlutterParity`, the emitter's OWN scanner, so "a NEW Flutter fallback
// wording is covered the day it is added".  That is the right idea; this module
// generalises it to every target.  A give-up now carries a fixed SENTINEL, so
// the matrix matches on structure instead of on a copy of the wording — which
// is the same "derive, don't hand-keep" rule the walker already applies to
// primitive names (`walker-primitive-names.ts`) and named args
// (`walker-primitive-args.ts`).
//
// `walker-give-up-routing.test.ts` pins that no walker file calls
// `renderComment` for a give-up directly, so a new one cannot skip the sentinel.
//
// ---------------------------------------------------------------------------
// M-T9.55 — THE SENTINEL IS NOT ENOUGH ON ITS OWN.
//
// The sentinel makes a give-up FINDABLE.  It does not make it EXPLICABLE: the
// wording is prose written at the emission site, so the reader of a generated
// page gets a sentence and no way to look the condition up, and no test,
// census or CLI pass can group two spellings of the same refusal.  Measured on
// this tree before the drain, `CreateForm { }` (no `of:`) and
// `DestroyForm { }` are valid `.ddd` — `ddd parse` reports `0 error(s), 0
// warning(s)` — and generate a page whose whole body is one of these comments.
// That is the SILENT CLASS: the walker declined and nothing named the reason.
//
// So every give-up now carries a `loom.*` CODE from the one diagnostic
// catalog (`src/diagnostics/messages.ts`), and the code is rendered into the
// comment right after the sentinel:
//
//     loom:unrendered [loom.page-primitive-arg-missing] CreateForm(of: …): …
//
// The code is a `DiagnosticMessageKey`, so an emission site cannot invent one:
// a key outside the catalog fails `tsc`, and `diagnostic-catalog.test.ts`
// keeps the catalog and `code-docs.ts` honest about it.  What that buys:
//
//   * the reader of generated output has a code to look up (`code-docs.ts`
//     anchors it in the language reference);
//   * `GIVE_UP_RE` below extracts (code, text) from emitted output, so a scan
//     can CLASSIFY degradations instead of merely counting them — the
//     conformance invariant in `test/generator/_walker/walker-declines-
//     with-a-code.test.ts` rides exactly that;
//   * a future `generate system` pass can lift these into real CLI
//     diagnostics with no emitter change, because the code is already there.
//
// The remaining half — SURFACING those codes as `ddd generate` warnings —
// lives outside this tree (`src/system/`), and is the follow-on this drain
// unblocks rather than something an emitter can do from here.
// ---------------------------------------------------------------------------

import { codeOfMessageKey, type DiagnosticMessageKey } from "../../diagnostics/messages.js";
import type { WalkerTarget } from "./target.js";

/** The marker every walker give-up comment carries.
 *
 *  Deliberately lower-case, colon-joined and prefixed `loom` — it has to be a
 *  string that cannot plausibly occur in the surrounding generated code, since
 *  the matrix greps emitted output for it.  Short prefixes like `Action(` or
 *  `Form(` (real give-up wordings) match ordinary emitted code, which is why the
 *  wording itself can never be the thing tests look for. */
export const GIVE_UP_SENTINEL = "loom:unrendered";

/** The `loom.*` code a give-up names.  A catalog KEY rather than a bare string
 *  so the compiler rejects an invented one; the bare code (the `#slug` dropped)
 *  is what lands in the emitted comment. */
export type GiveUpCode = DiagnosticMessageKey;

/** Matches a rendered give-up in emitted output of ANY target, capturing the
 *  code and the explanatory text.  Exported so scanners read the shape from
 *  here instead of re-spelling it — the same "derive, don't hand-keep" rule the
 *  sentinel itself exists for. */
export const GIVE_UP_RE = new RegExp(`${GIVE_UP_SENTINEL} \\[(loom\\.[a-z0-9-]+)\\] ?([^\\n]*)`);

/** The comment BODY of a give-up: sentinel, code, then the prose.
 *
 *  Split out of {@link giveUp} for the three give-up sites that build their own
 *  comment syntax because they have no `WalkerTarget` in hand — the HEEx
 *  parallel walker and the two self-hosting packs (Feliz / Flutter).  They pass
 *  the result through their own comment delimiters; they must NOT re-spell the
 *  sentinel. */
export function giveUpText(code: GiveUpCode, text: string): string {
  return `${GIVE_UP_SENTINEL} [${codeOfMessageKey(code)}] ${text}`;
}

/** Emit the give-up comment for a construct this target cannot render.
 *
 *  Use this — never `target.renderComment` — for anything that means "the
 *  authored construct did not make it into the output".  `renderComment` stays
 *  the seam for a comment that is not a degradation.
 *
 *  `code` names the catalogued `loom.*` condition; the sentinel and the code go
 *  FIRST so a truncated line in a diff or a test failure still shows both. */
export function giveUp(target: WalkerTarget, code: GiveUpCode, text: string): string {
  return target.renderComment(giveUpText(code, text));
}

/** The give-up's VISIBLE twin — for a construct whose absence would otherwise
 *  leave a framed, empty region on the page (see `renderNotice` on
 *  {@link WalkerTarget}).  Carries the same sentinel + code, so one scan finds
 *  both. */
export function giveUpNotice(target: WalkerTarget, code: GiveUpCode, text: string): string {
  const render = target.renderNotice ?? target.renderComment;
  return render.call(target, giveUpText(code, text));
}
