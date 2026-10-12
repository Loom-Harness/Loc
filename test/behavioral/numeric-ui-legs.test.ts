// The FAST-suite guard over the two self-hosting frontends' numeric runtime legs
// (M-T9.38).
//
// The legs themselves are nightly and heavy: Flutter's builds its app with the
// SDK and reads Flutter's accessibility tree; Feliz's runs `dotnet fable` + vite
// and drives the emitted `*.ui.spec.ts`.  Neither says anything in `npm test`.
// So the thing that can rot between nightlies is not the legs' code — it is
// their SUBJECT: delete `listPrice` from a fixture, or change a seeded value
// without its expectation, and both legs stay GREEN while no longer proving the
// money/decimal/int/long round-trip they exist for.  That is the §59/§63 shape
// (a gate that no longer reaches the thing it names) and this file is the
// ratchet against it.
//
// What it asserts, all three directions of the same claim:
//   1. both fixtures still DECLARE one field per numeric host type, with that
//      host type (read off the lowered+enriched IR, not a regex over source);
//   2. the Flutter leg still derives BOTH halves — seed and expectation — from
//      `numeric-ui-contract.mjs`, so they cannot drift apart;
//   3. the Feliz fixture's UI e2e still reads every one of those fields back
//      with the contract's expected text.
// Plus the vacuity guard: every expectation is discriminating (≥ 4 chars — a
// bare "7" is found inside any UUID on the page) and consistent with its seed.
//
// MUTATION-PROVEN (CLAUDE.md → "Mutation-prove a new gate"), four ways; each
// mutation was reverted BY FILE COPY and md5-verified, never `git checkout --`:
//   - deleting `stock: int` from sales-system-feliz.ddd fails "every numeric
//     host type is declared on Product" naming stock/int on the feliz fixture;
//   - deleting the same from the flutter fixture fails the flutter row;
//   - replacing `...numericSeedBody()` in run-ui-flutter.mjs with an inline
//     object fails "the flutter leg derives its seed from the contract";
//   - dropping one `toHaveText` from the feliz fixture's numeric round-trip
//     fails "the feliz UI round-trip reads every numeric field back".
//
// The VUE cell (M-T9.15, wave C3 packet 3b) joined the same contract: its
// fixture is held to (1) and (3) like Feliz's, and — because its list half is
// a harness probe rather than a `.ddd` assertion — the wiring test below pins
// the corpus case to the fixture and the probe to the contract.  Mutation-
// proven the same way (file copy, restored, md5-verified):
//   - deleting `barcode: long` from the vue fixture fails the vue declaration
//     row naming barcode/long;
//   - changing the fixture's `toHaveText("98.76")` to "98.7600" fails "the vue
//     UI round-trip reads every numeric field back" naming listPrice;
//   - replacing `f[cfg.render]` in run-ui.mjs's list probe with `f.vue` fails
//     "the vue cell is wired".

import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { allContexts } from "../../src/ir/types/loom-ir.js";
import { parseValid } from "../_helpers/parse.js";
import { flutterExpectations, NUMERIC_FIELDS, numericSeedBody } from "./numeric-ui-contract.mjs";

const REPO = path.resolve(__dirname, "..", "..");
const FIXTURES = {
  feliz: "web/src/examples/sales-system-feliz.ddd",
  flutter: "web/src/examples/sales-system-flutter.ddd",
  vue: "test/e2e/fixtures/vue-fullstack/sales-system-vue.ddd",
} as const;
const FLUTTER_RUNNER = "test/behavioral/run-ui-flutter.mjs";
const UI_RUNNER = "test/behavioral/run-ui.mjs";
/** The legs whose emitted `*.ui.spec.ts` reads the numeric fields back off the
 *  DETAIL page — each fixture's `.ddd` assertion text is its contract column. */
const DOM_LEGS = ["feliz", "vue"] as const;

const read = (rel: string) => fs.readFileSync(path.join(REPO, rel), "utf8");

/** The `Product` aggregate's declared fields, off the enriched IR. */
async function productProperties(rel: string) {
  const model = await parseValid(read(rel));
  const agg = allContexts(enrichLoomModel(lowerModel(model)))
    .flatMap((c) => c.aggregates)
    .find((a) => a.name === "Product");
  if (!agg) throw new Error(`${rel}: no Product aggregate — the fixture's shape changed`);
  return agg.fields;
}

describe("numeric runtime legs — the contract the two self-hosting frontends assert", () => {
  it("covers the four numeric host types and nothing silently fewer", () => {
    // The denominator: if this table collapses, every assertion below is
    // vacuous, so it is pinned rather than derived from itself.
    expect(NUMERIC_FIELDS.map((f) => f.host).sort()).toEqual(["decimal", "int", "long", "money"]);
  });

  for (const [frontend, rel] of Object.entries(FIXTURES)) {
    it(`every numeric host type is declared on Product in the ${frontend} fixture`, async () => {
      const fields = await productProperties(rel);
      for (const row of NUMERIC_FIELDS) {
        const prop = fields.find((p) => p.name === row.field);
        expect(
          prop,
          `${rel}: Product has no '${row.field}' field — the ${row.host} round-trip the ${frontend} leg asserts has lost its subject`,
        ).toBeDefined();
        expect(prop!.type, `${rel}: '${row.field}' is not a primitive type`).toMatchObject({
          kind: "primitive",
          name: row.host,
        });
      }
    });
  }

  it("the flutter leg derives its seed AND its expectations from the contract", () => {
    const src = read(FLUTTER_RUNNER);
    expect(src).toContain('from "./numeric-ui-contract.mjs"');
    // Both halves, by name: a leg that inlines either one can drift from the
    // other, which is the exact way this gate goes quiet.
    expect(
      src,
      `${FLUTTER_RUNNER}: the seeded numeric row must come from numericSeedBody()`,
    ).toContain("...numericSeedBody(),");
    expect(src, `${FLUTTER_RUNNER}: the numeric probe must expect flutterExpectations()`).toContain(
      "expect: flutterExpectations(),",
    );
  });

  for (const leg of DOM_LEGS) {
    it(`the ${leg} UI round-trip reads every numeric field back`, () => {
      const src = read(FIXTURES[leg]);
      for (const row of NUMERIC_FIELDS) {
        // The `.ddd` assertion the emitted `*.ui.spec.ts` lowers to
        // `await expect(read.field("<name>")).toHaveText("<text>")`.
        expect(
          src,
          `${FIXTURES[leg]}: the numeric UI round-trip no longer asserts '${row.field}' as the contract's ${leg} text — the ${leg} leg would still pass without reading it back`,
        ).toContain(`expect(read.${row.field}).toHaveText("${row[leg]}")`);
      }
    });
  }

  it("the vue cell is wired: corpus case → fixture, and the list probe reads the contract", () => {
    // The Vue leg is a corpus case plus a harness probe, and either half can go
    // quiet on its own: a case pointing at another `.ddd` keeps the leg green
    // on a fixture without the numeric row, and a probe that stops deriving its
    // seed or its expectations from the contract drifts exactly the way the
    // flutter test above guards against.
    const corpus = JSON.parse(read("test/behavioral/corpus.json")) as {
      cases: {
        name: string;
        ddd: string;
        ui?: boolean;
        numericList?: Record<string, unknown>;
      }[];
    };
    const vue = corpus.cases.find((c) => c.name === "sales-system-vue");
    expect(vue, "corpus.json lost its sales-system-vue case").toBeDefined();
    expect(vue!.ddd).toBe(FIXTURES.vue);
    expect(vue!.ui, "the vue case must run in run-ui.mjs").toBe(true);
    expect(vue!.numericList, "the vue case must declare the list probe").toMatchObject({
      render: "vue",
      api: "/api/products",
      route: "/products",
      row: "products-row-",
    });
    const src = read(UI_RUNNER);
    expect(src).toContain('from "./numeric-ui-contract.mjs"');
    expect(src, `${UI_RUNNER}: the list probe must seed numericSeedBody()`).toContain(
      "...numericSeedBody() }",
    );
    expect(src, `${UI_RUNNER}: the list probe must read the contract column`).toContain(
      "const want = f[cfg.render];",
    );
    expect(src, `${UI_RUNNER}: the probe must run for a case that declares it`).toContain(
      "if (c.numericList) {",
    );
  });

  it("every expectation is discriminating and consistent with its seed", () => {
    for (const row of NUMERIC_FIELDS) {
      for (const [target, text] of [
        ["flutter", row.flutter],
        ["feliz", row.feliz],
        ["vue", row.vue],
      ] as const) {
        // Four characters is the floor, not an aesthetic: the flutter probe
        // asserts by SUBSTRING over the page's accessible text, and a one- or
        // two-character number is found inside a UUID, a timestamp or a page
        // count — a match that proves nothing.
        expect(
          text.length,
          `${row.field}/${target}: "${text}" is too short to discriminate`,
        ).toBeGreaterThanOrEqual(4);
        // And the expectation has to be ABOUT the seed.  A row whose expected
        // text shares no prefix with the seeded value is a typo that would read
        // as a real divergence in whichever target renders it.
        const seed = String(row.seed);
        expect(
          seed.startsWith(text) || text.startsWith(seed),
          `${row.field}/${target}: expected text "${text}" is unrelated to the seeded value "${seed}"`,
        ).toBe(true);
      }
    }
  });

  it("the seed body carries exactly the contract's fields", () => {
    expect(Object.keys(numericSeedBody()).sort()).toEqual(
      NUMERIC_FIELDS.map((f) => f.field).sort(),
    );
    expect(flutterExpectations()).toHaveLength(NUMERIC_FIELDS.length);
  });
});
