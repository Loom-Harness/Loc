// Gate for D-ICU-DOMAIN-DROP-WARN (docs/decisions).
// A6 string interpolation (https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/old/plans/stdlib.md) — the backtick template
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
  // These holes sit in a `derived`, so each also draws the placement refusal
  // `loom.interp-format-in-domain` (covered below); what is judged here is the
  // suffix against the hole's type.
  const notPlacement = (errors: string[]): string[] =>
    errors.filter((e) => !e.includes("format code sits in a"));

  it("accepts a `, number` suffix on a numeric hole (int, money)", async () => {
    const { errors } = await parseString(
      wrap(`
        derived a: string = \`n {quantity, number}\`
        derived b: string = \`m {total, number, ::currency/USD}\`
        derived c: string = \`p {quantity, number, ::percent}\`
      `),
    );
    expect(notPlacement(errors)).toEqual([]);
  });

  it("accepts a `, date` / `, time` suffix on a datetime hole (lifts the datetime rejection)", async () => {
    const { errors } = await parseString(
      wrap(`
        derived d: string = \`due {dueAt, date, ::yMMMd}\`
        derived e: string = \`at {dueAt, time, short}\`
      `),
    );
    expect(notPlacement(errors)).toEqual([]);
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
    expect(notPlacement(errors)).toEqual([]);
  });

  it("accepts a `, select` suffix on a string / enum hole (slice 2)", async () => {
    const { errors } = await parseString(
      wrap(`derived x: string = \`s {customerName, select, vip {VIP} other {someone}}\``),
    );
    expect(notPlacement(errors)).toEqual([]);
  });

  it("rejects a `, plural` suffix on a non-numeric hole — loom.interp-hole-type", async () => {
    const { diagnostics } = await parseString(
      wrap(`derived x: string = \`p {customerName, plural, other {#}}\``),
    );
    expect(diagnostics.some((d) => d.code === "loom.interp-hole-type")).toBe(true);
  });

  // A branch body every runtime can render: `intl-messageformat`, Dart
  // `MessageFormat` and `Cldr.Message` all refuse a choice without `other`, and
  // the call site hands the runtime only the hole's own value.
  describe("loom.interp-format-invalid", () => {
    const CODE = "loom.interp-format-invalid";
    const invalid = async (body: string) =>
      (await parseString(wrap(body))).diagnostics
        .filter((d) => d.code === CODE)
        .map((d) => String(d.message));

    it("rejects a choice with no `other` branch", async () => {
      const [msg, ...rest] = await invalid(
        `derived a: string = \`p {quantity, plural, one {# item}}\``,
      );
      expect(rest).toEqual([]);
      expect(msg).toContain(`{quantity, plural} is missing the required "other" branch`);
    });

    it("rejects a plural selector that is no CLDR category", async () => {
      const [msg] = await invalid(
        `derived a: string = \`p {quantity, selectordinal, first {#st} other {#th}}\``,
      );
      expect(msg).toContain(`"first" is not a plural selector`);
    });

    it("rejects a branch that reads another value", async () => {
      const [msg] = await invalid(
        `derived a: string = \`p {quantity, plural, one {# for {customerName}} other {#}}\``,
      );
      expect(msg).toContain("cannot read another value ('{customerName}')");
    });

    it("accepts every well-formed plural / select / selectordinal body", async () => {
      expect(
        await invalid(`
          derived a: string = \`p {quantity, plural, =0 {none} one {# item} other {# items}}\`
          derived b: string = \`o {quantity, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}\`
          derived c: string = \`s {customerName, select, vip {VIP} other {someone}}\`
          derived d: string = \`q {quantity, plural, offset:1 one {just you} other {you and # more}}\`
        `),
      ).toEqual([]);
    });
  });

  // Ruling 178 (#5438): a format code on a hole is rendered by the translation
  // layer, which only a ui page has.  In backend domain code every backend
  // would print the bare value, so it is refused — every format kind, every
  // domain host — and the plain methods are named instead.
  describe("loom.interp-format-in-domain", () => {
    const CODE = "loom.interp-format-in-domain";
    const refused = async (body: string) =>
      (await parseString(wrap(body))).diagnostics.filter((d) => d.code === CODE);

    it("refuses every format kind in a derived, operation and function", async () => {
      const ds = await refused(`
        derived a: string = \`p {quantity, plural, one {# item} other {# items}}\`
        derived b: string = \`o {quantity, selectordinal, one {#st} other {#th}}\`
        derived c: string = \`s {customerName, select, vip {VIP} other {someone}}\`
        derived d: string = \`t {total, number, ::currency/USD}\`
        derived e: string = \`d {dueAt, date}\`
        operation greet(): string {
          return \`{quantity, plural, one {# order} other {# orders}}\`
        }
        function tag(): string = \`{customerName, select, vip {VIP} other {std}}\`
      `);
      expect(ds.map((d) => d.severity)).toEqual([1, 1, 1, 1, 1, 1, 1]); // all errors
      expect(
        ds.map((d) =>
          String(d.message)
            .match(/^This hole's '(\w+)' format code sits in a '(\w+)'/)
            ?.slice(1),
        ),
      ).toEqual([
        ["plural", "derived"],
        ["selectordinal", "derived"],
        ["select", "derived"],
        ["number", "derived"],
        ["date", "derived"],
        ["plural", "operation"],
        ["select", "function"],
      ]);
      expect(String(ds[3]!.message)).toContain(".format(2)");
    });

    it("refuses a format code in a workflow and a command handler", async () => {
      const { diagnostics } = await parseString(`
system S {
  subdomain Core { context C {
    aggregate Order with crudish { quantity: int  note: string }
    repository Orders for Order { }
    commandHandler Tag(o: Order id, n: int) {
      let x = Orders.get(o)
      let t = \`{n, number, ::integer-width/000000}\`
    }
    workflow Label {
      create(o: Order id, n: int) {
        let t = \`{n, plural, one {# order} other {# orders}}\`
      }
    }
  } }
}`);
      expect(
        diagnostics
          .filter((d) => d.code === CODE)
          .map((d) => String(d.message).match(/sits in a '(\w+)'/)?.[1]),
      ).toEqual(["handler", "workflow"]);
    });

    it("is silent on a format-less hole in domain code", async () => {
      expect(await refused(`derived c: string = \`n {quantity}\``)).toEqual([]);
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
