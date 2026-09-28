// `WALKER_PRIMITIVE_ARG_VALUES` (src/util/walker-primitive-arg-values.ts) is
// the closed vocabulary `loom.page-primitive-unknown-arg-value` enforces.  A
// hand-listed table that a gate rejects source against is only trustworthy if
// it cannot drift from what the targets actually render, so every row is
// pinned against BOTH rendering families:
//
//   1. THE HEEX PACKS.  `core-components.heex.hbs` declares the same
//      vocabulary as a Phoenix `attr :<arg>, :string, values: [...]`
//      constraint — a compile-time check on that target.  A row must EQUAL
//      that list (modulo the `nil` default), so the DSL gate and the Phoenix
//      compiler cannot disagree about the same value.
//   2. THE JSX / SFC PACKS.  Every `(eq <arg> "…")` literal in every
//      `primitive-<name>.hbs` must be a MEMBER of the row.  A pack branching
//      on a value the gate now rejects would be dead code that a reader would
//      reasonably take as support.
//
// The reverse of (2) is deliberately NOT pinned: a row value no pack branches
// on is the legitimate "falls to the `{{else}}` arm" case — `ghost` IS that
// arm, and it is precisely the value an unrecognised one used to become.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  WALKER_PRIMITIVE_ARG_VALUES,
  walkerPrimitiveArgValues,
} from "../../../src/util/walker-primitive-arg-values.js";
import { WALKER_PRIMITIVE_NAMED_ARGS } from "../../../src/util/walker-primitive-args.js";
import { isWalkerPrimitive } from "../../../src/util/walker-primitive-names.js";

const DESIGNS = join(import.meta.dirname, "..", "..", "..", "designs");

/** `Button` → `primitive-button`; `EnumBadge` → `primitive-enum-badge`. */
const templateStem = (primitive: string) =>
  `primitive-${primitive.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase()}`;

/** The HEEx function component that declares each row's `attr … values:`
 *  constraint, or `null` where HEEx does not model that argument at all.
 *
 *  Explicit per ROW rather than per primitive, and `null` rather than absent,
 *  so both directions stay pinned: a row claiming a HEEx authority must find
 *  one, and a row claiming there is none must find none.  A HEEx declaration
 *  quietly deleted would otherwise just stop being compared. */
const HEEX_COMPONENT: Record<string, string | null> = {
  "Button.variant": "button",
  "Card.variant": "card",
  // `<.button>` passes `to`/`disabled`/`type`/`variant` through and nothing
  // else — icon placement is not part of the HEEx button's surface, so this
  // row rests on the JSX pin below alone.  Its vocabulary is no less closed:
  // the emitter defaults to `right` and every template branches only on
  // `left`, so any third value renders right with nothing said.
  "Button.iconPosition": null,
};

/** Every `<pack>/<version>` directory under `designs/`. */
function packDirs(): string[] {
  const out: string[] = [];
  for (const family of readdirSync(DESIGNS, { withFileTypes: true })) {
    if (!family.isDirectory()) continue;
    for (const version of readdirSync(join(DESIGNS, family.name), { withFileTypes: true })) {
      if (version.isDirectory()) out.push(join(DESIGNS, family.name, version.name));
    }
  }
  return out;
}

const rows = Object.keys(WALKER_PRIMITIVE_ARG_VALUES).map((key) => {
  const [primitive, arg] = key.split(".") as [string, string];
  return { key, primitive, arg, values: WALKER_PRIMITIVE_ARG_VALUES[key] as readonly string[] };
});

describe("walker primitive argument VALUE vocabulary", () => {
  it("has rows to check (a table that emptied itself would pass everything below)", () => {
    expect(rows.length).toBeGreaterThan(0);
  });

  describe.each(rows)("$key", ({ primitive, arg, values }) => {
    it("names a real primitive and one of its accepted arguments", () => {
      expect(isWalkerPrimitive(primitive)).toBe(true);
      expect(WALKER_PRIMITIVE_NAMED_ARGS[primitive] ?? []).toContain(arg);
    });

    it("is sorted and duplicate-free", () => {
      expect(values).toEqual([...new Set(values)].sort());
    });

    it("matches the HEEx pack's `attr … values:` constraint exactly", () => {
      const key = `${primitive}.${arg}`;
      expect(key in HEEX_COMPONENT, `${key} has no HEEx disposition recorded`).toBe(true);
      const component = HEEX_COMPONENT[key];
      let checked = 0;
      for (const dir of packDirs()) {
        const file = join(dir, "core-components.heex.hbs");
        let src: string;
        try {
          src = readFileSync(file, "utf8");
        } catch {
          continue; // a JSX pack — it has no core-components module
        }
        // The `attr` declarations immediately preceding `def <component>(assigns)`.
        if (component === null) {
          // The row claims HEEx does not model this argument — hold it to that.
          expect(
            src,
            `${file} DOES declare an \`attr :${arg}\`, so ${key} has a HEEx authority now`,
          ).not.toMatch(new RegExp(`attr :${arg},`));
          checked++;
          continue;
        }
        const at = src.indexOf(`def ${component}(assigns)`);
        expect(at, `${file} declares no \`${component}\` component`).toBeGreaterThan(-1);
        const region = src.slice(0, at);
        const decl = [
          ...region.matchAll(
            new RegExp(`attr :${arg}, :string[^\\n]*values: \\[([^\\]]*)\\]`, "g"),
          ),
        ].pop();
        expect(decl, `${file}: \`${component}\` declares no \`values:\` for :${arg}`).toBeDefined();
        const declared = [...(decl as RegExpMatchArray)[1].matchAll(/"([^"]*)"/g)]
          .map((m) => m[1] as string)
          .sort();
        expect(declared, `${file} disagrees with the ${primitive}.${arg} row`).toEqual([...values]);
        checked++;
      }
      // A pin that found no pack to compare against proves nothing.
      expect(checked, "no HEEx pack was actually compared").toBeGreaterThan(0);
    });

    it("covers every value the JSX/SFC packs branch on", () => {
      const stem = templateStem(primitive);
      const offenders: string[] = [];
      let checked = 0;
      for (const dir of packDirs()) {
        let src: string;
        try {
          src = readFileSync(join(dir, `${stem}.hbs`), "utf8");
        } catch {
          continue; // a HEEx pack, or a pack that does not template this primitive
        }
        checked++;
        for (const m of src.matchAll(new RegExp(`\\(eq ${arg} "([^"]*)"\\)`, "g"))) {
          const value = m[1] as string;
          if (!values.includes(value)) offenders.push(`${dir}/${stem}.hbs: "${value}"`);
        }
      }
      expect(checked, `no pack templates ${stem}.hbs`).toBeGreaterThan(0);
      expect(offenders).toEqual([]);
    });
  });

  it("leaves an unlisted argument's vocabulary open", () => {
    // `label:` is a free string on the same primitive whose `variant:` is
    // closed — the gate is opt-in per ARGUMENT, not per primitive.
    expect(walkerPrimitiveArgValues("Button", "label")).toBeUndefined();
    expect(walkerPrimitiveArgValues("Card", "shadow")).toBeUndefined();
  });
});
