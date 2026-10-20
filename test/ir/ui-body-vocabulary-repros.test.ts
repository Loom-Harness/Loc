// The thirteen frontend-body throw sites of the fail-closed register, one case
// each, from its repros
// (`docs/new-plan/missions/M-T9.77-fail-closed-register.md`).  Each `.ddd`
// reported `0 error(s)` and then crashed `ddd generate system`; now each is
// refused by a `loom.*` code at `ddd parse`, or (toast) generates.  The
// frontend × shape matrix around them is `ui-body-vocabulary-census.test.ts`.

import { describe, expect, it } from "vitest";
import { validate } from "../../src/api/index.js";
import { generateSystemFiles } from "../_helpers/generate.js";

/** A one-page ui on `platform`, the page carrying `page` members. */
function onePage(platform: string, page: string, repo = "", extraUi = ""): string {
  return `
system S {
  subdomain M { context Sales {
    aggregate Thing with crudish { name: string  qty: int }
    repository Things for Thing { ${repo} }
  } }
  api SApi from M
  ui WebApp {
    api C: SApi
    ${extraUi}
    page Home {
      route: "/"
      state { n: int = 0  s: string = ""  xs: int[] = []  b: bool = false }
      ${page}
    }
  }
  storage primary { type: postgres }
  resource salesState { for: Sales, kind: state, use: primary }
  deployable api { platform: node contexts: [Sales] dataSources: [salesState] serves: SApi port: 3000 }
  deployable web { platform: ${platform} targets: api ui: WebApp { C: api } port: 3005 }
}`;
}

/** A `:id` page awaiting a union-returning op, on `platform`. */
function awaitPage(platform: string, action: string, store = ""): string {
  return `
system Demo {
  subdomain S { context C {
    error OrderMissing { missingRef: string }
    aggregate Order with crudish {
      customerId: string
      operation reserve(): Order or OrderMissing { return OrderMissing { missingRef: customerId } }
    }
  } }
  api A from S { httpStatus OrderMissing -> 404 }
  ui Web {
    api C: A
    ${store}
    page Detail(id: Order id) {
      route: "/orders/:id"
      state { draftName: string = "" }
      action reserveNow() { ${action} }
      body: Stack { Button { "Reserve", onClick: reserveNow } }
    }
  }
  storage primary { type: postgres }
  resource st { for: C, kind: state, use: primary }
  deployable api { platform: node contexts: [C] dataSources: [st] serves: A port: 3000 }
  deployable web { platform: ${platform} targets: api ui: Web { C: api } port: 3001 }
}`;
}

const QV = (of: string, data = 'rows => Text { "x" }') =>
  `QueryView { of: ${of}, loading: Text { "l" }, error: Text { "e" }, empty: Text { "n" }, data: ${data} }`;

const NESTED =
  'match await C.Order.reserve() { Order o => { match await C.Order.reserve() { Order p => { draftName := p.customerId } else => { draftName := "b" } } } else => { draftName := "u" } }';

const CASES: readonly { site: string; src: string; code: string }[] = [
  {
    site: "_walker/walker-core.ts#emitExpr$4",
    src: onePage("react", "body: Stack { Text { this.s } }"),
    code: "loom.ui-this-unbound",
  },
  {
    site: "_walker/walker-core.ts#unsupportedPageStmt",
    src: onePage(
      "react",
      'action bump() { other := 1 } body: Stack { Button { "Bump", onClick: bump } }',
    ),
    code: "loom.ui-assign-not-state",
  },
  {
    site: "feliz/fs-expr.ts#renderFsMethodCall",
    src: onePage(
      "feliz",
      'action say() { xs := xs.reverse() } body: Button { "go", onClick: say }',
    ),
    code: "loom.unknown-member",
  },
  {
    site: "feliz/fs-expr.ts#renderFsExpr$3",
    src: onePage(
      "feliz",
      'action say() { let f = x => { let y = x } } body: Button { "go", onClick: say }',
    ),
    code: "loom.ui-body-feature-unsupported",
  },
  {
    site: "feliz/fs-expr.ts#renderFsExpr$4",
    src: onePage("feliz", 'action say() { b := this.b } body: Button { "go", onClick: say }'),
    code: "loom.ui-this-unbound",
  },
  {
    site: "feliz/update-emit.ts#renderUpdateStmt$2",
    src: awaitPage("feliz", NESTED),
    code: "loom.ui-body-feature-unsupported",
  },
  {
    site: "feliz/wire.ts#findParamQueryValue",
    src: onePage(
      "feliz",
      `body: ${QV('C.Thing.byNames(["a"])')}`,
      "find byNames(names: string[]): Thing[]",
    ),
    code: "loom.ui-body-feature-unsupported",
  },
  {
    site: "feliz/wire.ts#felizFindRead",
    src: onePage("feliz", `body: ${QV("C.Thing.names()")}`, "find names(): string[]"),
    code: "loom.ui-body-feature-unsupported",
  },
  {
    site: "feliz/wire.ts#felizFindRead$2",
    src: onePage("feliz", `body: ${QV("C.Thing.byName()")}`, "find byName(name: string): Thing[]"),
    code: "loom.ui-find-call-arity",
  },
  {
    site: "feliz/wire.ts#walk",
    src: onePage(
      "feliz",
      `body: ${QV("C.Thing.all", `rows => For { each: rows, r => ${QV("C.Thing.byName(r.name)", 'xs2 => Text { "y" }')} }`)}`,
      "find byName(name: string): Thing[]",
    ),
    code: "loom.ui-body-feature-unsupported",
  },
  {
    site: "flutter/riverpod-emit.ts#renderNotifierStmt",
    src: awaitPage(
      "flutter",
      "Cart.b()",
      "store Cart { state { n: int = 0 } action a() { n := 1 } action b() { foo() } }",
    ),
    code: "loom.unresolved-action-ref",
  },
  {
    site: "flutter/riverpod-emit.ts#renderNotifierStmt$2",
    src: awaitPage("flutter", NESTED),
    code: "loom.ui-body-feature-unsupported",
  },
];

describe("frontend-body register repros — each is refused at `ddd parse`", () => {
  for (const c of CASES) {
    it(`${c.site} → ${c.code}`, async () => {
      const report = await validate(c.src);
      const errors = report.diagnostics.filter((d) => d.severity === "error");
      expect(errors.map((d) => d.code)).toEqual([c.code]);
    });
  }

  it("feliz/update-emit.ts#renderUpdateStmt — `toast(…)` in an action now generates", async () => {
    const files = await generateSystemFiles(
      onePage("feliz", 'action say() { toast("hi") } body: Button { "go", onClick: say }'),
    );
    const app = [...files].find(([p]) => p.endsWith("App.fs"))?.[1] ?? "";
    expect(app).toContain('Cmd.ofEffect (fun _ -> updateToast (string ("hi")))');
  });
});
