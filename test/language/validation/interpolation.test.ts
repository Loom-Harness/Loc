// A6 string interpolation (docs/old/plans/stdlib.md) — the backtick template
// `` `Order {id} for {customer.name}` ``.  Parse-level coverage: the
// two-mode lexer (interpolation coexists with ordinary block braces), and
// the hole-type gate:
//   loom.interp-hole-type — a hole must be string / stringifiable.

import { describe, expect, it } from "vitest";
import { parseString } from "../../_helpers/parse.js";

const wrap = (body: string): string => `
  context C {
    aggregate Order {
      quantity: int
      customerName: string
      total: money
      dueAt: datetime
      tags: string[]
      ${body}
    }
    repository Orders for Order { }
  }
`;

describe("validation — A6 string interpolation", () => {
  it("accepts string / number / money holes, multi-hole, plain, and empty templates", async () => {
    const { errors } = await parseString(
      wrap(`
        derived a: string = \`Order #{quantity} for {customerName}\`
        derived b: string = \`total {total}\`
        derived c: string = \`no holes here\`
        derived e: string = \`{customerName}\`
        derived f: string = \`\`
      `),
    );
    expect(errors).toEqual([]);
  });

  it("coexists with ordinary block braces — no lexer regression", async () => {
    // The surrounding aggregate / context blocks AND a `match`-adjacent body
    // all use `{ }`; a template's `{hole}` must not disturb them.
    const { errors } = await parseString(
      wrap(`
        derived label: string = \`Order {quantity}\`
        operation greet(): string {
          return \`Hi {customerName}, order {quantity}\`
        }
      `),
    );
    expect(errors).toEqual([]);
  });

  it("supports full-expression holes (arithmetic, calls, nested templates)", async () => {
    const { errors } = await parseString(
      wrap(`
        derived total2: string = \`doubled {quantity + quantity}\`
        derived tern: string = \`{quantity > 0 ? "some" : "none"}\`
        derived nested: string = \`[{\`#{quantity}\`}]\`
      `),
    );
    expect(errors).toEqual([]);
  });

  it("rejects a datetime hole (no stringification) — loom.interp-hole-type", async () => {
    const { diagnostics } = await parseString(wrap(`derived x: string = \`at {dueAt}\``));
    expect(diagnostics.some((d) => d.code === "loom.interp-hole-type")).toBe(true);
  });

  it("rejects a collection hole — loom.interp-hole-type", async () => {
    const { diagnostics } = await parseString(wrap(`derived x: string = \`tags {tags}\``));
    expect(diagnostics.some((d) => d.code === "loom.interp-hole-type")).toBe(true);
  });

  it("rejects an empty hole (parse error)", async () => {
    const { errors } = await parseString(wrap(`derived x: string = \`a {} b\``));
    expect(errors.length).toBeGreaterThan(0);
  });
});

// ICU `,format` suffix (i18n, M-T1.11) — a hole may carry `, <format>` after
// its expression.  NUMBER/CURRENCY/PERCENT + PLURAL/SELECTORDINAL require a
// numeric value; DATE/TIME lift the datetime rejection above (a datetime hole is
// exactly what they format); SELECT wants a string/enum; a genuinely unknown ICU
// argType → loom.interp-format-unknown.
describe("validation — A6 interpolation format suffix", () => {
  it("accepts a `, number` suffix on a numeric hole (int, money)", async () => {
    const { errors } = await parseString(
      wrap(`
        derived a: string = \`n {quantity, number}\`
        derived b: string = \`m {total, number, ::currency/USD}\`
        derived c: string = \`p {quantity, number, ::percent}\`
      `),
    );
    expect(errors).toEqual([]);
  });

  it("accepts a `, date` / `, time` suffix on a datetime hole (lifts the datetime rejection)", async () => {
    const { errors } = await parseString(
      wrap(`
        derived d: string = \`due {dueAt, date, ::yMMMd}\`
        derived e: string = \`at {dueAt, time, short}\`
      `),
    );
    expect(errors).toEqual([]);
  });

  it("rejects a `, number` suffix on a datetime hole — loom.interp-hole-type", async () => {
    const { diagnostics } = await parseString(wrap(`derived x: string = \`d {dueAt, number}\``));
    expect(diagnostics.some((d) => d.code === "loom.interp-hole-type")).toBe(true);
  });

  it("rejects a `, date` suffix on a numeric hole — loom.interp-hole-type", async () => {
    const { diagnostics } = await parseString(wrap(`derived x: string = \`x {quantity, date}\``));
    expect(diagnostics.some((d) => d.code === "loom.interp-hole-type")).toBe(true);
  });

  it("accepts a `, plural` / `, selectordinal` suffix on a numeric hole (slice 2)", async () => {
    const { errors } = await parseString(
      wrap(`
        derived a: string = \`p {quantity, plural, one {# item} other {# items}}\`
        derived b: string = \`o {quantity, selectordinal, one {#st} other {#th}}\`
      `),
    );
    expect(errors).toEqual([]);
  });

  it("accepts a `, select` suffix on a string / enum hole (slice 2)", async () => {
    const { errors } = await parseString(
      wrap(`derived x: string = \`s {customerName, select, vip {VIP} other {someone}}\``),
    );
    expect(errors).toEqual([]);
  });

  it("rejects a `, plural` suffix on a non-numeric hole — loom.interp-hole-type", async () => {
    const { diagnostics } = await parseString(
      wrap(`derived x: string = \`p {customerName, plural, other {#}}\``),
    );
    expect(diagnostics.some((d) => d.code === "loom.interp-hole-type")).toBe(true);
  });

  // Item 38 / ruling D8: every backend renders an `i18nFormat` hole as its
  // bare value, so a plural/select branch in domain code silently loses its
  // text (`{qty, plural, …}` → "3").  Warn where it happens; stay silent where
  // the frontend i18n runtime does render it (a page slot) and on formats that
  // carry no branch text (`number`).
  describe("loom.interp-format-dropped-in-domain (D8)", () => {
    const CODE = "loom.interp-format-dropped-in-domain";
    const dropped = async (body: string) =>
      (await parseString(wrap(body))).diagnostics.filter((d) => d.code === CODE);

    it("warns on plural / selectordinal / select holes in a derived, operation and function", async () => {
      const ds = await dropped(`
        derived a: string = \`p {quantity, plural, one {# item} other {# items}}\`
        derived b: string = \`o {quantity, selectordinal, one {#st} other {#th}}\`
        derived c: string = \`s {customerName, select, vip {VIP} other {someone}}\`
        operation greet(): string {
          return \`{quantity, plural, one {# order} other {# orders}}\`
        }
        function label(): string = \`{customerName, select, vip {VIP} other {std}}\`
      `);
      expect(ds.map((d) => d.severity)).toEqual([2, 2, 2, 2, 2]); // all warnings
      expect(
        ds.map((d) =>
          String(d.message)
            .match(/^This '(\w+)' hole sits in a '(\w+)'/)
            ?.slice(1),
        ),
      ).toEqual([
        ["plural", "derived"],
        ["selectordinal", "derived"],
        ["select", "derived"],
        ["plural", "operation"],
        ["select", "function"],
      ]);
    });

    it("is silent on a number / date format and on a format-less hole in domain code", async () => {
      const ds = await dropped(`
        derived a: string = \`t {total, number, ::currency/USD}\`
        derived b: string = \`d {dueAt, date}\`
        derived c: string = \`n {quantity}\`
      `);
      expect(ds).toEqual([]);
    });

    it("is silent on a plural hole in a ui page slot (the i18n runtime renders it)", async () => {
      const { diagnostics, errors } = await parseString(`
system S {
  subdomain Core { context C {
    aggregate Order with crudish { quantity: int }
    repository Orders for Order { }
  } }
  ui Web {
    page Home(count: int) { route: "/:count"
      body: Text { \`You have {count, plural, one {# order} other {# orders}}\` }
    }
  }
}`);
      expect(errors).toEqual([]); // the page really parsed — not a vacuous silence
      expect(diagnostics.filter((d) => d.code === CODE)).toEqual([]);
    });
  });

  it("rejects a genuinely unknown ICU format — loom.interp-format-unknown", async () => {
    const { diagnostics } = await parseString(
      wrap(`derived x: string = \`x {quantity, spellout}\``),
    );
    expect(diagnostics.some((d) => d.code === "loom.interp-format-unknown")).toBe(true);
  });
});
