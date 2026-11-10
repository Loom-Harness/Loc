// Pure tests for the ICU subset parser, the translation validator, the
// pseudo-locale and the XLIFF / PO exchange formats.

import { describe, expect, it } from "vitest";
import {
  contextNotes,
  type ExchangeUnit,
  parsePo,
  parseXliff,
  renderPo,
  renderXliff,
} from "../../src/i18n/exchange.js";
import {
  describeIssue,
  IcuSyntaxError,
  parseIcu,
  placeholdersOf,
  printIcu,
  validateTranslation,
} from "../../src/i18n/icu.js";
import { pseudoLocalize } from "../../src/i18n/pseudo.js";

describe("parseIcu", () => {
  it("reads plain text, simple holes, typed holes and apostrophe quoting", () => {
    expect(placeholdersOf(parseIcu("Order {id}"))).toEqual(new Set(["id"]));
    expect(placeholdersOf(parseIcu("{total, number, ::currency/EUR} for {who}"))).toEqual(
      new Set(["total", "who"]),
    );
    // '{' is a literal brace, '' a literal apostrophe: no placeholder, no error.
    expect(placeholdersOf(parseIcu("Use '{name}' and don''t"))).toEqual(new Set());
  });

  it("reads nested plural / select with # and exact-value selectors", () => {
    const msg = "{n, plural, =0 {none} one {# item by {who}} other {# items}}";
    expect(placeholdersOf(parseIcu(msg))).toEqual(new Set(["n", "who"]));
    expect(printIcu(parseIcu(msg))).toBe(msg);
  });

  it.each([
    ["Order {id", "after {id"],
    ["Order id}", "unmatched"],
    ["{}", "argument name"],
    ["{n, plural, one {x}}", '"other"'],
    ["{g, select, a {x}}", '"other"'],
    ["{n, plural, few {x} few {y} other {z}}", "duplicate"],
    ["{n, plural, sometimes {x} other {y}}", "not a plural selector"],
    ["{n, plural}", 'after "plural"'],
  ])("rejects %j", (message, fragment) => {
    expect(() => parseIcu(message)).toThrow(IcuSyntaxError);
    expect(() => parseIcu(message)).toThrow(new RegExp(fragment));
  });
});

describe("validateTranslation", () => {
  it("accepts a sound translation", () => {
    expect(validateTranslation("Order {id}", "Commande {id}", "fr")).toEqual([]);
    // Reordering holes is fine.
    expect(validateTranslation("{a} then {b}", "{b} puis {a}", "fr")).toEqual([]);
  });

  it("a translator renaming {name} to {nombre} is caught both ways", () => {
    const issues = validateTranslation("Hello {name}", "Hola {nombre}", "es");
    expect(issues).toContainEqual({ kind: "missing-placeholder", name: "name" });
    expect(issues).toContainEqual({ kind: "unexpected-placeholder", name: "nombre" });
    expect(issues.map(describeIssue).join("\n")).toContain("{name} from the source is missing");
  });

  it("a dropped placeholder is caught", () => {
    expect(validateTranslation("Hello {name}", "Hola", "es")).toEqual([
      { kind: "missing-placeholder", name: "name" },
    ]);
  });

  it("broken ICU is a syntax issue", () => {
    const [issue] = validateTranslation("Hello {name}", "Hola {name", "es");
    expect(issue?.kind).toBe("syntax");
  });

  it("requires every plural form the locale uses (Polish: one few many other)", () => {
    const source = "{count, plural, one {# task} other {# tasks}}";
    const incomplete = "{count, plural, one {# zadanie} other {# zadania}}";
    const issues = validateTranslation(source, incomplete, "pl");
    const valid = ["one", "few", "many", "other"];
    expect(issues).toEqual([
      { kind: "plural-missing-form", arg: "count", form: "few", valid },
      { kind: "plural-missing-form", arg: "count", form: "many", valid },
    ]);
    const complete =
      "{count, plural, one {# zadanie} few {# zadania} many {# zadań} other {# zadania}}";
    expect(validateTranslation(source, complete, "pl")).toEqual([]);
  });

  it("rejects a plural form the locale lacks (English has no 'few')", () => {
    const msg = "{count, plural, one {#} few {#} other {#}}";
    expect(validateTranslation(msg, msg, "en")).toEqual([
      { kind: "plural-extra-form", arg: "count", form: "few", valid: ["one", "other"] },
    ]);
  });

  it("names the locale's valid set when a form is wrong (Russian: one few many other)", () => {
    const source = "{count, plural, one {# task} other {# tasks}}";
    const [issue, ...rest] = validateTranslation(
      source,
      "{count, plural, one {# задача} two {# задачи} few {# задачи} many {# задач} other {# задачи}}",
      "ru",
    );
    expect(rest).toEqual([]);
    expect(describeIssue(issue!)).toBe(
      'plural {count} has a "two" form this locale does not use (it uses one, few, many, other)',
    );
    expect(
      validateTranslation(
        source,
        "{count, plural, one {# задача} few {# задачи} many {# задач} other {# задачи}}",
        "ru",
      ),
    ).toEqual([]);
  });

  it("judges selectordinal by the locale's ORDINAL categories", () => {
    const source = "{n, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}";
    expect(validateTranslation(source, source, "en")).toEqual([]);
    // Russian ordinals have one category; its cardinal one/few/many are wrong here.
    expect(
      validateTranslation(source, "{n, selectordinal, one {#-й} other {#-й}}", "ru").map(
        describeIssue,
      ),
    ).toEqual(['plural {n} has a "one" form this locale does not use (it uses other)']);
  });

  it("a translation without `other` is an error", () => {
    const [issue] = validateTranslation(
      "{count, plural, one {# task} other {# tasks}}",
      "{count, plural, one {# zadanie} few {# zadania} many {# zadań}}",
      "pl",
    );
    expect(issue?.kind).toBe("syntax");
    expect(describeIssue(issue!)).toContain('missing the required "other" branch');
  });

  it("a language with a single form needs only 'other' (Japanese)", () => {
    expect(
      validateTranslation(
        "{count, plural, one {# task} other {# tasks}}",
        "{count, plural, other {#件}}",
        "ja",
      ),
    ).toEqual([]);
  });

  it("exact =N selectors never count as a CLDR form", () => {
    expect(
      validateTranslation(
        "{n, plural, =0 {none} one {#} other {#}}",
        "{n, plural, =0 {aucun} one {#} many {#} other {#}}",
        "fr",
      ),
    ).toEqual([]);
  });
});

describe("pseudoLocalize (en-XA)", () => {
  it("accents, pads and brackets plain text", () => {
    const out = pseudoLocalize("Welcome");
    expect(out.startsWith("[")).toBe(true);
    expect(out.endsWith("]")).toBe(true);
    expect(out).not.toMatch(/[A-Za-z]{3}/); // no run of plain ASCII letters survives
    expect(out.length).toBeGreaterThan("Welcome".length + 4);
  });

  it("keeps ICU structure and placeholders intact", () => {
    const src = "{n, plural, one {# item for {who}} other {# items for {who}}}";
    const out = pseudoLocalize(src);
    expect(validateTranslation(src, out, "en")).toEqual([]);
    expect(placeholdersOf(parseIcu(out))).toEqual(new Set(["n", "who"]));
  });

  it("round-trips quoted braces and apostrophes", () => {
    const out = pseudoLocalize("Use '{x}' don''t {name}");
    expect(validateTranslation("Use '{x}' don''t {name}", out, "en")).toEqual([]);
  });

  it("leaves a message that is not valid ICU alone", () => {
    expect(pseudoLocalize("broken {")).toBe("broken {");
  });
});

describe("exchange formats", () => {
  const units: ExchangeUnit[] = [
    {
      key: "WebApp.page.Home.heading.k2f9aa",
      namespace: "WebApp",
      source: 'Welcome <b> & "friends"',
      target: 'Willkommen <b> & "Freunde"',
      state: "translated",
      notes: contextNotes("WebApp.page.Home.heading.k2f9aa", "WebApp", 'Welcome <b> & "friends"'),
    },
    {
      key: "WebApp.page.Home.text.aaaaaa",
      namespace: "WebApp",
      source: "Orders\nline two",
      target: "Bestellungen\nZeile zwei",
      state: "needs-review",
      notes: ["family: page"],
      previousSource: "Order list",
      previousTranslation: "Bestellliste",
    },
    {
      key: "chrome.notFound",
      namespace: "_chrome",
      source: "Not found",
      state: "new",
      notes: contextNotes("chrome.notFound", "_chrome", "Not found"),
    },
  ];

  it("contextNotes names family, page, slot and key", () => {
    const notes = contextNotes("WebApp.page.Home.heading.k2f9aa", "WebApp", "Welcome");
    expect(notes).toEqual(
      expect.arrayContaining([
        "family: page",
        "namespace: WebApp",
        "page: Home",
        "slot: heading",
        "key: WebApp.page.Home.heading.k2f9aa",
      ]),
    );
  });

  it("XLIFF round-trips target, state and previous source; untranslated has no target", () => {
    const xml = renderXliff(units, { sourceLocale: "en", targetLocale: "de" });
    expect(xml).toContain('target-language="de"');
    expect(xml).toContain("Welcome &lt;b&gt; &amp; &quot;friends&quot;");
    const parsed = parseXliff(xml);
    expect(parsed.locale).toBe("de");
    expect(parsed.units).toEqual([
      { key: "WebApp.page.Home.heading.k2f9aa", target: units[0]!.target, state: "translated" },
      {
        key: "WebApp.page.Home.text.aaaaaa",
        target: "Bestellungen\nZeile zwei",
        state: "needs-review",
        previousSource: "Order list",
      },
    ]);
  });

  it("PO round-trips with msgctxt as the key, fuzzy as needs-review, empty msgstr as new", () => {
    const po = renderPo(units, { targetLocale: "de" });
    expect(po).toContain('msgctxt "WebApp.page.Home.heading.k2f9aa"');
    expect(po).toContain("#, fuzzy");
    expect(po).toContain('#| msgid "Order list"');
    const parsed = parsePo(po);
    expect(parsed.locale).toBe("de");
    expect(parsed.units).toEqual([
      { key: "WebApp.page.Home.heading.k2f9aa", target: units[0]!.target, state: "translated" },
      {
        key: "WebApp.page.Home.text.aaaaaa",
        target: "Bestellungen\nZeile zwei",
        state: "needs-review",
        previousSource: "Order list",
      },
      { key: "chrome.notFound", target: "", state: "new" },
    ]);
  });

  it("PO accepts the wrapped multi-line strings a TMS writes", () => {
    const po = [
      'msgid ""',
      'msgstr ""',
      '"Language: fr\\n"',
      "",
      'msgctxt "k.a"',
      'msgid "x"',
      'msgstr ""',
      '"Bon"',
      '"jour"',
      "",
    ].join("\n");
    expect(parsePo(po)).toEqual({
      locale: "fr",
      units: [{ key: "k.a", target: "Bonjour", state: "translated" }],
    });
  });
});
