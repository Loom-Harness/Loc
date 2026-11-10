// The tabulated CLDR ordinal rules a runtime without its own (Flutter's
// `package:intl`) selects `{n, selectordinal, …}` branches by: for every
// locale the generating Node knows, the prefix + cycle table must agree with
// `Intl.PluralRules({ type: "ordinal" })` far past the range it was derived
// from.

import { describe, expect, it } from "vitest";
import {
  ORDINAL_CATEGORY_LETTERS,
  ordinalLetter,
  ordinalTable,
} from "../../../src/generator/_i18n/ordinal-rules.js";

/** Every two-letter language Node's ICU has plural rules for. */
function knownLanguages(): string[] {
  const out: string[] = [];
  const a = "a".charCodeAt(0);
  for (let i = 0; i < 26; i++) {
    for (let j = 0; j < 26; j++) {
      const tag = String.fromCharCode(a + i, a + j);
      if (Intl.PluralRules.supportedLocalesOf([tag]).length > 0) out.push(tag);
    }
  }
  return out;
}

/** Numbers beyond the derivation range, including the exact values CLDR
 *  ordinal rules single out (`n = 800` in Italian) and their shifts. */
function probes(): number[] {
  const out: number[] = [];
  for (let n = 0; n < 3000; n++) out.push(n);
  for (const base of [20_000, 99_000, 123_000, 1_000_000, 987_654_321]) {
    for (let d = 0; d < 1200; d += 7) out.push(base + d);
  }
  return out;
}

describe("ordinal-rules", () => {
  const languages = knownLanguages();

  it("finds a meaningful set of languages to check", () => {
    expect(languages.length).toBeGreaterThan(100);
    expect(languages).toEqual(expect.arrayContaining(["en", "it", "cy", "sv", "ru", "ja"]));
  });

  it("agrees with Intl ordinal rules for every known language", () => {
    const n = probes();
    for (const tag of [...languages, "pt-BR", "en-GB", "zh-Hant"]) {
      const table = ordinalTable(tag);
      expect(table, tag).toBeDefined();
      const rules = new Intl.PluralRules(tag, { type: "ordinal" });
      for (const value of n) {
        const want = ORDINAL_CATEGORY_LETTERS[rules.select(value)];
        if (ordinalLetter(table!, value) !== want) {
          expect.fail(`${tag}: ordinal(${value}) is ${rules.select(value)}`);
        }
      }
    }
  });

  it("keeps the tables small", () => {
    expect(ordinalTable("en")).toEqual({ prefix: "", cycle: expect.any(String) });
    expect(ordinalTable("en")!.cycle).toHaveLength(100);
    expect(ordinalTable("ja")).toEqual({ prefix: "", cycle: "x" });
    expect(ordinalTable("ru")).toEqual({ prefix: "", cycle: "x" });
  });

  it("names English's st / nd / rd / th the CLDR way", () => {
    const en = ordinalTable("en")!;
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111].map((v) => ordinalLetter(en, v))).toEqual(
      ["o", "t", "f", "x", "x", "x", "x", "o", "t", "f", "o", "x"],
    );
  });

  it("is undefined for a locale the runtime does not know", () => {
    expect(ordinalTable("qq")).toBeUndefined();
  });
});
