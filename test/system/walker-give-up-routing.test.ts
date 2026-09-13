// Every walker degradation goes through `giveUp()` — so ONE marker finds them all.
//
// The cross-frontend render matrix (`frontend-showcase-render.test.ts`) exists to
// catch a construct that silently fails to render on some target.  It could only
// do that by recognising the give-up comment the walker leaves behind, and until
// the sentinel landed it recognised those by their WORDING — a hand-kept list of
// four strings against the thirty-six the walkers emit.  It saw one.
//
// `Timeline: not yet supported on …` does not contain the `"not supported"` the
// list looked for.  The `Icon` fallback is built from a variable, so it has no
// static wording to list at all.  The other thirty-three were never added — and
// nothing failed when they were not, which is the property that let the list
// stay at four while the walkers grew.
//
// `giveUp()` fixes that by construction: the marker is one constant, imported
// from the emitter side rather than copied.  What this file adds is the part
// that keeps it true — a new give-up cannot skip the helper, because a direct
// `renderComment` call in walker code fails here.
//
// The rule is narrow on purpose.  `renderComment` is still the right seam for a
// comment that is NOT a degradation (HEEx's benign `<op> has no parameters`
// note), so the pin is "route give-ups through the helper", not "never emit a
// comment".  The allowlist below is where a non-degradation comment is declared,
// with the reason it is not one.

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { DIAGNOSTIC_MESSAGES } from "../../src/diagnostics/messages.js";
import { GIVE_UP_SENTINEL } from "../../src/generator/_walker/give-up.js";

const REPO = resolve(import.meta.dirname, "..", "..");

/** The trees whose comments are page-body rendering output.  `src/generator/
 *  elixir/` is in scope for its walker core only — the rest of the Phoenix
 *  emitter writes ordinary source comments. */
const WALKER_TREES = ["_walker", "react", "vue", "svelte", "angular", "feliz", "flutter"] as const;

/** TWO entries per tree, and that is not redundancy (audit finding F63).
 *  `git ls-files 'src/generator/react/**' + '/*.ts'` matches files in
 *  SUBDIRECTORIES ONLY — a top-level `src/generator/react/x.ts` does not match,
 *  because git's `**` requires the slash it spans to be present. So the single
 *  glob this list used to carry scanned **40 of 140** files: 19 of `_walker`'s
 *  39, 9 of react's 22, and **zero** of flutter's 22 and feliz's 13. Twenty-eight
 *  direct seam calls sat in that blind spot — including six in the shared
 *  `walker-core.ts` and the whole Angular destroy-form fork — while this test
 *  reported green. A gate that never reaches what it names is the repo's own
 *  recurring failure shape (`experience_gathered.md` §59, §63). */
const WALKER_GLOBS = [
  ...WALKER_TREES.flatMap((t) => [`src/generator/${t}/*.ts`, `src/generator/${t}/**/*.ts`]),
  // The HEEx parallel engine — a walker in every sense that matters here (it
  // emits page-body markup and it gives up), but it lives beside the rest of
  // the Phoenix emitter, whose comments are ordinary source comments. So the
  // two files are named rather than the tree globbed.
  "src/generator/elixir/heex-walker-core.ts",
  "src/generator/elixir/heex-target.ts",
];

/** Files allowed to call `renderComment` / `renderNotice` directly, each with
 *  the reason the call is not a degradation.  A file that stops calling it fails
 *  as a stale entry, the same ratchet the register rows carry. */
const NOT_A_GIVE_UP: readonly { file: string; why: string }[] = [
  {
    file: "src/generator/_walker/give-up.ts",
    why: "the helper itself — the one place that is allowed to reach the seam",
  },
];

const allowed = new Set(NOT_A_GIVE_UP.map((a) => a.file));

/** Direct `…renderComment(…)` / `…renderNotice(…)` CALLS, excluding the seam's
 *  own declaration and each target's implementation of it (`renderComment: …`),
 *  which are definitions rather than uses. */
function directSeamCalls(): { file: string; line: number; text: string }[] {
  const files = execSync(`git ls-files ${WALKER_GLOBS.map((g) => `'${g}'`).join(" ")}`, {
    cwd: REPO,
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .filter(Boolean);
  const hits: { file: string; line: number; text: string }[] = [];
  for (const file of files) {
    if (allowed.has(file)) continue;
    const src = readFileSync(resolve(REPO, file), "utf8");
    if (!src.includes("renderComment") && !src.includes("renderNotice")) continue;
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const callee = node.expression.getText();
        if (/(^|\.)render(Comment|Notice)$/.test(callee.replace(/\?\.$/, ""))) {
          hits.push({
            file,
            line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1,
            text: callee,
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return hits;
}

describe("walker give-ups all route through the sentinel", () => {
  it("no walker file reaches the comment seam directly", () => {
    const direct = directSeamCalls().map((h) => `${h.file}:${h.line}  ${h.text}(…)`);
    expect(
      direct,
      "a walker degradation is being emitted without the `loom:unrendered` sentinel. " +
        "The cross-frontend render matrix finds silent gaps by that marker, so a give-up " +
        "that skips it is invisible there — which is exactly how the previous wording-list " +
        "version came to recognise 1 of 36. Use `giveUp(ctx.target, …)` (or `giveUpNotice`), " +
        "or, if the comment is NOT a degradation, declare the file in NOT_A_GIVE_UP with why.",
    ).toEqual([]);
  });

  it("allows nothing that no longer needs allowing (a stale entry is a lie)", () => {
    const stale = NOT_A_GIVE_UP.filter((a) => {
      const src = readFileSync(resolve(REPO, a.file), "utf8");
      return !src.includes("renderComment") && !src.includes("renderNotice");
    }).map((a) => a.file);
    expect(stale, "allowlisted files that no longer touch the seam — drop the entry").toEqual([]);
  });

  // -------------------------------------------------------------------------
  // M-T9.55 slice 3 — the sentinel says a give-up HAPPENED; the code says WHY.
  //
  // Slices 1+2 (#2843) fixed the glob and routed the 26 sites it uncovered
  // through `giveUp()`.  That made every decline findable and left all of them
  // unexplained: the reason was prose at the emission site, so `CreateForm { }`
  // (no `of:`) validated clean and generated a page whose body was one comment,
  // with nothing to look up and nothing for a census to group on.
  //
  // The ratchet: every give-up names a catalogued `loom.*` code.  It is a
  // compile-time property too (`GiveUpCode` = `DiagnosticMessageKey`), but the
  // scan below is what keeps it from being restored as a `String` cast or a
  // computed key — and what reports the residue as a LIST rather than a count,
  // so a partial drain names its own remaining sites.
  //
  // `UNCODED_GIVE_UPS` is shrink-only and currently EMPTY.  An entry is a
  // file:line plus the reason its code cannot be named yet; a stale one fails.
  // -------------------------------------------------------------------------
  const UNCODED_GIVE_UPS: readonly { site: string; why: string }[] = [];

  /** Every `giveUp(…)` / `giveUpNotice(…)` call in the walker trees, with the
   *  code argument as WRITTEN — `null` when it is not a plain string literal
   *  (a computed key defeats the point: the emitted comment would carry a code
   *  no scan of the source can predict). */
  function giveUpCalls(): { file: string; line: number; code: string | null }[] {
    const files = execSync(`git ls-files ${WALKER_GLOBS.map((g) => `'${g}'`).join(" ")}`, {
      cwd: REPO,
      encoding: "utf8",
    })
      .trim()
      .split("\n")
      .filter(Boolean);
    const hits: { file: string; line: number; code: string | null }[] = [];
    for (const file of files) {
      const src = readFileSync(resolve(REPO, file), "utf8");
      if (!src.includes("giveUp")) continue;
      const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
      const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node)) {
          const callee = node.expression.getText();
          // `giveUpText(code, text)` takes the code FIRST (no target to pass);
          // `giveUp`/`giveUpNotice` take it second.
          const idx = callee === "giveUpText" ? 0 : 1;
          if (/^giveUp(Notice|Text)?$/.test(callee)) {
            const arg = node.arguments[idx];
            const literal =
              arg !== undefined && ts.isStringLiteralLike(arg)
                ? arg.text
                : // A conditional of two string literals is still statically
                  // known (`Icon`'s missing-vs-invalid fork), so both arms count.
                  arg !== undefined &&
                    ts.isConditionalExpression(arg) &&
                    ts.isStringLiteralLike(arg.whenTrue) &&
                    ts.isStringLiteralLike(arg.whenFalse)
                  ? `${arg.whenTrue.text}|${arg.whenFalse.text}`
                  : null;
            hits.push({
              file,
              line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1,
              code: literal,
            });
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }
    return hits;
  }

  it("every give-up names a catalogued `loom.*` code", () => {
    const catalog = new Set(Object.keys(DIAGNOSTIC_MESSAGES));
    const waived = new Set(UNCODED_GIVE_UPS.map((u) => u.site));
    const bad = giveUpCalls()
      .filter((h) => h.file !== "src/generator/_walker/give-up.ts")
      .filter((h) => !waived.has(`${h.file}:${h.line}`))
      .filter((h) => h.code === null || !h.code.split("|").every((c) => catalog.has(c)))
      .map((h) => `${h.file}:${h.line}  ${h.code ?? "<not a string literal>"}`);
    expect(
      bad,
      "a walker give-up declines without naming WHY. The sentinel makes a decline findable; " +
        "the code makes it explicable — it is what the reader of generated output looks up, " +
        "what a census groups on, and what a future `generate system` pass lifts into a real " +
        "diagnostic. Pass a `loom.*` key from src/diagnostics/messages.ts as the code argument " +
        "(mint one there + an anchor in code-docs.ts if none fits).",
    ).toEqual([]);
  });

  it("the give-up census actually reaches the emitters (no vacuous green)", () => {
    // The failure shape this whole file exists to prevent: a scan that never
    // reaches what it names and reports green (§59/§63). If the walk found no
    // give-ups at all, the assertion above proved nothing.
    const calls = giveUpCalls().filter((h) => h.file !== "src/generator/_walker/give-up.ts");
    expect(calls.length).toBeGreaterThan(50);
    expect(new Set(calls.map((h) => h.file)).size).toBeGreaterThan(10);
  });

  it("waives nothing that no longer needs waiving (the ratchet shrinks)", () => {
    const live = new Set(giveUpCalls().map((h) => `${h.file}:${h.line}`));
    const stale = UNCODED_GIVE_UPS.filter((u) => !live.has(u.site)).map((u) => u.site);
    expect(stale, "waived give-up sites that no longer exist — drop the entry").toEqual([]);
  });

  it("the sentinel is a string generated code cannot plausibly contain", () => {
    // The whole scan rests on this. A marker that occurs naturally in emitted
    // output turns every cell of the matrix into a false positive; one that is
    // too short (the real give-up wordings include `Action(` and `Form(`) does
    // the same, which is why the wording could never be the thing to match on.
    expect(GIVE_UP_SENTINEL).toMatch(/^loom:[a-z]+$/);
    expect(GIVE_UP_SENTINEL.length).toBeGreaterThan(8);
  });
});
