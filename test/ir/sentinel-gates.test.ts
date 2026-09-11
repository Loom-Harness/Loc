// Wave C1 packet 1d-ii — the phase-⑦ gates that replaced the §18 EMITTER
// sentinels.
//
// Every shape below was RUN through `ddd parse` / `ddd generate system` on this
// tree before its gate existed, and every one reported
// `0 error(s), 0 warning(s)` and then either crashed codegen with a bare
// `throw new Error(...)` — raw stack trace, no `loom.*` code — or emitted a
// comment into the generated project and silently dropped the construct.  This
// file is the negative half (the gate fires) paired with a positive control
// (the nearest shape that still works), because a gate with no control is one
// refactor away from refusing everything.
//
// The EMITTER halves live beside their emitters:
//   * the two LiveView collisions + their internal floors — `test/generator/
//     elixir/heex-component-state.test.ts`
//   * the walker's unresolved-receiver give-up — `test/generator/_walker/
//     unresolved-receiver-give-up.test.ts`
//   * the prop-type predicate vs. the two emitters — `test/ir/
//     frontend-prop-type-support.test.ts`

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { parseString } from "../_helpers/parse.js";

async function codes(source: string): Promise<string[]> {
  const { model, doc } = await parseString(source, { validate: false });
  const parseErrors = (doc.parseResult.parserErrors ?? []).map((e) => e.message);
  // A shape that does not PARSE proves nothing about a validator — the gate
  // would "pass" on a body that was never built.  Fail loudly instead.
  expect(parseErrors, "fixture must parse").toEqual([]);
  return validateLoomModel(enrichLoomModel(lowerModel(model)))
    .filter((d) => d.severity === "error")
    .map((d) => d.code ?? "<uncoded>");
}

// ---------------------------------------------------------------------------
// `loom.ui-page-route-collision` — src/generator/svelte/routes-emitter.ts
//
// Before: `Error: svelte: pages 'Alpha' and 'Beta' both route to
// src/routes/(app)/dup/+page.svelte — SvelteKit file routing needs distinct
// routes per page.`, thrown from `emitSveltePagesForUi` after the CLI had
// already printed `0 error(s), 0 warning(s)`.
//
// Checked on the ROUTE rather than on SvelteKit's directory, because the
// collision is not SvelteKit's: React / Vue / Angular match the first declared
// path and the second page simply cannot be opened.
// ---------------------------------------------------------------------------

const routeSys = (alpha: string, beta: string, framework: string) => `
system RouteSys {
  subdomain Work { context Ops {
    aggregate Job with crudish { name: string }
  } }
  api OpsApi from Work
  storage pg { type: postgres }
  resource st { for: Ops, kind: state, use: pg }
  ui Console {
    page Alpha { route: "${alpha}" body: Stack { Heading { "Alpha", level: 1 } } }
    page Beta { route: "${beta}" body: Stack { Heading { "Beta", level: 1 } } }
  }
  deployable api { platform: node, contexts: [Ops], dataSources: [st], serves: OpsApi, port: 8080 }
  deployable web { platform: ${framework}, targets: api, ui: Console, port: 3001 }
}`;

describe("loom.ui-page-route-collision", () => {
  for (const framework of ["svelte", "react", "vue", "angular"]) {
    it(`fires on ${framework} — a route is an address, not a file-layout detail`, async () => {
      expect(await codes(routeSys("/dup", "/dup", framework))).toContain(
        "loom.ui-page-route-collision",
      );
    });
  }

  it("stays quiet when the two pages have distinct routes", async () => {
    expect(await codes(routeSys("/a", "/b", "svelte"))).not.toContain(
      "loom.ui-page-route-collision",
    );
  });

  // ---------------------------------------------------------------------
  // The ONE exempt pair, and why it is a rule rather than a hole.
  //
  // A scaffold-synthesised `Home` YIELDS its route to a user page claiming the
  // same address — `classifyPage`'s contract ("write `page Home { … }` to
  // replace the generated landing page") and React's `userHasRootRoute`, which
  // skips the synthesised Home's import AND its route.  Found by this gate
  // refusing `web/src/examples/erp/main.ddd`, whose hand-written
  // `page Dashboard { route: "/" }` sits beside the scaffold's Home; the
  // emitted `App.tsx` carries exactly one `<Route path="/" …>`, for Dashboard.
  // ---------------------------------------------------------------------
  const scaffoldSys = (customRoute: string, extra = "") => `
system ScaffoldRoute {
  subdomain Work { context Ops {
    aggregate Job with crudish { name: string }
  } }
  api OpsApi from Work
  storage pg { type: postgres }
  resource st { for: Ops, kind: state, use: pg }
  ui Console with scaffold(aggregates: [Job]) {
    page Dashboard { route: "${customRoute}" body: Stack { Heading { "D", level: 1 } } }
${extra}
  }
  deployable api { platform: node, contexts: [Ops], dataSources: [st], serves: OpsApi, port: 8080 }
  deployable web { platform: react, targets: api, ui: Console, port: 3001 }
}`;

  it("exempts a scaffold `Home` yielding `/` to a user page", async () => {
    expect(await codes(scaffoldSys("/"))).not.toContain("loom.ui-page-route-collision");
  });

  it("but a THIRD page at `/` still collides with the one that actually mounts", async () => {
    // The winner owns the route from there on.  Declared in THIS order on
    // purpose — Home first, so the yielded page is the one already in the map
    // when `Landing` arrives.  Without the winner-ownership guard, `Landing`
    // would be compared against the yielded `Home`, be exempted as a
    // Home-vs-user pair, and a genuine two-user-page collision at `/` would go
    // unreported.  (A hand-written `page Home` classifies as the home kind on
    // purpose: the scaffold's override contract is by NAME.)
    const found = await codes(`
system ThreeAtRoot {
  subdomain Work { context Ops {
    aggregate Job with crudish { name: string }
  } }
  api OpsApi from Work
  storage pg { type: postgres }
  resource st { for: Ops, kind: state, use: pg }
  ui Console {
    page Home { route: "/" body: Stack { Heading { "H", level: 1 } } }
    page Dashboard { route: "/" body: Stack { Heading { "D", level: 1 } } }
    page Landing { route: "/" body: Stack { Heading { "L", level: 1 } } }
  }
  deployable api { platform: node, contexts: [Ops], dataSources: [st], serves: OpsApi, port: 8080 }
  deployable web { platform: react, targets: api, ui: Console, port: 3001 }
}`);
    expect(found).toContain("loom.ui-page-route-collision");
  });

  it("and the scaffold's own pages do not collide with each other", async () => {
    expect(await codes(scaffoldSys("/elsewhere"))).not.toContain("loom.ui-page-route-collision");
  });
});

// ---------------------------------------------------------------------------
// `loom.ui-body-statement-kind` — the riverpod `default:` arm + the JS walker's
// `unsupportedPageStmt` throw.
//
// Before, from one `.ddd` reporting `0 error(s), 0 warning(s)`:
//   react   `Error: react: unsupported statement 'return' in a page event
//            handler — it has no meaning in a React page event handler.`
//   flutter `// TODO(flutter full-parity): unsupported action statement
//            'return'` — the action silently does nothing.
// ---------------------------------------------------------------------------

const stmtSys = (body: string, framework: string) => `
system StmtSys {
  api A from D
  subdomain D { context C {
    aggregate Order { code: string }
    repository Orders for Order { }
  } }
  storage pg { type: postgres }
  resource st { for: C, kind: state, use: pg }
  ui App {
    framework: ${framework}
    api Shop: A
    page Edit {
      route: "/edit"
      state { n: int = 0 }
      action bump() {
${body}
      }
      body: Stack { Heading { "Edit", level: 1 }, Button { "bump", onClick: bump } }
    }
  }
  deployable api { platform: node, contexts: [C], dataSources: [st], serves: A, port: 8080 }
  deployable app { platform: ${framework === "flutter" ? "flutter" : "react"}, targets: api, ui: App { Shop: api }, port: 3006 }
}`;

describe("loom.ui-body-statement-kind", () => {
  for (const [kind, body] of [
    ["return", "        return 1"],
    ["precondition", "        precondition n > 0"],
    ["requires", "        requires n > 0"],
  ] as const) {
    for (const framework of ["react", "flutter"]) {
      it(`refuses \`${kind}\` in a ${framework} action body`, async () => {
        expect(await codes(stmtSys(body, framework))).toContain("loom.ui-body-statement-kind");
      });
    }
  }

  it("leaves the kinds a ui action DOES render alone", async () => {
    // `let` + a state write + a bare expression: the vocabulary an action really
    // has.  If this ever fires, the gate has widened past what it describes.
    const found = await codes(stmtSys("        let m = n + 1\n        n := m", "react"));
    expect(found).not.toContain("loom.ui-body-statement-kind");
  });
});

// ---------------------------------------------------------------------------
// `loom.frontend-prop-type-unsupported` — _frontend/component-prop-type.ts and
// _frontend/extern-functions.ts.
//
// Before: `Error: component prop: unsupported primitive 'money'.` /
// `Error: extern function: unsupported primitive 'money' in signature.`, both
// raw, both from `.ddd` that had just validated clean.
// ---------------------------------------------------------------------------

const propSys = (decls: string, body: string, framework: string) => `
system PropSys {
  api A from D
  subdomain D { context C {
    valueobject Address { zip: string }
    aggregate Order { code: string  total: money }
    repository Orders for Order { }
  } }
  storage pg { type: postgres }
  resource st { for: C, kind: state, use: pg }
  ui App {
    framework: ${framework}
    api Shop: A
${decls}
    page Edit {
      route: "/edit"
      state { total: money = 0.00  label: string = "" }
      body: Stack { Heading { "Edit", level: 1 }, ${body} }
    }
  }
  deployable api { platform: node, contexts: [C], dataSources: [st], serves: A, port: 8080 }
  deployable app { platform: ${framework === "feliz" ? "feliz" : "react"}, targets: api, ui: App { Shop: api }, port: 3006 }
}`;

describe("loom.frontend-prop-type-unsupported", () => {
  const CODE = "loom.frontend-prop-type-unsupported";

  it("refuses a `money` component param", async () => {
    const src = propSys(
      `    component Price(amount: money) { body: Text { "p" } }`,
      "Price(amount: total)",
      "react",
    );
    expect(await codes(src)).toContain(CODE);
  });

  it("refuses a `File` component param", async () => {
    const src = propSys(
      `    component Doc(f: File) { body: Text { "d" } }`,
      "Text { label }",
      "react",
    );
    expect(await codes(src)).toContain(CODE);
  });

  it("refuses a `valueobject` component param", async () => {
    const src = propSys(
      `    component Ship(at: Address) { body: Text { "s" } }`,
      "Text { label }",
      "react",
    );
    expect(await codes(src)).toContain(CODE);
  });

  it("refuses a `money` parameter on an `extern` function signature", async () => {
    const src = propSys(
      `    function fmt(m: money): string extern from "./lib/fmt"`,
      "Text { fmt(total) }",
      "react",
    );
    expect(await codes(src)).toContain(CODE);
  });

  it("admits the types the prop layer CAN spell", async () => {
    const src = propSys(
      `    component Badge(level: int, tag: string?, tags: string[]) { body: Text { tag } }`,
      `Badge(level: 2, tag: label, tags: [ ])`,
      "react",
    );
    expect(await codes(src)).not.toContain(CODE);
  });

  it("does not fire on Feliz — it spells its own props record, not TypeScript", async () => {
    const src = propSys(
      `    component Price(amount: money) { body: Text { "p" } }`,
      "Price(amount: total)",
      "feliz",
    );
    expect(await codes(src)).not.toContain(CODE);
  });
});

// ---------------------------------------------------------------------------
// `loom.flutter-action-body-unsupported` — riverpod-emit.ts's three
// `TODO(flutter full-parity)` arms.
// ---------------------------------------------------------------------------

const flutterSys = (actionBody: string, platform = "flutter") => `
system FlutterSys {
  api A from D
  subdomain D { context C {
    error Rejected { reason: string }
    aggregate Order {
      code: string
      operation confirm(): Order or Rejected { code := "c" }
    }
    repository Orders for Order { }
  } }
  storage pg { type: postgres }
  resource st { for: C, kind: state, use: pg }
  ui App {
    framework: ${platform}
    api Shop: A
    page Edit {
      route: "/edit/:id"
      state { message: string = "" }
      action go() {
${actionBody}
      }
      body: Stack { Heading { "Edit", level: 1 }, Button { "go", onClick: go } }
    }
  }
  deployable api { platform: node, contexts: [C], dataSources: [st], serves: A, port: 8080 }
  deployable app { platform: ${platform}, targets: api, ui: App { Shop: api }, port: 3006 }
}`;

const MATCH_AWAIT = (op: string) => `        match await Shop.Order.${op}() {
          Order o    => { message := o.code }
          Rejected r => { message := r.reason }
        }`;

describe("loom.flutter-action-body-unsupported", () => {
  const CODE = "loom.flutter-action-body-unsupported";

  it("refuses `navigate(…)` in a Flutter action body", async () => {
    expect(await codes(flutterSys(`        navigate("/other")`))).toContain(CODE);
  });

  it("refuses `toast(…)` in a Flutter action body", async () => {
    expect(await codes(flutterSys(`        toast("hi")`))).toContain(CODE);
  });

  it("refuses `match await` on a STANDARD aggregate op", async () => {
    // `delete` is never in `agg.operations`, which is the only place the
    // Flutter async-effect emitter looks.
    expect(await codes(flutterSys(MATCH_AWAIT("delete")))).toContain(CODE);
  });

  it("admits `match await` on a DECLARED operation — the shape that renders", async () => {
    expect(await codes(flutterSys(MATCH_AWAIT("confirm")))).not.toContain(CODE);
  });

  it("does not fire on react, which renders both shapes", async () => {
    expect(await codes(flutterSys(`        navigate("/other")`, "react"))).not.toContain(CODE);
    expect(await codes(flutterSys(MATCH_AWAIT("delete"), "react"))).not.toContain(CODE);
  });
});
