// Every persistence adapter applies the shared migration chain, which routes a
// context's tables into its binding's Postgres schema (`snake(<context>)` by
// default).  Dapper and MikroORM name their tables unqualified and reach them
// through the connection's `search_path`: a `schema:` is honoured, a
// `tablePrefix:` (a rename their SQL never applies) is refused.

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { parseString } from "../_helpers/parse.js";

/** Two deployables over ONE context; the adapters are the only variables. */
const CO_HOSTED = (writerPlatform: string, readerPlatform: string, bindingExtras = ""): string => `
system Adp3 {
  subdomain S {
    context Alpha {
      aggregate A { label: string }
      repository As for A { }
    }
  }
  api AlphaApi from S
  storage primary { type: postgres }
  resource alphaState { for: Alpha, kind: state, use: primary${bindingExtras} }
  deployable writer {
    platform: ${writerPlatform}
    contexts: [Alpha]
    dataSources: [alphaState]
    serves: AlphaApi
    port: 4000
  }
  deployable reader {
    platform: ${readerPlatform}
    contexts: [Alpha]
    dataSources: [alphaState]
    serves: AlphaApi
    port: 4100
  }
}
`;

/** One deployable; `bindingExtras` is the only variable. */
const LONE = (platform: string, bindingExtras: string): string => `
system Adp3b {
  subdomain S {
    context Alpha {
      aggregate A { label: string }
      repository As for A { }
    }
  }
  api AlphaApi from S
  storage primary { type: postgres }
  resource alphaState { for: Alpha, kind: state, use: primary${bindingExtras} }
  deployable reader {
    platform: ${platform}
    contexts: [Alpha]
    dataSources: [alphaState]
    serves: AlphaApi
    port: 4100
  }
}
`;

async function diagsFor(src: string) {
  const { model } = await parseString(src, { validate: false });
  return validateLoomModel(enrichLoomModel(lowerModel(model)));
}

const errorsWithCode = (diags: Awaited<ReturnType<typeof diagsFor>>, code: string) =>
  diags.filter((d) => d.severity === "error" && d.code === code);

const ADAPTERS = [
  ["dapper", "dotnet { persistence: dapper }", "loom.dapper-unsupported"],
  ["mikroorm", "node { persistence: mikroorm }", "loom.mikroorm-unsupported"],
] as const;

describe("the unqualified-SQL adapters vs. the dataSource's table placement", () => {
  for (const [name, platform, code] of ADAPTERS) {
    it(`${name} beside a default adapter on one context is accepted — both migrate one table`, async () => {
      const other = name === "dapper" ? "dotnet" : "node";
      expect(errorsWithCode(await diagsFor(CO_HOSTED(other, platform)), code)).toEqual([]);
    });

    it(`a lone ${name} deployable honours an explicit \`schema:\` — accepted`, async () => {
      expect(errorsWithCode(await diagsFor(LONE(platform, `, schema: "legacy"`)), code)).toEqual(
        [],
      );
    });

    it(`an explicit \`tablePrefix:\` is refused on ${name} — its tables are named unprefixed`, async () => {
      const diags = await diagsFor(LONE(platform, `, schema: "public", tablePrefix: "t_"`));
      const gate = errorsWithCode(diags, code);
      expect(gate.length, JSON.stringify(diags.map((d) => d.code))).toBe(1);
      expect(gate[0]!.message).toContain(`declares 'tablePrefix: "t_"'`);
    });
  }

  it("mikroorm beside dapper on one context is accepted — both name the same table", async () => {
    const diags = await diagsFor(
      CO_HOSTED("dotnet { persistence: dapper }", "node { persistence: mikroorm }"),
    );
    expect(errorsWithCode(diags, "loom.mikroorm-unsupported")).toEqual([]);
    expect(errorsWithCode(diags, "loom.dapper-unsupported")).toEqual([]);
  });

  it("an explicit `tablePrefix:` on the DEFAULT adapter stays accepted — it is honoured there", async () => {
    const diags = await diagsFor(LONE("dotnet", `, tablePrefix: "t_"`));
    expect(errorsWithCode(diags, "loom.dapper-unsupported")).toEqual([]);
  });
});
