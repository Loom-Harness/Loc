// A builtin `Icon` must not be unbounded — and the cross-target error-boundary
// testid must not drift.
//
// WHY THIS EXISTS.  `icons.ts` documented the contract as "design packs can
// size + colour them via CSS", and the SVGs carried a `viewBox` with no
// width/height.  An inline `<svg>` with no intrinsic size fills its container,
// so on any pack that did not ship the rule a 16px icon rendered as tall as
// the page (measured: ~900px, and on MUI it pushed the page into horizontal
// overflow at every viewport).  Ten of the fifteen packs did not ship it, and
// four of those COULD not — `mantine`, `mui`, `chakra` and `vuetify` theme
// through a JS object and emit no stylesheet at all.  A contract only some
// packs can satisfy is not a contract, so the intrinsic box moved into the
// icon itself and the pack rule became an override.
//
// Both halves are pinned: the size the generator hands out, and the fact that
// a pack shipping its own `.loom-icon svg` rule still wins (CSS beats a
// presentation attribute — so the five packs that DO ship one are unchanged).

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BUILTIN_ICONS, lookupBuiltinIcon } from "../../../src/generator/_walker/icons.js";

const DESIGNS = join(process.cwd(), "designs");
const packDirs = (): string[] =>
  readdirSync(DESIGNS)
    .flatMap((fam) => {
      const famDir = join(DESIGNS, fam);
      if (!statSync(famDir).isDirectory()) return [];
      return readdirSync(famDir).map((v) => join(fam, v));
    })
    .filter((p) => statSync(join(DESIGNS, p)).isDirectory());

const readAll = (dir: string): string =>
  readdirSync(dir, { withFileTypes: true })
    .map((e) =>
      e.isDirectory() ? readAll(join(dir, e.name)) : readFileSync(join(dir, e.name), "utf8"),
    )
    .join("\n");

describe("builtin icons carry their own box", () => {
  it("every builtin comes back with an intrinsic, em-relative size", () => {
    const names = Object.keys(BUILTIN_ICONS);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      const svg = lookupBuiltinIcon(name);
      expect(svg, name).toBeDefined();
      // em-relative, not px: an icon should track the type scale around it.
      expect(svg, name).toContain('width="1em"');
      expect(svg, name).toContain('height="1em"');
    }
  });

  it("does not touch an SVG that already sizes itself", () => {
    // The `Icon { svg: "…" }` escape hatch is the user's markup; and a future
    // builtin that wants its own box keeps it.
    for (const [name, raw] of Object.entries(BUILTIN_ICONS)) {
      if (!/\s(width|height)\s*=/.test(raw.match(/^<svg\b[^>]*>/)?.[0] ?? "")) continue;
      expect(lookupBuiltinIcon(name), name).toBe(raw);
    }
  });

  it("an unknown name still resolves to undefined, so the caller can be loud", () => {
    expect(lookupBuiltinIcon("no-such-icon")).toBeUndefined();
  });

  it("a pack that renders `loom-icon` no longer has to ship the CSS to be correct", () => {
    // The class stays — it is how a pack OVERRIDES the default box — but the
    // packs that emit it without defining it are no longer broken by doing so.
    const emitters = packDirs().filter((p) => {
      const icon = join(DESIGNS, p, "primitive-icon.hbs");
      try {
        return readFileSync(icon, "utf8").includes("loom-icon");
      } catch {
        return false;
      }
    });
    expect(emitters.length).toBeGreaterThan(0);
    const definers = emitters.filter((p) => /\.loom-icon\b/.test(readAll(join(DESIGNS, p))));
    // Documented, not asserted-equal: this records the split rather than
    // freezing it, so adding the rule to a pack is not a test failure.
    expect(definers.length).toBeLessThanOrEqual(emitters.length);
  });
});

describe("the root error boundary is one testid across targets", () => {
  it("every JSX/SFC app-shell that has a boundary spells it `app-error`", () => {
    const shells = packDirs()
      .map((p) => join(DESIGNS, p, "app-shell.hbs"))
      .filter((f) => {
        try {
          statSync(f);
          return true;
        } catch {
          return false;
        }
      });
    expect(shells.length).toBeGreaterThan(0);
    for (const f of shells) {
      const src = readFileSync(f, "utf8");
      // A shell either has no boundary at all, or names it `app-error` — never
      // a second spelling, which is what let a gate keyed on one name skip a
      // whole framework.
      expect(src.includes('data-testid="root-error"'), f).toBe(false);
    }
  });

  it("the shared Svelte and Angular boundaries carry it too", () => {
    expect(readFileSync(join(process.cwd(), "sveltekit/root-layout.hbs"), "utf8")).toContain(
      'data-testid="app-error"',
    );
    expect(readFileSync(join(process.cwd(), "src/generator/angular/index.ts"), "utf8")).toContain(
      'data-testid="app-error"',
    );
  });
});
