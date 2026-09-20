// M-T3.16 C4 — a remapped `Forbidden` moves the LIFECYCLE rungs, on all five.
//
// The mission's own "what is left" list carried two goldens; this is the second
// of them (ledger `M-T3.16-C4-forbidden-remap-golden`). `errorStatuses("create",
// true)` / `("destroy", true)` resolve `Forbidden` through the api's
// `httpStatus <Error> -> <Code>` map — but nothing asserted it, and the two
// sibling suites that look like they might do not:
//
//   * `domain-floor-status-override.test.ts` remaps `Forbidden` on an OPERATION
//     (`operation cancel() requires …`), and scans the whole emitted project as
//     one string — so it cannot tell a create route's declaration from an
//     operation route's, and would pass with the lifecycle rungs stuck at 403.
//   * `lifecycle-guard-render.test.ts` pins the lifecycle GATE byte-exact, but a
//     gate raises a typed error; the STATUS is chosen downstream.
//
// So the shape under test is the one neither covers: a system whose ONLY
// guarded routes are the canonical `create` and `destroy`. 451 can then appear
// in the output for exactly one reason, which is what makes the assertions
// non-vacuous — and the control asserts it appears NOWHERE without the override,
// while 403 appears on both rungs.
//
// Per backend the declaration is read ROUTE-SCOPED rather than project-wide:
// java and python declare the whole per-route status set on one line, and
// node / dotnet / elixir are sliced between their own route markers. A test
// that only counted 451s across the project would pass if both of them landed
// on the same route.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

/** The ONLY guarded routes are the canonical `create` and `destroy`; `bump` is
 *  the UNGATED control operation, so an emitter that gated everything would be
 *  visible too. No `unique`, no `when`, no optional find — 451 has exactly one
 *  possible source. */
const SOURCE = (platform: string, apiBody: string) => `
system Gated {
  user { id: string  permissions: string[] }
  subdomain Sales {
    permissions { manage }
    context Sales {
      aggregate Order {
        quantity: int

        create(quantity: int) {
          requires currentUser.permissions.contains(permissions.manage)
        }
        destroy {
          requires currentUser.permissions.contains(permissions.manage)
        }
        operation bump() { quantity := quantity + 1 }
      }
      repository Orders for Order { }
    }
  }
  api SalesApi from Sales ${apiBody}
  storage primary { type: postgres }
  resource salesState { for: Sales, kind: state, use: primary }
  deployable api {
    platform: ${platform}
    contexts: [Sales]
    dataSources: [salesState]
    serves: SalesApi
    port: 8080
    auth: required
  }
}
`;

interface Spelling {
  /** Path suffix of the file carrying the per-route DECLARED status set. */
  readonly declFile: string;
  /** Start/end markers bounding the create route's declaration. */
  readonly createSlice: readonly [string, string];
  readonly destroySlice: readonly [string, string];
  /** The runtime `Forbidden` handler arm, byte-exact at the given status. */
  readonly arm: (status: number, title: string) => string;
}

const SPELLINGS: Record<string, Spelling> = {
  node: {
    declFile: "api/http/order.routes.ts",
    createSlice: ['operationId: "createOrder"', "async (c) =>"],
    destroySlice: ['operationId: "destroyOrder"', "async (c) =>"],
    arm: (s, t) => `return problem(${s}, "${t}", err.message);`,
  },
  dotnet: {
    declFile: "api/Api/OrdersController.cs",
    createSlice: ["[HttpPost]", "public async Task<ActionResult<CreateOrderResponse>> CreateOrder"],
    destroySlice: ['[HttpDelete("{id}")]', "public async Task<IActionResult> DestroyOrder"],
    arm: (s, t) => `Problem(context, ${s}, "${t}", fe.Message, trace_id);`,
  },
  java: {
    declFile: "api/src/main/java/com/loom/api/config/OpenApiContractCustomizer.java",
    // springdoc has no per-route annotations; the customizer bakes each route's
    // declared set as its own `new Route(...)` literal, which IS route-scoped.
    createSlice: ['new Route("post", "/api/orders",', "),"],
    destroySlice: ['new Route("delete", "/api/orders/{id}",', "),"],
    arm: (s, t) => `return respond(problem(${s}, "${t}", e.getMessage(), request), ${s});`,
  },
  python: {
    declFile: "api/app/http/order_routes.py",
    createSlice: ['operation_id="createOrder"', "\n"],
    destroySlice: ['operation_id="destroyOrder"', "\n"],
    arm: (s, t) => `return problem(request, ${s}, "${t}", str(err))`,
  },
  elixir: {
    declFile: "api/lib/api_web/api/sales_api_spec.ex",
    createSlice: ['operationId: "createOrder"', "operationId:"],
    destroySlice: ['operationId: "destroyOrder"', "operationId:"],
    // Phoenix gates in the CONTEXT and the controller maps the typed tuple.
    arm: (s, t) => `ProblemDetails.problem_response(conn, ${s}, "${t}", `,
  },
};

const PLATFORMS = Object.keys(SPELLINGS);

async function emit(platform: string, apiBody: string): Promise<Map<string, string>> {
  return await generateSystemFiles(SOURCE(platform, apiBody));
}

function pick(files: Map<string, string>, suffix: string): string {
  const key = [...files.keys()].find((k) => k.endsWith(suffix));
  expect(key, `${suffix} not emitted`).toBeDefined();
  return files.get(key as string) as string;
}

/** The text between `from` and the first `to` after it — the route's own
 *  declaration block.  Throws rather than silently returning "" if the markers
 *  are gone, so a drifted emitter fails loudly instead of vacuously. */
function slice(text: string, [from, to]: readonly [string, string]): string {
  const start = text.indexOf(from);
  expect(start, `route marker ${JSON.stringify(from)} not found`).toBeGreaterThan(-1);
  const rest = text.slice(start + from.length);
  const end = rest.indexOf(to);
  return end === -1 ? rest : rest.slice(0, end);
}

describe("M-T3.16 C4 — `httpStatus Forbidden -> 451` moves BOTH lifecycle rungs", () => {
  for (const platform of PLATFORMS) {
    const sp = SPELLINGS[platform] as Spelling;

    it(`${platform}: without the override both rungs declare 403 and 451 appears nowhere`, async () => {
      const files = await emit(platform, "");
      const all = [...files.values()].join("\n");
      expect(all, "451 must not appear without the override").not.toContain("451");
      const decl = pick(files, sp.declFile);
      expect(slice(decl, sp.createSlice), "the guarded create declares no 403").toContain("403");
      expect(slice(decl, sp.destroySlice), "the guarded destroy declares no 403").toContain("403");
    });

    it(`${platform}: with the override BOTH rungs declare 451, route-scoped`, async () => {
      const files = await emit(platform, "{ httpStatus Forbidden -> 451 }");
      const decl = pick(files, sp.declFile);
      const create = slice(decl, sp.createSlice);
      const destroy = slice(decl, sp.destroySlice);
      expect(create, "the create rung did not follow the override").toContain("451");
      expect(destroy, "the destroy rung did not follow the override").toContain("451");
      // And the stale code is gone from BOTH, or the contract advertises two
      // answers for one outcome.
      expect(create, "the create rung still declares the pre-override 403").not.toContain("403");
      expect(destroy, "the destroy rung still declares the pre-override 403").not.toContain("403");
    });

    // The title is the GENERIC "Error", and that is correct rather than a gap:
    // `problemTitle` deliberately has NO 451 entry, which is exactly what
    // `test/conformance/override-status-title-parity.test.ts` relies on to prove
    // the title follows the resolved STATUS and not the error NAME (an
    // `errorTitle("Forbidden")` would still read "Forbidden").  Adding an entry
    // here would silently remove that suite's discriminator, so this asserts
    // what ships rather than "improving" it.
    it(`${platform}: the runtime arm follows the override`, async () => {
      const all = [...(await emit(platform, "{ httpStatus Forbidden -> 451 }")).values()].join(
        "\n",
      );
      expect(all).toContain(sp.arm(451, "Error"));
      expect(all, "the pre-override arm survived").not.toContain(sp.arm(403, "Forbidden"));
    });
  }
});
