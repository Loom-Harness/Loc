import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

// ---------------------------------------------------------------------------
// vanilla Phoenix — a single-row read that matches no row returns 404, not an
// HTTP 200 with a `null` body.
//
// The routed single-row read is `scaffoldGet` (D-FINDDECL-REMOVED): a
// `queryHandler` whose `if let x = Repo.find(C) { return x } else { notFound
// "not_found" }` answers the miss as `{:error, {:not_found, "not_found"}}`,
// and the routes controller's shared `respond/2` maps it to the 404
// ProblemDetails with the canonical `"not_found"` TOKEN as `detail` — the
// spelling node/python/java/dotnet all send (RS-27 keeps the find-miss token,
// not a sentence naming the aggregate).
// ---------------------------------------------------------------------------

const SOURCE = `
system Shop {
  subdomain Sales {
    context Catalog with scaffoldGet(of: ItemsBySku) {
      aggregate Item with crudish {
        name: string
        sku: string
      }
      repository Items for Item
      criterion ItemsBySku(sku: string) of Item = this.sku == sku
    }
  }
  api CatalogApi with scaffoldGetApi(of: ItemsBySku) from Sales
  storage pg { type: postgres }
  resource s { for: Catalog, kind: state, use: pg }
  deployable d { platform: elixir, contexts: [Catalog], dataSources: [s], serves: CatalogApi, port: 4000 }
}
`;

function file(files: Map<string, string>, suffix: string): string {
  const hit = [...files.entries()].find(([p]) => p.endsWith(suffix))?.[1];
  expect(hit, `${suffix} not emitted`).toBeDefined();
  return hit!;
}

describe("vanilla Phoenix — single-row read absence → 404", () => {
  it("a scaffoldGet miss answers the 404 ProblemDetails with the not_found token, not a 200 null body", async () => {
    const files = await generateSystemFiles(SOURCE);
    // The handler answers the miss as the not-found error, carrying the token.
    const handler = file(files, "/handlers/get_item_by_items_by_sku.ex");
    expect(handler).toContain('{:error, {:not_found, "not_found"}}');
    // The routes controller routes the handler's result through `respond/2`…
    const ctrl = file(files, "/controllers/catalog_api_routes_controller.ex");
    expect(ctrl).toContain(
      "respond(conn, D.Catalog.Handlers.GetItemByItemsBySku.run(params))",
    );
    // …whose not-found clause is the shared 404 producer, `detail` passed through.
    expect(ctrl).toMatch(
      /def respond\(conn, \{:error, \{:not_found, detail\}\}\),\s+do: ProblemDetails\.problem_response\(conn, 404, "Not Found", detail\)/,
    );
    // Neither the schema-invalid 200 null body nor the old sentence spelling.
    expect(ctrl).not.toContain("json(conn, nil)");
    expect(ctrl).not.toContain('"Item not found"');
  });

  it("the LIST read is untouched — it has no absence to answer", async () => {
    // Scope guard: the `all` read answers an empty page, never a 404 (RS-23).
    // Without this a fix that 404'd every nil-ish read would pass the
    // assertions above.
    const files = await generateSystemFiles(SOURCE);
    const ctrl = file(files, "item_controller.ex");
    expect(ctrl.indexOf("def index(")).toBeGreaterThan(-1);
    const named = ctrl.slice(ctrl.indexOf("def index("));
    const body = named.slice(
      0,
      named.indexOf("\n  def ", 1) === -1 ? undefined : named.indexOf("\n  def ", 1),
    );
    expect(body).toContain("json(conn,");
    expect(body).not.toContain("problem_response");
  });
});
