// Flutter — Dart-reserved / `Object`-member names OUTSIDE wire fields.
//
// `reserved-field-names.test.ts` pins the wire-model member respelling.  The
// same `.ddd` names reach Dart as many other identifiers, and each was emitted
// bare: a `state { default: … }` cell (`final String default;`), a component
// param (`required this.class`), a page route param (`final default = …`), an
// action payload / `let` (`void bump(int var) { final case = … }`), a lambda /
// `For` binder (`.where((new) => …)`), a store field local, a `derived` name —
// every one `expected_identifier_but_got_keyword` under `flutter analyze`.  A
// state cell or wire field named `toString` / `runtimeType` / `noSuchMethod` /
// `hashCode` collides with the `Object` member (`conflicting_field_and_method`
// / `invalid_override`).  All take `dartMember`'s `<name>_` spelling; JSON keys,
// route-arg keys and i18n placeholder keys keep the declared name.
//
// Also pinned: a qualified enum member whose name matches a state cell
// (`k := Kind.new` beside `state { new: … }`) is the wire STRING `'new'`, not a
// read of that cell (it rendered `state.new`).

import { describe, expect, it } from "vitest";
import { dartMember } from "../../../src/generator/flutter/dart-member.js";
import { generateSystemFiles } from "../../_helpers/index.js";

const SYS = `
system Shop {
  subdomain Sales { context Orders {
    enum Kind { default, class, new, plain }
    aggregate Product with crudish {
      label: string
      kind: Kind
      toString: string
      runtimeType: string
    }
    repository Products for Product { }
  } }
  api ShopApi from Sales
  storage pg { type: postgres }
  resource ordersState { for: Orders, kind: state, use: pg }
  ui App {
    api Shop: ShopApi
    store Cart {
      state { switch: string[]  case: int = 0 }
      action add(new: string) { switch += new  case += 1 }
    }
    component Tag(default: string, class: int) {
      state { switch: bool = false  new: int = class }
      action flip() { switch := !switch }
      action bump(var: int) { let case = var + 1  new := new + case }
      body: Card { Stack { Text { \`{default} {new}\` }, Button { "flip", onClick: flip } } }
    }
    component Label(switch: string) {
      derived assert: int = 1
      body: Text { \`{switch} {assert}\` }
    }
    page Home {
      route: "/"
      state { default: string = "x"  class: int = 0  new: string = ""  k: Kind = Kind.default  items: string[] = []  runtimeType: int = 2 }
      derived while: int = runtimeType * 3
      action inc(do: int) { let var = do + class  class := var }
      action pick() { k := Kind.new }
      body: Stack {
        Text { default },
        Text { \`{class} {while} {Cart.case}\` },
        Text { \`{items.where(new => new == "a").count}\` },
        For { each: Cart.switch, class => Card { class } },
        Tag(default: "a", class: 2),
        Label(switch: "s")
      }
    }
    page Other(default: string) { route: "/o/:default" body: Text { default } }
  }
  deployable api { platform: node contexts: [Orders] dataSources: [ordersState] serves: ShopApi port: 3000 }
  deployable app { platform: flutter targets: api ui: App { Shop: api } port: 3006 }
}`;

describe("flutter — Dart-reserved names in state / params / locals / binders", () => {
  it("dartMember respells reserved words and Object members only", () => {
    expect(dartMember("default")).toBe("default_");
    expect(dartMember("toString")).toBe("toString_");
    expect(dartMember("hashCode")).toBe("hashCode_");
    expect(dartMember("abstract")).toBe("abstract");
    expect(dartMember("label")).toBe("label");
  });

  it("respells page state cells in the data class, init, setters and reads", async () => {
    const home = (await generateSystemFiles(SYS)).get("app/lib/pages/home_page.dart")!;
    expect(home).toContain("  final String default_;");
    expect(home).toContain("  final int runtimeType_;");
    expect(home).toContain("required this.class_");
    expect(home).toContain("String? default_, int? class_");
    expect(home).toContain("default_: default_ ?? this.default_");
    expect(home).toContain("state = state.copyWith(default_: v);");
    expect(home).toContain("Text('${state.default_}')");
    expect(home).not.toMatch(/\bfinal String default;/);
  });

  it("respells action params and let bindings", async () => {
    const home = (await generateSystemFiles(SYS)).get("app/lib/pages/home_page.dart")!;
    expect(home).toContain("void inc(int do_) {");
    expect(home).toContain("final var_ = (do_ + state.class_);");
    expect(home).toContain("state = state.copyWith(class_: var_);");
  });

  it("an enum member sharing a state cell's name is the wire string, not a state read", async () => {
    const home = (await generateSystemFiles(SYS)).get("app/lib/pages/home_page.dart")!;
    expect(home).toContain("k: 'default'");
    expect(home).toContain("state = state.copyWith(k: 'new');");
    expect(home).not.toContain("k: state.new");
  });

  it("respells lambda / For binders, derived and store locals", async () => {
    const home = (await generateSystemFiles(SYS)).get("app/lib/pages/home_page.dart")!;
    expect(home).toContain(".where((new_) => (new_ == 'a'))");
    expect(home).toContain("...switch_.map((class_) =>");
    expect(home).toContain("final while_ = (state.runtimeType_ * 3);");
    expect(home).toContain("final case_ = ref.watch(cartProvider.select((s) => s.case_));");
  });

  it("respells component params (field, ctor, getter, call site) and component state", async () => {
    const files = await generateSystemFiles(SYS);
    const comp = files.get("app/lib/components.dart")!;
    expect(comp).toContain("required this.default_, required this.class_");
    expect(comp).toContain("  final String default_;");
    expect(comp).toContain("String get default_ => widget.default_;");
    expect(comp).toContain("final bool switch_;");
    expect(comp).toContain("state = TagModel(switch_: false, new_: class_);");
    expect(comp).toContain("void bump(int var_) {");
    expect(comp).toContain("final case_ = (var_ + 1);");
    expect(comp).toContain("int get assert_ => 1;");
    expect(files.get("app/lib/pages/home_page.dart")!).toContain("Tag(default_: 'a', class_: 2)");
  });

  it("respells a route param local but keeps the route-arg key", async () => {
    const other = (await generateSystemFiles(SYS)).get("app/lib/pages/other_page.dart")!;
    expect(other).toContain(
      "final default_ = routeArgs is Map ? (routeArgs['default'] as String? ?? '')",
    );
    expect(other).toContain("${default_}");
  });

  it("respells store fields and action params", async () => {
    const stores = (await generateSystemFiles(SYS)).get("app/lib/stores.dart")!;
    expect(stores).toContain("final List<String> switch_;");
    expect(stores).toContain("void add(String new_) {");
    expect(stores).toContain("[...state.switch_, new_]");
  });

  it("respells Object-member wire fields, keeping the JSON key", async () => {
    const models = (await generateSystemFiles(SYS)).get("app/lib/models.dart")!;
    expect(models).toContain("  final String toString_;");
    expect(models).toContain("toString_: json['toString'] as String,");
    expect(models).toContain("'runtimeType': runtimeType_,");
    expect(models).not.toMatch(/final String toString;/);
  });
});
