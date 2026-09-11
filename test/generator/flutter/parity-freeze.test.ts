// Flutter parity FREEZE test (proposal `flutter-parity-and-native-gates.md`,
// mission M-E) — the analogue of `test/generator/elixir/heex-parity.test.ts`.
//
// The plain parity test (`parity.test.ts`) proves the lint FINDS a marker and
// reports a clean bill for a gap-free ui.  That's necessary but not sufficient:
// it passes only because its showcase avoids the primitives/form-fields the
// Flutter target still drops, so on its own it would silently tolerate EVERY
// gap.  This test closes that hole.
//
// It generates a fixture that DELIBERATELY exercises the four form-field shapes
// that used to be dropped (nested-VO sub-field, value-object array with a
// non-scalar sub-field, bool element array, enum element array), then asserts
// the parity findings equal a PINNED allowlist — each entry carrying a reason
// and the owning follow-up mission.  The discipline mirrors heex-parity /
// pipeline-layering / walker-stdlib-completeness:
//   - a NEW gap (a finding not on the list) fails CI — it must be rendered or
//     explicitly pinned with a reason,
//   - CLOSING a gap (a real widget lands, so a marker disappears) ALSO fails
//     here — delete the entry, a welcome direction.
// The known gaps stay a reviewed decision, never silent drift.
//
// The allowlist is now EMPTY: ledger row `flutter-form-field-drops` closed all
// four with real Dart widgets (recursive VO flattening, per-cell bool / enum /
// datetime row editors, bool and enum element arrays — `forms-emit.ts`).  An
// empty freeze is the strongest form of this test: ANY marker the fixture
// provokes is now a regression.  The rendered shapes are asserted in
// `nested-vo-field.test.ts`, `object-array.test.ts` and
// `bool-enum-array.test.ts`; this file guards that NONE of them degrades back
// to a comment.

import { describe, expect, it } from "vitest";
import { analyzeFlutterParity } from "../../../src/generator/flutter/parity.js";
import { generateSystemFiles } from "../../_helpers/generate.js";

// A flutter ui whose CreateForm's aggregate carries the four shapes that used to
// be form-field drop sites: a VO nested inside a VO (`addr.geo`), a VO array
// with a non-scalar sub-field (`lines`, whose `LineItem.active` is a bool), a
// bool element array (`flags`) and an enum element array (`colors`).  All four
// now render, so the fixture must produce ZERO findings — and the vacuity test
// below asserts the shapes really reached the emitted Dart.
const GAP_EXERCISER = `
system Par {
  api A from D
  subdomain D { context C {
    valueobject Geo { lat: decimal  lng: decimal }
    valueobject Addr { line: string  geo: Geo }
    valueobject LineItem { sku: string  active: bool }
    enum Color { red  green }
    aggregate Item {
      name: string
      addr: Addr
      lines: LineItem[]
      flags: bool[]
      colors: Color[]
    }
    repository Items for Item {}
  } }
  storage db { type: postgres }
  resource st { for: C, kind: state, use: db }
  ui App {
    framework: flutter
    api Shop: A
    page Home {
      route: "/"
      body: Stack { Heading { "H", level: 1 } }
    }
    page NewItem { route: "/new" body: Stack { Heading { "New", level: 1 }, CreateForm { of: Item } } }
  }
  deployable api1 { platform: node contexts: [C] dataSources: [st] serves: A port: 8081 }
  deployable app { platform: flutter targets: api1 ui: App { Shop: api1 } port: 3006 }
}`;

/** The FROZEN set of Flutter parity gaps the GAP_EXERCISER fixture provokes,
 *  keyed by the exact marker message the lint reports, each with WHY it's still a
 *  gap and the mission that owns closing it.
 *
 *  EMPTY, and that is the point: all four entries (nested-VO sub-field,
 *  value-object array with a non-scalar sub-field, bool element array, enum
 *  element array) were closed by real Dart widgets — the ledger row
 *  `flutter-form-field-drops`.  A re-added entry is a regression, not a
 *  deferral: the fixture below still carries every one of those shapes, so
 *  anything the lint reports here is a form-field that stopped rendering.
 *
 *    M-A — the drop is LOUD: the emitter marks it instead of silently omitting.
 *    M-B — closing the gap means emitting a real Dart widget.
 *    M-C — auth-gate parity (not exercised by this fixture; listed for the enum). */
const KNOWN_FLUTTER_GAPS: Record<string, { reason: string; mission: "M-A" | "M-B" | "M-C" }> = {};

describe("flutter parity freeze (M-E)", () => {
  it("the parity findings equal the pinned known-gap allowlist", async () => {
    const files = await generateSystemFiles(GAP_EXERCISER);
    const actual = analyzeFlutterParity(files)
      .map((f) => f.message)
      .sort();
    expect(actual).toEqual(Object.keys(KNOWN_FLUTTER_GAPS).sort());
  });

  it("every pinned gap carries a non-empty reason and an owning mission", () => {
    for (const [msg, { reason, mission }] of Object.entries(KNOWN_FLUTTER_GAPS)) {
      expect(reason.trim().length, `pinned flutter gap '${msg}' needs a reason`).toBeGreaterThan(0);
      expect(["M-A", "M-B", "M-C"]).toContain(mission);
    }
  });

  it("the fixture really exercises all four shapes (the empty freeze is not vacuous)", async () => {
    // With the allowlist empty, "no findings" would also be the answer if the
    // fixture stopped producing a form at all — so assert the four shapes are
    // present IN THE EMITTED DART, each by the state declaration only its own
    // renderer emits.  Without this the freeze would pass on an empty
    // `forms.dart`.
    const files = await generateSystemFiles(GAP_EXERCISER);
    const forms = [...files.entries()].find(([k]) => k.endsWith("lib/forms.dart"));
    expect(forms, "no forms.dart — the freeze would be vacuous").toBeDefined();
    const src = forms![1];
    // 1. nested VO sub-field: `addr.geo.lat` flattened to its own controller.
    expect(src).toContain("_addrGeoLatController");
    // 2. VO array with a non-scalar (bool) sub-field: a row-slot list.
    expect(src).toContain("final List<List<dynamic>> _linesRows = [];");
    // 3. bool element array + 4. enum element array: their value lists.
    expect(src).toContain("final List<bool> _flagsValues = [];");
    expect(src).toContain("final List<String> _colorsValues = [];");
  });

  it("NO pack no-renderer diagnostic fires (every primitive renders)", async () => {
    // The `diagnostic` (pack no-renderer) family must NOT fire — every page
    // primitive renders, so a resurfaced no-renderer line is a real regression
    // (a primitive silently dropped) and fails here.
    const findings = analyzeFlutterParity(await generateSystemFiles(GAP_EXERCISER));
    expect(findings.some((f) => f.kind === "diagnostic")).toBe(false);
  });
});
