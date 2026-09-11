// ---------------------------------------------------------------------------
// THE WALKER INVARIANT (M-T9.55): the body walker never declines in silence.
//
// For every input the walker is handed, exactly one of three things must be
// true — and the third is the one this file exists to forbid:
//
//   A. the model is REFUSED before codegen, with a `loom.*` diagnostic the
//      author can read and look up (`Slot { }` in a page body, a misplaced
//      `Tab`, a `Chart` with no grouped `of:`);
//   B. the walker RENDERS it;
//   C. the walker declines — emits nothing useful for the construct — and
//      says nothing about why.
//
// (C) is the SILENT CLASS.  It was measured on this tree before the drain and
// it was not hypothetical: `CreateForm { }` and `DestroyForm { }` are valid
// `.ddd` (`ddd parse` → `0 error(s), 0 warning(s)`) and generate a page whose
// entire body is `{/* loom:unrendered CreateForm(of: …): … */}` — a blank
// screen, no diagnostic, and a comment whose prose is the only explanation
// anywhere.  Two of ~64 such sites; #2843 had just made the rest FINDABLE
// (the `loom:unrendered` sentinel) without making any of them EXPLICABLE.
//
// So the invariant this file pins is: a decline carries a CATALOGUED `loom.*`
// CODE.  The scan is structural — `GIVE_UP_RE` comes from the emitter side
// (`_walker/give-up.ts`), never re-spelled here, the same rule that stopped
// the old cross-frontend matrix from recognising 1 wording out of 36.
//
// THE INPUT: every primitive in the registry, spelled with NO arguments.
//
// That is the MINIMAL body for each — the smallest thing an author can write —
// and it is deliberately the shape most likely to reach a decline path, so the
// sweep hits the give-ups rather than tiptoeing around them.  It is the exact
// complement of `test/conformance/frontend-showcase-render.test.ts`, which
// drives the FULLY-ARGUED showcase through the same seven targets and asserts
// ZERO sentinels: that gate proves the walker renders what it should, this one
// proves it explains what it won't.  Neither subsumes the other — a give-up
// cannot appear in the showcase matrix by construction, so nothing there can
// ever check what a give-up says.
//
// The seven targets are the six that ride `walkBody` plus the HEEx parallel
// engine, because the invariant is about the WALKER LAYER, not one frontend —
// and `heex-walker-core.ts` has its own give-up arm.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { validate } from "../../../src/api/index.js";
import { DIAGNOSTIC_MESSAGES } from "../../../src/diagnostics/messages.js";
import { GIVE_UP_RE, GIVE_UP_SENTINEL } from "../../../src/generator/_walker/give-up.js";
import { WALKER_PRIMITIVES } from "../../../src/generator/_walker/registry.js";
import { generateSystemFiles } from "../../_helpers/generate.js";

/** The catalogued codes a give-up may name. */
const CATALOG = new Set(Object.keys(DIAGNOSTIC_MESSAGES).map((k) => k.split("#")[0]));

/** Each target: the hosting deployable's platform and the emitted paths that
 *  carry RENDERED page output.  Phoenix is the self-hosting topology (it owns
 *  its contexts; `targets:` is a validator error on it), and it emits a whole
 *  backend — so its scan is scoped to what the HEEx walker + pack render. */
const TARGETS = [
  { name: "react", platform: "react", selfHosted: false, rendered: /\/src\/pages\// },
  { name: "vue", platform: "vue", selfHosted: false, rendered: /\/src\/pages\// },
  { name: "svelte", platform: "svelte", selfHosted: false, rendered: /\+page\.svelte$/ },
  { name: "angular", platform: "angular", selfHosted: false, rendered: /\/src\/app\/pages\// },
  { name: "feliz", platform: "feliz", selfHosted: false, rendered: /\.fs$/ },
  { name: "flutter", platform: "flutter", selfHosted: false, rendered: /lib\/pages\// },
  {
    name: "phoenixLiveView",
    platform: "elixir",
    selfHosted: true,
    rendered: /_live\.ex$|\.heex$|_web\/components\//,
  },
] as const;

const source = (body: string, t: (typeof TARGETS)[number]): string =>
  t.selfHosted
    ? `system P {
  subdomain S { context Ops { aggregate Job { name: string } repository Jobs for Job { } } }
  ui App { page Home { route: "/" title: "H" body: Stack { ${body} } } }
  api OpsApi from S
  storage primary { type: postgres }
  resource st { for: Ops, kind: state, use: primary }
  deployable app { platform: elixir contexts: [Ops] dataSources: [st] serves: OpsApi ui: App port: 4400 }
}`
    : `system P {
  subdomain S { context Ops { aggregate Job { name: string } repository Jobs for Job { } } }
  ui App { page Home { route: "/" title: "H" body: Stack { ${body} } } }
  api OpsApi from S
  storage primary { type: postgres }
  resource st { for: Ops, kind: state, use: primary }
  deployable api { platform: node contexts: [Ops] dataSources: [st] serves: OpsApi port: 4400 }
  deployable app { platform: ${t.platform} targets: api ui: App port: 3007 }
}`;

const PRIMITIVES = Object.keys(WALKER_PRIMITIVES);

/** Every give-up code the sweep actually SAW, across all seven targets.
 *  Accumulated by the per-target tests and checked by the last one — see there
 *  for why a census of the codes is not the same thing as a census of the
 *  sites. */
const SEEN = new Set<string>();

/** The give-up codes an ARGLESS body can reach — which is not the whole
 *  family, and the difference is the point of writing the list down:
 *
 *   * `loom.page-ref-unreachable` needs a primitive that NAMES something
 *     (`CreateForm { of: "Ghost" }`); argless spellings stop one step earlier,
 *     at the missing argument.  Driven by the corpus witness beside this file.
 *   * `loom.page-primitive-target-gap` fires per-FRONTEND, from the two
 *     procedural packs' missing-renderer fallback and the HEEx engine's
 *     unsupported-primitive arm — neither reachable by varying the BODY.
 *     Driven by `test/generator/elixir/heex-unsupported-primitive.test.ts` and
 *     the two `*-pack-groundwork` tests.
 *   * `loom.page-expr-unrenderable` is `walker-core.ts`'s markup-position
 *     expression backstop and has no known authored shape at all; it is pinned
 *     as unreachable in `test/system/diagnostic-firing-census.test.ts`.
 *
 *  Listing any of those three here would make this assertion a wish rather
 *  than a measurement. */
const MUST_EXERCISE = [
  "loom.page-primitive-arg-missing",
  "loom.page-primitive-arg-invalid",
] as const;

async function errorsOf(src: string): Promise<readonly { code: string; message: string }[]> {
  const report = await validate(src);
  return report.diagnostics
    .filter((d) => d.severity === "error")
    .map((d) => ({ code: d.code ?? "loom.unknown", message: d.message }));
}

/** Branch (A): the primitives whose ARGLESS spelling the compiler refuses
 *  outright.  Computed, not listed — the point is that (A) and (B∪C) partition
 *  the registry, so whichever side a primitive falls on it is accounted for. */
async function refusedCodes(name: string): Promise<readonly string[]> {
  return (await errorsOf(source(`${name} { }`, TARGETS[0]))).map((e) => e.code);
}

/** The primitives that REACH the walker on a given target: start from the
 *  target-independent set, then drop whatever that target's own phase-⑦ gates
 *  refuse (`loom.datagrid-unsupported-target` on flutter / phoenixLiveView is
 *  the live example).  A fixpoint over the combined body rather than 58 more
 *  single-primitive validations — same answer, a fraction of the cost.
 *
 *  A refusal that does NOT name a primitive cannot be dropped from, so it
 *  throws: silently generating a smaller page would hide the very refusal the
 *  partition test exists to account for. */
async function reachingOn(
  target: (typeof TARGETS)[number],
  base: readonly string[],
): Promise<string[]> {
  let reaching = [...base];
  for (let round = 0; round < 6; round++) {
    const errs = await errorsOf(source(reaching.map((n) => `${n} { }`).join(", "), target));
    if (errs.length === 0) return reaching;
    const named = reaching.filter((n) =>
      errs.some((e) => new RegExp(`\\b${n}\\b`).test(e.message)),
    );
    if (named.length === 0)
      throw new Error(
        `${target.name}: phase ⑦ refuses the sweep body for a reason that names no ` +
          `primitive, so the sweep cannot narrow: ${errs.map((e) => `${e.code} ${e.message}`).join(" | ")}`,
      );
    reaching = reaching.filter((n) => !named.includes(n));
  }
  throw new Error(`${target.name}: the reaching-set fixpoint did not settle`);
}

describe("the body walker never declines without a code", () => {
  it("partitions the registry: every primitive is refused with a code, or reaches the walker", async () => {
    // The vacuity guard. A sweep whose input set is empty (a renamed registry
    // export, a `.ddd` shape that stopped parsing) passes every assertion below
    // while testing nothing — the repo's own recurring failure shape (§59/§63).
    expect(PRIMITIVES.length).toBeGreaterThan(40);

    const uncoded: string[] = [];
    for (const name of PRIMITIVES) {
      const codes = await refusedCodes(name);
      // A refusal must be a CODED refusal — an uncoded error is the silent
      // class wearing a different hat (the author still gets no code to look
      // up), and `loom.unknown` is what `src/api/report.ts` stamps on one.
      if (codes.length > 0 && codes.some((c) => c === "loom.unknown" || !c.startsWith("loom.")))
        uncoded.push(`${name} -> ${codes.join(",")}`);
    }
    expect(
      uncoded,
      "an argless spelling of these primitives is refused WITHOUT a `loom.*` code, so the " +
        "author is told no and given nothing to look up.",
    ).toEqual([]);
  }, 120_000);

  // One generation per target, with EVERY walker-reaching primitive on the
  // page — not one generation per (primitive × target), which is the same
  // coverage at 7× the cost. A throw takes the whole cell down and names the
  // target, which is the right granularity: a walker that CRASHES on a minimal
  // body is a worse failure than the one this file is about, and must not be
  // swallowed into a per-primitive skip.
  for (const target of TARGETS) {
    it(`${target.name}: every decline carries a catalogued loom.* code`, async () => {
      const base: string[] = [];
      for (const name of PRIMITIVES) {
        if ((await refusedCodes(name)).length === 0) base.push(name);
      }
      const reaching = await reachingOn(target, base);
      expect(
        reaching.length,
        "no primitive reaches the walker at all — the sweep is vacuous",
      ).toBeGreaterThan(30);

      // ---------------------------------------------------------------
      // PER-PRIMITIVE ATTRIBUTION — why the body is bracketed.
      //
      // A single `Stack { P1 { }, P2 { }, … }` proves the codes are there,
      // but it CANNOT see a primitive that renders nothing at all: a silent
      // `return ""` just shortens the joined body, and both assertions below
      // stay green because the OTHER primitives' give-ups still carry codes.
      // That is branch (C) in its purest form and the one this file is named
      // for, so the sweep has to be able to name the primitive.
      //
      // Each primitive is therefore bracketed by two literal `Text` markers,
      // and the region BETWEEN them is compared against a CONTROL pair with
      // nothing between it.  The control is what "two adjacent markers and
      // nothing else" costs on this target — pack markup, indentation, the
      // framework's own child-join — measured rather than assumed, so the
      // comparison needs no per-target knowledge and cannot drift when a
      // pack changes how it wraps text.
      const MARK = "LoomProbeZq";
      const mark = (s: string) => `Text { "${MARK}${s}" }`;
      const body = [
        mark("CtlB"),
        mark("CtlE"),
        ...reaching.flatMap((n) => [mark(`${n}B`), `${n} { }`, mark(`${n}E`)]),
      ].join(", ");
      const files = await generateSystemFiles(source(body, target));
      const pages = [...files].filter(([p]) => target.rendered.test(p));
      expect(pages.length, `${target.name}: no rendered page files emitted`).toBeGreaterThan(0);
      const whole = pages.map(([, c]) => c).join("\n");

      /** The emitted text strictly between a primitive's two markers,
       *  whitespace-collapsed. `null` when a marker did not survive emission. */
      //
      //  `lastIndexOf`, not `indexOf`: a marker string can occur TWICE. Feliz
      //  emits its i18n catalog at the top of `App.fs` — one `"page.Home.
      //  text.<hash>", "<literal>"` row per translatable string, ordered by
      //  HASH — so the first occurrence of every marker is a catalog row in an
      //  order unrelated to the page body, and `CtlE` precedes `CtlB` there.
      //  The RENDER is always the last occurrence.
      const between = (name: string): string | null => {
        const b = whole.lastIndexOf(`${MARK}${name}B`);
        const e = whole.lastIndexOf(`${MARK}${name}E`);
        if (b < 0 || e < 0 || e < b) return null;
        return whole
          .slice(b + `${MARK}${name}B`.length, e)
          .replace(/\s+/g, " ")
          .trim();
      };
      const control = between("Ctl");
      expect(
        control,
        `${target.name}: the probe markers did not survive emission, so per-primitive ` +
          `attribution is blind — the assertions below would pass over nothing.`,
      ).not.toBeNull();

      const silent = reaching.filter((n) => {
        const region = between(n);
        // A marker that vanished is itself a finding, reported as silent.
        return region === null || region.length <= (control ?? "").length;
      });
      expect(
        silent,
        `${target.name}: these primitives emitted NOTHING between their probe markers — no ` +
          `markup and no give-up. That is the silent decline this file exists to forbid: the ` +
          `author's construct left no trace in the generated page and no diagnostic anywhere. ` +
          `Render it, or decline through \`giveUp(target, "loom.…", …)\`.`,
      ).toEqual([]);

      const bad: string[] = [];
      let declines = 0;
      for (const [path, content] of pages) {
        for (const [i, line] of content.split("\n").entries()) {
          if (!line.includes(GIVE_UP_SENTINEL)) continue;
          declines++;
          if (!GIVE_UP_RE.test(line)) bad.push(`${path}:${i + 1}  ${line.trim().slice(0, 140)}`);
          else {
            const code = GIVE_UP_RE.exec(line)?.[1];
            if (!code || !CATALOG.has(code))
              bad.push(`${path}:${i + 1}  uncatalogued code '${code}'`);
            else SEEN.add(code);
          }
        }
      }
      expect(
        bad,
        `${target.name}: the walker declined and did not say why. Every give-up carries its ` +
          `\`loom.*\` code (see src/generator/_walker/give-up.ts); a bare sentinel leaves the ` +
          `reader of the generated page a sentence and no way to look the condition up.`,
      ).toEqual([]);

      // The other half of the vacuity guard, and the one that matters more:
      // this sweep exists BECAUSE argless primitives decline. If nothing
      // declined, the assertion above was checking an empty set — which is
      // exactly how a gate comes to report green over a blind spot.
      expect(
        declines,
        `${target.name}: no primitive declined on an argless body, so the "carries a code" ` +
          `assertion above ran over nothing. Either the walker grew defaults for every ` +
          `primitive (delete this guard and say so) or the page scan stopped reaching the ` +
          `emitted bodies.`,
      ).toBeGreaterThan(0);
    }, 180_000);
  }

  // Runs last, after every target has contributed to `SEEN`.
  //
  // The assertions above are about the SITES: whatever declined, named a code.
  // This one is about the CODES: each of the four the walker can produce from
  // an argless body is actually produced by this sweep.  They are different
  // claims, and only the second one makes this file a real firing proof for
  // those codes — which is what `diagnostic-firing-census.test.ts` points at
  // when it credits them as DRIVEN_ELSEWHERE (they never come out of
  // `validate()`, because codegen has no diagnostic channel).
  it("exercises every give-up code the walker can reach from an argless body", () => {
    const missing = MUST_EXERCISE.filter((c) => !SEEN.has(c));
    expect(
      missing,
      "the sweep no longer produces these codes, so the firing proof the census credits to " +
        "this file is gone. Either the emitter stopped using the code (delete it from the " +
        "catalog and from the census bucket in the same PR) or the sweep stopped reaching " +
        "the arm that raises it.",
    ).toEqual([]);
  });
});
