// Flutter's a11y leg scans EVERY page, not just the boot frame.
//
// `generated-a11y.yml` runs axe-core over every route of the showcase on the
// five DOM frontends.  Flutter web renders to CANVAS and publishes no DOM for
// axe to read, so it cannot join that matrix — its a11y coverage is entirely
// the emitted `test/a11y_test.dart`, run by `generated-flutter-build.yml`'s
// `flutter test` step.  That file used to pump `App()` once, at its
// `initialRoute`, so a violation on any page but `/` was invisible.
//
// PROVEN, not assumed (wave C2 packet 2j, with a local Flutter 3.47.3 SDK):
// seeding one 8×8 unlabeled `GestureDetector` into the generated
// `insights_page.dart` fails the widened leg —
//   "Expected: Tappable widgets should have a semantic label
//    … InsightsPage meets WCAG accessibility guidelines  [E]"
// — while the pre-widening boot-frame-only file, run against the SAME seeded
// tree, reports "All tests passed!".
//
// The existing `a11y.test.ts` pins the four guideline matchers; this pins the
// per-page fan-out and the harness that makes a `:id` page constructible.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const SRC = `
system A11y {
  api A from D
  subdomain D { context C {
    aggregate Item { name: string }
    repository Items for Item {}
  } }
  storage db { type: postgres }
  resource st { for: C, kind: state, use: db }
  ui App {
    framework: flutter
    api Shop: A
    page Home { route: "/"  body: Stack { Heading { "H", level: 1 } } }
    page Listing { route: "/items"  body: Stack { Heading { "L", level: 1 } } }
    page Detail { route: "/items/:id"  body: Stack { Heading { "D", level: 1 }, Text { id } } }
  }
  deployable api1 { platform: node contexts: [C] dataSources: [st] serves: A port: 8081 }
  deployable app { platform: flutter targets: api1 ui: App { Shop: api1 } port: 3006 }
}`;

async function a11yDart(): Promise<string> {
  const files = await generateSystemFiles(SRC);
  const entry = [...files.entries()].find(([k]) => k.endsWith("app/test/a11y_test.dart"));
  expect(entry, "no app/test/a11y_test.dart emitted").toBeDefined();
  return entry![1];
}

describe("flutter a11y leg — per page, not per boot frame", () => {
  it("emits one guideline case per emitted page", async () => {
    const src = await a11yDart();
    for (const cls of ["HomePage", "ListingPage", "DetailPage"]) {
      expect(src).toContain(`testWidgets('${cls} meets WCAG accessibility guidelines'`);
      expect(src).toContain(`_probe(const ${cls}())`);
    }
    expect((src.match(/testWidgets\(/g) ?? []).length).toBe(3);
    // The boot-frame-only shape is gone — `App()` is no longer pumped here at
    // all (it would put every gated page behind `AuthGate`'s session probe,
    // which never resolves under `flutter_test`).
    expect(src).not.toContain("pumpWidget(const App())");
  });

  it("all four WCAG guidelines run on EACH page, not just the first", async () => {
    const src = await a11yDart();
    for (const g of [
      "androidTapTargetGuideline",
      "iOSTapTargetGuideline",
      "labeledTapTargetGuideline",
      "textContrastGuideline",
    ]) {
      expect((src.match(new RegExp(g, "g")) ?? []).length, `${g} not run per page`).toBe(3);
    }
  });

  it("the harness supplies route arguments, so a `:id` page is constructible", async () => {
    const src = await a11yDart();
    // The detail page's shell reads `routeArgs['id']`; without settings
    // arguments it throws before a frame is laid out and the case would report
    // a crash rather than an a11y verdict.
    expect(src).toContain("arguments: <String, String>{'id':");
    expect(src).toContain("onGenerateRoute:");
    // Riverpod-scoped — a page shell that watches a provider needs the
    // container the real `App` roots.
    expect(src).toContain("ProviderScope(");
  });

  it("imports exactly the page libraries it pumps", async () => {
    const src = await a11yDart();
    for (const f of ["home_page", "listing_page", "detail_page"]) {
      expect(src).toContain(`import 'package:app/pages/${f}.dart';`);
    }
  });
});
