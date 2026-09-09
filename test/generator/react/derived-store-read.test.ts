// A page/component `derived` that reads a STORE field (F9 of the 2026-09-03
// language-docs audit, packet W1.2 / M-T1.28).
//
// `store Cart persist: local { state { count: int = 0 } }` +
// `derived itemCount: int = Cart.count` used to emit
//
//     const itemCount = useMemo(() => count, []);
//
// with `count` declared nowhere: the derived's walk context carried no
// `usedStores` map, so `recordStoreUse` no-oped and the shell never hoisted the
// selector binding.  TS2304 in the generated project — and invisible whenever
// the BODY happened to read the same member, which is why every store test
// passed over it.
//
// The binding region is ordered `store.decls` → `stateLines` → … →
// `derivedLines`, so the selector `const` is already above the memo; the fix is
// only that the derived records into the same map.

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

async function reactFiles(uiBody: string): Promise<Map<string, string>> {
  return generateSystemFiles(`
    system Demo {
      subdomain S { context C { } }
      ui Web { ${uiBody} }
      deployable api { platform: node, contexts: [C], port: 3000 }
      deployable web { platform: react, targets: api, ui: Web, port: 3001 }
    }
  `);
}

/** Index of the first line matching `re`, or -1. */
function lineOf(src: string, re: RegExp): number {
  return src.split("\n").findIndex((l) => re.test(l));
}

describe("React `derived` reading a store field", () => {
  it("hoists the selector binding for a store member only a derived reads", async () => {
    const tsx = (
      await reactFiles(`
      ${STORE}
      page P {
        route: "/p"
        derived itemCount: int = Cart.count
        body: Stack { Heading { itemCount, level: 1 } }
      }
    `)
    ).get("web/src/pages/p.tsx")!;
    // The store hook + the selector binding for the member the DERIVED reads —
    // no body slot mentions `Cart.count` at all.
    expect(tsx).toContain('import { useCart } from "../stores/cart";');
    expect(tsx).toContain("const count = useCart((s) => s.count);");
    // The memo reads that binding and depends on it (a Zustand selector returns
    // a fresh value when the cell changes; an empty dep array goes stale).
    expect(tsx).toContain("const itemCount = useMemo(() => count, [count]);");
    // …and the binding is ABOVE the memo — `const` is not hoisted in TS.
    expect(lineOf(tsx, /const count = useCart/)).toBeLessThan(
      lineOf(tsx, /const itemCount = useMemo/),
    );
  });

  it("renames the derived without renaming what it reads (drop, not shadowing)", async () => {
    // The register's own discriminator: if the receiver were merely shadowed,
    // renaming the derived would change the emitted identifier.  It did not —
    // `count` was the dropped store member, and stayed undeclared.
    const tsx = (
      await reactFiles(`
      ${STORE}
      page P {
        route: "/p"
        derived count: int = Cart.count
        body: Stack { Heading { count, level: 1 } }
      }
    `)
    ).get("web/src/pages/p.tsx")!;
    // The derived is itself named `count`, so the store local is qualified —
    // `storeLocalFor` and the shell's `renderStoreWiring` reserve the same
    // names, so both sides say `cartCount`.
    expect(tsx).toContain("const cartCount = useCart((s) => s.count);");
    expect(tsx).toContain("const count = useMemo(() => cartCount, [cartCount]);");
  });

  it("agrees on the local name when the store member collides with a LATER derived", async () => {
    const tsx = (
      await reactFiles(`
      ${STORE}
      page P {
        route: "/p"
        derived total: int = Cart.count
        derived count: int = 7
        body: Stack { Heading { total, level: 1 }, Heading { count, level: 2 } }
      }
    `)
    ).get("web/src/pages/p.tsx")!;
    // `count` is a derived declared LATER, so the store member binds qualified.
    // The use site inside the earlier derived must say the same thing.
    expect(tsx).toContain("const cartCount = useCart((s) => s.count);");
    expect(tsx).toContain("const total = useMemo(() => cartCount, [cartCount]);");
    expect(tsx).not.toContain("useMemo(() => count, ");
  });

  it("wires the same read from a COMPONENT derived", async () => {
    const comp = (
      await reactFiles(`
      ${STORE}
      component CartBadge() {
        derived itemCount: int = Cart.count
        body: Stack { Heading { itemCount, level: 3 } }
      }
      page P { route: "/p" body: CartBadge() }
    `)
    ).get("web/src/components/CartBadge.tsx")!;
    expect(comp).toContain('import { useCart } from "../stores/cart";');
    expect(comp).toContain("const count = useCart((s) => s.count);");
    expect(comp).toContain("const itemCount = useMemo(() => count, [count]);");
    expect(lineOf(comp, /const count = useCart/)).toBeLessThan(
      lineOf(comp, /const itemCount = useMemo/),
    );
  });

  it("leaves a derived over page state byte-identical (no store, no new deps)", async () => {
    const tsx = (
      await reactFiles(`
      ${STORE}
      page P {
        route: "/p"
        state { n: int = 1 }
        derived twice: int = n + n
        body: Stack { Heading { twice, level: 1 } }
      }
    `)
    ).get("web/src/pages/p.tsx")!;
    expect(tsx).toContain("const twice = useMemo(() => (n + n), [n]);");
    expect(tsx).not.toContain("useCart");
  });
});
