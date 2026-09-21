// F50 (2026-09-03 language-docs audit) — the Svelte twin of react's F3/F9,
// both halves, M-T1.28 residue 2.
//
//   * `derived itemCount: int = Cart.count` emitted
//     `const itemCount = $derived(count);` with `count` declared NOWHERE:
//     `buildDerivedLines` evaluated each initialiser against a throwaway
//     context carrying no `usedStores` map, so `recordStoreUse` no-oped and
//     `renderStoreWiring` never declared the `$derived(cart.count)` local.
//     Invisible whenever the BODY happened to read the same member too, which
//     is why the existing store tests passed over it.
//
//   * `action save() { toast("Draft saved") }` emitted a bare `toast(...)`
//     call with no import.  Svelte's `src/lib/toast.svelte.ts` export is an
//     OBJECT (`{ items, success, error }`) the pack's `realtime-toast`
//     template renders, not a callable, and it is mounted only on the realtime
//     path — so the page effect gets the shared self-mounting module beside it
//     (`src/lib/toast-effect.ts`, the same bytes react emits at
//     `src/lib/toast.ts`).
//
// Both are `svelte-check` TS2304 in the generated project.

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

async function svelteFiles(uiBody: string): Promise<Map<string, string>> {
  return generateSystemFiles(`
    system Demo {
      subdomain S { context C { } }
      ui Web { framework: svelte ${uiBody} }
      deployable api { platform: node, contexts: [C], port: 3000 }
      deployable web { platform: svelte, targets: api, ui: Web, port: 3001 }
    }
  `);
}

/** Index of the first line matching `re`, or -1. */
function lineOf(src: string, re: RegExp): number {
  return src.split("\n").findIndex((l) => re.test(l));
}

describe("Svelte `derived` reading a store field (F50a)", () => {
  it("declares the store binding for a member only a derived reads", async () => {
    const page = (
      await svelteFiles(`
      ${STORE}
      page P {
        route: "/p"
        derived itemCount: int = Cart.count
        body: Stack { Heading { itemCount, level: 1 } }
      }
    `)
    ).get("web/src/routes/(app)/p/+page.svelte")!;
    expect(page).toContain('import { cart } from "$lib/stores/cart.svelte";');
    expect(page).toContain("const count = $derived(cart.count);");
    expect(page).toContain("const itemCount = $derived(count);");
    // …and above it — `const` is not hoisted.
    expect(lineOf(page, /const count = \$derived\(cart\.count\)/)).toBeLessThan(
      lineOf(page, /const itemCount = \$derived\(count\)/),
    );
  });

  it("wires the same read from a COMPONENT derived", async () => {
    const comp = (
      await svelteFiles(`
      ${STORE}
      component CartBadge() {
        derived itemCount: int = Cart.count
        body: Stack { Heading { itemCount, level: 3 } }
      }
      page P { route: "/p" body: CartBadge() }
    `)
    ).get("web/src/lib/components/CartBadge.svelte")!;
    expect(comp).toContain("const count = $derived(cart.count);");
    expect(comp).toContain("const itemCount = $derived(count);");
  });

  it("qualifies the store local when the derived takes the bare name", async () => {
    // The drop-vs-shadowing discriminator: renaming the derived to the member's
    // own name must rename the STORE local, not leave `count` undeclared.
    const page = (
      await svelteFiles(`
      ${STORE}
      page P {
        route: "/p"
        derived count: int = Cart.count
        body: Stack { Heading { count, level: 1 } }
      }
    `)
    ).get("web/src/routes/(app)/p/+page.svelte")!;
    expect(page).toContain("const cartCount = $derived(cart.count);");
    expect(page).toContain("const count = $derived(cartCount);");
  });
});

describe("Svelte `toast(<msg>)` page effect (F50b)", () => {
  it("imports the effect module for an action-body toast and emits it", async () => {
    const files = await svelteFiles(`
      page P {
        route: "/p"
        action save() { toast("Draft saved") }
        body: Stack { Button { "Save", onClick: save } }
      }
    `);
    const page = files.get("web/src/routes/(app)/p/+page.svelte")!;
    expect(page).toContain('import { toast } from "$lib/toast-effect";');
    expect(page).toContain('const save = () => { toast("Draft saved"); };');
    // The module the import resolves to is emitted, and it exports a CALLABLE
    // (the sibling `toast.svelte.ts` store export is an object).
    const mod = files.get("web/src/lib/toast-effect.ts")!;
    expect(mod).toContain("export function toast(message: unknown): void");
  });

  it("imports it for a component-body toast too", async () => {
    const files = await svelteFiles(`
      component SaveBar() {
        action save() { toast("Saved") }
        body: Stack { Button { "Save", onClick: save } }
      }
      page P { route: "/p" body: SaveBar() }
    `);
    const comp = files.get("web/src/lib/components/SaveBar.svelte")!;
    expect(comp).toContain('import { toast } from "$lib/toast-effect";');
  });

  it("emits neither the import nor the module when no body reaches the effect", async () => {
    const files = await svelteFiles(`
      page P { route: "/p" body: Stack { Heading { "hi", level: 1 } } }
    `);
    expect(files.get("web/src/routes/(app)/p/+page.svelte")!).not.toContain("toast-effect");
    expect(files.has("web/src/lib/toast-effect.ts")).toBe(false);
  });

  it("yields the name to a ui-declared extern `toast`", async () => {
    // An `extern` function named `toast` owns the symbol — the walker binds its
    // shim, so importing the effect module over it would be a redeclaration.
    const files = await svelteFiles(`
      function toast(message: string): string extern from "./toast-shim"
      page P {
        route: "/p"
        action save() { toast("Saved") }
        body: Stack { Button { "Save", onClick: save } }
      }
    `);
    const page = files.get("web/src/routes/(app)/p/+page.svelte")!;
    expect(page).not.toContain('from "$lib/toast-effect"');
    expect(page).toContain('import { toast } from "$lib/toast";');
  });
});
