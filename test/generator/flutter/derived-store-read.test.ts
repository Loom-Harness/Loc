// A page `derived` that reads a STORE field on Flutter (F9 of the 2026-09-03
// language-docs audit, packet W1.2 / M-T1.28).
//
// The register recorded Flutter as "interpolates the same bare identifier"; it
// does not.  `derivedResolvableOnPage` refused a store-field ref outright, so
// the derived was dropped WHOLE and the body read of it rendered the walker's
// give-up comment (`const SizedBox.shrink() /* ref: itemCount */`) — a silent
// drop that compiles, not a build break.  Either way the declared value never
// reached the screen.
//
// The store binding is `ref.watch(<store>Provider.select(...))`, which depends
// on nothing but `ref` — so it can (and now must) be bound ABOVE the derived
// `final`s: Dart is not hoisted, and a `final` reading a later `final` is a
// hard `referenced_before_declaration`.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

const SYS = (pageBody: string) => `
system Shop {
  subdomain Sales { context Orders {
    aggregate Order { customerId: string }
    repository Orders for Order { } } }
  api ShopApi from Sales
  storage pg { type: postgres }
  resource ordersState { for: Orders, kind: state, use: pg }
  ui App {
    api Shop: ShopApi
    store Cart {
      state { lines: string[]  count: int = 0 }
      action add(sku: string) { lines += sku  count += 1 }
    }
    ${pageBody}
  }
  deployable api { platform: node contexts: [Orders] dataSources: [ordersState] serves: ShopApi port: 3000 }
  deployable app { platform: flutter targets: api ui: App { Shop: api } port: 3006 }
}`;

async function page(pageBody: string): Promise<string> {
  const files = await generateSystemFiles(SYS(pageBody));
  return files.get("app/lib/pages/cart_page_page.dart")!;
}

/** Index of the first line matching `re`, or -1. */
function lineOf(src: string, re: RegExp): number {
  return src.split("\n").findIndex((l) => re.test(l));
}

describe("Flutter page `derived` reading a store field", () => {
  it("binds the store local and keeps the derived", async () => {
    const dart = await page(`
      page CartPage {
        route: "/cart"
        derived itemCount: int = Cart.count
        body: Stack { Heading { itemCount, level: 1 } }
      }`);
    expect(dart).toContain("final count = ref.watch(cartProvider.select((s) => s.count));");
    expect(dart).toContain("final itemCount = count;");
    // The body renders the value instead of the give-up comment.
    expect(dart).toContain("Text('${itemCount}')");
    expect(dart).not.toContain("/* ref: itemCount */");
    // Dart is not hoisted: the store local has to be bound first.
    expect(lineOf(dart, /final count = ref\.watch/)).toBeLessThan(
      lineOf(dart, /final itemCount = count;/),
    );
    // A store read makes the page a ConsumerWidget even with no other
    // reactive input — the binding needs a `WidgetRef`.
    expect(dart).toContain("class CartPagePage extends ConsumerWidget");
  });

  it("orders the store locals above the derived when the page also has state", async () => {
    const dart = await page(`
      page CartPage {
        route: "/cart"
        state { confirming: bool = false }
        derived itemCount: int = Cart.count
        derived flag: bool = !confirming
        body: Stack { Heading { itemCount, level: 1 }, Heading { flag, level: 2 } }
      }`);
    // `state` first (a derived may read it), then the store locals, then the
    // derived block.
    expect(lineOf(dart, /final state = ref\.watch\(cartPageProvider\)/)).toBeLessThan(
      lineOf(dart, /final count = ref\.watch\(cartProvider/),
    );
    expect(lineOf(dart, /final count = ref\.watch\(cartProvider/)).toBeLessThan(
      lineOf(dart, /final itemCount = count;/),
    );
    expect(dart).toContain("final flag = (!state.confirming);");
  });

  it("does not bind a store the surviving derived never reads", async () => {
    // `keepUsedDerived` drops a derived the rendered body never references —
    // an unused `final` is a `flutter analyze` warning — and its store use
    // must go with it rather than leaving a dangling binding.
    const dart = await page(`
      page CartPage {
        route: "/cart"
        derived itemCount: int = Cart.count
        body: Stack { Heading { "static", level: 1 } }
      }`);
    expect(dart).not.toContain("final itemCount");
    expect(dart).not.toContain("cartProvider");
  });

  it("qualifies the local when the store member collides with a derived name", async () => {
    const dart = await page(`
      page CartPage {
        route: "/cart"
        derived count: int = Cart.count
        body: Stack { Heading { count, level: 1 } }
      }`);
    expect(dart).toContain("final cartCount = ref.watch(cartProvider.select((s) => s.count));");
    expect(dart).toContain("final count = cartCount;");
  });
});
