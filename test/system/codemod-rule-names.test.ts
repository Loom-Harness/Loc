// #4450's codemod (`scripts/codemod-rule-names.mjs`): every `message "…"` on an
// invariant / field check / precondition becomes a named rule plus a
// `locales/en/<Ctx>.json` entry.
//
// The derivation the codemod names a rule with is the compiler's own
// (`src/util/rule-name.ts`, which the `loom.rule-message-removed` diagnostic
// quotes), and the sentences it writes to `locales/en/` are the ones the
// migrated source answers with.

import { describe, expect, it } from "vitest";
import {
  findRules,
  migrateRuleMessages,
  deriveRuleName as scriptDerive,
} from "../../scripts/codemod-rule-names.mjs";
import { deriveRuleName } from "../../src/util/rule-name.js";
import { generateSystemFiles, lspCodes, parseString } from "../_helpers/index.js";

const SRC = `system S {
subdomain D { context Shop {
  valueobject Sku {
    code: string
    // a comment with message "not a clause"
    invariant code.length >= 3 message "Code is required"
  }
  aggregate Item with crudish {
    name: string check name.length > 0 message "Name is required"
    qty: int
    invariant nameRequired: name.length < 99
    invariant qty >= 0 message "Quantity cannot be negative"
    operation take(n: int) {
      precondition n <= qty message "Name is required"
      qty := qty - n
    }
  }
  repository Items for Item
} }
}`;

describe("codemod-rule-names — the derived name", () => {
  it("agrees with the compiler's derivation on every sample", () => {
    const samples = [
      "Name is required",
      "SKU code needs at least 3 characters",
      "Required",
      "3 items at most",
      "",
      "Balance cannot exceed the ceiling",
      "A memo has at least its minimum pages",
      "is a",
    ];
    for (const s of samples) expect(scriptDerive(s), s).toBe(deriveRuleName(s));
  });

  it("is camelCase, at most four words, and never a lone word", () => {
    expect(deriveRuleName("Name is required")).toBe("nameRequired");
    expect(deriveRuleName("SKU code needs at least 3 characters")).toBe("skuCodeNeedsAt");
    expect(deriveRuleName("Required")).toBe("requiredRule");
    expect(deriveRuleName("3 items at most")).toBe("rule3ItemsAt");
  });
});

describe("codemod-rule-names — migrateRuleMessages", () => {
  it("finds every rule with its owner, context, name and clause", () => {
    const rules = findRules(SRC);
    expect(rules.map((r) => [r.owner, r.ctx, r.declared, r.message?.text])).toEqual([
      ["Sku", "Shop", undefined, "Code is required"],
      ["Item", "Shop", undefined, "Name is required"],
      ["Item", "Shop", "nameRequired", undefined],
      ["Item", "Shop", undefined, "Quantity cannot be negative"],
      ["Item", "Shop", undefined, "Name is required"],
    ]);
  });

  it("names each rule, drops the clause, dedupes per owner, and leaves comments alone", () => {
    const { text, entries, changed } = migrateRuleMessages(SRC);
    expect(changed).toBe(4);
    expect(text).toContain('// a comment with message "not a clause"');
    expect(text).toContain("invariant codeRequired: code.length >= 3\n");
    // `nameRequired` is declared in Item, so both derived ones dedupe past it.
    expect(text).toContain("name: string check nameRequired2: name.length > 0\n");
    expect(text).toContain("invariant quantityCannotNegative: qty >= 0\n");
    expect(text).toContain("precondition nameRequired3: n <= qty\n");
    // Only the commented-out one survives.
    expect(text.match(/\bmessage "/g)).toEqual(['message "']);
    expect(entries).toEqual([
      { ns: "Shop", key: "Sku.rule.codeRequired", text: "Code is required" },
      { ns: "Shop", key: "Item.rule.nameRequired2", text: "Name is required" },
      { ns: "Shop", key: "Item.rule.quantityCannotNegative", text: "Quantity cannot be negative" },
      { ns: "Shop", key: "Item.rule.nameRequired3", text: "Name is required" },
    ]);
    // Idempotent: nothing left to migrate.
    expect(migrateRuleMessages(text).changed).toBe(0);
  });

  it("produces source that validates without a removed-clause warning", async () => {
    const { text } = migrateRuleMessages(SRC);
    const { errors, diagnostics } = await parseString(text, { validate: true });
    expect(errors).toEqual([]);
    expect(lspCodes(diagnostics)).not.toContain("loom.rule-message-removed");
  });
});

describe("codemod-rule-names — the migrated source keeps every sentence", () => {
  const DEPLOYED = `system Shop {
  subdomain Sales { context Cat {
    aggregate Item with crudish {
      name: string check name.length > 0 message "Name is required"
      qty: int
      invariant qty >= 0 message "Quantity cannot be negative"
      operation take(n: int) {
        precondition n <= qty message "Not enough stock"
        qty := qty - n
      }
    }
    repository Items for Item
  } }
  api CatApi from Sales
  storage db { type: postgres }
  resource st { for: Cat, kind: state, use: db }
  deployable api { platform: node contexts: [Cat] dataSources: [st] serves: CatApi port: 8080 }
}`;

  it("the written overrides reach the generated code, and the source carries no clause", async () => {
    const { text, entries, changed } = migrateRuleMessages(DEPLOYED);
    expect(changed).toBe(3);
    expect(text).not.toMatch(/\bmessage "/);
    const overrides = new Map(entries.map((e) => [`${e.ns}.${e.key}`, e.text]));
    const emitted = [...(await generateSystemFiles(text, { sourceOverrides: overrides })).values()];
    for (const e of entries) expect(emitted.join("\n"), e.key).toContain(e.text);
  });
});
