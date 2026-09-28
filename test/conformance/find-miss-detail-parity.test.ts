// A DECLARED-FIND MISS answers the canonical `"not_found"` TOKEN as its RFC
// 9457 `detail`, on every backend and on every single-row carrier.
//
// The third sibling of `not-found-by-id-detail-parity.test.ts` (RS-27 — the
// by-id read's `"<Aggregate> <id> not found"` SENTENCE) and
// `absent-read-envelope-parity.test.ts` (M-T6.31 — the projection/workflow-
// instance shows reach the one 404 producer).  Both of those gates deliberately
// scope the DECLARED-FIND miss OUT: it is a different question with a different
// answer.  A by-id read addresses a row the caller already names, so the
// sentence can name it back; a declared find addresses a PREDICATE, and there
// is no id to put in a sentence — so its detail is the bare token.  Those two
// answers must stay two, which is why the last test in this file asserts the
// sentence is still emitted at the by-id site on all five.
//
// WHAT WAS BROKEN.  node's REPOSITORY arm spelled the token `"not found"` —
// with a SPACE — where dotnet / python / java / elixir all answered
// `"not_found"`.  That made it a 4-vs-1 cross-backend split AND, worse, an
// INTRA-backend one: node answers from the ROUTE on its `T?` and `T option`
// carriers (`routes-builder.ts`, already the token) and from the REPOSITORY on
// its `: T` and `: T envelope` carriers (`repository-find-builder.ts`, the
// space) — one service spelling one 404 class two ways depending on which
// carrier the `find` happened to be declared with.  That is precisely the
// defect shape the two sibling gates exist to catch, and this class had no
// gate.
//
// WHY ALL FOUR CARRIERS AND NOT JUST THE BROKEN ONE.  Which arm throws is a
// per-backend EMISSION choice, not a language fact:
//
//   carrier        node          dotnet        java     python   elixir
//   `: T`          repository    repository    ctrl     route    ctrl
//   `: T?`         route         controller    ctrl     route    ctrl
//   `: T option`   route         controller    ctrl     route    ctrl
//   `: T envelope` repository    repository    ctrl     route    ctrl
//
// A gate that read one carrier would have been green on node through the whole
// regression (the `T?` arm was always right), and a gate that read one backend
// could not see the split at all.  So the matrix is written out in full: 5
// backends x 4 carriers = 20 sites, each named by the emitted FILE that owns it
// and the REGION inside that file.
//
// WHY PER-SITE REGIONS.  All four carriers of one backend land in one or two
// emitted files, and on node two of them emit the BYTE-IDENTICAL throw — so a
// file-wide `toContain` is satisfied by whichever sibling arm is still correct
// and would have stayed green through this very regression.  (That is the
// failure `not-found-by-id-detail-parity`'s first java pin actually shipped:
// it searched all `.java`, which `OrderRepositoryImpl` satisfied, so "java
// emits the sentence" was TRUE while the controller answered an empty body.)
// Every needle below is cut to its own site, and every site carries a NEGATIVE
// beside its positive — the positive alone cannot tell "the arm throws" from
// "the arm was renamed", the negative alone cannot tell "it throws" from "the
// route was deleted".

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

/** One canonical single-backend system per platform, declaring the SAME find
 *  four times over — once per single-row carrier.  A `find` over a non-id
 *  property is what makes these declared finds rather than by-id reads, which
 *  is the whole distinction this file guards. */
function systemFor(platform: string, port: number): string {
  return `
system S {
  subdomain M {
    context C {
      aggregate Order {
        code: string
        status: string
      }
      repository Orders for Order {
        find byBare(code: string): Order
        find byOpt(code: string): Order?
        find byOptn(code: string): Order option
        find byEnv(code: string): Order envelope
      }
    }
  }
  api OrdersApi from M
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

/** One emission per platform for the whole file — 20 sites plus the guard tests
 *  all read the same five file maps rather than re-running the pipeline per
 *  assertion. */
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

/** The emitted text from `anchor` up to the NEXT boundary anchor that follows
 *  it (or EOF).  `boundaries` is the file's full ordered set of cut points —
 *  the four carrier anchors plus a trailing sentinel for whichever one is last
 *  — so a region can never bleed into the sibling arm below it, nor into the
 *  by-id read whose 404 is a different rule. */
function region(src: string, anchor: string, boundaries: string[]): string {
  const start = src.indexOf(anchor);
  expect(start, `anchor not emitted: ${anchor}`).toBeGreaterThanOrEqual(0);
  const ends = boundaries.map((b) => src.indexOf(b, start + anchor.length)).filter((i) => i >= 0);
  return src.slice(start, ends.length ? Math.min(...ends) : undefined);
}

/** Per emitted file: the anchors that open each carrier's site, plus the
 *  trailing sentinel that closes the last of them. */
const REPO_TS = [
  "async byBare(",
  "async byOpt(",
  "async byOptn(",
  "async byEnv(",
  "toWire(root: Order)",
];
const ROUTES_TS = [
  'operationId: "byBareOrder"',
  'operationId: "byOptOrder"',
  'operationId: "byOptnOrder"',
  'operationId: "byEnvOrder"',
  'operationId: "getOrderById"',
];
const REPO_CS = [
  "public async Task<Order> ByBare(",
  "public async Task<Order?> ByOpt(",
  "public async Task<Order?> ByOptn(",
  "public async Task<Order> ByEnv(",
];
const CTRL_CS = ["ByBareOrder(", "ByOptOrder(", "ByOptnOrder(", "ByEnvOrder("];
const CTRL_JAVA = ["byBareOrder(", "byOptOrder(", "byOptnOrder(", "byEnvOrder("];
const ROUTES_PY = [
  'operation_id="byBareOrder"',
  'operation_id="byOptOrder"',
  'operation_id="byOptnOrder"',
  'operation_id="byEnvOrder"',
  'operation_id="getOrderById"',
];
const CTRL_EX = [
  "def by_bare(conn, params)",
  "def by_opt(conn, params)",
  "def by_optn(conn, params)",
  "def by_env(conn, params)",
  "defp page_param(",
];

type Site = {
  platform: string;
  /** The emitted file that OWNS this carrier's miss. */
  file: string;
  anchor: string;
  boundaries: string[];
  /** Must appear in the region: the guard AND the throw carrying the token. */
  raises: string[];
  /** Must NOT appear in the region. */
  forbidden: string[];
};

/** The SPACE spelling, quoted — the exact regression this file was written for.
 *  Quoted deliberately: the bare words `not found` also occur inside RS-27's
 *  by-id SENTENCE, which is correct and must survive, so banning the unquoted
 *  substring would ban the sibling rule. */
const SPACE_SPELLING = '"not found"';

const SITES: Record<string, Site> = {
  // ── node ────────────────────────────────────────────────────────────────
  // `: T` and `: T envelope` return a NON-nullable aggregate, so the miss can
  // only be refused where the rows are read: the repository.  This was the
  // broken arm.
  "node `: T`": {
    platform: "node",
    file: "db/repositories/order-repository.ts",
    anchor: "async byBare(",
    boundaries: REPO_TS,
    raises: ['if (rootRows.length === 0) throw new AggregateNotFoundError("not_found");'],
    forbidden: [SPACE_SPELLING],
  },
  // `: T?` / `: T option` hand a nullable back and the ROUTE refuses it — the
  // arms that were already right, pinned so the alignment is symmetric rather
  // than assumed.
  "node `: T?`": {
    platform: "node",
    file: "http/order.routes.ts",
    anchor: 'operationId: "byOptOrder"',
    boundaries: ROUTES_TS,
    raises: ['if (result == null) throw new AggregateNotFoundError("not_found");'],
    forbidden: [SPACE_SPELLING],
  },
  "node `: T option`": {
    platform: "node",
    file: "http/order.routes.ts",
    anchor: 'operationId: "byOptnOrder"',
    boundaries: ROUTES_TS,
    raises: ['if (result == null) throw new AggregateNotFoundError("not_found");'],
    forbidden: [SPACE_SPELLING],
  },
  "node `: T envelope`": {
    platform: "node",
    file: "db/repositories/order-repository.ts",
    anchor: "async byEnv(",
    boundaries: REPO_TS,
    raises: ['if (rootRows.length === 0) throw new AggregateNotFoundError("not_found");'],
    forbidden: [SPACE_SPELLING],
  },

  // ── dotnet ──────────────────────────────────────────────────────────────
  // The same repository/controller split as node, by the same reasoning — and
  // the reason node's divergence was a real cross-backend gap rather than a
  // layering difference: the two backends put the throw in the same place and
  // then spelled it differently.
  "dotnet `: T`": {
    platform: "dotnet",
    file: "Infrastructure/Repositories/OrderRepository.cs",
    anchor: "public async Task<Order> ByBare(",
    boundaries: REPO_CS,
    raises: ['?? throw new AggregateNotFoundException("not_found");'],
    forbidden: [SPACE_SPELLING],
  },
  "dotnet `: T?`": {
    platform: "dotnet",
    file: "Api/OrdersController.cs",
    anchor: "ByOptOrder(",
    boundaries: CTRL_CS,
    raises: [
      'if (result is null) throw new global::Api.Domain.Common.AggregateNotFoundException("not_found");',
    ],
    forbidden: [SPACE_SPELLING, "NotFound()"],
  },
  "dotnet `: T option`": {
    platform: "dotnet",
    file: "Api/OrdersController.cs",
    anchor: "ByOptnOrder(",
    boundaries: CTRL_CS,
    raises: [
      "if (result is null)",
      'throw new global::Api.Domain.Common.AggregateNotFoundException("not_found");',
    ],
    forbidden: [SPACE_SPELLING, "NotFound()"],
  },
  "dotnet `: T envelope`": {
    platform: "dotnet",
    file: "Infrastructure/Repositories/OrderRepository.cs",
    anchor: "public async Task<Order> ByEnv(",
    boundaries: REPO_CS,
    raises: ['?? throw new AggregateNotFoundException("not_found");'],
    forbidden: [SPACE_SPELLING],
  },

  // ── java ────────────────────────────────────────────────────────────────
  // All four throw at the CONTROLLER — the service hands a nullable back on
  // every carrier.  `ResponseEntity.notFound().build()` is banned per site for
  // the reason `absent-read-envelope-parity` bans it: it is a 404 with an EMPTY
  // BODY that never reaches the `@ExceptionHandler(AggregateNotFoundException)`
  // arm, so it carries no `detail` to be canonical about.
  "java `: T`": {
    platform: "java",
    file: "features/orders/OrdersController.java",
    anchor: "byBareOrder(",
    boundaries: CTRL_JAVA,
    raises: ['if (response == null) throw new AggregateNotFoundException("not_found");'],
    forbidden: [SPACE_SPELLING, "ResponseEntity.notFound().build()"],
  },
  "java `: T?`": {
    platform: "java",
    file: "features/orders/OrdersController.java",
    anchor: "byOptOrder(",
    boundaries: CTRL_JAVA,
    raises: ['if (response == null) throw new AggregateNotFoundException("not_found");'],
    forbidden: [SPACE_SPELLING, "ResponseEntity.notFound().build()"],
  },
  "java `: T option`": {
    platform: "java",
    file: "features/orders/OrdersController.java",
    anchor: "byOptnOrder(",
    boundaries: CTRL_JAVA,
    raises: ["if (r == null) {", 'throw new AggregateNotFoundException("not_found");'],
    forbidden: [SPACE_SPELLING, "ResponseEntity.notFound().build()"],
  },
  "java `: T envelope`": {
    platform: "java",
    file: "features/orders/OrdersController.java",
    anchor: "byEnvOrder(",
    boundaries: CTRL_JAVA,
    raises: ['if (response == null) throw new AggregateNotFoundException("not_found");'],
    forbidden: [SPACE_SPELLING, "ResponseEntity.notFound().build()"],
  },

  // ── python ──────────────────────────────────────────────────────────────
  // All four raise in the ROUTE, which the `@app.exception_handler` renders.
  // `status_code=404` is banned per site (as in `absent-read-envelope-parity`)
  // because a local `HTTPException`/`JSONResponse` would bypass that handler
  // and answer FastAPI's own `{"detail": …}` shape instead of 7807.
  "python `: T`": {
    platform: "python",
    file: "http/order_routes.py",
    anchor: 'operation_id="byBareOrder"',
    boundaries: ROUTES_PY,
    raises: ["if found is None:", 'raise AggregateNotFoundError("not_found")'],
    forbidden: [SPACE_SPELLING, "status_code=404"],
  },
  "python `: T?`": {
    platform: "python",
    file: "http/order_routes.py",
    anchor: 'operation_id="byOptOrder"',
    boundaries: ROUTES_PY,
    raises: ["if found is None:", 'raise AggregateNotFoundError("not_found")'],
    forbidden: [SPACE_SPELLING, "status_code=404"],
  },
  "python `: T option`": {
    platform: "python",
    file: "http/order_routes.py",
    anchor: 'operation_id="byOptnOrder"',
    boundaries: ROUTES_PY,
    raises: [
      "if (found := await repo.by_optn(code)) is None:",
      'raise AggregateNotFoundError("not_found")',
    ],
    forbidden: [SPACE_SPELLING, "status_code=404"],
  },
  "python `: T envelope`": {
    platform: "python",
    file: "http/order_routes.py",
    anchor: 'operation_id="byEnvOrder"',
    boundaries: ROUTES_PY,
    raises: ["if found is None:", 'raise AggregateNotFoundError("not_found")'],
    forbidden: [SPACE_SPELLING, "status_code=404"],
  },

  // ── elixir ──────────────────────────────────────────────────────────────
  // Phoenix answers all four from the controller's `{:ok, nil}` clause through
  // the shared `ProblemDetails` producer.  Note it does NOT go through
  // `not_found_response/3` — that helper builds RS-27's SENTENCE from a
  // `kind`/`id` pair, and a declared find has no id to name.
  "elixir `: T`": {
    platform: "elixir",
    file: "api_web/controllers/order_controller.ex",
    anchor: "def by_bare(conn, params)",
    boundaries: CTRL_EX,
    raises: [
      "{:ok, nil} ->",
      'ProblemDetails.problem_response(conn, 404, "Not Found", "not_found")',
    ],
    forbidden: [SPACE_SPELLING, 'json(%{"error" => "not found"})'],
  },
  "elixir `: T?`": {
    platform: "elixir",
    file: "api_web/controllers/order_controller.ex",
    anchor: "def by_opt(conn, params)",
    boundaries: CTRL_EX,
    raises: [
      "{:ok, nil} ->",
      'ProblemDetails.problem_response(conn, 404, "Not Found", "not_found")',
    ],
    forbidden: [SPACE_SPELLING, 'json(%{"error" => "not found"})'],
  },
  "elixir `: T option`": {
    platform: "elixir",
    file: "api_web/controllers/order_controller.ex",
    anchor: "def by_optn(conn, params)",
    boundaries: CTRL_EX,
    raises: [
      "{:ok, nil} ->",
      'ProblemDetails.problem_response(conn, 404, "Not Found", "not_found")',
    ],
    forbidden: [SPACE_SPELLING, 'json(%{"error" => "not found"})'],
  },
  "elixir `: T envelope`": {
    platform: "elixir",
    file: "api_web/controllers/order_controller.ex",
    anchor: "def by_env(conn, params)",
    boundaries: CTRL_EX,
    raises: [
      "{:ok, nil} ->",
      'ProblemDetails.problem_response(conn, 404, "Not Found", "not_found")',
    ],
    forbidden: [SPACE_SPELLING, 'json(%{"error" => "not found"})'],
  },
};

describe("a declared-find miss answers the canonical `not_found` token, all five backends x all four carriers", () => {
  for (const [name, site] of Object.entries(SITES)) {
    it(`${name} refuses the miss with the token`, async () => {
      const src = region(await fileOf(site.platform, site.file), site.anchor, site.boundaries);
      for (const needle of site.raises) {
        expect(src, `${name}: missing ${needle}`).toContain(needle);
      }
      for (const banned of site.forbidden) {
        expect(src, `${name}: still emits ${banned}`).not.toContain(banned);
      }
    });
  }

  // ── the intra-backend half ───────────────────────────────────────────────
  // The cross-backend matrix above would have gone green on node if BOTH of its
  // arms had said `"not found"`.  This says the thing the matrix cannot: the
  // two arms of ONE service agree, and they agree on the token.
  it("node's repository arm and its route arm spell the one 404 class the one way", async () => {
    const repo = await fileOf("node", "db/repositories/order-repository.ts");
    const routes = await fileOf("node", "http/order.routes.ts");
    expect(repo).toContain('throw new AggregateNotFoundError("not_found");');
    expect(routes).toContain('throw new AggregateNotFoundError("not_found");');
    // The regression, banned on both halves at once.
    expect(repo, "node repository still spells the token with a space").not.toContain(
      'AggregateNotFoundError("not found")',
    );
    expect(routes, "node routes still spells the token with a space").not.toContain(
      'AggregateNotFoundError("not found")',
    );
  });

  // The file-wide floor, per backend: the quoted SPACE spelling occurs nowhere
  // in any file that owns a find-miss site.  Quoted, so RS-27's by-id sentence
  // (`Order ${id} not found`) — which contains the same two words unquoted and
  // must survive — is untouched by this ban.
  it("no miss-site file on any backend carries the space-spelled token", async () => {
    const owners: Array<[string, string]> = [
      ["node", "db/repositories/order-repository.ts"],
      ["node", "http/order.routes.ts"],
      ["dotnet", "Infrastructure/Repositories/OrderRepository.cs"],
      ["dotnet", "Api/OrdersController.cs"],
      ["java", "features/orders/OrdersController.java"],
      ["python", "http/order_routes.py"],
      ["elixir", "api_web/controllers/order_controller.ex"],
    ];
    for (const [platform, file] of owners) {
      expect(await fileOf(platform, file), `${platform} ${file}`).not.toContain(SPACE_SPELLING);
    }
  });

  // ── the carriers that DELEGATE ───────────────────────────────────────────
  // node's and dotnet's `: T` / `: T envelope` routes hand the repository's
  // value straight back.  Pinned as a negative so a future "fix" that re-adds a
  // route-local 404 beside the repository's — the way the two backends'
  // by-id reads once did (RS-27) — fails here rather than on a booted leg.
  it("node's and dotnet's non-nullable carriers do not hand-roll a second 404 at the route", async () => {
    const routes = await fileOf("node", "http/order.routes.ts");
    for (const carrier of ['operationId: "byBareOrder"', 'operationId: "byEnvOrder"']) {
      expect(region(routes, carrier, ROUTES_TS), `node ${carrier}`).not.toContain(
        "AggregateNotFoundError",
      );
    }
    const controller = await fileOf("dotnet", "Api/OrdersController.cs");
    for (const carrier of ["ByBareOrder(", "ByEnvOrder("]) {
      expect(region(controller, carrier, CTRL_CS), `dotnet ${carrier}`).not.toContain(
        "AggregateNotFoundException",
      );
    }
  });

  // ── RS-27's distinction, preserved ───────────────────────────────────────
  // The failure mode on the OTHER side of this change: collapsing the by-id
  // 404's sentence into the token because "both are 404s".  They are not the
  // same question — the by-id read names a row, a declared find names a
  // predicate — so each backend must still emit BOTH spellings, at their own
  // sites.  (`not-found-by-id-detail-parity.test.ts` owns the sentence's own
  // per-route pins; this is only the non-collapse assertion.)
  it("each backend still emits the by-id SENTENCE beside the find-miss TOKEN", async () => {
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
        `${platform}: the by-id 404 no longer names the row — RS-27 collapsed into the find-miss token`,
      ).toContain(sentence);
    }
  });
});
