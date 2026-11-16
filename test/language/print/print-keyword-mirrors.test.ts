// Completeness guard for the `.ddd` printer's Platform keyword mirror and its
// design-pack bareword set (src/language/print/print-structural.ts).
//
// `PLATFORM_KEYWORDS` decides whether the printer emits a platform bare (a
// grammar keyword) or re-quotes it (the STRING alternative); it is pinned
// against the grammar's `Platform` rule.  A design pack is not a keyword: a
// bare name is a built-in family (D-REGISTRY-NAMES), so `DESIGN_BAREWORDS` is
// pinned against pack discovery and the `DesignPack` rule must hold no
// keyword at all.

import { AstUtils, GrammarAST } from "langium";
import { describe, expect, it } from "vitest";
import { DddGrammar } from "../../../src/language/generated/grammar.js";
import {
  DESIGN_BAREWORDS,
  PLATFORM_KEYWORDS,
} from "../../../src/language/print/print-structural.js";
import { BUILTIN_PACK_LATEST } from "../../../src/util/builtin-formats.js";

/** Every literal keyword alternative of a `returns string` datatype rule. */
function ruleKeywords(ruleName: string): Set<string> {
  const grammar = DddGrammar();
  const rule = grammar.rules.find((r) => r.name === ruleName);
  if (!rule) throw new Error(`grammar rule '${ruleName}' not found`);
  const ks = new Set<string>();
  for (const node of AstUtils.streamAllContents(rule)) {
    if (GrammarAST.isKeyword(node)) ks.add(node.value);
  }
  return ks;
}

describe("`.ddd` printer keyword mirrors vs the grammar", () => {
  it("PLATFORM_KEYWORDS equals the grammar's Platform keyword alternatives", () => {
    expect([...PLATFORM_KEYWORDS].sort()).toEqual([...ruleKeywords("Platform")].sort());
  });

  it("DesignPack holds no keyword; DESIGN_BAREWORDS is the built-in pack families", () => {
    expect([...ruleKeywords("DesignPack")]).toEqual([]);
    expect([...ruleKeywords("StorageType")]).toEqual([]);
    expect([...DESIGN_BAREWORDS].sort()).toEqual(Object.keys(BUILTIN_PACK_LATEST).sort());
  });
});
