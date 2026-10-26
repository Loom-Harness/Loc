// The read gate on the projections `scaffoldDashboard` emits.
//
// A dashboard totals row discloses the aggregate's data — its row count and the
// sum of every numeric column — so it must be guarded exactly like the rows it
// summarises.  The macro copies the source aggregate's
// `policy { read X requires … }` gate onto each projection's header, and every
// backend renders a projection's `requires` before the query (403).
//
// When there is no such rule, the projection is ungated: under `denyByDefault`
// that is refused (`loom.default-deny-ungated`) with a hint naming the policy
// rule to write — the projection has no header of its own to gate, but the
// fix the author owns is the rule the macro copies.  An ungated projection is
// SERVED (unlike the injected `find all`, which fails closed at runtime), so it
// cannot be exempt.

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { allContexts } from "../../src/ir/types/loom-ir.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { generateSystemFiles } from "../_helpers/generate.js";
import { parseString } from "../_helpers/parse.js";

const POLICY = `policy { read Order requires currentUser.role == "clerk" }`;

const SYSTEM = (
  opts: { policy?: string; extra?: string; enforcement?: string; platform?: string } = {},
): string => `
system Shop {
  user { role: string }
  subdomain Sales {
    context Orders with scaffoldDashboard {
      aggregate Order {
        code: string
        total: money
        createdAt: datetime
      }
      repository Orders for Order { }
      ${opts.policy ?? POLICY}${opts.extra ?? ""}
    }
  }
  api SalesApi from Sales
  storage pg { type: postgres }
  resource ordersState { for: Orders, kind: state, use: pg }
  auth { enforcement: ${opts.enforcement ?? "denyByDefault"} oidc { issuer: "https://issuer.example", clientId: "web" } }
  deployable d {
    platform: ${opts.platform ?? "node"}
    contexts: [Orders]
    dataSources: [ordersState]
    serves: SalesApi
    port: 8080
    auth: required
  }
}
`;

async function analyse(src: string) {
  const { model } = await parseString(src, { validate: false });
  const loom = enrichLoomModel(lowerModel(model));
  return { loom, diags: validateLoomModel(loom) };
}

async function denyDiags(src: string): Promise<Array<{ source: string; message: string }>> {
  const { diags } = await analyse(src);
  return diags
    .filter((d) => d.severity === "error" && d.code === "loom.default-deny-ungated")
    .map((d) => ({ source: d.source ?? "", message: d.message }))
    .filter((d) => d.source.startsWith("projection/"));
}

describe("scaffoldDashboard — projections inherit the aggregate's read gate", () => {
  it("copies the policy read gate onto the totals and per-day projections", async () => {
    for (const enforcement of ["denyByDefault", "opt"]) {
      const { loom } = await analyse(SYSTEM({ enforcement }));
      const ctx = allContexts(loom).find((c) => c.name === "Orders");
      const gated = (ctx?.projections ?? []).map((p) => [p.name, !!p.query?.requires]);
      expect(gated).toEqual([
        ["OrderTotals", true],
        ["OrderPerDay", true],
      ]);
    }
  });

  it("emits the gate on the generated routes (node, python)", async () => {
    const node = await generateSystemFiles(SYSTEM());
    const nodeRoutes = node.get("d/http/query-projections.ts") ?? "";
    expect(nodeRoutes).toContain(
      `if (!(currentUser.role === "clerk")) throw new ForbiddenError("Forbidden: projection OrderTotals")`,
    );
    expect(nodeRoutes).toContain(`Forbidden: projection OrderPerDay`);

    const py = await generateSystemFiles(SYSTEM({ platform: "python" }));
    const pyRoutes = py.get("d/app/http/query_projections_routes.py") ?? "";
    expect(pyRoutes).toContain(`if not (current_user.role == "clerk"):`);
    expect(pyRoutes).toContain(`raise ForbiddenError("Forbidden: projection OrderTotals")`);
  });

  it("is accepted under denyByDefault when the policy rule exists", async () => {
    expect(await denyDiags(SYSTEM())).toEqual([]);
  });

  it("refuses an ungated scaffolded projection under denyByDefault, naming the policy rule", async () => {
    const diags = await denyDiags(SYSTEM({ policy: "" }));
    expect(diags.map((d) => d.source)).toEqual([
      "projection/OrderTotals",
      "projection/OrderPerDay",
    ]);
    expect(diags[0]!.message).toContain("`with scaffoldDashboard`");
    expect(diags[0]!.message).toContain("policy { read Order requires <expr> }");
  });

  it("still demands a header gate on an author-declared projection", async () => {
    const diags = await denyDiags(
      SYSTEM({
        extra: `
      projection OpenOrders {
        code: string
        from Order as o
        select code = o.code
      }`,
      }),
    );
    expect(diags.map((d) => d.source)).toEqual(["projection/OpenOrders"]);
    expect(diags[0]!.message).toContain("after its declaration header");
  });
});
