// The `unknown`-CASCADE census (M-T5.16 (b)).
//
// `T.unknown` is the type system's placeholder: "I could not work out what this
// is."  Every downstream check then treats it as a STOP — `if (t.kind ===
// "unknown") return;` — on the reasoning that whatever made it unknown already
// reported, so re-reporting would cascade.  That reasoning is right about
// cascades and wrong about coverage: the suppression is written per *receiver*,
// not per *diagnostic*, so ONE unknown in an expression silently disables
// EVERY check downstream of it — operand typing, assignability, sensitivity
// drop, arity, enum membership — including the ones that had an independent
// complaint to make.
//
// The weak-spots audit §7 named this as a fragility; this census makes it a
// MEASURED one. Two halves:
//
//   1. **The site census.** Every `kind === "unknown"` suppression in
//      `src/language/validators/**` and `src/language/type-system.ts`, pinned
//      per file on an exact, shrink-only baseline. A new suppression has to be
//      declared here, which is the lint the mission asked for ("at minimum a
//      lint that counts suppressed sites"). It does NOT forbid them — several
//      are correct — it forbids adding one silently.
//
//   2. **The corpus measurement.** How much of the real corpus stands behind
//      that stop sign: the share of expression nodes across `examples/` +
//      `web/src/examples/` that types as `unknown`. If that share were ~0 the
//      fragility would be theoretical.
//
//      **Measured: 28 333 of 46 492 expression nodes — 60.9 % — type as
//      `unknown`**, overwhelmingly `NameRef` (13 886) and `PostfixChain`
//      (11 773). Read it as an UPPER BOUND, and read WHY carefully, because
//      the number is two findings, not one:
//
//        - The env here is `envForNode`, the SHARED env builder — the one the
//          LSP hover/completion/definition providers and several validators
//          use. It documents its own approximation ("`let` bindings are typed
//          `T.unknown` for simplicity"), and it has no arm for several binder
//          shapes. So part of the 60.9 % is env poverty, not expression
//          poverty: a validator that builds its env inline sees fewer.
//        - But that IS the second finding. Every consumer of `envForNode`
//          — go-to-definition on a member, hover, completion, and the
//          validators that route through it — sees the same 60.9 %. The
//          suppression and the coarse env compound: the env produces the
//          placeholder, and the suppression turns it into silence.
//
//      The band below is pinned both ways so either direction is a review.
//
// WHAT THIS DOES NOT DO. It does not narrow any suppression and it does not
// enrich `envForNode` — both are `src/language/{validators,type-system}.ts`
// behaviour changes outside this packet's fence. The recipe is in the wave C4
// packet 4f hand-off: split each site into "suppress the type-mismatch arm"
// vs "suppress everything", a per-site judgement over the 21 sites this census
// names, and give `envForNode` real `let`-binding types.

import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT, trackedDddFiles } from "../_helpers/ddd-corpus.js";

/** Files that own a cascade suppression, with the EXACT number of sites each
 *  carries.  Shrink-only: narrowing a suppression lowers its row (and deletes
 *  it at 0); adding one fails until it is declared here with a reason. */
const SUPPRESSION_BASELINE: Record<string, number> = {
  // The statement validator is the big one — lvalue walks, call-arg checks and
  // assignment all stop on an unknown receiver.
  "src/language/validators/statements.ts": 8,
  // Binary-operand folding, ternary branch agreement, and the `match`
  // subject/arm check.
  "src/language/validators/types.ts": 7,
  // `warnSensitivityDrop` — a sensitivity tag cannot be compared through a
  // placeholder, so this one is arguably sound.
  "src/language/validators/_shared.ts": 2,
  // Builder-call argument typing: a typo'd bare enum value is reported at its
  // own site, so the arg check stands down.
  "src/language/validators/builder-call.ts": 1,
  // Interpolation-hole typing in a template literal.
  "src/language/validators/template.ts": 1,
  // `arithmeticResult` itself: unknown ⊕ anything = unknown. This is the
  // PROPAGATOR, not a suppression — it is what makes one unknown reach every
  // later operand position in the same expression.
  "src/language/type-system.ts": 2,
};

/** The band the measured `unknown` share must stay inside.  Measured at
 *  **60.9 %** (28 333 of 46 492) on the day this census landed.  Pinned BOTH
 *  ways on purpose: a rise means the validators stopped checking more of the
 *  corpus (a name-resolution or env regression), and a fall means the drain
 *  worked and the band should be lowered in the same change — the anti-slack
 *  rule that keeps a baseline believable. */
const UNKNOWN_SHARE_MAX = 0.66;
const UNKNOWN_SHARE_MIN = 0.5;

function suppressionSites(rel: string): number {
  const text = fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
  return [...text.matchAll(/kind === "unknown"/g)].length;
}

function validatorFiles(): string[] {
  const dir = path.join(REPO_ROOT, "src/language/validators");
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => `src/language/validators/${f}`);
}

describe("unknown-cascade census (M-T5.16 (b))", () => {
  it("every cascade suppression is declared, and none was added silently", () => {
    const scanned = [...validatorFiles(), "src/language/type-system.ts"];
    // Vacuum guard: the scan must reach the files it claims to.
    expect(scanned.length).toBeGreaterThan(15);
    expect(scanned).toContain("src/language/validators/statements.ts");

    const live: Record<string, number> = {};
    for (const rel of scanned) {
      const n = suppressionSites(rel);
      if (n > 0) live[rel] = n;
    }

    const added = Object.keys(live).filter((f) => !(f in SUPPRESSION_BASELINE));
    expect(
      added,
      'New `kind === "unknown"` cascade suppression(s) in a file that had none. ' +
        "A suppression written per RECEIVER disables every downstream check, not " +
        "just the one that would cascade (M-T5.16 (b)) — declare it in " +
        "SUPPRESSION_BASELINE with the reason it is sound.",
    ).toEqual([]);

    const grown = Object.entries(live)
      .filter(([f, n]) => n > (SUPPRESSION_BASELINE[f] ?? 0))
      .map(([f, n]) => `${f}: ${SUPPRESSION_BASELINE[f]} → ${n}`);
    expect(grown, "Cascade suppressions grew. This baseline is shrink-only:").toEqual([]);

    // Anti-slack: a drained file must lower its row in the same change, or the
    // baseline rots into a number nobody believes.
    const stale = Object.entries(SUPPRESSION_BASELINE)
      .filter(([f, n]) => (live[f] ?? 0) < n)
      .map(([f, n]) => `${f}: baseline ${n}, actual ${live[f] ?? 0} — lower it`);
    expect(stale, "A suppression was narrowed without lowering its baseline row:").toEqual([]);
  });

  it("the corpus measurement: how much really stands behind the stop sign", async () => {
    const { parseString } = await import("../_helpers/parse.js");
    const { AstUtils } = await import("langium");
    const { typeOf, envForNode } = await import("../../src/language/type-system.js");
    const { isExpression } = await import("../../src/language/generated/ast.js");

    // A representative slice, not the whole population — every tracked `.ddd`
    // would make this a multi-minute suite member for a number that moves
    // slowly. `examples/` + `web/src/examples/` is the same slice the
    // frontend corpus snapshot uses.
    const sources = trackedDddFiles().filter(
      (f) => f.startsWith("examples/") || f.startsWith("web/src/examples/"),
    );
    expect(sources.length, "the corpus slice is empty").toBeGreaterThan(20);

    let total = 0;
    let unknown = 0;
    const byType: Record<string, number> = {};
    for (const rel of sources) {
      const text = fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
      let model: Awaited<ReturnType<typeof parseString>>["model"];
      try {
        model = (await parseString(text, { validate: false })).model;
      } catch {
        continue; // a template or a deliberately-broken fixture — not the point
      }
      if (!model) continue;
      for (const node of AstUtils.streamAllContents(model)) {
        if (!isExpression(node)) continue;
        total++;
        let t: { kind: string };
        try {
          t = typeOf(node, envForNode(node));
        } catch {
          continue;
        }
        if (t.kind !== "unknown") continue;
        unknown++;
        byType[node.$type] = (byType[node.$type] ?? 0) + 1;
      }
    }

    expect(total, "the measurement reached no expression at all").toBeGreaterThan(1000);
    const share = unknown / total;
    const report =
      `${unknown} of ${total} expression nodes (${(share * 100).toFixed(2)} %) type as ` +
      "`unknown` under the shared `envForNode` env, so every check downstream of " +
      `each one is suppressed. By node type: ${JSON.stringify(byType)}.`;
    expect(
      share,
      `${report} A RISE means the validators (and LSP hover/definition) stopped ` +
        "reaching more of the corpus — a name-resolution or env regression, not a " +
        "corpus change.",
    ).toBeLessThan(UNKNOWN_SHARE_MAX);
    expect(
      share,
      `${report} A FALL is good news that must be BANKED: lower UNKNOWN_SHARE_MIN ` +
        "(and UNKNOWN_SHARE_MAX) in the same change, or the band stops meaning anything.",
    ).toBeGreaterThan(UNKNOWN_SHARE_MIN);
  });
});
