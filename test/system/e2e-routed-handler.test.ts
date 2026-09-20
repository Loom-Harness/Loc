// The route class the `test e2e` surface could not address: an explicit
// `route <METHOD> <PATH> -> <Context>.<Handler>` binding.
//
// `api.<x>.<y>(…)` resolved to an aggregate or a folded projection ONLY, so a
// system whose whole api is routed handlers had no callable route at all —
// probing one answered
//
//   loom.e2e-unknown-aggregate: e2e: unknown aggregate 'api.sales' on this
//   deployable. Available aggregates: orders.
//
// and `test-checks.ts` said so in its own comment ("an explicit route … has no
// such slug and cannot be called from a test body yet").  Two corpus fixtures
// (`handler-triad`, `extern-handlers`) are entirely this shape, so both sat on
// `E2E_LESS_CORPUS_FIXTURES` with no runtime caller for any route they declare.
//
// A routed handler is now addressed through the SAME two-level shape, with the
// CONTEXT in the slug position and the HANDLER in the method position — the
// exact spelling the route arrow already uses (`-> Sales.Echo` →
// `api.sales.echo(…)`).  No grammar change: the call form was already
// parseable, it just resolved to nothing.
//
// What these tests pin, and why each matters:
//   • the REQUEST — method off the route, `{token}`s substituted from the
//     positionally matching argument, the rest in the JSON body.  That split
//     is not this file's invention: it mirrors what every backend's
//     explicit-route emitter reads (`emitRouteHandler` in
//     `src/platform/hono/v4/explicit-handlers-builder.ts` and its four twins),
//     which is why the resolution + binding live in ONE place
//     (`src/ir/util/routed-handler.ts`) consumed by the renderer and both
//     IR-validate checks.
//   • PRECEDENCE — an aggregate verb always wins, so a context whose name
//     slugs like an aggregate changes no existing call's meaning.
//   • the two REFUSALS — a wrong argument count (arguments bind positionally,
//     so a miscount shifts every later one and renders `undefined` into a URL
//     segment), and a bodyless method whose handler declares a param no
//     `{token}` binds (the backends read it from a request body a GET cannot
//     carry, so the argument would silently vanish).

import { describe, expect, it } from "vitest";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { generateSystemFiles } from "../_helpers/index.js";
import { toLoomModel } from "../_helpers/ir.js";
import { parseString } from "../_helpers/parse.js";

const head = (extra = "") => `
  system Routed {
    subdomain D {
      context Sales {
        aggregate Order with crudish {
          code: string
        }
        repository Orders for Order { }
        commandHandler Echo(text: string): string { return text }
        queryHandler Sum(a: int, b: int): int { return a + b }
        commandHandler Note(sku: string, memo: string): string { return memo }
      }
    }
    api A from D {
      route POST "/echo/{text}" -> Sales.Echo
      route GET  "/sum/{a}/{b}" -> Sales.Sum
      route POST "/notes/{sku}" -> Sales.Note
    }
    storage pg { type: postgres }
    resource s { for: Sales, kind: state, use: pg }
    deployable d {
      platform: node
      contexts: [Sales]
      dataSources: [s]
      serves: A
      port: 4000
    }
${extra}
  }
`;

const SYS = head(`
    test e2e "routed handlers" against d {
      expect(api.sales.echo("hi")).toBe("hi")
      expect(api.sales.sum(2, 3)).toBe(5)
      expect(api.sales.note("SKU-1", "hello")).toBe("hello")
    }
`);

const e2eOf = async (src: string): Promise<string> =>
  (await generateSystemFiles(src)).get("e2e/Routed.e2e.test.ts") as string;

/** The phase-⑦ (IR-validate) diagnostic codes a source raises. */
async function codesOf(src: string): Promise<string[]> {
  const { model, errors } = await parseString(src);
  expect(errors).toEqual([]);
  return validateLoomModel(toLoomModel(model)).map((d) => d.code);
}

/** The phase-⑦ diagnostics themselves, for message assertions. */
async function diagsOf(src: string): Promise<{ code: string; message: string }[]> {
  const { model } = await parseString(src);
  return validateLoomModel(toLoomModel(model));
}

describe("e2e routed handlers — the request", () => {
  it("takes the METHOD from the route, not from the verb name", async () => {
    const e2e = await e2eOf(SYS);
    // `echo` is a POST because the route says so; `sum` a GET for the same
    // reason.  No aggregate verb has this property — `create` is always POST.
    expect(e2e).toContain('await __route("POST", `${base}/api/echo/');
    expect(e2e).toContain('await __route("GET", `${base}/api/sum/');
  });

  it("substitutes each {token} from the param of the SAME NAME", async () => {
    const e2e = await e2eOf(SYS);
    // Two tokens, two positional args, bound by name in path order.
    expect(e2e).toContain(
      "`${base}/api/sum/${encodeURIComponent(String(2))}/${encodeURIComponent(String(3))}`",
    );
  });

  it("sends the params NO {token} binds as the JSON body", async () => {
    const e2e = await e2eOf(SYS);
    // `Note(sku, memo)` on `POST /notes/{sku}`: `sku` is path-bound, `memo` is
    // not — and every backend's emitter reads `memo` off `body.memo`.
    expect(e2e).toContain(
      '`${base}/api/notes/${encodeURIComponent(String("SKU-1"))}`, { memo: "hello" }',
    );
  });

  it("emits the __route helper ONLY when a suite calls a routed handler", async () => {
    const withoutRouted = head(`
    test e2e "aggregate only" against d {
      let o = api.orders.create({ code: "A" })
      expect(api.orders.getById(o).code).toBe("A")
    }
`);
    expect(await e2eOf(withoutRouted)).not.toContain("__route");
    expect(await e2eOf(SYS)).toContain("async function __route(");
  });

  it("every emitted routed request is a route the api DECLARES", async () => {
    // The route-contract question, asked of the api's own `routes` list rather
    // than of a hand-written string: a path the emitter invents but the model
    // does not declare is the `loom.e2e-unrouted-verb` defect class wearing a
    // different hat.
    const { model } = await parseString(SYS);
    const declared = new Set<string>();
    for (const sys of toLoomModel(model).systems) {
      for (const api of sys.apis) {
        for (const r of api.routes) declared.add(`${r.method.toUpperCase()} /api${r.path}`);
      }
    }
    const emitted = new Set<string>();
    for (const m of (await e2eOf(SYS)).matchAll(/__route\("(\w+)", `\$\{base\}([^`]*)`/g)) {
      emitted.add(`${m[1]} ${(m[2] as string).replace(/\$\{[^}]*\}/g, "{}")}`);
    }
    expect(emitted.size).toBe(3);
    for (const e of emitted) {
      // Collapse the declared `{token}` names the same way, so the comparison
      // is route-shape to route-shape.
      const shapes = new Set([...declared].map((d) => d.replace(/\{\w+\}/g, "{}")));
      expect(shapes, `emitted a request for an undeclared route: ${e}`).toContain(e);
    }
  });
});

describe("e2e routed handlers — precedence", () => {
  it("an aggregate verb still wins over a same-slugged context", async () => {
    // `context Orders` + `aggregate Order`: both slug to `orders`.  The
    // aggregate's own verbs must keep their meaning; only a verb the aggregate
    // does NOT have may fall through to a routed handler.
    const collide = `
  system Collide {
    subdomain D {
      context Orders {
        aggregate Order with crudish { code: string }
        repository Orders for Order { }
        queryHandler Tally(n: int): int { return n }
      }
    }
    api A from D { route GET "/tally/{n}" -> Orders.Tally }
    storage pg { type: postgres }
    resource s { for: Orders, kind: state, use: pg }
    deployable d {
      platform: node contexts: [Orders] dataSources: [s] serves: A port: 4000
    }
    test e2e "both" against d {
      let o = api.orders.create({ code: "A" })
      expect(api.orders.getById(o).code).toBe("A")
      expect(api.orders.tally(7)).toBe(7)
    }
  }
`;
    const e2e = (await generateSystemFiles(collide)).get("e2e/Collide.e2e.test.ts") as string;
    // The aggregate verbs render as they always did…
    expect(e2e).toContain("await __post(`${base}/api/orders`");
    expect(e2e).toContain("await __get(`${base}/api/orders/${o.id}`)");
    // …and only the verb the aggregate does not have routes to the handler.
    expect(e2e).toContain('await __route("GET", `${base}/api/tally/');
  });
});

describe("e2e routed handlers — the refusals", () => {
  it("accepts the well-formed calls with no diagnostic", async () => {
    // Non-vacuity for the two refusals below: the same system minus the defect
    // must be clean, or a refusal could be firing for an unrelated reason.
    expect(await codesOf(SYS)).toEqual([]);
  });

  it("refuses a WRONG ARGUMENT COUNT", async () => {
    const short = head(`
    test e2e "short call" against d {
      expect(api.sales.sum(2)).toBe(5)
    }
`);
    expect(await codesOf(short)).toContain("loom.e2e-routed-handler-arity");
  });

  it("refuses a bodyless method whose param no {token} binds", async () => {
    // `GET /quote` + `queryHandler Quote(sku: string)`: every backend reads
    // `sku` from a request BODY, which `fetch` cannot send on a GET — so the
    // argument would vanish and the assertion would silently test the default.
    const bodyless = `
  system Bodyless {
    subdomain D {
      context Sales {
        aggregate Order with crudish { code: string }
        repository Orders for Order { }
        queryHandler Quote(sku: string): string { return sku }
      }
    }
    api A from D { route GET "/quote" -> Sales.Quote }
    storage pg { type: postgres }
    resource s { for: Sales, kind: state, use: pg }
    deployable d {
      platform: node contexts: [Sales] dataSources: [s] serves: A port: 4000
    }
    test e2e "unsendable" against d {
      expect(api.sales.quote("SKU-1")).toBe("SKU-1")
    }
  }
`;
    expect(await codesOf(bodyless)).toContain("loom.e2e-routed-handler-bodyless-method");
  });

  it("still refuses a genuinely unknown slug, and names the routed handlers", async () => {
    const typo = head(`
    test e2e "typo" against d {
      expect(api.nosuch.echo("hi")).toBe("hi")
    }
`);
    const unknown = (await diagsOf(typo)).find((d) => d.code === "loom.e2e-unknown-aggregate");
    expect(unknown).toBeDefined();
    // The remedy the old message could not offer, because the class did not
    // exist: the spellings this deployable DOES answer.
    expect(unknown?.message).toContain("api.sales.echo");
  });
});
