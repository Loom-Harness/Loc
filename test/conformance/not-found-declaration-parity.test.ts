// Cross-backend parity for the DOMAIN NOT-FOUND rung — schemathesis F10 + F13
// (https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/audits/schemathesis-findings-2026-08.md).
//
// One root cause, two route classes.  `errorStatuses` published the not-found
// rung from the ROUTE SHAPE — does the path carry an `{id}`? — while the rung's
// real producer is the READ: every repository read whose declared return type
// is a single non-optional aggregate has nowhere to put an empty result set, so
// the emitted method throws the shared not-found carrier and the router renders
// it as 404.  Shape and read agree wherever a path id is what gets read, and
// diverge in exactly the two places a non-optional read happens WITHOUT one:
//
//   F10  POST /api/workflows/<wf>  whose body loads an aggregate
//   F13  GET  /api/<aggs>/<read>   for a routed single-row read with no path id
//        (a `scaffoldGet` over a unique key — `getBy`, non-optional — or over
//        a criterion — `find(C)` + `notFound`)
//
// F13 also had a RUNTIME half, found once the declaration forced the question
// "what does each backend actually answer here?".  All five agreed on the happy
// path and split four ways on a miss: node / java / python reached the shared
// not-found carrier, .NET called EF `FirstAsync` and answered 500 on
// `InvalidOperationException("Sequence contains no elements")`, and elixir
// answered `200` with a `null` body that is not a valid `<Agg>Response` — a
// violation of the 200 schema it publishes.  Both are corrected here, so the
// declaration below is a promise the emitters keep rather than a second lie.
//
// Both answered a 404 they never declared, on all five backends.  The fix is
// one table plus one predicate, so it is pinned here in one place rather than
// as five per-backend spot checks — and the NEGATIVE case is pinned with equal
// weight: a workflow that reads nothing must NOT declare 404, or the cure is
// just the opposite contract lie (an unreachable declared status, which
// schemathesis' `status_code_conformance` reads with the same suspicion).

import { describe, expect, it } from "vitest";

import { generateSystemFiles } from "../_helpers/generate.js";
import { javaDocumentedRoutes } from "../_helpers/java-openapi-annotations.js";

/** One context, five deployables, three workflows chosen to span the predicate:
 *
 *   `spend`      loads by a client-supplied id (`getById`)  → declares 404
 *   `spendByRef` reads a criterion, `notFound` on a miss    → declares 404
 *   `jot`        constructs only, touches no repository     → declares NONE
 *
 * The F13 subjects are the two routed single-row reads: `GET
 * /wallets/by_owner_ref` (`getBy(ownerRef:)` over `unique (ownerRef)`, whose
 * repository method throws on a miss) and `GET /wallets/wallets_maybe_by_ref`
 * (`find(WalletsMaybeByRef(r))`, whose handler answers `notFound`). */
const SRC = `
system NotFoundDecl {
  subdomain N {
    context N with scaffoldGet(of: Wallet, key: "ownerRef"), scaffoldGet(of: WalletsMaybeByRef) {
      aggregate Wallet {
        ownerRef: string
        balance: decimal
        unique (ownerRef)
        create(ownerRef: string, balance: decimal) { }
        operation debit(amount: decimal) { balance := balance - amount }
      }
      aggregate Note {
        text: string
        create(text: string) { }
      }
      repository Wallets for Wallet { }
      criterion WalletsByRef(r: string) of Wallet = this.ownerRef == r
      criterion WalletsMaybeByRef(r: string) of Wallet = this.ownerRef == r
      repository Notes for Note { }

      workflow spend transactional {
        create(walletId: Wallet id, amount: decimal) {
          let w = Wallets.get(walletId)
          w.debit(amount)
        }
      }
      workflow spendByRef transactional {
        create(ref: string, amount: decimal) {
          if let w = Wallets.find(WalletsByRef(ref)) {
            w.debit(amount)
          } else {
            notFound
          }
        }
      }
      workflow jot transactional {
        create(text: string) {
          let n = Note.create(text: text)
        }
      }
    }
  }
  api NApi with scaffoldGetApi(of: Wallet, key: "ownerRef"), scaffoldGetApi(of: WalletsMaybeByRef) from N
  storage pg { type: postgres }
  resource st { for: N, kind: state, use: pg }
  deployable nodeApi { platform: node,   contexts: [N], dataSources: [st], serves: NApi, port: 3000 }
  deployable pyApi   { platform: python, contexts: [N], dataSources: [st], serves: NApi, port: 3001 }
  deployable netApi  { platform: dotnet, contexts: [N], dataSources: [st], serves: NApi, port: 3002 }
  deployable javaApi { platform: java,   contexts: [N], dataSources: [st], serves: NApi, port: 3003 }
  deployable exApi   { platform: elixir, contexts: [N], dataSources: [st], serves: NApi, port: 3004 }
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

/** The statuses one route declares, per backend.  Each backend spells its
 *  declaration in its own idiom, so the extraction is per-backend; what the
 *  assertions compare is the resulting SET, which is the thing that has to
 *  match across the five (it is what `conformance-parity` diffs). */
const statuses = {
  /** Hono: a `createRoute({ … responses: { 204: …, 400: … } })` block. */
  async node(routeFile: RegExp, path: string): Promise<number[]> {
    const src = await fileMatching(routeFile);
    const at = src.indexOf(`path: "${path}"`);
    expect(at, `node: no route for ${path}`).toBeGreaterThan(-1);
    const block = src.slice(at, src.indexOf("    }),", at));
    return sorted(block.matchAll(/^\s{8}(\d{3}): \{/gm));
  },
  /** FastAPI: `responses={404: {"model": ProblemDetails, …}}` on the decorator. */
  async python(routeFile: RegExp, path: string): Promise<number[]> {
    const src = await fileMatching(routeFile);
    const line = src.split("\n").find((l) => l.includes(`"${path}"`) && l.includes("@router."));
    expect(line, `python: no route decorator for ${path}`).toBeDefined();
    return sorted(line!.matchAll(/(\d{3}): \{"model": ProblemDetails/g));
  },
  /** ASP.NET: the `[ProducesResponseType]` attribute run above the action. */
  async dotnet(controller: RegExp, attr: string): Promise<number[]> {
    const src = await fileMatching(controller);
    const at = src.indexOf(attr);
    expect(at, `dotnet: no action carrying ${attr}`).toBeGreaterThan(-1);
    const from = src.lastIndexOf("    [Http", at);
    return sorted(
      src
        .slice(from, at)
        .matchAll(
          /ProducesResponseType\(typeof\(ProblemResponse\), (\d{3}), "application\/problem\+json"\)/g,
        ),
    );
  },
  /** springdoc: the `@ApiResponse` annotations above the controller method. */
  async java(path: string): Promise<number[]> {
    const routes = javaDocumentedRoutes(await files());
    const hit = [...routes].find(([k]) => k.endsWith(` ${path}`));
    expect(hit, `java: no documented route for ${path}`).toBeDefined();
    return hit![1].errors;
  },
  /** OpenApiSpex: `NNN => %OpenApiSpex.Response{…}` inside the PathItem. */
  async elixir(path: string): Promise<number[]> {
    const src = await fileMatching(/_spec\.ex$/);
    const at = src.indexOf(`"/api${path}" => %OpenApiSpex.PathItem{`);
    expect(at, `elixir: no PathItem for ${path}`).toBeGreaterThan(-1);
    const next = src.indexOf("%OpenApiSpex.PathItem{", at + 40);
    const block = src.slice(at, next > 0 ? next : undefined);
    return sorted(block.matchAll(/(\d{3}) => %OpenApiSpex\.Response\{/g));
  },
};

function sorted(matches: IterableIterator<RegExpMatchArray>): number[] {
  return [...new Set([...matches].map((m) => Number(m[1])))].sort((a, b) => a - b);
}

describe("F10 — a workflow that reads declares the 404 it answers", () => {
  it("node", async () => {
    expect(await statuses.node(/http\/workflows\.ts$/, "/spend")).toContain(404);
    expect(await statuses.node(/http\/workflows\.ts$/, "/spend_by_ref")).toContain(404);
  });

  it("python", async () => {
    expect(await statuses.python(/workflows_routes\.py$/, "/spend")).toContain(404);
    expect(await statuses.python(/workflows_routes\.py$/, "/spend_by_ref")).toContain(404);
  });

  it("dotnet", async () => {
    expect(await statuses.dotnet(/WorkflowsController\.cs$/, "SpendWorkflow(")).toContain(404);
    expect(await statuses.dotnet(/WorkflowsController\.cs$/, "SpendByRefWorkflow(")).toContain(404);
  });

  it("java", async () => {
    expect(await statuses.java("/api/workflows/spend")).toContain(404);
    expect(await statuses.java("/api/workflows/spend_by_ref")).toContain(404);
  });

  it("elixir", async () => {
    expect(await statuses.elixir("/workflows/spend")).toContain(404);
    expect(await statuses.elixir("/workflows/spend_by_ref")).toContain(404);
  });

  it("and a workflow that reads NOTHING declares no 404 — on all five", async () => {
    // The half that makes the rung a predicate rather than a new constant.  If
    // this ever flips, the fix has traded an undeclared reachable status for a
    // declared unreachable one and the contract is no more honest than before.
    expect(await statuses.node(/http\/workflows\.ts$/, "/jot")).not.toContain(404);
    expect(await statuses.python(/workflows_routes\.py$/, "/jot")).not.toContain(404);
    expect(await statuses.dotnet(/WorkflowsController\.cs$/, "JotWorkflow(")).not.toContain(404);
    expect(await statuses.java("/api/workflows/jot")).not.toContain(404);
    expect(await statuses.elixir("/workflows/jot")).not.toContain(404);
  });

  it("the five declare the SAME set for each workflow", async () => {
    // What `conformance-parity` diffs.  Pinned here so a backend that drifts
    // fails on a 4-second unit run instead of in a nightly compose boot.
    for (const [nodePath, javaPath, exPath, netAttr] of [
      ["/spend", "/api/workflows/spend", "/workflows/spend", "SpendWorkflow("],
      [
        "/spend_by_ref",
        "/api/workflows/spend_by_ref",
        "/workflows/spend_by_ref",
        "SpendByRefWorkflow(",
      ],
      ["/jot", "/api/workflows/jot", "/workflows/jot", "JotWorkflow("],
    ] as const) {
      const node = (await statuses.node(/http\/workflows\.ts$/, nodePath)).filter((s) => s >= 400);
      const py = await statuses.python(/workflows_routes\.py$/, nodePath);
      const net = await statuses.dotnet(/WorkflowsController\.cs$/, netAttr);
      const java = await statuses.java(javaPath);
      const ex = (await statuses.elixir(exPath)).filter((s) => s >= 400);
      expect({ py, net, java, ex }).toEqual({ py: node, net: node, java: node, ex: node });
    }
  });
});

describe("F13 (runtime) — every backend ANSWERS the not-found rung on a miss", () => {
  // The declaration half is only worth having if the code behind it agrees.
  // These read the emitted `getBy` read, which is where the split once lived
  // (.NET's `FirstAsync` 500, elixir's `200 null`).
  it("node throws the shared carrier from the repository method", async () => {
    const repo = await fileMatching(/wallet-repository\.ts$/);
    expect(repo).toMatch(
      /async getByOwnerRef\([^)]*\)[\s\S]*?if \(rootRows\.length === 0\) throw new AggregateNotFoundError/,
    );
  });

  it("python raises it from the repository method", async () => {
    const repo = await fileMatching(/wallet_repository\.py$/);
    expect(repo).toMatch(
      /async def get_by_owner_ref\([^)]*\)[\s\S]*?if row is None:\n\s+raise AggregateNotFoundError/,
    );
  });

  it("java throws it from the repository", async () => {
    const repo = await fileMatching(/WalletRepositoryImpl\.java$/);
    expect(repo).toMatch(
      /getByOwnerRef\(String ownerRef\)[\s\S]*?if \(result == null\) throw new AggregateNotFoundException/,
    );
  });

  it("dotnet throws it instead of letting EF's FirstAsync 500", async () => {
    // `FirstAsync` on an empty set throws `InvalidOperationException`, which no
    // filter arm matches — a 500 on a route the other backends 404.
    const repo = await fileMatching(/Infrastructure\/Repositories\/WalletRepository\.cs$/);
    expect(repo).toMatch(
      /GetByOwnerRef[\s\S]*?FirstOrDefaultAsync\(cancellationToken\) \?\? throw new AggregateNotFoundException/,
    );
    expect(repo).not.toMatch(/\.FirstAsync\(cancellationToken\)/);
  });

  it("dotnet's dapper adapter too", async () => {
    // `persistence: dapper` builds its own method bodies rather than riding
    // the EF terminal; a `null` from a declared `Task<Wallet>` is CS8603 under
    // `dotnet build /warnaserror`.  The dapper variant is generated from a
    // ONE-DEPLOYABLE source: `SRC`'s five deployables share context `N`, and
    // `loom.dapper-unsupported#schema-split` refuses a self-provisioning adapter
    // beside a migration-chain one on one context.
    const dapperSrc = SRC.split("\n")
      .filter((l) => !/^ {2}deployable (?!netApi)/.test(l))
      .join("\n")
      .replace(
        "deployable netApi  { platform: dotnet,",
        "deployable netApi  { platform: dotnet { persistence: dapper },",
      );
    const files = await generateSystemFiles(dapperSrc);
    const key = [...files.keys()].find((k) => /Repositories\/WalletRepository\.cs$/.test(k));
    expect(key, "no dapper wallet repository emitted").toBeDefined();
    const repo = files.get(key!)!;
    const at = repo.indexOf("public async Task<Wallet> GetByOwnerRef(");
    expect(at, "no non-optional GetByOwnerRef method emitted").toBeGreaterThan(-1);
    const body = repo.slice(at, repo.indexOf("\n    }", at));
    expect(body).toMatch(/r is null \? throw new AggregateNotFoundException\("not_found"\)/);
    expect(body).not.toMatch(/r is null \? null/);
  });

  it("elixir answers the problem response instead of `200 null`", async () => {
    const handler = await fileMatching(/handlers\/get_wallet_by_owner_ref\.ex$/);
    expect(handler).toContain('{:error, :not_found} -> {:error, {:not_found, "not_found"}}');
    const controller = await fileMatching(/n_api_routes_controller\.ex$/);
    expect(controller).toMatch(
      /def respond\(conn, \{:error, \{:not_found, detail\}\}\),\s+do: ProblemDetails\.problem_response\(conn, 404,/,
    );
  });
});

describe("F13 — a routed single-row read declares the 404 it answers", () => {
  it("node", async () => {
    expect(await statuses.node(/nApi-routes\.ts$/, "/wallets/by_owner_ref")).toContain(404);
  });

  it("python", async () => {
    expect(await statuses.python(/n_api_routes\.py$/, "/wallets/by_owner_ref")).toContain(404);
  });

  it("dotnet", async () => {
    expect(await statuses.dotnet(/NApiRoutesController\.cs$/, "GetWalletByOwnerRef(")).toContain(
      404,
    );
  });

  it("java", async () => {
    expect(await statuses.java("/api/wallets/by_owner_ref")).toContain(404);
  });

  it("elixir", async () => {
    expect(await statuses.elixir("/wallets/by_owner_ref")).toContain(404);
  });

  it("the COLLECTION read still declares none — `[]` is not an absent row", async () => {
    // The boundary of the fix.  A collection read answers an empty array for
    // "nothing matched", so it has no absent case and no rung.
    expect(await statuses.java("/api/wallets")).not.toContain(404);
    expect(await statuses.node(/wallet\.routes\.ts$/, "/")).not.toContain(404);
  });

  it("an OPTIONAL read answered with `notFound` declares its 404 too", async () => {
    expect(await statuses.java("/api/wallets/wallets_maybe_by_ref")).toContain(404);
    expect(await statuses.node(/nApi-routes\.ts$/, "/wallets/wallets_maybe_by_ref")).toContain(404);
  });
});
