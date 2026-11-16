// `loom.serves-context-unhosted` and `loom.api-no-surface`: a deployable that
// `serves:` an api must host what the api serves, and an api must declare a
// surface at all.  Before these, a deployable serving `api AApi from A` while
// hosting only subdomain B's contexts compiled `0 error(s)` and served B's
// routes; a route to an unhosted context was dropped by the router builder;
// and `api Floating` (no `from`, no `with`, no `route`) only warned.

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { parseString } from "../_helpers/parse.js";

const sys = (deployables: string, apis = "api AApi from A") => `
system S {
  subdomain A {
    context Ca {
      aggregate Foo with crudish { name: string }
      repository Foos for Foo { }
      commandHandler Echo(text: string): string { return text }
    }
    context Ca2 { aggregate Baz with crudish { name: string } repository Bazs for Baz { } }
  }
  subdomain B { context Cb { aggregate Bar with crudish { name: string } repository Bars for Bar { } } }
  ${apis}
  storage pg { type: postgres }
  resource caState { for: Ca, kind: state, use: pg }
  resource ca2State { for: Ca2, kind: state, use: pg }
  resource cbState { for: Cb, kind: state, use: pg }
  ${deployables}
}`;

async function irDiags(src: string) {
  const { model, errors } = await parseString(src);
  expect(errors).toEqual([]);
  return validateLoomModel(enrichLoomModel(lowerModel(model))).filter(
    (d) => d.code === "loom.serves-context-unhosted",
  );
}

describe("loom.serves-context-unhosted", () => {
  it("refuses a deployable serving an api whose `from` subdomain it hosts none of", async () => {
    const hits = await irDiags(
      sys(`deployable be { platform: node, contexts: [Cb], dataSources: [cbState], serves: AApi, port: 3000 }
  deployable ab { platform: node, contexts: [Ca, Ca2], dataSources: [caState, ca2State], port: 3001 }`),
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]!.severity).toBe("error");
    expect(hits[0]!.source).toBe("S/be");
    expect(hits[0]!.message).toContain("derived from subdomain 'A'");
    expect(hits[0]!.message).toContain("'Ca', 'Ca2'");
  });

  it("refuses an explicit route to a context the deployable does not host", async () => {
    const hits = await irDiags(
      sys(
        `deployable be { platform: node, contexts: [Cb], dataSources: [cbState], serves: RApi, port: 3000 }
  deployable ab { platform: node, contexts: [Ca, Ca2], dataSources: [caState, ca2State], port: 3001 }`,
        `api RApi { route POST "/echo/{text}" -> Ca.Echo }`,
      ),
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]!.message).toContain("route 'POST /echo/{text}' targets context 'Ca'");
  });

  it("allows hosting part of the subdomain: one api split across deployables", async () => {
    expect(
      await irDiags(
        sys(`deployable a1 { platform: node, contexts: [Ca], dataSources: [caState], serves: AApi, port: 3000 }
  deployable a2 { platform: node, contexts: [Ca2, Cb], dataSources: [ca2State, cbState], serves: AApi, port: 3001 }`),
      ),
    ).toEqual([]);
  });

  it("allows a route to a hosted context", async () => {
    expect(
      await irDiags(
        sys(
          `deployable ab { platform: node, contexts: [Ca, Ca2, Cb], dataSources: [caState, ca2State, cbState], serves: RApi, port: 3000 }`,
          `api RApi { route POST "/echo/{text}" -> Ca.Echo }`,
        ),
      ),
    ).toEqual([]);
  });
});

describe("loom.api-no-surface", () => {
  const deployable =
    "deployable ab { platform: node, contexts: [Ca, Ca2, Cb], dataSources: [caState, ca2State, cbState], serves: AApi, port: 3000 }";

  it("refuses an api with no `from`, no `with` and no `route`", async () => {
    const { diagnostics } = await parseString(sys(deployable, "api AApi from A\n  api Floating"));
    const hits = diagnostics.filter((d) => d.code === "loom.api-no-surface");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.severity).toBe(1);
    expect(hits[0]!.message).toContain("api 'Floating' declares no surface");
    // One diagnostic at the cause: the unserved warning is not repeated.
    expect(diagnostics.map((d) => d.code)).not.toContain("loom.api-unserved");
  });

  it("accepts each of the three surface sources", async () => {
    for (const api of [
      "api AApi from A",
      "api AApi with scaffoldApi(of: A)",
      'api AApi { route POST "/echo/{text}" -> Ca.Echo }',
    ]) {
      const { diagnostics } = await parseString(sys(deployable, api));
      expect(
        diagnostics.map((d) => d.code),
        api,
      ).not.toContain("loom.api-no-surface");
    }
  });
});
