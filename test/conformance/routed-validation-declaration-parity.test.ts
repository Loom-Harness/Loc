// Cross-backend parity for the WIRE-VALIDATION 422 on a routed handler's route
// (`route <M> "<path>" -> Ctx.Handler`, and the `scaffoldGetApi` / `scaffoldGet`
// routes, which are routed handlers).
//
// A routed route parses every request part it binds — a typed `{path}` token, a
// query param on a bodyless method, a JSON body field — and a value that fails
// its type answers the shared wire-validation 422 on every backend (Hono's
// `defaultHook`, FastAPI's request validation, ASP.NET's model-state filter,
// Spring's binder advice, the Phoenix param checks).  So the operation declares
// 422 exactly when it parses something, the same rule the derived routes follow
// (`errorStatuses` / `findValidatesRequest`).  The one derivation is
// `routedErrorStatuses` in `src/ir/util/routed-handler.ts`; each backend renders
// it in its own idiom, and this file reads the five renderings back.
//
// The NEGATIVE case carries equal weight: a param-less route parses nothing and
// must not declare 422, or the cure is the opposite contract lie.
//
// The deployables are generated from the backend registry, so a backend added
// there lands in this fixture and fails here until it has an extractor below.

import { describe, expect, it } from "vitest";
import { defaultBuiltInBackends } from "../../src/platform/registry.js";
import { snake } from "../../src/util/naming.js";
import { generateSystemFiles } from "../_helpers/generate.js";

const FAMILIES = [...new Set(defaultBuiltInBackends().map((b) => b.manifest.family))].sort();

/** Four routed handlers spanning the predicate:
 *
 *   GET  /wallets/by_owner/{owner}   a `Customer id` path token  → 422
 *   GET  /wallets/by_label?label=    a query param               → 422
 *   POST /wallets/{walletId}/relabel  a path token + a JSON body  → 415 + 422
 *   GET  /wallets/any                 parses nothing              → no 422 */
const SRC = `
system RoutedDecl {
  subdomain RS {
    context R {
      aggregate Customer {
        email: string
        create(email: string) { }
      }
      aggregate Wallet {
        ownerId: Customer id
        label: string
        create(ownerId: Customer id, label: string) { }
        operation relabel(next: string) { label := next }
      }
      repository Customers for Customer { }
      repository Wallets for Wallet { }
      criterion WalletsByOwner(owner: Customer id) of Wallet = this.ownerId == owner
      criterion WalletsByLabel(wanted: string) of Wallet = this.label == wanted
      criterion AnyWallet of Wallet = this.label != ""
      queryHandler ListWalletsByOwner(owner: Customer id): Wallet[] {
        let r = Wallets.all(WalletsByOwner(owner))
        return r
      }
      queryHandler ListWalletsByLabel(wanted: string): Wallet[] {
        let r = Wallets.all(WalletsByLabel(wanted))
        return r
      }
      queryHandler ListAnyWallets(): Wallet[] {
        let r = Wallets.all(AnyWallet())
        return r
      }
      commandHandler RelabelWallet(walletId: Wallet id, next: string) {
        let w = Wallets.get(walletId)
        w.relabel(next)
      }
    }
  }
  api RApi from RS {
    route GET "/wallets/by_owner/{owner}" -> R.ListWalletsByOwner
    route GET "/wallets/by_label" -> R.ListWalletsByLabel
    route GET "/wallets/any" -> R.ListAnyWallets
    route POST "/wallets/{walletId}/relabel" -> R.RelabelWallet
  }
  storage pg { type: postgres }
  resource st { for: R, kind: state, use: pg }
${FAMILIES.map(
  (f, i) =>
    `  deployable ${f}Api { platform: ${f}, contexts: [R], dataSources: [st], serves: RApi, port: ${4000 + i} }`,
).join("\n")}
}
`;

let cache: Map<string, string> | undefined;
async function files(): Promise<Map<string, string>> {
  cache ??= await generateSystemFiles(SRC);
  return cache;
}

async function fileMatching(re: RegExp): Promise<string> {
  const all = await files();
  const key = [...all.keys()].find((k) => re.test(k));
  expect(key, `no emitted file matched ${re}`).toBeDefined();
  return all.get(key!)!;
}

const reEscape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function sorted(matches: IterableIterator<RegExpMatchArray>): number[] {
  return [...new Set([...matches].map((m) => Number(m[1])))].sort((a, b) => a - b);
}

interface Subject {
  method: string;
  path: string;
  handler: string;
}

/** The ERROR statuses one routed route declares, per backend family.  Each
 *  backend spells the declaration in its own idiom; what is compared is the
 *  resulting set. */
const errorStatuses: Record<string, (s: Subject) => Promise<number[]>> = {
  /** Hono: the `createRoute({ … responses: { … } })` block of the route. */
  async node({ method, path }) {
    const src = await fileMatching(/rApi-routes\.ts$/);
    const at = src.search(new RegExp(`method: "${method}",\\n\\s+path: "${reEscape(path)}",`));
    expect(at, `node: no route for ${method} ${path}`).toBeGreaterThan(-1);
    const from = src.indexOf("responses: {", at);
    const block = src.slice(from, src.indexOf("\n    }),", from));
    return sorted(block.matchAll(/^\s+(\d{3}): \{/gm)).filter((s) => s >= 400);
  },
  /** FastAPI: `responses={NNN: {"model": ProblemDetails, …}}` on the decorator. */
  async python({ method, path }) {
    const src = await fileMatching(/r_api_routes\.py$/);
    // FastAPI spells a path token in snake case.
    const pyPath = path.replace(/\{(\w+)\}/g, (_, n: string) => `{${snake(n)}}`);
    const line = src.split("\n").find((l) => l.startsWith(`@router.${method}("${pyPath}"`));
    expect(line, `python: no route decorator for ${method} ${path}`).toBeDefined();
    return sorted(line!.matchAll(/(\d{3}): \{"model": ProblemDetails/g));
  },
  /** ASP.NET: the `[ProducesResponseType]` run above the action. */
  async dotnet({ handler }) {
    const src = await fileMatching(/RApiRoutesController\.cs$/);
    const at = src.indexOf(`Task<IActionResult> ${handler}(`);
    expect(at, `dotnet: no action ${handler}`).toBeGreaterThan(-1);
    const from = src.lastIndexOf("    [Http", at);
    return sorted(
      src
        .slice(from, at)
        .matchAll(
          /ProducesResponseType\(typeof\(ProblemResponse\), (\d{3}), "application\/problem\+json"\)/g,
        ),
    );
  },
  /** springdoc: the `new Route("<method>", "<path>", …, new int[] {…}, …)` row. */
  async java({ method, path }) {
    const src = await fileMatching(/OpenApiContractCustomizer\.java$/);
    const line = src.split("\n").find((l) => l.includes(`new Route("${method}", "/api${path}"`));
    expect(line, `java: no contract row for ${method} ${path}`).toBeDefined();
    const set = /new int\[\] \{([^}]*)\}/.exec(line!);
    return (set?.[1] ?? "")
      .split(",")
      .map((n) => Number(n.trim()))
      .filter((n) => !Number.isNaN(n))
      .sort((a, b) => a - b);
  },
  /** OpenApiSpex: the `<method>: %OpenApiSpex.Operation{…}` under the PathItem. */
  async elixir({ method, path }) {
    const src = await fileMatching(/r_api_spec\.ex$/);
    const item = src.indexOf(`"/api${path}" => %OpenApiSpex.PathItem{`);
    expect(item, `elixir: no PathItem for ${path}`).toBeGreaterThan(-1);
    const at = src.indexOf(`${method}: %OpenApiSpex.Operation{`, item);
    expect(at, `elixir: no ${method} operation for ${path}`).toBeGreaterThan(-1);
    const next = src.indexOf("%OpenApiSpex.Operation{", at + 30);
    const block = src.slice(at, next > 0 ? next : undefined);
    return sorted(block.matchAll(/(\d{3}) => %OpenApiSpex\.Response\{/g)).filter((s) => s >= 400);
  },
};

const BY_OWNER: Subject = {
  method: "get",
  path: "/wallets/by_owner/{owner}",
  handler: "ListWalletsByOwner",
};
const BY_LABEL: Subject = {
  method: "get",
  path: "/wallets/by_label",
  handler: "ListWalletsByLabel",
};
const RELABEL: Subject = {
  method: "post",
  path: "/wallets/{walletId}/relabel",
  handler: "RelabelWallet",
};
const ANY: Subject = { method: "get", path: "/wallets/any", handler: "ListAnyWallets" };

describe("a routed route declares the 422 its request validator answers", () => {
  it("every registered backend has an extractor here", () => {
    expect(Object.keys(errorStatuses).sort()).toEqual(FAMILIES);
  });

  for (const family of FAMILIES) {
    it(`${family}: a validated path token, query param or body declares 422`, async () => {
      const read = errorStatuses[family]!;
      expect(await read(BY_OWNER), "path token").toContain(422);
      expect(await read(BY_LABEL), "query param").toContain(422);
      expect(await read(RELABEL), "path + body").toContain(422);
    });

    it(`${family}: a route that parses nothing declares no 422`, async () => {
      expect(await errorStatuses[family]!(ANY)).not.toContain(422);
    });
  }

  it("the five declare the SAME error set for each route", async () => {
    // What the conformance parity gate diffs on a booted stack, read here off
    // the emitted source instead.
    for (const [subject, want] of [
      [BY_OWNER, [400, 404, 422]],
      [BY_LABEL, [400, 404, 422]],
      [RELABEL, [400, 404, 415, 422]],
      [ANY, [400, 404]],
    ] as const) {
      const got: Record<string, number[]> = {};
      for (const family of FAMILIES) got[family] = await errorStatuses[family]!(subject);
      expect(got, `${subject.method} ${subject.path}`).toEqual(
        Object.fromEntries(FAMILIES.map((f) => [f, want])),
      );
    }
  });
});
