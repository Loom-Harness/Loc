// Flutter — model names in the positions `reserved-local-names.test.ts` left
// bare, found by building the generated app (`flutter analyze`):
//   - page / store / component ACTION names are Dart METHODS (`void class()`,
//     `void switch()`, `Future<void> do(…)`), plus the page shell's tear-off
//     (`final class = notifier.class;`) and the store-action call / binding
//     (`ref.read(cartProvider.notifier).switch()`, `final while = …`);
//   - a component PARAM named after a widget / `State` member (`key`,
//     `context`, `widget`, `mounted`, `setState`, `build`) — a widget field
//     clashing with `Widget.key`, a `State` getter overriding `State.context`
//     (`invalid_override`) or `setState` (`conflicting_field_and_method`);
//   - a `let` in an action that shares a state cell's name: the later read fell
//     through to `state.count`, leaving the local dead (a silent wrong value).
// Reserved / Object-member names take `dartMember`'s `<name>_`; component
// scope additionally respells the widget/`State` members (`dartComponentMember`),
// call sites included.  Match-arm binders in an async action (`Order class`)
// are pinned too — they were changed earlier but never compiled.

import { describe, expect, it } from "vitest";
import { dartComponentMember } from "../../../src/generator/flutter/dart-member.js";
import { generateSystemFiles } from "../../_helpers/index.js";

const SYS = `
system Shop {
  subdomain Sales { context Orders {
    error Rejected { reason: string }
    aggregate Order with crudish {
      code: string
      operation confirm(): Order or Rejected { code := "c" }
    }
    repository Orders for Order { }
  } }
  api ShopApi from Sales
  storage pg { type: postgres }
  resource ordersState { for: Orders, kind: state, use: pg }
  ui App {
    api Shop: ShopApi
    store Cart {
      state { count: int = 0 }
      action switch() { let var = count + 1  count := var }
      action default(case: int) { let class = case + 1  count := class }
      action while() { count := 0 }
    }
    component Tag(key: string, context: int, widget: string, mounted: bool, setState: int, build: string) {
      state { n: int = 0 }
      action new() { n := n + context + setState }
      action bump() { let n = 5  n := n + 1 }
      body: Card { Stack {
        Button { "bump", onClick: bump },
        Text { \`{key} {widget} {mounted} {build} {n}\` },
        Button { "new", onClick: new }
      } }
    }
    page Home {
      route: "/"
      state { count: int = 0 }
      action class() { count := count + 1 }
      action default(do: int) { count := do }
      action switch() { Cart.switch() }
      action shadow() { let count = 100  count := count + 1 }
      body: Stack {
        Button { "sw", onClick: Cart.while },
        Button { "shadow", onClick: shadow },
        Text { \`{count} {Cart.count}\` },
        Tag(key: "a", context: 2, widget: "w", mounted: true, setState: 3, build: "b"),
        Button { "class", onClick: class },
        Button { "switch", onClick: switch }
      }
    }
    page Detail(id: Order id) {
      route: "/o/:id"
      state { message: string = "" }
      action do() {
        match await Shop.Order.confirm() {
          Order class => { message := class.code }
          Rejected var => { message := var.reason }
        }
      }
      body: Stack { Text { message }, Button { "go", onClick: do } }
    }
  }
  deployable api { platform: node contexts: [Orders] dataSources: [ordersState] serves: ShopApi port: 3000 }
  deployable app { platform: flutter targets: api ui: App { Shop: api } port: 3006 }
}`;

const files = async () => {
  const f = await generateSystemFiles(SYS);
  const get = (suffix: string) => [...f.entries()].find(([k]) => k.endsWith(suffix))![1];
  return {
    home: get("lib/pages/home_page.dart"),
    detail: get("lib/pages/detail_page.dart"),
    stores: get("lib/stores.dart"),
    components: get("lib/components.dart"),
  };
};

describe("dartComponentMember", () => {
  it("respells widget/State members and reserved words; leaves the rest", () => {
    expect(dartComponentMember("key")).toBe("key_");
    expect(dartComponentMember("context")).toBe("context_");
    expect(dartComponentMember("class")).toBe("class_");
    expect(dartComponentMember("label")).toBe("label");
  });
});

describe("flutter — reserved action names", () => {
  it("page actions: Notifier method, shell tear-off and call site agree", async () => {
    const { home } = await files();
    expect(home).toContain("  void class_() {");
    expect(home).toContain("  void default_(int do_) {");
    expect(home).toContain("    final class_ = notifier.class_;");
    expect(home).toContain("onPressed: () { class_(); }");
    expect(home).not.toMatch(/void (class|default|switch)\(/);
  });

  it("an async-effect action: method, id-capturing closure, and match-arm binders", async () => {
    const { detail } = await files();
    expect(detail).toContain("Future<void> do_(String id) async {");
    expect(detail).toContain("final do_ = () => notifier.do_(id);");
    expect(detail).toContain("final class_ = Order.fromJson(result);");
    expect(detail).toContain("state = state.copyWith(message: class_.code);");
    expect(detail).toContain("final var_ = Rejected.fromJson(result);");
  });

  it("store actions: declaration, cross-store call, shell binding and use", async () => {
    const { home, stores } = await files();
    expect(stores).toContain("  void switch_() {");
    expect(stores).toContain("  void default_(int case_) {");
    expect(stores).toContain("  void while_() {");
    expect(home).toContain("ref.read(cartProvider.notifier).switch_();");
    expect(home).toContain("final while_ = ref.read(cartProvider.notifier).while_;");
    expect(home).toContain("onPressed: () { while_(); }");
  });
});

describe("flutter — component params named after widget/State members", () => {
  it("respells the field, ctor param, State getter, body read and call-site arg", async () => {
    const { home, components } = await files();
    expect(components).toContain("required this.key_, required this.context_");
    expect(components).toContain("  final String key_;");
    expect(components).toContain("  int get context_ => widget.context_;");
    expect(components).toContain("  int get setState_ => widget.setState_;");
    expect(components).toContain("((state.n + context_) + setState_)");
    expect(components).toContain("'key': key_");
    expect(components).not.toMatch(/get (key|context|widget|mounted|setState|build) =>/);
    expect(home).toContain(
      "Tag(key_: 'a', context_: 2, widget_: 'w', mounted_: true, setState_: 3, build_: 'b')",
    );
    // A component action named like a reserved word: declaration and use.
    expect(components).toContain("  void new_() {");
    expect(components).toContain("onPressed: () { new_(); }");
  });
});

describe("flutter — a `let` shadows a same-named state cell", () => {
  it("page action: the read after the let is the local", async () => {
    const { home } = await files();
    expect(home).toContain(
      "    final count = 100;\n    state = state.copyWith(count: (count + 1));",
    );
  });

  it("component action: the read after the let is the local", async () => {
    const { components } = await files();
    expect(components).toContain("final n = 5;\n      state = state.copyWith(n: (n + 1));");
  });
});
