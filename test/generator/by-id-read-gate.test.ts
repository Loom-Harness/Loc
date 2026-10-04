// The BY-ID read's `requires` gate (M-T3.19), on all five backends at once.
//
// Every non-abstract aggregate serves `GET /<aggs>/{id}`.  The route is
// compiler-derived, and until M-T3.19 it had no gate surface on ANY backend:
// a model could gate `find all` admin-only and still hand the same rows out
// one id at a time.  The surface is the repository find with the by-id shape:
//
//     repository Orders for Order {
//       find byId(id: Order id): Order? requires currentUser.role == "admin"
//     }
//
// What is pinned here, per backend:
//   - the gate is rendered on the `/{id}` route (not only on the find's own
//     `/by_id` route), and it runs BEFORE the load — a gate after the load
//     would already have read the row, and would turn the route into an
//     existence oracle (404 vs 403) for a refused caller;
//   - the negative control: without a `find byId`, the `/{id}` route carries no
//     gate machinery at all, so none of the above can pass by emitting a gate
//     unconditionally;
//   - the lowering half: a filterless `find byId` reads THE row (the shape's
//     only meaning), not the table's first one.
//
// Plus the elixir EVENT-SOURCED controller, which is a separate emitter and
// used to render both `index` and `show` without consulting any read gate.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/index.js";

const GATE = 'requires currentUser.role == "admin"';

const system = (platform: string, findClauses: string, aggMods = "") => `system Shop {
  user { id: string role: string }
  subdomain Sales {
    context Orders {
      aggregate Order${aggMods} {
        code: string
        ${aggMods ? 'create(code: string) { emit OrderOpened { code: code } }\n        apply(e: OrderOpened) { code := e.code }' : ""}
      }
      ${aggMods ? "event OrderOpened { code: string }" : ""}
      repository Orders for Order {
        ${findClauses}
      }
    }
  }
  api SalesApi from Sales
  storage pg { type: postgres }
  resource ordersState { for: Orders, kind: state, use: pg }
  deployable api { platform: ${platform} contexts: [Orders] dataSources: [ordersState] serves: SalesApi port: 8080 auth: required }
}`;

async function fileEndingWith(src: string, suffix: string): Promise<string> {
  const files = await generateSystemFiles(src);
  for (const [path, content] of files) if (path.endsWith(suffix)) return content;
  throw new Error(`no generated file ending with ${suffix}`);
}

/** `region(out)` cuts the by-id handler out of the file; `guard` is the exact
 *  emitted 403 check; `read` is the load it must precede. */
const BACKENDS = [
  {
    name: "node",
    file: "http/order.routes.ts",
    region: (out: string): string => sliceFrom(out, 'operationId: "getOrderById"', "\n  );"),
    guard: 'if (!(currentUser.role === "admin")) throw new ForbiddenError("Forbidden: find byId");',
    read: "repo.findById(",
  },
  {
    name: "dotnet",
    file: "Queries/GetOrderByIdHandler.cs",
    region: (out: string): string => out,
    guard:
      'if (!(currentUser.Role == "admin")) throw new ForbiddenException("Forbidden: find byId");',
    read: "_repo.GetByIdAsync(",
  },
  {
    name: "java",
    file: "OrdersController.java",
    region: (out: string): string => sliceFrom(out, "getOrderById(@PathVariable", "\n    }"),
    guard:
      'if (!(Objects.equals(currentUser.role(), "admin"))) throw new ForbiddenException("Forbidden: find byId");',
    read: "service.getOrderById(",
  },
  {
    name: "python",
    file: "http/order_routes.py",
    region: (out: string): string => sliceFrom(out, "async def get_order_by_id(", "\n\n"),
    guard: 'raise ForbiddenError("Forbidden: find byId")',
    read: "repo.get_by_id(",
  },
  {
    name: "elixir",
    file: "controllers/order_controller.ex",
    region: (out: string): string => sliceFrom(out, "def show(conn", "\n  end\n"),
    guard: '"Forbidden: find byId"',
    read: "Orders.get_order(",
  },
] as const;

function sliceFrom(out: string, start: string, end: string): string {
  const at = out.indexOf(start);
  if (at < 0) throw new Error(`region start not found: ${start}`);
  const stop = out.indexOf(end, at);
  return out.slice(at, stop < 0 ? undefined : stop);
}

describe("by-id read `requires` gate — GET /<aggs>/{id} (M-T3.19)", () => {
  for (const b of BACKENDS) {
    it(`${b.name}: 403s BEFORE the by-id load`, async () => {
      const out = await fileEndingWith(
        system(b.name, `find byId(id: Order id): Order? ${GATE}`),
        b.file,
      );
      const handler = b.region(out);
      const gateAt = handler.indexOf(b.guard);
      expect(gateAt, `gate not on the /{id} route on ${b.name}`).toBeGreaterThan(-1);
      const readAt = handler.indexOf(b.read);
      expect(readAt, `by-id load not found on ${b.name}`).toBeGreaterThan(-1);
      expect(readAt).toBeGreaterThan(gateAt);
    });
  }
});

describe("an UNGATED by-id read emits no gate machinery", () => {
  // The mutation control: without it, emitting a gate unconditionally would
  // pass every assertion above.
  for (const b of BACKENDS) {
    it(`${b.name}: no 403, no principal read on the /{id} route`, async () => {
      const out = await fileEndingWith(system(b.name, "find all(): Order[]"), b.file);
      const handler = b.region(out);
      expect(handler).not.toContain("Forbidden");
      expect(handler).not.toContain('"admin"');
    });
  }
});

describe("the by-id route declares 403 only when gated", () => {
  it("node: 403 in the /{id} route's declared responses", async () => {
    const gated = await fileEndingWith(
      system("node", `find byId(id: Order id): Order? ${GATE}`),
      "http/order.routes.ts",
    );
    const ungated = await fileEndingWith(system("node", ""), "http/order.routes.ts");
    const responses = (s: string): string => sliceFrom(s, 'operationId: "getOrderById"', "}),");
    expect(responses(gated)).toContain("403:");
    expect(responses(ungated)).not.toContain("403:");
  });
});

describe("a filterless `find byId` reads THE row", () => {
  it("node: the repository method filters on the id (not `.limit(1)` over the table)", async () => {
    const out = await fileEndingWith(
      system("node", `find byId(id: Order id): Order? ${GATE}`),
      "repositories/order-repository.ts",
    );
    const method = sliceFrom(out, "async byId(", "\n  }\n");
    expect(method).toContain("eq(schema.orders.id, id)");
  });
});

describe("elixir event-sourced controller honours the list AND by-id gates", () => {
  it("gates `index` and `show` before their loads", async () => {
    const out = await fileEndingWith(
      system(
        "elixir",
        `find all(): Order[] ${GATE}\n        find byId(id: Order id): Order? ${GATE}`,
        " persistedAs: eventLog",
      ),
      "controllers/order_controller.ex",
    );
    const index = sliceFrom(out, "def index(conn", "\n  end\n");
    const show = sliceFrom(out, "def show(conn", "\n  end\n");
    for (const [action, label, read] of [
      [index, "Forbidden: find all", "Orders.list_orders("],
      [show, "Forbidden: find byId", "Orders.get_order("],
    ] as const) {
      const gateAt = action.indexOf(label);
      expect(gateAt, `${label} gate missing`).toBeGreaterThan(-1);
      expect(action.indexOf(read)).toBeGreaterThan(gateAt);
    }
  });

  it("emits no gate when neither read declares one", async () => {
    const out = await fileEndingWith(
      system("elixir", "find all(): Order[]", " persistedAs: eventLog"),
      "controllers/order_controller.ex",
    );
    expect(sliceFrom(out, "def index(conn", "\n  end\n")).not.toContain("Forbidden");
    expect(sliceFrom(out, "def show(conn", "\n  end\n")).not.toContain("Forbidden");
  });
});
