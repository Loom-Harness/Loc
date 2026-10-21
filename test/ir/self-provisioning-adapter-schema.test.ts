// F2-ADP-3 — the OTHER consequence of a self-provisioning persistence adapter:
// it has no Postgres-schema concept, and until this gate that was silent.
//
// `resolveDataSourceConfig` DEFAULTS a binding's schema to `snake(<context>)`,
// so a context named `Alpha` with a bare `resource s { for: Alpha, kind: state,
// use: pg }` — no `schema:` anywhere in the source — makes every migration-chain
// adapter route its tables into `alpha`:
//
//   efcore   builder.ToTable("as", "alpha")
//   drizzle  pgSchema("alpha").table("as", …)
//   dapper   CREATE TABLE "alpha"."as" (its migration) + search_path=public,alpha
//
// while the self-provisioning adapter names them unqualified:
//
//   mikroorm @Entity({ tableName: "as" })             (→ public.as)
//
// So mikroorm beside any chain adapter is two physical tables, both deployables
// green, each reading an empty database — refused.  A LONE mikroorm deployable
// is self-consistent (it creates and reads `public.as`), but an EXPLICIT
// `schema:` / `tablePrefix:` on its binding is a request it silently drops.
//
// Dapper used to be on the mikroorm side of this line (`CREATE TABLE IF NOT
// EXISTS "as"`).  Since it applies the migration chain (M-T2.17) its tables land
// in the binding's schema and its connection's `search_path` finds them, so it
// agrees with efcore — accepted — and honours an explicit `schema:`.  What it
// still cannot do is a `tablePrefix:`: its repository SQL names every table
// unprefixed.
//
// And the exemption the mikroorm arms need: `schema: "public"`.  There the two
// namings converge on one physical table, so neither arm's claim holds.  A
// `tablePrefix:` is NOT exempt even beside `schema: "public"` — it renames the
// table rather than placing it.

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

describe("self-provisioning adapters vs. the dataSource's Postgres schema", () => {
  it("dapper beside efcore on one context is accepted — both migrate the same schema-qualified table", async () => {
    const diags = await diagsFor(CO_HOSTED("dotnet", "dotnet { persistence: dapper }"));
    expect(errorsWithCode(diags, "loom.dapper-unsupported")).toEqual([]);
  });

  it("mikroorm beside DAPPER is refused — dapper qualifies its tables now, mikroorm does not", async () => {
    const diags = await diagsFor(
      CO_HOSTED("dotnet { persistence: dapper }", "node { persistence: mikroorm }"),
    );
    const gate = errorsWithCode(diags, "loom.mikroorm-unsupported");
    expect(gate.length, JSON.stringify(diags.map((d) => d.code))).toBe(1);
    expect(gate[0]!.message).toContain("'writer' (dapper)");
    expect(errorsWithCode(diags, "loom.dapper-unsupported")).toEqual([]);
  });

  it("mikroorm beside drizzle is refused the same way — the limit is the adapter, not the platform", async () => {
    const diags = await diagsFor(CO_HOSTED("node", "node { persistence: mikroorm }"));
    const gate = errorsWithCode(diags, "loom.mikroorm-unsupported");
    expect(gate.length, JSON.stringify(diags.map((d) => d.code))).toBe(1);
    expect(gate[0]!.message).toContain("UNQUALIFIED (public)");
    expect(gate[0]!.message).toContain("persistence: drizzle");
  });

  it("two MIGRATION-CHAIN deployables over one context are fine — they agree on the schema", async () => {
    const diags = await diagsFor(CO_HOSTED("dotnet", "node"));
    expect(errorsWithCode(diags, "loom.dapper-unsupported")).toEqual([]);
    expect(errorsWithCode(diags, "loom.mikroorm-unsupported")).toEqual([]);
  });

  it("a LONE dapper deployable is fine — its migrations and its search_path name one schema", async () => {
    const diags = await diagsFor(LONE("dotnet { persistence: dapper }", ""));
    expect(errorsWithCode(diags, "loom.dapper-unsupported")).toEqual([]);
  });

  it("...and an EXPLICIT `schema:` on its binding is honoured — accepted", async () => {
    const diags = await diagsFor(LONE("dotnet { persistence: dapper }", `, schema: "legacy"`));
    expect(errorsWithCode(diags, "loom.dapper-unsupported")).toEqual([]);
  });

  it("...but the mikroorm twin still refuses an explicit `schema:` — it is dropped there", async () => {
    const diags = await diagsFor(LONE("node { persistence: mikroorm }", `, schema: "legacy"`));
    const gate = errorsWithCode(diags, "loom.mikroorm-unsupported");
    expect(gate.length, JSON.stringify(diags.map((d) => d.code))).toBe(1);
    expect(gate[0]!.message).toContain(`declares 'schema: "legacy"'`);
  });

  it("an explicit `tablePrefix:` is refused on dapper — its repositories name tables unprefixed", async () => {
    const diags = await diagsFor(LONE("dotnet { persistence: dapper }", `, tablePrefix: "t_"`));
    const gate = errorsWithCode(diags, "loom.dapper-unsupported");
    expect(gate.length, JSON.stringify(diags.map((d) => d.code))).toBe(1);
    expect(gate[0]!.message).toContain(`declares 'tablePrefix: "t_"'`);
  });

  it("an explicit schema on the DEFAULT adapter stays accepted — it is honoured there", async () => {
    const diags = await diagsFor(LONE("dotnet", `, schema: "legacy"`));
    expect(errorsWithCode(diags, "loom.dapper-unsupported")).toEqual([]);
  });

  // --- the `schema: "public"` exemption -----------------------------------
  // Both arms above describe a divergence that does not exist here: naming
  // `public` explicitly asks for exactly where an unqualified table already
  // lands, so the two adapters address ONE table.

  it("dapper beside efcore is ACCEPTED when the binding names `public` — one physical table", async () => {
    const diags = await diagsFor(
      CO_HOSTED("dotnet", "dotnet { persistence: dapper }", `, schema: "public"`),
    );
    expect(
      errorsWithCode(diags, "loom.dapper-unsupported"),
      "the split-brain message claims two DIFFERENT physical tables, and here there is one",
    ).toEqual([]);
  });

  it("the mikroorm twin is accepted too — the exemption is about the schema, not the adapter", async () => {
    const diags = await diagsFor(
      CO_HOSTED("node", "node { persistence: mikroorm }", `, schema: "public"`),
    );
    expect(errorsWithCode(diags, "loom.mikroorm-unsupported")).toEqual([]);
  });

  it("a LONE dapper deployable naming `public` is accepted — the request IS honoured", async () => {
    const diags = await diagsFor(LONE("dotnet { persistence: dapper }", `, schema: "public"`));
    expect(
      errorsWithCode(diags, "loom.dapper-unsupported"),
      "the dropped-request message says the tables 'land in public' — which is what was asked for",
    ).toEqual([]);
  });

  it('`tablePrefix:` beside `schema: "public"` is still refused, and the message names the PREFIX', async () => {
    const diags = await diagsFor(
      LONE("dotnet { persistence: dapper }", `, schema: "public", tablePrefix: "t_"`),
    );
    const gate = errorsWithCode(diags, "loom.dapper-unsupported");
    expect(gate.length, JSON.stringify(diags.map((d) => d.code))).toBe(1);
    // Quoting the exempt `schema:` clause here would point the author at the
    // one clause they are allowed to keep.
    expect(gate[0]!.message).toContain(`declares 'tablePrefix: "t_"'`);
    expect(gate[0]!.message).not.toContain(`declares 'schema: "public"'`);
  });

  it("a prefix breaks the convergence for the CO-HOSTED arm too", async () => {
    const diags = await diagsFor(
      CO_HOSTED(
        "dotnet",
        "dotnet { persistence: dapper }",
        `, schema: "public", tablePrefix: "t_"`,
      ),
    );
    expect(errorsWithCode(diags, "loom.dapper-unsupported").length).toBe(1);
  });
});
