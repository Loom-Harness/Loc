import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

// ---------------------------------------------------------------------------
// Read-argument live-refetch — Vue.
//
// A page that reads a parameterised criterion (`Order.findAllByInStatus(…)`,
// the find `scaffoldPaged` synthesises) with an argument bound to page state
// must live-refetch when that state changes.  On Vue the find hook therefore
// takes a `MaybeRefOrGetter` (queryKey tracks a `computed(toValue(query))`) and
// the page passes a getter `() => ({ ... })` rather than snapshotting
// `state.value` at setup.  React (re-render-driven) is unaffected — its hook
// stays a plain object param.
// ---------------------------------------------------------------------------

const SRC = (platform: string, stateName = "wanted") => `
  system S {
    subdomain Sub { context Sales with scaffoldPaged(of: InStatus) {
      aggregate Order { status: string  customerId: string }
      repository Orders for Order
      criterion InStatus(status: string) of Order = this.status == status
    } }
    api SalesApi with scaffoldPagedApi(of: InStatus) from Sub
    ui WebApp {
      api Sub: SalesApi
      page ByStatus {
        route: "/by-status"
        state { ${stateName}: string = "open" }
        body: QueryView { of: Order.findAllByInStatus(${stateName}), data: rows => Text { "rows" } }
      }
    }
    storage loomDb { type: postgres }
    resource salesState { for: Sales, kind: state, use: loomDb }
    deployable api { platform: node, contexts: [Sales], dataSources: [salesState], serves: SalesApi, port: 3000 }
    deployable web { platform: ${platform}, targets: api, ui: WebApp { Sub: api }, port: 3001 }
  }
`;

async function files(platform: string, prefix: string, stateName?: string) {
  const all = await generateSystemFiles(SRC(platform, stateName));
  const out = new Map<string, string>();
  for (const [p, c] of all) {
    if (p.startsWith(prefix)) out.set(p.slice(prefix.length), c);
  }
  return out;
}

describe("read-argument live-refetch — Vue", () => {
  it("the find hook takes a MaybeRefOrGetter and tracks it via computed(toValue)", async () => {
    const f = await files("vue", "web/");
    const api = f.get("src/api/order.ts")!;
    expect(api).toContain('import { type MaybeRefOrGetter, computed, toValue } from "vue";');
    expect(api).toContain(
      "export function useFindAllByInStatusOrder(query: MaybeRefOrGetter<FindAllByInStatusQueryInput>) {",
    );
    expect(api).toContain("const queryArgs = computed(() => toValue(query));");
    expect(api).toContain('queryKey: ["orders", "find", "find_all_by_in_status", queryArgs],');
    expect(api).toContain("Object.entries(queryArgs.value)");
  });

  it("the page passes a getter that re-reads the state cell", async () => {
    const page = (await files("vue", "web/")).get("src/pages/by_status.vue")!;
    expect(page).toContain(
      'useFindAllByInStatusOrder(() => ({ status: wanted.value, page: 1, pageSize: 20, sort: "id", dir: "asc" }))',
    );
  });

  // A state cell with the SAME name as the read's parameter: the state-ref
  // rewrite must leave the object KEY bare (`{ status: status.value }`), never
  // `{ status.value: status.value }`.
  it("a state cell named like the parameter keeps the bare key", async () => {
    const page = (await files("vue", "web/", "status")).get("src/pages/by_status.vue")!;
    expect(page).toContain("useFindAllByInStatusOrder(() => ({ status: status.value,");
  });

  it("React's find hook is unaffected — a plain object param, no Vue imports", async () => {
    const f = await files("static", "web/");
    const api = f.get("src/api/order.ts")!;
    expect(api).toContain(
      "export function useFindAllByInStatusOrder(query: FindAllByInStatusQueryInput) {",
    );
    expect(api).not.toContain("MaybeRefOrGetter");
    expect(api).not.toContain("toValue");
  });
});
