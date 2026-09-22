// Surfacing the walker's give-ups as real diagnostics.
//
// `src/generator/_walker/give-up.ts` made every unrenderable construct carry a
// sentinel AND a `loom.*` code, and its header names the half it could not do
// from inside an emitter:
//
//   "The remaining half — SURFACING those codes as `ddd generate` warnings —
//    lives outside this tree (`src/system/`), and is the follow-on this drain
//    unblocks rather than something an emitter can do from here."
//
// This is that half.  Until it existed, the information was WRITTEN INTO THE
// OUTPUT and reported nowhere: a `ui` scaffolding a subdomain its target
// backend does not host emitted pages whose body is
//
//     { /* loom:unrendered [loom.method-call-unresolved-receiver] … */ undefined.data.items.map(…) }
//
// — a guaranteed `TypeError` on first render — while `ddd parse` and
// `ddd generate system` both answered `0 error(s), 0 warning(s)` (F-019).  The
// generator knew, named the condition, and wrote the code into a comment
// three characters from the defect; nothing lifted it.
//
// Reported as WARNINGS, not errors, and deliberately: most of the 36 give-up
// conditions are honest degradation that still compiles (an unsupported
// primitive rendering as a comment), and promoting those to errors would refuse
// projects that generate and run today.  The subset that emits non-running code
// — an unresolved receiver is the clear case — deserves error severity, but
// that is a per-code ruling backed by a corpus sweep, not a blanket one.

import { GIVE_UP_RE, GIVE_UP_SENTINEL } from "../generator/_walker/give-up.js";

/** One give-up the walker rendered into an emitted file. */
export interface GiveUpReport {
  /** Emitted path, relative to the output directory. */
  readonly path: string;
  /** 1-based line within that file. */
  readonly line: number;
  /** The `loom.*` code the walker named. */
  readonly code: string;
  /** The emission-site prose that follows the code. */
  readonly text: string;
}

/** Every give-up in an emitted file map, in path then line order.
 *
 *  Scans the OUTPUT rather than instrumenting the walkers, because there are
 *  seven of them (six `WalkerTarget`s plus the parallel HEEx engine) and three
 *  more give-up sites that build their own comment syntax.  A collector
 *  threaded through all ten would be ten places to forget; the sentinel is
 *  already in the text, and `walker-give-up-routing.test.ts` pins that it
 *  cannot be bypassed. */
export function collectGiveUps(files: ReadonlyMap<string, string>): GiveUpReport[] {
  const out: GiveUpReport[] = [];
  // One global matcher per scan; `GIVE_UP_RE` itself is not global (callers
  // match single lines with it), so re-wrap rather than mutate the shared one.
  const re = new RegExp(GIVE_UP_RE.source, "g");
  for (const path of [...files.keys()].sort()) {
    const text = files.get(path)!;
    // Cheap reject first — most emitted files carry no give-up at all, and the
    // scan runs over every file of every generated project.
    if (!text.includes(GIVE_UP_SENTINEL)) continue;
    text.split("\n").forEach((lineText, i) => {
      re.lastIndex = 0;
      for (const m of lineText.matchAll(re)) {
        out.push({ path, line: i + 1, code: m[1]!, text: trimToCommentEnd(m[2] ?? "") });
      }
    });
  }
  return out;
}

/** Give-up codes whose emitted output CANNOT RUN, as opposed to running in a
 *  degraded shape.
 *
 *  The distinction is the whole reason this is not one blanket severity.
 *  Measured on the emitted text of all 467 tracked `.ddd`:
 *
 *  * `loom.page-ref-unreachable` renders a COMMENT where a form would be —
 *    the page mounts, it is simply missing that form.  Honest degradation,
 *    visible in the source: a warning.
 *  * `loom.method-call-unresolved-receiver` renders the receiver as the literal
 *    `undefined`, so the page emits `undefined.isLoading` and
 *    `undefined.data.items.map(...)`.  That is a `TypeError` on first render —
 *    not a degraded page, a broken one.
 *
 *  Promoting the second to an error costs nothing shipped: across those 467
 *  sources, every give-up of any kind came from exactly two files — a fixture
 *  that exists to produce them (`walker-give-up-shapes.ddd`) and one audit
 *  repro.  `examples/`, `web/src/examples/`, `journey/` and the whole fixture
 *  corpus emit none. */
export const NON_RUNNING_GIVE_UPS: ReadonlySet<string> = new Set([
  "loom.method-call-unresolved-receiver",
]);

/** Split a give-up scan into the two severities above. */
export function partitionGiveUps(reports: readonly GiveUpReport[]): {
  errors: GiveUpReport[];
  warnings: GiveUpReport[];
} {
  const errors: GiveUpReport[] = [];
  const warnings: GiveUpReport[] = [];
  for (const r of reports) (NON_RUNNING_GIVE_UPS.has(r.code) ? errors : warnings).push(r);
  return { errors, warnings };
}

/** The give-up's prose, cut at whatever closes the comment it lives in.
 *
 *  `GIVE_UP_RE` captures to end of line, which is right for a scanner asking
 *  "is there a give-up here" and wrong for a DIAGNOSTIC: the walkers inline
 *  these comments mid-expression, so the raw capture drags the rest of the
 *  emitted line along —
 *
 *    receiver did not resolve * / undefined.data.items.map((row) => (
 *
 *  and a reader cannot tell the compiler's sentence from the code beside it.
 *  Each target closes its comments differently (`* /` in TSX/Dart/F#,
 *  `--%>` and `%>` in HEEx, `-->` in markup), so cut at the earliest of them. */
function trimToCommentEnd(raw: string): string {
  const ends = ["*/", "-->", "--%>", "%>"];
  let cut = raw.length;
  for (const e of ends) {
    const at = raw.indexOf(e);
    if (at >= 0 && at < cut) cut = at;
  }
  return raw.slice(0, cut).trim();
}
