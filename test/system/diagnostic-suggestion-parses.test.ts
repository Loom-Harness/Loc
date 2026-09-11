// A fix-it suggestion must be spelled in the language it is suggesting.
//
// Twice in one session a `loom.*` message told the reader to write something the
// grammar cannot accept:
//
//   loom.persistence-mode-unsupported  "Declare `dataSource workState { … }`"
//   loom.file-field-needs-object-storage  "declare a `dataSource <ds> { … }`"
//
// The declaration keyword is `resource`.  `dataSource` names the DEPLOYABLE's
// `dataSources:` clause and is not a declaration keyword at all, so pasting
// either suggestion verbatim produced
//
//   error: Expecting token of type '}' but found `dataSource`.
//
// which is the one thing a fix-it message must never do: send the reader from a
// real error to a fake one.  (A third instance had a different shape — the Feliz
// `design:` error listed daisyUI themes UNQUOTED when `DesignPack` is a closed
// keyword set plus `STRING`, so `design: light` is a parse error and
// `design: "light"` is not.  That one is not mechanically checkable here; it is
// noted so the next reader knows the class is wider than the rule below.)
//
// THE RULE.  Inside a backticked span that contains `{` — i.e. a block-shaped
// DSL suggestion, not prose and not an identifier — a LOWERCASE lead word must
// be a real grammar keyword.  The case split is what makes this precise rather
// than noisy: Loom's declaration keywords are lowercase (`resource`,
// `aggregate`, `storage`, `deployable`, …) while builder calls are PascalCase
// (`Stack { … }`, `OperationForm { … }`, `Order {order.id}`), which are page
// primitives or user-declared types and correctly absent from the grammar.
//
// Measured when written: across the whole catalog the rule produced exactly ONE
// hit, and it was the second real bug above. Zero false positives, so there is
// no waiver list — if you find yourself wanting one, the message is probably
// wrong.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DIAGNOSTIC_MESSAGES } from "../../src/diagnostics/messages.js";

const GRAMMAR = join(import.meta.dirname, "..", "..", "src", "language", "ddd.langium");

/** Every quoted keyword literal in the grammar — the set of words that can lead
 *  a declaration.  Read from `ddd.langium` rather than hand-listed, so a
 *  renamed keyword cannot leave this test asserting against a stale vocabulary. */
function grammarKeywords(): ReadonlySet<string> {
  const src = readFileSync(GRAMMAR, "utf8");
  return new Set([...src.matchAll(/'([A-Za-z][A-Za-z0-9_]*)'/g)].map((m) => m[1] as string));
}

/** Render every catalog entry with a Proxy standing in for its params — the
 *  same trick `diagnostic-catalog.test.ts` uses, so no per-entry fixtures. */
function renderedMessages(): { key: string; text: string }[] {
  const anyParams = new Proxy({}, { get: (_t, p) => `<${String(p)}>` });
  return Object.entries(DIAGNOSTIC_MESSAGES).map(([key, entry]) => ({
    key,
    text: typeof entry === "string" ? entry : (entry as (p: unknown) => string)(anyParams),
  }));
}

describe("a fix-it suggestion is spelled in the language it suggests", () => {
  it("every block-shaped suggestion leads with a real grammar keyword", () => {
    const keywords = grammarKeywords();
    // Guard the guard: a regex that silently matched nothing would make this
    // pass by vacuum, which is how the swallowed-fixture failures in this repo
    // have historically read as green.
    expect(keywords.size, "keywords were extracted from ddd.langium").toBeGreaterThan(100);
    expect(keywords.has("resource"), "a known declaration keyword is present").toBe(true);
    expect(keywords.has("dataSource"), "`dataSource` is NOT a declaration keyword").toBe(false);

    const offenders: string[] = [];
    let blockSpans = 0;
    for (const { key, text } of renderedMessages()) {
      for (const m of text.matchAll(/`([^`]+)`/g)) {
        const span = m[1] ?? "";
        if (!span.includes("{")) continue;
        const lead = span.trim().split(/[\s({]/)[0] ?? "";
        // PascalCase lead: a page primitive or a user-declared type, not a
        // keyword position. Anything else non-lowercase-identifier is prose.
        if (!/^[a-z][A-Za-z0-9_]*$/.test(lead)) continue;
        blockSpans++;
        if (keywords.has(lead)) continue;
        offenders.push(`${key}: \`${span.slice(0, 90)}\` — '${lead}' is not a grammar keyword`);
      }
    }
    // …and that the scan actually reached block-shaped spans at all.
    expect(blockSpans, "the scan found lowercase-led block suggestions to check").toBeGreaterThan(
      5,
    );
    expect(offenders).toEqual([]);
  });
});
