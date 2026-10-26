// `scaffoldGet` / `scaffoldGetApi` — the single-row twin of `scaffoldPaged`.
// The context macro emits a `queryHandler` answering a criterion's first match
// (`if let x = Repo.find(C(args)) { return x } else { notFound "not_found" }`)
// or a declared unique key's row (`let x = Repo.getBy(<col>: …); return x`);
// the api macro mounts it where a declared find's route was
// (`GET /<aggs>/<snake read>`), its params on the query string.  Pinned:
//   1. the expanded AST and its unfold (`printStructural`);
//   2. byte-identity with the hand-written handler + route on all five backends;
//   3. the wire: each backend binds the params from the query string and
//      answers the aggregate's response shape; node and python mount the route
//      ahead of the aggregate's `/{id}`;
//   4. the call-site refusals.
// The booted proof that the route answers what the find answered is the
// `scaffold-get` / `scaffold-get-find` corpus pair
// (`test/behavioral/scaffold-get-wire.test.ts`).

import { AstUtils } from "langium";
import { describe, expect, it } from "vitest";
import {
  type Api,
  type BoundedContext,
  isApi,
  isBoundedContext,
} from "../../src/language/generated/ast.js";
import { printStructural } from "../../src/language/print/index.js";
import { generateSystemFiles } from "../_helpers/generate.js";
import { parseString } from "../_helpers/parse.js";

const SYS = (platform: string, ctxMacro: string, apiMacro: string, body = "", routes = "") => `
  system Shop {
    subdomain Sales {
      context Sales${ctxMacro} {
        aggregate Order { code: string }
        aggregate Item {
          sku: string
          unique (sku)
        }
        repository Orders for Order { }
        repository Items for Item { }
        policy Staff(): bool = true
        criterion ByCode(code: string) of Order = this.code == code
        ${body}
      }
    }
    api SalesApi${apiMacro} from Sales {${routes}}
    storage pg { type: postgres }
    resource st { for: Sales, kind: state, use: pg }
    deployable api { platform: ${platform}, contexts: [Sales], dataSources: [st], serves: SalesApi, port: 5001 }
  }
`;

const MACRO = (platform: string): string =>
  SYS(
    platform,
    ' with scaffoldGet(of: ByCode, requires: Staff), scaffoldGet(of: Item, key: "sku")',
    ' with scaffoldGetApi(of: ByCode), scaffoldGetApi(of: Item, key: "sku")',
  );

const HAND = (platform: string): string =>
  SYS(
    platform,
    "",
    "",
    `queryHandler GetOrderByCode(code: string): Order {
          requires Staff()
          if let x = Orders.find(ByCode(code)) {
            return x
          } else {
            notFound "not_found"
          }
        }
        queryHandler GetItemBySku(sku: string): Item {
          let x = Items.getBy(sku: sku)
          return x
        }`,
    `
      route GET "/orders/by_code" -> Sales.GetOrderByCode
      route GET "/items/by_sku" -> Sales.GetItemBySku
    `,
  );

async function parsed(src: string): Promise<{ ctx: BoundedContext; api: Api }> {
  const { model } = await parseString(src, { validate: false });
  const nodes = [...AstUtils.streamAllContents(model)];
  return {
    ctx: nodes.filter(isBoundedContext).find((c) => c.name === "Sales") as BoundedContext,
    api: nodes.filter(isApi)[0] as Api,
  };
}

const BACKENDS = ["node", "python", "java", "dotnet", "elixir"] as const;

describe("scaffoldGet — the expanded source", () => {
  it("parses + validates with no errors", async () => {
    const { errors } = await parseString(MACRO("node"));
    expect(errors).toEqual([]);
  });

  it("splices the guarded criterion read and the unique-key read", async () => {
    const printed = printStructural((await parsed(MACRO("node"))).ctx);
    expect(printed).toMatch(
      /queryHandler GetOrderByCode\(code: string\): Order \{\s*requires Staff\(\)\s*if let x = Orders\.find\(ByCode\(code\)\) \{\s*return x\s*\} else \{\s*notFound "not_found"\s*\}\s*\}/,
    );
    expect(printed).toMatch(
      /queryHandler GetItemBySku\(sku: string\): Item \{\s*let x = Items\.getBy\(sku: sku\)\s*return x\s*\}/,
    );
  });

  it("mounts each read where a find of the same name had its route", async () => {
    const printed = printStructural((await parsed(MACRO("node"))).api);
    expect(printed).toContain('route GET "/orders/by_code" -> Sales.GetOrderByCode');
    expect(printed).toContain('route GET "/items/by_sku" -> Sales.GetItemBySku');
  });
});

/** Each backend's query-string binding of the read's param on the routed GET. */
const QUERY_BINDING: Record<(typeof BACKENDS)[number], string[]> = {
  node: ["request: { query: z.object({ code: z.string() }) }", "const code = __query.code;"],
  python: ["async def get_order_by_code_route(code: WireStr, session: SessionDep)"],
  java: ['@GetMapping("/api/orders/by_code")', "@RequestParam String code"],
  dotnet: ['[HttpGet("/api/orders/by_code")]', "GetOrderByCode([FromQuery] string code)"],
  // Phoenix merges the query string into `params`; the handler destructures it.
  elixir: ['get "/orders/by_code", SalesApiRoutesController, :get_order_by_code'],
};

describe("scaffoldGet — generated on every backend", () => {
  for (const platform of BACKENDS) {
    it(`${platform}: byte-identical to the hand-written handlers + routes`, async () => {
      const macro = await generateSystemFiles(MACRO(platform));
      const hand = await generateSystemFiles(HAND(platform));
      expect([...macro.keys()].sort()).toEqual([...hand.keys()].sort());
      for (const [k, v] of macro) expect(v, `content differs for ${k}`).toBe(hand.get(k));
    });

    it(`${platform}: binds the read's param from the query string`, async () => {
      const all = [...(await generateSystemFiles(MACRO(platform))).values()].join("\n");
      for (const needle of QUERY_BINDING[platform]) expect(all).toContain(needle);
    });
  }

  it("elixir: a key read's miss answers the find-absence detail, not the generic one", async () => {
    // The context's `get_by_<key>` answers a bare `{:error, :not_found}`, which
    // the routes controller renders as "Resource not found"; the find's route
    // answered the `not_found` token, so the handler tags the miss with it.
    const files = await generateSystemFiles(MACRO("elixir"));
    const handler = files.get("api/lib/api/sales/handlers/get_item_by_sku.ex") as string;
    expect(handler).toContain('{:error, :not_found} -> {:error, {:not_found, "not_found"}}');
    const controller = files.get(
      "api/lib/api_web/controllers/sales_api_routes_controller.ex",
    ) as string;
    expect(controller).toContain("def respond(conn, {:error, {:not_found, detail}})");
  });

  it("node: mounts the explicit routes ahead of the aggregate's `/{id}`", async () => {
    const index = (await generateSystemFiles(MACRO("node"))).get("api/http/index.ts") as string;
    const explicit = index.indexOf('app.route("/api", salesApiRoutes(db, events));');
    const orders = index.indexOf('app.route("/api/orders", orderRoutes(');
    expect(explicit).toBeGreaterThan(-1);
    expect(orders).toBeGreaterThan(explicit);
  });

  it("python: includes the explicit router ahead of the aggregate routers", async () => {
    const main = (await generateSystemFiles(MACRO("python"))).get("api/app/main.py") as string;
    const explicit = main.indexOf("app.include_router(sales_api_router");
    const orders = main.indexOf("app.include_router(order_router");
    expect(explicit).toBeGreaterThan(-1);
    expect(orders).toBeGreaterThan(explicit);
  });
});

describe("scaffoldGet — the aggregate's read gate", () => {
  // A declared find's route enforced `policy { read <Agg> requires … }`; a
  // handler does not inherit it, so the macro splices it ahead of the read.
  const GATED = (platform: string): string =>
    MACRO(platform)
      .replace("system Shop {", "system Shop {\n    user { id: guid  role: string }")
      .replace(
        "policy Staff(): bool = true",
        'policy Staff(): bool = true\n        policy { read Order requires currentUser.role == "agent" }',
      )
      .replace("port: 5001 }", "port: 5001, auth: required }");

  it("splices the read gate as the first statement, ahead of `requires:`", async () => {
    const printed = printStructural((await parsed(GATED("node"))).ctx);
    expect(printed).toMatch(
      /queryHandler GetOrderByCode\(code: string\): Order \{\s*requires currentUser\.role == "agent"\s*requires Staff\(\)\s*if let x/,
    );
    // The ungated aggregate's read carries no gate.
    expect(printed).toMatch(/queryHandler GetItemBySku\(sku: string\): Item \{\s*let x = Items/);
  });

  for (const platform of BACKENDS) {
    it(`${platform}: answers the gate's 403 before the read`, async () => {
      const files = await generateSystemFiles(GATED(platform));
      const all = [...files.values()].join("\n");
      const gateAt = all.search(/Forbidden: currentUser\.role == \\?"agent\\?"/);
      expect(gateAt, "gate rendered").toBeGreaterThan(-1);
      expect(all.slice(gateAt).search(/ByCode|by_code/), "read after the gate").toBeGreaterThan(0);
    });
  }
});

describe("scaffoldGet — call-site refusals", () => {
  const refusal = async (ctxMacro: string): Promise<string> => {
    const { errors } = await parseString(SYS("node", ctxMacro, ""));
    return errors.join("\n");
  };

  it("an aggregate without `key:`", async () => {
    expect(await refusal(" with scaffoldGet(of: Item)")).toContain("needs 'key:'");
  });

  it("`key:` beside a criterion", async () => {
    expect(await refusal(' with scaffoldGet(of: ByCode, key: "code")')).toContain(
      "'key:' names a unique key of an aggregate",
    );
  });

  it("a key column the aggregate does not declare", async () => {
    expect(await refusal(' with scaffoldGet(of: Item, key: "nope")')).toContain(
      "'nope' is not a field of 'Item'",
    );
  });

  it("an event-log or document aggregate", async () => {
    for (const shape of ["persistedAs: eventLog", "shape: document"]) {
      const src = SYS("node", " with scaffoldGet(of: ByCode)", "").replace(
        "aggregate Order {",
        `aggregate Order ${shape} {`,
      );
      const { errors } = await parseString(src);
      expect(errors.join("\n")).toContain(`'Order' is ${shape}`);
    }
  });

  it("a policy that takes parameters", async () => {
    const src = MACRO("node").replace(
      "policy Staff(): bool = true",
      'policy Staff(r: string): bool = r == "x"',
    );
    const { errors } = await parseString(src);
    expect(errors.join("\n")).toContain("scaffoldGet can only call a parameterless policy");
  });
});
