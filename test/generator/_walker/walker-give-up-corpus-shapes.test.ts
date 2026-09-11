// ---------------------------------------------------------------------------
// The corpus witness for the body-walker give-up codes (M-T9.55, rule 13).
//
// `test/fixtures/walker-give-up-shapes.ddd` is the first CHECKED-IN `.ddd`
// that authors a give-up.  Until it landed, every one of the walker's ~81
// decline paths was exercised only by probes written inline inside individual
// unit tests — so the codes they now carry had no fixture that would notice
// them rotting, and the silent-class shapes themselves (bodies that validate
// clean and render nothing) existed nowhere on disk.
//
// It sits in `test/fixtures/`, NOT `test/fixtures/corpus/`, and that is a
// reviewed placement rather than a convenience: the corpus is a BACKEND
// feature matrix, and two of its own gates say so normatively —
// `clause-census.test.ts`'s "the corpus fixtures still carry no `ui`" (retro
// §82) and `feature-doc-coverage.test.ts`'s FEATURE_DOCS, which admits only
// docs describing an authorable DOMAIN feature.  A frontend give-up fixture
// satisfies neither, and forcing it in would have flipped a stated property
// to make a rule of thumb fit.
//
// Two things are asserted, and the second is the one that matters:
//
//   1. the fixture still validates CLEAN — if a future validator starts
//      refusing one of these shapes that is GOOD NEWS (the silent class got
//      smaller), but it means this witness no longer witnesses, so it must
//      fail here rather than quietly stop covering anything;
//   2. each declared shape reaches its declared code in the emitted page.
//
// The codes are read off the emitted output through `GIVE_UP_RE`, never
// re-spelled — the same rule that keeps the cross-frontend matrix honest.
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validate } from "../../../src/api/index.js";
import { GIVE_UP_RE } from "../../../src/generator/_walker/give-up.js";
import { generateSystemFiles } from "../../_helpers/generate.js";

/** shape → the code its give-up must name.  Keyed by a fragment of the
 *  give-up's own text, so a reworded message fails here instead of silently
 *  matching nothing (the failure mode the sentinel exists for). */
const EXPECTED: readonly { text: string; code: string; why: string }[] = [
  {
    text: "Timeline: missing entries",
    code: "loom.page-primitive-arg-missing",
    why: "`Timeline { }` — no entries argument in either spelling",
  },
  {
    text: "IdLink: missing 'of:' aggregate ref",
    code: "loom.page-primitive-arg-missing",
    why: "`IdLink { }` — no `of:`",
  },
  {
    text: "DestroyForm: expected (of: <Agg>)",
    code: "loom.page-primitive-arg-invalid",
    why: "`DestroyForm { }` — the `of:` is absent, so the shape is unreadable",
  },
  {
    text: "unknown icon name",
    code: "loom.page-primitive-arg-invalid",
    why: "`Icon { name: … }` outside the builtin glyph registry",
  },
  {
    text: "CreateForm(of: Ghost)",
    code: "loom.page-ref-unreachable",
    why: "the ui cannot reach an aggregate named Ghost",
  },
];

const SOURCE = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "fixtures",
    "walker-give-up-shapes.ddd",
  ),
  "utf8",
);

describe("corpus: walker-give-up-shapes", () => {
  it("validates clean — every shape in it is the SILENT class, not a refusal", async () => {
    const report = await validate(SOURCE);
    const errors = report.diagnostics.filter((d) => d.severity === "error");
    expect(
      errors.map((d) => `${d.code}: ${d.message}`),
      "the fixture stopped being a witness: one of its shapes is now refused at validation. " +
        "That is progress, not a bug — move the shape out of the fixture (and note which gate " +
        "took it over) so what remains is still the silent class this file covers.",
    ).toEqual([]);
  }, 60_000);

  it("every declared shape reaches its declared loom.* code in the emitted page", async () => {
    const files = await generateSystemFiles(SOURCE);
    const pages = [...files].filter(([p]) => p.startsWith("web/src/pages/"));
    expect(pages.length, "no react page files emitted for the `web` deployable").toBeGreaterThan(0);
    const whole = pages.map(([, c]) => c).join("\n");

    const wrong: string[] = [];
    for (const { text, code, why } of EXPECTED) {
      const line = whole.split("\n").find((l) => l.includes(text));
      if (line === undefined) {
        wrong.push(`${why}: no give-up carrying "${text}" in the emitted page`);
        continue;
      }
      const found = GIVE_UP_RE.exec(line)?.[1];
      if (found !== code) wrong.push(`${why}: expected ${code}, emitted ${found ?? "<no code>"}`);
    }
    expect(wrong).toEqual([]);
  }, 60_000);
});
