// A rule's `.ddd` source expression never reaches a response (#4450).
//
// An UNNAMED invariant / field check / precondition answers a generic message
// (`ruleText`, src/generator/_i18n/rule-text.ts); a NAMED one its own text.
// Neither may carry the predicate's source — it is the model's internals, not
// a sentence a user can act on, and it leaks the DSL into every 422.
//
// The census: generate every backend for one system whose rules have
// distinctive predicates, and grep every emitted source file for the predicate
// text as written in the `.ddd` INSIDE A STRING LITERAL — the only place a
// message can carry it (the predicate itself is rendered as code, and a
// params-only one reads exactly like its source).  The `.loom/` artefacts (wire
// spec, traceability) are build-time metadata, not responses, and are excluded.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

/** Predicates spelled as the `.ddd` writes them — the needles. */
const SOURCES = [
  // unnamed cross-field invariant (domain floor + wire refine)
  "reserve <= stock * 2",
  // unnamed cross-field precondition over a param and state
  "qty + reserve <= stock",
  // unnamed precondition over params only (the wire rung)
  "qty < limit * 3",
  // unnamed value-object invariant
  "low <= high + 0",
  // unnamed workflow / handler precondition
  "amount + 1 > floor",
];

/** A one-line double-quoted, single-quoted or backtick string literal. */
const STRING_LITERAL = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`[^`\n]*`/g;

const system = (platform: string): string => `
system S {
  subdomain D {
    context Shop {
      valueobject Range {
        low: int
        high: int
        invariant low <= high + 0
      }
      aggregate Item with crudish {
        stock: int
        reserve: int
        band: Range
        invariant reserve <= stock * 2
        invariant positiveStock: stock >= 0
        operation take(qty: int, limit: int) {
          precondition qty + reserve <= stock
          precondition qty < limit * 3
          stock := stock - qty
        }
      }
      repository Items for Item
      commandHandler Bump(amount: int, floor: int): int {
        precondition amount + 1 > floor
        return amount
      }
    }
  }
  api ShopApi from D
  storage primary { type: postgres }
  resource shopState { for: Shop, kind: state, use: primary }
  deployable app { platform: ${platform}, contexts: [Shop], dataSources: [shopState], serves: ShopApi, port: 8080 }
}
`;

describe("no backend response carries a rule's source expression", () => {
  for (const platform of ["node", "dotnet", "java", "python", "elixir"]) {
    it(platform, async () => {
      const files = await generateSystemFiles(system(platform));
      const leaks: string[] = [];
      for (const [file, content] of files) {
        if (file.startsWith(".loom/")) continue;
        content.split("\n").forEach((line, i) => {
          for (const lit of line.match(STRING_LITERAL) ?? []) {
            for (const src of SOURCES)
              if (lit.includes(src)) leaks.push(`${file}:${i + 1}: ${lit}`);
          }
        });
      }
      expect(leaks).toEqual([]);
      // The census reached the rules: the generic text and the named key are
      // both emitted, so an empty `leaks` is not a vacuous pass.
      const all = [...files.values()].join("\n");
      expect(all).toContain("Business rule violated");
      expect(all).toContain("Shop.Item.rule.positiveStock");
    });
  }
});
