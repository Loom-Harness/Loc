// ---------------------------------------------------------------------------
// `component <Name>` where `<Name>` is a walker-stdlib primitive.
//
// The page-body dispatcher resolves a call by NAME, primitives first.  So
//
//   component Alert(msg: string) { body: Heading { msg, level: 3 } }
//   page Home { route: "/"  body: Stack { Alert("hi") } }
//
// generated, on this tree, at `0 error(s), 0 warning(s)`:
//
//   src/components/Alert.tsx          ← the author's component, emitted…
//   src/pages/home.tsx:
//     import { Alert, Stack, Title } from "@mantine/core";
//     <Alert color="red" variant="light">{t("page.Home.alert.sx4lga", "hi")}</Alert>
//
// …and never rendered.  The author's `Heading { msg, level: 3 }` appears
// nowhere in the project, and nothing said so.
//
// This is the same defect `loom.extern-function-shadows-stdlib` has always
// refused for an `extern function` — for the same stated reason ("the body
// dispatcher would route the call to the primitive, silently ignoring the
// user's module").  The component arm was simply missing.
//
// D-PAGE-PRIMITIVE-SHADOW records why the ruling is COMPONENTS ONLY: a
// `valueobject Money` does not shadow the `Money` primitive (the primitive
// still wins, and its own arity gate still fires), and refusing it would reject
// `web/src/examples/sales-system.ddd`, which declares exactly that.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { validate } from "../../../src/api/index.js";

const CODE = "loom.component-shadows-stdlib";

const uiWith = (decls: string, body: string): string => `
system S {
  subdomain Sales { context Orders {
    valueobject Money { amount: decimal  currency: string }
    aggregate Order { code: string  derived display: string = code }
    repository Orders for Order { }
  } }
  api SalesApi from Sales
  storage pg { type: postgres }
  resource st { for: Orders, kind: state, use: pg }
  ui WebApp {
    api Sales: SalesApi
${decls}
    page Home {
      route: "/"
      body: Stack { Heading { "Home", level: 1 }, ${body} }
    }
  }
  deployable api { platform: node, contexts: [Orders], dataSources: [st], serves: SalesApi, port: 8080 }
  deployable web { platform: react, targets: api, ui: WebApp { Sales: api }, port: 3001 }
}`;

const codes = async (src: string): Promise<string[]> =>
  (await validate(src)).diagnostics.map((d) => d.code ?? "");

describe("loom.component-shadows-stdlib", () => {
  // Three primitives from three different families — a display primitive, a
  // container, and the most-used leaf — so the gate is not pinned to one entry
  // of the name set.
  for (const name of ["Alert", "Card", "Text"] as const) {
    it(`refuses a component named '${name}'`, async () => {
      const src = uiWith(
        `    component ${name}(msg: string) { body: Heading { msg, level: 3 } }`,
        `${name}("hi")`,
      );
      expect(await codes(src)).toContain(CODE);
    });
  }

  it("admits a component whose name is NOT a primitive", async () => {
    const src = uiWith(
      `    component OrderBanner(msg: string) { body: Heading { msg, level: 3 } }`,
      `OrderBanner("hi")`,
    );
    expect(await codes(src)).not.toContain(CODE);
  });

  it("an EXTERN component collides the same way and is refused too", async () => {
    // An extern component is addressed by the same name at the same call site,
    // so the dispatcher makes the same choice — the user's module is just as
    // dead.  Asserting it here keeps the gate from being narrowed to the walked
    // flavour by someone reading only the first case.
    const src = uiWith(
      `    component Card(msg: string) extern from "./widgets/Card"`,
      `Card("hi")`,
    );
    expect(await codes(src)).toContain(CODE);
  });

  it("a `valueobject` sharing a primitive name is NOT refused", async () => {
    // The scope line of D-PAGE-PRIMITIVE-SHADOW, asserted rather than asserted
    // in prose: `Money` is both a walker primitive and a value object in the
    // shipped `sales-system.ddd`.  The fixture above declares it in every case,
    // so a widening of this gate to value objects fails HERE, not only in the
    // examples corpus.
    const src = uiWith("", `Money(10)`);
    expect(await codes(src)).not.toContain(CODE);
  });

  it("the primitive's own gates still apply to the shadowed name", async () => {
    // The premise of the ruling: the PRIMITIVE wins the call, which is why the
    // component is dead — so the primitive's arity gate must still be the one
    // that fires on a bad call.  If a `valueobject Money` were capturing the
    // name, this would come back clean.
    const src = uiWith("", `Money { 10, "dropped" }`);
    expect(await codes(src)).toContain("loom.page-primitive-extra-children");
  });
});
