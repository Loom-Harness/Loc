// M-T1.36 F1 — the Vue/Angular twins of Svelte's F50 (store-showcase.ddd with
// `platform: vue|angular`).
//
//   * Vue: `derived itemCount: int = Cart.count` emitted
//     `const itemCount = computed(() => count);`.  The store member local is
//     itself a `ComputedRef` (`const count = computed(() => cart.state.count)`),
//     so the derived held the REF, not the number — `vue-tsc` accepts it only
//     because `computed` infers `ComputedRef<ComputedRef<number>>`, and the
//     template then renders `[object Object]`.  Script position must deref.
//
//   * An action-body `toast("…")` on a page whose derived reads a store: both
//     frameworks import the self-mounting toast module and emit it.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

const STORE = `
    store Cart {
      state {
        lines: string[]
        count: int = 0
      }
      action add(sku: string) { lines += sku  count += 1 }
    }`;

async function files(framework: "vue" | "angular", uiBody: string): Promise<Map<string, string>> {
  return generateSystemFiles(`
    system Demo {
      subdomain S { context C { } }
      ui Web { framework: ${framework} ${uiBody} }
      deployable api { platform: node, contexts: [C], port: 3000 }
      deployable web { platform: ${framework}, targets: api, ui: Web, port: 3001 }
    }
  `);
}

const PAGE = `
      ${STORE}
      page P {
        route: "/p"
        derived itemCount: int = Cart.count
        derived doubled: int = itemCount * 2
        action save() { toast("Draft saved") }
        body: Stack { Heading { itemCount, level: 1 }, Heading { doubled, level: 2 }, Button { "Save", onClick: save } }
      }`;

describe("Vue `derived` reading a store field (F1)", () => {
  it("dereferences the store member's ComputedRef in script position", async () => {
    const page = (await files("vue", PAGE)).get("web/src/pages/p.vue")!;
    expect(page).toContain("const count = computed(() => cart.state.count);");
    expect(page).toContain("const itemCount = computed(() => count.value);");
    expect(page).toContain("const doubled = computed(() => (itemCount.value * 2));");
  });

  it("dereferences the store-qualified local when a derived takes the member's name", async () => {
    const page = (
      await files(
        "vue",
        `${STORE}
        page P {
          route: "/p"
          derived count: int = Cart.count
          body: Stack { Heading { count, level: 1 } }
        }`,
      )
    ).get("web/src/pages/p.vue")!;
    expect(page).toContain("const cartCount = computed(() => cart.state.count);");
    expect(page).toContain("const count = computed(() => cartCount.value);");
  });

  it("does the same from a COMPONENT derived", async () => {
    const comp = (
      await files(
        "vue",
        `${STORE}
        component CartBadge() {
          derived itemCount: int = Cart.count
          body: Stack { Heading { itemCount, level: 3 } }
        }
        page P { route: "/p" body: CartBadge() }`,
      )
    ).get("web/src/components/CartBadge.vue")!;
    expect(comp).toContain("const itemCount = computed(() => count.value);");
  });

  it("imports and emits the toast module beside the store-derived page", async () => {
    const out = await files("vue", PAGE);
    const page = out.get("web/src/pages/p.vue")!;
    expect(page).toMatch(/import \{ pushToast as toast \} from "\.\.\/lib\/toast";/);
    expect(page).toContain('const save = () => { toast("Draft saved"); };');
    expect(out.get("web/src/lib/toast.ts")).toBeDefined();
  });
});

describe("Angular store-derived page + toast (F1)", () => {
  it("reads the store signal and imports the toast module", async () => {
    const out = await files("angular", PAGE);
    const page = [...out.entries()].find(([k]) => k.endsWith("/pages/p.component.ts"))?.[1];
    expect(page).toBeDefined();
    expect(page).toContain("readonly itemCount = computed(() => this.cart.count());");
    expect(page).toContain('import { toast } from "../../lib/toast";');
    expect(page).toContain('save() { toast("Draft saved"); }');
    expect(out.get("web/src/lib/toast.ts")).toContain("export function toast");
  });
});
