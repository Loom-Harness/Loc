// A PREDICATE-READ MISS answers the canonical `"not_found"` TOKEN as its RFC
// 9457 `detail`, on every backend and on both single-row carriers.
//
// The third sibling of `not-found-by-id-detail-parity.test.ts` (RS-27 — the
// by-id read's `"<Aggregate> <id> not found"` SENTENCE) and
// `absent-read-envelope-parity.test.ts` (M-T6.31 — the projection/workflow-
// instance shows reach the one 404 producer).  Both of those gates deliberately
// scope the PREDICATE-read miss OUT: it is a different question with a
// different answer.  A by-id read addresses a row the caller already names, so
// the sentence can name it back; a read by a key or a criterion addresses a
// PREDICATE, and there is no id to put in a sentence — so its detail is the
// bare token.  Those two answers must stay two, which is why the last test in
// this file asserts the sentence is still emitted at the by-id site on all
// five.
//
// THE TWO CARRIERS.  A single-row read a client calls is one of:
//
//   carrier                         node        dotnet      java        python      elixir
//   `getBy(code: c)` (a unique key) repository  repository  repository  repository  handler
//   `find(C)` + `notFound` (scaffoldGet)
//                                   route       handler     handler     handler     handler
//
// Which arm throws is a per-backend EMISSION choice, so the matrix is written
// out in full: 5 backends x 2 carriers = 10 sites, each named by the emitted
// FILE that owns it and the REGION inside that file.  The miss once split
// INTRA-backend (node spelled the repository arm `"not found"` with a space
// while its route arm said `"not_found"`), so every site also carries a
// NEGATIVE beside its positive — the positive alone cannot tell "the arm
// throws" from "the arm was renamed", the negative alone cannot tell "it
// throws" from "the route was deleted".

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

/** One canonical single-backend system per platform: a natural-key read
 *  (`getBy` over `unique (code)`) and a criterion read, each put on the wire
 *  by `scaffoldGet` / `scaffoldGetApi`. */
function systemFor(platform: string, port: number): string {
  return `
system S {
  subdomain M {
    context C with scaffoldGet(of: ByStatus), scaffoldGet(of: Order, key: "code") {
      aggregate Order {
        code: string
        status: string
        unique (code)
      }
      repository Orders for Order
      criterion ByStatus(status: string) of Order = this.status == status
    }
  }
  api OrdersApi with scaffoldGetApi(of: ByStatus), scaffoldGetApi(of: Order, key: "code") from M
  storage pg { type: postgres }
  resource st { for: C, kind: state, use: pg }
  deployable api {
    platform: ${platform}
    contexts: [C]
    dataSources: [st]
    serves: OrdersApi
    port: ${port}
  }
}`;
}

const PORTS: Record<string, number> = {
  node: 3201,
  dotnet: 3202,
  java: 3203,
  python: 3204,
  elixir: 3205,
};

/** One emission per platform for the whole file. */
const EMISSIONS = new Map<string, Promise<Map<string, string>>>();
function emission(platform: string): Promise<Map<string, string>> {
  let p = EMISSIONS.get(platform);
  if (!p) {
    p = generateSystemFiles(systemFor(platform, PORTS[platform]!));
    EMISSIONS.set(platform, p);
  }
  return p;
}

async function fileOf(platform: string, suffix: string): Promise<string> {
  const files = await emission(platform);
  const hits = [...files.entries()].filter(([k]) => k.endsWith(suffix));
  expect(hits.length, `${platform}: no emitted file ends with ${suffix}`).toBeGreaterThan(0);
  return hits.map(([, v]) => v).join("\n");
}

/** The emitted text from `anchor` up to the next `end` after it (or EOF), so a
 *  region never bleeds into the sibling read below it — in particular not into
 *  the by-id read, whose 404 is a different rule. */
function region(src: string, anchor: string, end: string | undefined): string {
  const start = src.indexOf(anchor);
  expect(start, `anchor not emitted: ${anchor}`).toBeGreaterThanOrEqual(0);
  if (end === undefined) return src.slice(start);
  const stop = src.indexOf(end, start + anchor.length);
  return src.slice(start, stop >= 0 ? stop : undefined);
}

type Site = {
  platform: string;
  /** The emitted file that OWNS this carrier's miss. */
  file: string;
  anchor: string;
  /** Where the region stops; undefined = the rest of the file. */
  end?: string;
  /** Must appear in the region: the guard AND the throw carrying the token. */
  raises: string[];
  /** Must NOT appear in the region. */
  forbidden: string[];
};

/** The SPACE spelling, quoted — the regression this file was written for.
 *  Quoted deliberately: the bare words `not found` also occur inside RS-27's
 *  by-id SENTENCE, which is correct and must survive. */
const SPACE_SPELLING = '"not found"';

const SITES: Record<string, Site> = {
  // ── node ────────────────────────────────────────────────────────────────
  "node `getBy`": {
    platform: "node",
    file: "db/repositories/order-repository.ts",
    anchor: "async getByCode(",
    end: "\n  async ",
    raises: ['if (rootRows.length === 0) throw new AggregateNotFoundError("not_found");'],
    forbidden: [SPACE_SPELLING],
  },
  "node `find(C)`": {
    platform: "node",
    file: "http/ordersApi-routes.ts",
    anchor: 'path: "/orders/by_status"',
    end: "app.openapi(",
    raises: ["if (x === null) {", 'throw new AggregateNotFoundError("not_found");'],
    forbidden: [SPACE_SPELLING],
  },

  // ── dotnet ──────────────────────────────────────────────────────────────
  "dotnet `getBy`": {
    platform: "dotnet",
    file: "Infrastructure/Repositories/OrderRepository.cs",
    anchor: "public async Task<Order> GetByCode(",
    end: "public async",
    raises: ['?? throw new AggregateNotFoundException("not_found");'],
    forbidden: [SPACE_SPELLING],
  },
  "dotnet `find(C)`": {
    platform: "dotnet",
    file: "Queries/GetOrderByStatusHandler.cs",
    anchor: "public async ValueTask<Order> Handle(",
    raises: ['throw new AggregateNotFoundException("not_found");'],
    forbidden: [SPACE_SPELLING, "NotFound()"],
  },

  // ── java ────────────────────────────────────────────────────────────────
  // `ResponseEntity.notFound().build()` is banned per site: a 404 with an
  // EMPTY BODY never reaches the `@ExceptionHandler(AggregateNotFoundException)`
  // arm, so it carries no `detail` to be canonical about.
  "java `getBy`": {
    platform: "java",
    file: "features/orders/OrderRepositoryImpl.java",
    anchor: "public Order getByCode(String code)",
    end: "\n    }",
    raises: ['if (result == null) throw new AggregateNotFoundException("not_found");'],
    forbidden: [SPACE_SPELLING, "ResponseEntity.notFound().build()"],
  },
  "java `find(C)`": {
    platform: "java",
    file: "workflows/GetOrderByStatusHandler.java",
    anchor: "public Order handle(String status)",
    raises: ['throw new AggregateNotFoundException("not_found");'],
    forbidden: [SPACE_SPELLING, "ResponseEntity.notFound().build()"],
  },

  // ── python ──────────────────────────────────────────────────────────────
  // `status_code=404` is banned per site: a local `HTTPException` would bypass
  // the `@app.exception_handler` and answer FastAPI's own `{"detail": …}`.
  "python `getBy`": {
    platform: "python",
    file: "db/repositories/order_repository.py",
    anchor: "async def get_by_code(",
    end: "\n    async def ",
    raises: ["if row is None:", 'raise AggregateNotFoundError("not_found")'],
    forbidden: [SPACE_SPELLING, "status_code=404"],
  },
  "python `find(C)`": {
    platform: "python",
    file: "application/get_order_by_status.py",
    anchor: "async def get_order_by_status(",
    raises: ["if x is not None:", 'raise AggregateNotFoundError("not_found")'],
    forbidden: [SPACE_SPELLING, "status_code=404"],
  },

  // ── elixir ──────────────────────────────────────────────────────────────
  // Both handlers hand `{:not_found, "not_found"}` to the routes controller,
  // whose `respond/2` renders the detail it carries.  Neither goes through
  // `not_found_response/3` — that helper builds RS-27's SENTENCE from a
  // `kind`/`id` pair, and a predicate read has no id to name.
  "elixir `getBy`": {
    platform: "elixir",
    file: "handlers/get_order_by_code.ex",
    anchor: "def run(params)",
    raises: ['{:error, :not_found} -> {:error, {:not_found, "not_found"}}'],
    forbidden: [SPACE_SPELLING, "not_found_response"],
  },
  "elixir `find(C)`": {
    platform: "elixir",
    file: "handlers/get_order_by_status.ex",
    anchor: "def run(params)",
    raises: ["if x != nil do", '{:error, {:not_found, "not_found"}}'],
    forbidden: [SPACE_SPELLING, "not_found_response"],
  },
};

describe("a predicate-read miss answers the canonical `not_found` token, all five backends x both carriers", () => {
  for (const [name, site] of Object.entries(SITES)) {
    it(`${name} refuses the miss with the token`, async () => {
      const src = region(await fileOf(site.platform, site.file), site.anchor, site.end);
      for (const needle of site.raises) {
        expect(src, `${name}: missing ${needle}`).toContain(needle);
      }
      for (const banned of site.forbidden) {
        expect(src, `${name}: still emits ${banned}`).not.toContain(banned);
      }
    });
  }

  // ── the intra-backend half ───────────────────────────────────────────────
  // The cross-backend matrix above would go green on node if BOTH of its arms
  // said `"not found"`.  This says what the matrix cannot: the two arms of ONE
  // service agree, and they agree on the token.
  it("node's repository arm and its route arm spell the one 404 class the one way", async () => {
    const repo = await fileOf("node", "db/repositories/order-repository.ts");
    const routes = await fileOf("node", "http/ordersApi-routes.ts");
    expect(repo).toContain('throw new AggregateNotFoundError("not_found");');
    expect(routes).toContain('throw new AggregateNotFoundError("not_found");');
    expect(repo, "node repository spells the token with a space").not.toContain(
      'AggregateNotFoundError("not found")',
    );
    expect(routes, "node routes spell the token with a space").not.toContain(
      'AggregateNotFoundError("not found")',
    );
  });

  // The elixir handlers' detail only reaches the wire through the routes
  // controller's `{:not_found, detail}` clause; pinned so a refactor that
  // drops it (leaving the bare `:not_found` clause's "Resource not found")
  // fails here.
  it("elixir's routes controller renders the detail the handler carries", async () => {
    const ctrl = await fileOf("elixir", "controllers/orders_api_routes_controller.ex");
    expect(ctrl).toContain("def respond(conn, {:error, {:not_found, detail}}),");
    expect(ctrl).toContain('do: ProblemDetails.problem_response(conn, 404, "Not Found", detail)');
  });

  // The file-wide floor, per backend: the quoted SPACE spelling occurs nowhere
  // in any file that owns a miss site.
  it("no miss-site file on any backend carries the space-spelled token", async () => {
    for (const site of Object.values(SITES)) {
      expect(await fileOf(site.platform, site.file), `${site.platform} ${site.file}`).not.toContain(
        SPACE_SPELLING,
      );
    }
  });

  // ── RS-27's distinction, preserved ───────────────────────────────────────
  // Collapsing the by-id 404's sentence into the token "because both are 404s"
  // is the failure on the other side: the by-id read names a row, a predicate
  // read does not — so each backend must still emit BOTH spellings, at their
  // own sites.  (`not-found-by-id-detail-parity.test.ts` owns the sentence's
  // per-route pins; this is only the non-collapse assertion.)
  it("each backend still emits the by-id SENTENCE beside the predicate-miss TOKEN", async () => {
    const byId: Array<[string, string, string]> = [
      ["node", "db/repositories/order-repository.ts", "`Order ${id} not found`"],
      ["dotnet", "Api/OrdersController.cs", '$"Order {id} not found"'],
      ["java", "features/orders/OrderService.java", '"Order " + id + " not found"'],
      ["python", "db/repositories/order_repository.py", 'f"Order {id} not found"'],
      [
        "elixir",
        "api_web/controllers/order_controller.ex",
        'not_found_response(conn, "Order", id)',
      ],
    ];
    for (const [platform, file, sentence] of byId) {
      expect(
        await fileOf(platform, file),
        `${platform}: the by-id 404 no longer names the row — RS-27 collapsed into the predicate-miss token`,
      ).toContain(sentence);
    }
  });
});
