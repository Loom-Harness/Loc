// ---------------------------------------------------------------------------
// IdLink over an OPTIONAL reference — cross-frontend null-guard gate (M-T1.33,
// audit #2864 finding T4).
//
// `lastKnownLocation: Location id?` is ordinary domain modelling — "we don't
// know where the cargo is yet" — and the wire ships `null` for it.  Every pack
// builds the reference link by CONCATENATING that value into a route, and
// unguarded the six frontends failed six ways, two of them fatally: vue-tsc
// rejected `:title="row.lastKnownLocation"` with TS2345 and Fable rejected
// `("/locations/" + <string option>)`, while react/svelte/angular/flutter
// compiled and linked to the literal path `/locations/null`.
//
// The guard is one decision applied six ways: an ABSENT reference renders a
// plain em dash and NO link — the placeholder `FileLink` already established
// for an unset `File?`.  This proves it renders on every frontend, in BOTH
// scaffolded positions (the list cell and the detail row), and — just as
// important — that a REQUIRED reference is still emitted with no guard at all.
//
// The two halves of the resolution both have to work for this to pass, and each
// was independently broken: a cell walk has to know which aggregate its row is
// (`extendRowScope`), and that lookup has to see through the `rows.items` of a
// server-paged list (`cellRowAggregate`).  The detail-page assertions pass with
// neither, so the LIST assertions are the ones that hold those two honest.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

/** A scaffolded aggregate carrying BOTH an optional cross-aggregate reference
 *  (`lastKnownLocation`) and a required one (`origin`) to the same target
 *  aggregate — so the guard and its absence are proved off one generation, and
 *  a fix that guarded everything indiscriminately would fail too. */
const scaffoldReferenceSystem = (platform: string): string => `
  system Freight {
    subdomain Ops {
      context Booking {
        aggregate Location with crudish {
          name: string
          derived display: string = name
        }
        repository Locations for Location { }
        aggregate Cargo with crudish {
          code: string
          lastKnownLocation: Location id?
          origin: Location id
          derived display: string = code
        }
        repository Cargos for Cargo { }
      }
    }
    ui Web with scaffold(subdomains: [Ops]) { }
    api OpsApi from Ops
    storage primary { type: postgres }
    resource opsState { for: Booking, kind: state, use: primary }
    deployable api {
      platform: node, contexts: [Booking], dataSources: [opsState],
      serves: OpsApi, port: 4300
    }
    deployable web { platform: ${platform}, targets: api, hosts: Web }
  }
`;

/** Concatenate every generated file so the assertions stay path-agnostic. */
function allFiles(files: Map<string, string>): string {
  let all = "";
  for (const content of files.values()) all += `\n${content}`;
  return all;
}

const generate = async (platform: string): Promise<string> =>
  allFiles(await generateSystemFiles(scaffoldReferenceSystem(platform)));

describe("IdLink — the JS/markup frontends guard an optional reference on truthiness", () => {
  // All four narrow the tested expression inside the true arm, so the link
  // renders over the ORIGINAL expression and only the split spelling differs.
  //
  // `listGuard` is the assertion that catches a row whose aggregate never
  // resolved: it reads the LIST cell, where the row is a rebound accessor param
  // over a server-paged `rows.items`.  `detailGuard` reads the detail page,
  // which resolves through a different path (`tryDetectApiHook`) and would keep
  // passing on its own.
  const JSX_FAMILY: ReadonlyArray<{
    target: string;
    listGuard: RegExp;
    detailGuard: RegExp;
    absent: string;
  }> = [
    {
      target: "react",
      listGuard: /\{row\.lastKnownLocation \? \(/,
      detailGuard: /\{cargoById\.data\.lastKnownLocation \? \(/,
      absent: "<span>—</span>",
    },
    {
      target: "svelte",
      listGuard: /\{#if row\.lastKnownLocation\}/,
      detailGuard: /\{#if cargoById\.data\.lastKnownLocation\}/,
      absent: "<span>—</span>",
    },
    {
      target: "vue",
      listGuard: /<template v-if='row\.lastKnownLocation'>/,
      detailGuard: /<template v-if='cargoById\.data\.lastKnownLocation'>/,
      absent: "<span>—</span>",
    },
    {
      target: "angular",
      listGuard: /@if \(row\.lastKnownLocation\) \{/,
      detailGuard: /@if \(cargoById\.data\(\)!\.lastKnownLocation\) \{/,
      absent: "<span>—</span>",
    },
  ];

  for (const { target, listGuard, detailGuard, absent } of JSX_FAMILY) {
    it(`${target}: the optional reference links only when present, else an em dash`, async () => {
      const out = await generate(target);
      expect(out).toMatch(listGuard);
      expect(out).toMatch(detailGuard);
      expect(out).toContain(absent);
    });

    it(`${target}: the REQUIRED reference is emitted with no guard`, async () => {
      const out = await generate(target);
      // The `origin` link is present…
      expect(out).toContain("/locations/");
      // …and nothing tests it for null.  A guard that fired on every reference
      // would churn every committed frontend golden.
      expect(out).not.toContain("row.origin ?");
      expect(out).not.toContain("{#if row.origin}");
      expect(out).not.toContain("v-if='row.origin'");
      expect(out).not.toContain("@if (row.origin)");
    });
  }
});

describe("IdLink — Feliz splits the option with a `match`, not a truthiness test", () => {
  it("binds the unwrapped id so the route concatenation stays `string` + `string`", async () => {
    const out = await generate("feliz");
    // The field really is an option — the premise the guard exists for.
    expect(out).toContain("lastKnownLocation: string option");
    // List cell and detail row both match, and BOTH concatenate the bound
    // `__id` (a `string`), never the option itself.  `"…" + <string option>` is
    // the F# type error that made this frontend un-buildable.
    expect(out).toMatch(
      /match row\.lastKnownLocation with \| Some __id -> Html\.a \[ prop\.className "link"; prop\.href \("\/locations\/" \+ __id\); prop\.text \(string \(__id\)\) \] \| None -> Html\.text "—"/,
    );
    expect(out).toMatch(
      /match cargoById\.lastKnownLocation with \| Some __id -> Html\.a .* \| None -> Html\.text "—"/,
    );
    expect(out).not.toContain('"/locations/" + row.lastKnownLocation');
    expect(out).not.toContain('"/locations/" + cargoById.lastKnownLocation');
    // The required reference concatenates directly, exactly as before.
    expect(out).toContain('prop.href ("/locations/" + row.origin)');
  });
});

describe("IdLink — Flutter splits the nullable with a null-check pattern", () => {
  it("binds the promoted id so the label is never the text `null`", async () => {
    const out = await generate("flutter");
    expect(out).toContain("final String? lastKnownLocation;");
    expect(out).toMatch(
      /switch \(row\.lastKnownLocation\) \{ final __id\? => TextButton\(onPressed: \(\) => Navigator\.of\(context\)\.pushNamed\('\/locations\/' \+ __id\.toString\(\)\), child: Text\(__id\.toString\(\)\)\), _ => const Text\('—'\) \}/,
    );
    // `x.toString()` on a null `String?` is what rendered the literal word
    // "null" as the cell's label — it must not survive on the optional field.
    expect(out).not.toContain("row.lastKnownLocation.toString()");
    // The required reference keeps the bare concatenation.
    expect(out).toContain("'/locations/' + row.origin.toString()");
  });
});
