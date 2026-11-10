// `Money { …, format: "locale" }` — the opt-in locale-formatted display — is
// emitted on every frontend that formats money, refused on the one that cannot,
// and absent (byte-for-byte the verbatim contract) when not asked for.
//
// The runtime semantics (precision, locales) are pinned in
// `money-format.test.ts` over the shared `moneyText`; this file pins that each
// target's EMISSION routes the argument to its own implementation.

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../../src/ir/lower/lower.js";
import { validateLoomModel } from "../../../src/ir/validate/validate.js";
import { generateSystemFiles, parseValid } from "../../_helpers/index.js";

const MONEY_ARGS = `currency: "EUR", format: "locale"`;

function system(framework: string, money: string): string {
  const host =
    framework === "feliz" || framework === "flutter"
      ? `deployable web { platform: ${framework}, targets: api, port: 3001, ui: WebApp { Sales: api } }`
      : `deployable web { platform: static, targets: api, port: 3001, ui: WebApp { Sales: api } }`;
  return `
system W {
  subdomain Sales {
    context Orders {
      aggregate Customer with crudish { name: string  spend: money }
      repository Customers for Customer { }
    }
  }
  api SalesApi from Sales
  storage pg { type: postgres }
  resource st { for: Orders, kind: state, use: pg }
  ui WebApp {
    framework: ${framework}
    api Sales: SalesApi
    page X { route: "/x"  title: "X"  body: Stack { ${money} } }
  }
  deployable api { platform: node, contexts: [Orders], dataSources: [st], serves: SalesApi, port: 3000 }
  ${host}
}
`;
}

/** Every generated frontend source file, concatenated. */
async function emitted(framework: string, money: string): Promise<string> {
  const files = await generateSystemFiles(system(framework, money));
  return [...files.entries()]
    .filter(([k]) => /\.(tsx|ts|vue|svelte|html|fs|dart)$/.test(k))
    .map(([, v]) => v)
    .join("\n");
}

describe('Money format: "locale" — emission per target', () => {
  const withFormat = `Money { 1234.5, ${MONEY_ARGS} }`;
  const without = `Money { 1234.5, currency: "EUR" }`;

  it("react packs pass `localized` to MoneyValue, which feeds moneyText the active locale", async () => {
    const out = await emitted("react", withFormat);
    expect(out).toMatch(/<MoneyValue [^>]*currency="EUR"[^>]*localized/);
    expect(out).toMatch(/moneyText\(.*localized, localized \? getLocale\(\) : undefined\)/);
  });

  for (const framework of ["vue", "svelte", "angular"]) {
    it(`${framework} passes the positional (currency, decimals, localized) tail to formatMoney`, async () => {
      const out = await emitted(framework, withFormat);
      expect(out).toContain(`formatMoney(1234.5, "EUR", undefined, true)`);
    });
  }

  it("the bare vocabulary word (`format: locale`) means the same as the string", async () => {
    const bare = await emitted("vue", `Money { 1234.5, currency: "EUR", format: locale }`);
    expect(bare).toContain(`formatMoney(1234.5, "EUR", undefined, true)`);
  });

  it("feliz formats the digit STRING through Intl in the active locale", async () => {
    const out = await emitted("feliz", withFormat);
    expect(out).toContain("Fable.Core.JsInterop.emitJsExpr<string> (string (1234.5m)");
    expect(out).toContain("Intl.NumberFormat");
  });

  it("flutter routes through LoomMoney.display with localized: true", async () => {
    const out = await emitted("flutter", withFormat);
    expect(out).toContain(`LoomMoney.display(v, currency: "EUR", localized: true)`);
    expect(out).not.toContain("LoomMoney.toNum(1234.5)");
  });

  it("flutter's DEFAULT is the verbatim contract: no float hop, no grouping formatter", async () => {
    const files = await generateSystemFiles(system("flutter", without));
    const page = [...files.entries()].find(([k]) => k.endsWith("pages/x_page.dart"))?.[1] ?? "";
    expect(page).toContain(`LoomMoney.display(v, currency: "EUR"))(`);
    expect(page).not.toContain("NumberFormat");
    expect(page).not.toContain("LoomMoney.toNum");
  });

  it("is absent from the output when the argument is not given", async () => {
    for (const framework of ["react", "vue", "svelte", "angular", "feliz", "flutter"]) {
      const out = await emitted(framework, without);
      expect(out, framework).not.toContain("localized: true");
      expect(out, framework).not.toMatch(/"EUR", undefined, true\)/);
      expect(out, framework).not.toMatch(/<MoneyValue [^>]*localized/);
    }
  });

  it("a HEEx ui is refused with an honest diagnostic rather than silently verbatim", async () => {
    const src = `
system W {
  subdomain Sales {
    context Orders {
      aggregate Customer with crudish { name: string  spend: money }
      repository Customers for Customer { }
    }
  }
  api SalesApi from Sales
  storage pg { type: postgres }
  resource st { for: Orders, kind: state, use: pg }
  ui WebApp {
    framework: phoenixLiveView
    api Sales: SalesApi
    page X { route: "/x"  title: "X"  body: Stack { ${withFormat} } }
  }
  deployable app { platform: elixir, contexts: [Orders], dataSources: [st], serves: SalesApi, ui: WebApp { Sales: app }, port: 4000 }
}
`;
    const diags = validateLoomModel(enrichLoomModel(lowerModel(await parseValid(src))));
    const refusals = diags.filter((d) => d.code === "loom.target-unsupported");
    expect(refusals).toHaveLength(1);
    expect(refusals[0]?.message).toContain('format: "locale"');
    expect(refusals[0]?.message).toContain("phoenixLiveView");

    // Without the argument the same page validates clean of that refusal.
    const clean = validateLoomModel(
      enrichLoomModel(lowerModel(await parseValid(src.replace(`, format: "locale"`, "")))),
    );
    expect(clean.filter((d) => d.code === "loom.target-unsupported")).toHaveLength(0);
  });
});
