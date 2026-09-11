// Ledger row `F2-CFE-1` — `navigate(<Page>)` inside a page `action` body.
//
// This is THE documented home for navigation (`docs/actions.md` §navigate; the
// lambda form is a hard validator error, `loom.effect-in-lambda`), and on
// Flutter it was dropped: the statement reached `renderNotifierStmt`'s
// `private-operation` arm and came out as
// `// TODO(flutter full-parity): 'private-operation' call 'navigate' …`.
// `ddd parse` reported 0 errors, the Dart compiled, and the button simply did
// nothing — while the other six frontends navigated.
//
// The fix could not reuse the view seam as-is: `flutterTarget.renderNavigate`
// spells `Navigator.pushNamed(context, …)`, and a Riverpod `Notifier` method has
// no `BuildContext` at all.  So the notifier renders through a generated
// out-of-tree bridge (`lib/nav.dart`'s `navigateTo`, backed by the
// `GlobalKey<NavigatorState>` `main.dart` installs), with the ROUTE resolved by
// the same shared `tryRenderNavigateCall` the `then:` path uses.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";
import { dartBracketImbalance } from "./_dart-balance.js";

/** Two pages, a paramless destination and one behind a `:param` route. */
const SRC = `
system Shop {
  api A from S
  subdomain S { context C {
    aggregate Product { name: string }
    repository Products for Product {}
  } }
  storage db { type: postgres }
  resource st { for: C, kind: state, use: db }
  ui App {
    framework: flutter
    api Shop: A
    page Home {
      route: "/"
      state { n: int = 0 }
      action go() { n := n + 1  navigate(Other) }
      action goPath() { navigate("/products/abc") }
      body: Stack { Button { "go", onClick: go }, Button { "path", onClick: goPath } }
    }
    page Other { route: "/somewhere-else" body: Text { "other" } }
  }
  deployable api1 { platform: node contexts: [C] dataSources: [st] serves: A port: 8081 }
  deployable app { platform: flutter targets: api1 ui: App { Shop: api1 } port: 3006 }
}
`;

async function gen(src: string = SRC) {
  const files = await generateSystemFiles(src);
  const pick = (suffix: string) => [...files.entries()].find(([k]) => k.endsWith(suffix))?.[1];
  return { files, pick };
}

describe("flutter navigate() in a page action", () => {
  it("pushes through the out-of-tree bridge, on the page's REAL route", async () => {
    const { pick } = await gen();
    const page = pick("lib/pages/home_page.dart");
    expect(page, "no home page").toBeDefined();
    // The route comes from the destination page's `route:` — NOT from
    // `/${snake(pageName)}`, which would have been `/other` here and is what a
    // missing `pageRoutes` map silently produced.
    expect(page).toContain("navigateTo('/somewhere-else');");
    expect(page).not.toContain("navigateTo('/other')");
    // The dropped-statement marker is gone.
    expect(page).not.toContain("TODO(flutter full-parity)");
    expect(page).not.toContain("loom:unrendered");
    // The state write in the same action still lands, in order.
    const src = page!;
    expect(src.indexOf("state = state.copyWith(n: (state.n + 1));")).toBeLessThan(
      src.indexOf("navigateTo('/somewhere-else');"),
    );
    // A literal path form navigates verbatim.
    expect(page).toContain("navigateTo('/products/abc');");
  });

  it("emits lib/nav.dart and imports it from the page that navigates", async () => {
    const { files, pick } = await gen();
    const nav = pick("lib/nav.dart");
    expect(nav, "no lib/nav.dart").toBeDefined();
    expect(nav).toContain("final GlobalKey<NavigatorState> appNavigatorKey = GlobalKey");
    expect(nav).toContain("appNavigatorKey.currentState?.pushNamed(route, arguments: arguments);");
    expect(pick("lib/pages/home_page.dart")).toContain("import '../nav.dart';");
    // Every emitted Dart file that calls the bridge must import it, or the app
    // fails to compile on an undefined name — sweep, don't spot-check.
    for (const [path, content] of files) {
      if (!path.endsWith(".dart") || path.endsWith("lib/nav.dart")) continue;
      if (!content.includes("navigateTo(")) continue;
      expect(content, `${path} calls navigateTo without importing nav.dart`).toMatch(
        /import '(\.\.\/)?nav\.dart';/,
      );
    }
  });

  it("installs the navigatorKey on MaterialApp", async () => {
    const { pick } = await gen();
    const main = pick("lib/main.dart");
    expect(main).toContain("import 'nav.dart';");
    expect(main).toContain("navigatorKey: appNavigatorKey,");
  });

  it("an app that never navigates from an action emits no bridge and no key", async () => {
    // The emission is use-driven; a non-navigating app must stay byte-identical
    // to the pre-fix output (no stray file, no unused import, no extra
    // `MaterialApp` argument).
    const { files, pick } = await gen(
      SRC.replace("n := n + 1  navigate(Other)", "n := n + 1").replace(
        'action goPath() { navigate("/products/abc") }',
        "action goPath() { n := 0 }",
      ),
    );
    expect([...files.keys()].some((k) => k.endsWith("lib/nav.dart"))).toBe(false);
    expect(pick("lib/main.dart")).not.toContain("navigatorKey:");
    expect(pick("lib/main.dart")).not.toContain("import 'nav.dart';");
  });

  it("refuses — with a code — a destination whose route needs a param the call cannot supply", async () => {
    // `navigate(<DetailPage>)` where the route is `/products/:id` has no `id` in
    // a Notifier method's scope.  Interpolating it anyway emits `'/products/${id}'`
    // against an unbound name — Dart that does not compile, which is strictly
    // worse than the drop this arm replaced.  So it declines, loudly and coded.
    const { pick } = await gen(
      SRC.replace('page Other { route: "/somewhere-else"', 'page Other { route: "/products/:id"'),
    );
    const page = pick("lib/pages/home_page.dart")!;
    expect(page).toContain("loom:unrendered");
    expect(page).toContain("navigate(Other)");
    expect(page).toContain("':param' segment");
    // Never the broken interpolation.
    expect(page).not.toContain("navigateTo('/products/${id}')");
    // A give-up in a METHOD body is a `//` line, not the view seam's
    // `const SizedBox.shrink() /* … */` widget — which would not even parse
    // there.  The bracket sweep is what proves it.
    expect(page).not.toContain("const SizedBox.shrink() /*");
    expect(dartBracketImbalance(page)).toBeUndefined();
  });
});
