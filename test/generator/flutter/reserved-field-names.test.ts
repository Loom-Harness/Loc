// Flutter — wire fields named after a Dart RESERVED word.
//
// `default`, `enum`, `extends`, `class`, `switch`, `new`, … are legal Loom field
// names (`default` was never a Loom keyword; the rest are soft since #3063), but
// they are reserved in Dart — illegal as ANY identifier.  The model emitted
// `final int default;` and the pages read `row.default`, so a `.ddd` that
// validates clean produced an app `flutter analyze` rejected with
// `expected_identifier_but_got_keyword` (found by building a scaffold over such
// a model in `ghcr.io/cirruslabs/flutter:stable`).  Dart has no escape syntax,
// so the Dart MEMBER is spelled `<name>_` while the JSON KEY stays the wire name.
// Built-in identifiers (`abstract`, `static`, `import`, …) are legal member
// names in Dart and stay bare.

import { describe, expect, it } from "vitest";
import { copyWithChain } from "../../../src/generator/flutter/copy-with.js";
import { generateSystemFiles } from "../../_helpers/index.js";

const SYS = `
system Shop {
  subdomain Sales { context Orders {
    aggregate Product {
      label: string
      default: int
      class: string
      abstract: string
    }
    repository Products for Product { }
    projection ByClass {
      class: string
      default: int
      from Product as p
      group by p.class
      select class = p.class, default = count()
    }
  } }
  api ShopApi from Sales
  storage pg { type: postgres }
  resource ordersState { for: Orders, kind: state, use: pg }
  ui App with scaffold(subdomains: [Sales]) {
    api Shop: ShopApi
    page Sorted { route: "/sorted"
      state { sortKey: string = ""  sortDir: string = "asc"  q: string = "" }
      body: QueryView { of: Shop.Product.all, data: rows => Table(
        Column(sortKey, p => p.default, sortable: true),
        Column(sortKey, p => p.class, sortable: true),
        rows: rows, sortKey: sortKey, sortDir: sortDir, filter: q) } }
    page Dash { route: "/dash"
      body: Stack { Chart { kind: "bar", of: Shop.ByClass, x: r => r.class, y: r => r.default } } }
  }
  deployable api { platform: node contexts: [Orders] dataSources: [ordersState] serves: ShopApi port: 3000 }
  deployable app { platform: flutter targets: api ui: App { Shop: api } port: 3006 }
}`;

describe("flutter — Dart-reserved wire field names", () => {
  it("spells the model member `<name>_` and keeps the JSON key", async () => {
    const models = (await generateSystemFiles(SYS)).get("app/lib/models.dart")!;
    expect(models).toContain("  final int default_;");
    expect(models).toContain("  final String class_;");
    expect(models).toContain("    required this.default_,");
    expect(models).toContain("        default_: json['default'] as int,");
    expect(models).toContain("        'default': default_,");
    expect(models).toContain("    int? default_,");
    expect(models).toContain("        default_: default_ ?? this.default_,");
    expect(models).not.toMatch(/\bfinal int default;/);
    // A built-in identifier is a legal Dart member — untouched.
    expect(models).toContain("  final String abstract;");
  });

  it("reads the respelled member on the scaffold pages", async () => {
    const files = await generateSystemFiles(SYS);
    const detail = files.get("app/lib/pages/product_detail_page.dart")!;
    expect(detail).toContain(".default_}");
    expect(detail).not.toMatch(/\.default\b/);
    const list = files.get("app/lib/pages/product_list_page.dart")!;
    expect(list).toContain("row.default_");
    expect(list).not.toMatch(/row\.default\b/);
  });

  it("respells the member in a client-side sort, a filter and a chart", async () => {
    const files = await generateSystemFiles(SYS);
    const sorted = files.get("app/lib/pages/sorted_page.dart")!;
    expect(sorted).toContain(
      "'default' => (a.default_ as Comparable).compareTo(b.default_ as Comparable)",
    );
    expect(sorted).toContain("<Object?>[row.default_, row.class_]");
    const dash = files.get("app/lib/pages/dash_page.dart")!;
    expect(dash).toContain("LoomChartPoint(r.class_.toString(), LoomMoney.toNum(r.default_)");
  });

  it("respells every segment of a nested copyWith write", () => {
    expect(copyWithChain("state.draft", ["class", "default"], "v")).toBe(
      "state.draft.copyWith(class_: state.draft.class_.copyWith(default_: v))",
    );
    // A plain path is unchanged.
    expect(copyWithChain("state.order", ["shipping", "zip"], "v")).toBe(
      "state.order.copyWith(shipping: state.order.shipping.copyWith(zip: v))",
    );
  });
});
