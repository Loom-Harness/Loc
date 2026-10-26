import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

// ---------------------------------------------------------------------------
// vanilla Phoenix — a find's declared query params are checked against the type
// the app's own OpenAPI document publishes for them, BEFORE the find runs, and a
// failure answers the declared 422 at the param's pointer.
//
// Unchecked, Schemathesis found on the storefront: `GET /api/customers/by_email`
// with no `email` reached Ecto as a `nil` comparison (ArgumentError → 500), and
// `GET /api/wallets/by_owner?owner=zz` raised `Ecto.Query.CastError` (→ an
// undeclared 400).  The published parameter says `required: true` /
// `format: uuid`, and the per-operation error matrix publishes 422 for a query
// parameter that does not parse against its declared type.
//
// Runtime evidence (booted, every kind): a missing required param → 422
// "Required"; `?x[]=1` → 422 "Expected a single value."; a malformed uuid /
// out-of-int32 integer / NaN decimal / non-bool / offset-less datetime / unknown
// enum value → 422 at `/<param>`; each well-formed value → 200.
// ---------------------------------------------------------------------------

const SOURCE = `
system Shop {
  subdomain Sales {
    context Catalog {
      enum Tier { Basic, Gold }
      aggregate Owner with crudish { name: string }
      aggregate Item with crudish {
        name: string
        ownerId: Owner id
        qty: int
        big: long
        price: money
        active: bool
        at: datetime
        tier: Tier
        note: string?
      }
      repository Items for Item {
        find byName(name: string): Item? where this.name == name
        find byOwner(owner: Owner id): Item? where this.ownerId == owner
        find byQty(min: int): Item? where this.qty >= min
        find byBig(b: long): Item? where this.big == b
        find byPrice(p: money): Item? where this.price >= p
        find byActive(a: bool): Item? where this.active == a
        find since(t: datetime): Item? where this.at >= t
        find byTier(tier: Tier): Item? where this.tier == tier
        find byNote(n: string?): Item? where this.note == n
      }
      repository Owners for Owner { }
    }
  }
  api CatalogApi from Sales
  storage pg { type: postgres }
  resource s { for: Catalog, kind: state, use: pg }
  deployable d { platform: elixir, contexts: [Catalog], dataSources: [s], serves: CatalogApi, port: 4000 }
}
`;

async function itemController(): Promise<string> {
  const files = await generateSystemFiles(SOURCE);
  const ctrl = [...files.entries()].find(([p]) => p.endsWith("item_controller.ex"))?.[1];
  expect(ctrl).toBeDefined();
  return ctrl!;
}

function action(ctrl: string, name: string): string {
  const from = ctrl.slice(ctrl.indexOf(`def ${name}(`));
  const end = from.indexOf("\n  def", 1);
  return end === -1 ? from : from.slice(0, end);
}

describe("vanilla Phoenix — find query params are checked before the find runs", () => {
  it("each find checks its params against the published type, required unless nullable", async () => {
    const ctrl = await itemController();
    const expected: Record<string, string> = {
      by_name: '[{"name", :string, true}]',
      by_owner: '[{"owner", :uuid, true}]',
      by_qty: '[{"min", {:integer, -2147483648, 2147483647}, true}]',
      by_big: '[{"b", {:integer, -9007199254740991, 9007199254740991}, true}]',
      by_price: '[{"p", :decimal, true}]',
      by_active: '[{"a", :bool, true}]',
      since: '[{"t", :datetime, true}]',
      by_tier: '[{"tier", {:enum, ["Basic", "Gold"]}, true}]',
      by_note: '[{"n", :string, false}]',
    };
    for (const [name, specs] of Object.entries(expected)) {
      expect(action(ctrl, name), name).toContain(`case __check_find_params(params, ${specs}) do`);
    }
  });

  it("the check runs FIRST and a failure answers the 422 errors[] envelope", async () => {
    const ctrl = await itemController();
    const byOwner = action(ctrl, "by_owner");
    const check = byOwner.indexOf("__check_find_params");
    const query = byOwner.indexOf("Catalog.by_owner_item(");
    expect(check).toBeGreaterThan(-1);
    expect(query).toBeGreaterThan(check);
    expect(byOwner).toMatch(
      /\{:error, find_param_errors\} ->\s+\S*ProblemDetails\.validation_errors_response\(conn, find_param_errors\)/,
    );
    // The responder it sends through is emitted.
    const files = await generateSystemFiles(SOURCE);
    const pd = [...files.entries()].find(([p]) => p.endsWith("problem_details.ex"))?.[1];
    expect(pd).toContain("def validation_errors_response(conn, errors)");
  });

  it("emits one __find_param_error clause per kind the controller uses", async () => {
    const ctrl = await itemController();
    for (const head of [
      "defp __check_find_params(params, specs) do",
      "defp __find_param_error(nil, _check, required)",
      "defp __find_param_error(value, _check, _required) when not is_binary(value)",
      "defp __find_param_error(_value, :string, _required)",
      "defp __find_param_error(value, :uuid, _required)",
      "defp __find_param_error(value, {:integer, min, max}, _required)",
      "defp __find_param_error(value, :decimal, _required)",
      "defp __find_param_error(value, :bool, _required)",
      "defp __find_param_error(value, :datetime, _required)",
      "defp __find_param_error(value, {:enum, values}, _required)",
    ]) {
      expect(ctrl, head).toContain(head);
    }
    // A clause for a kind no find uses would be dead code.
    expect(ctrl).not.toContain(":present");
  });

  it("a controller whose finds take no params emits no check", async () => {
    const files = await generateSystemFiles(SOURCE);
    const owner = [...files.entries()].find(([p]) => p.endsWith("owner_controller.ex"))?.[1];
    expect(owner).toBeDefined();
    expect(owner).not.toContain("__check_find_params");
    expect(owner).not.toContain("__find_param_error");
  });
});
