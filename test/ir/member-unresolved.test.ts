import { describe, expect, it } from "vitest";
import { validate } from "../../src/api/index.js";

// `loom.member-unresolved` — the IR backstop for an invented member the
// language layer never typed (`src/ir/validate/checks/member-resolution-checks.ts`).
//
// Before it, every model below was `0 error(s), 0 warning(s)` and node emitted
// `(…)[0].nope` into domain/task.ts. The receivers are typed `unknown` by the
// language layer (a `let` bound from a list literal / a collection-op result),
// so the AST member check stood down.  Since the single typing pass (M-T5.47)
// the language layer types those receivers too, so the AST check refuses them
// first; the backstop still fires behind it, and stays the net for whatever
// the pass leaves `unknown`.

const wrap = (ops: string): string => `
system Tasks {
  subdomain P {
    context T {
      valueobject Addr { street: string }
      aggregate Task with crudish {
        title: string
        addr: Addr
        addrs: Addr[]
${ops}
      }
      repository Tasks for Task { }
    }
  }
  api TA from P
  storage primary { type: postgres }
  resource st { for: T, kind: state, use: primary }
  deployable api { platform: node contexts: [T] dataSources: [st] serves: TA port: 4000 }
}
`;

async function codes(src: string): Promise<{ code?: string; message: string }[]> {
  const r = await validate(src);
  return r.diagnostics.filter((d) => d.severity === "error");
}

describe("loom.member-unresolved", () => {
  it("refuses an invented member on a let-bound list element", async () => {
    const errs = await codes(
      wrap(`
        operation probe() {
          let xs = [this.addr]
          title := xs.first().nope
        }`),
    );
    expect(errs.map((e) => e.code)).toEqual(["loom.unknown-member", "loom.member-unresolved"]);
    const backstop = errs.find((e) => e.code === "loom.member-unresolved");
    expect(backstop?.message).toContain("'nope' is not a member of 'Addr'");
    expect(backstop?.message).toContain("street");
  });

  it("refuses an invented member read through a second let", async () => {
    const errs = await codes(
      wrap(`
        operation probe() {
          let xs = [this.addr, this.addr]
          let a = xs.first()
          title := a.nope
        }`),
    );
    expect(errs.map((e) => e.code)).toEqual(["loom.unknown-member", "loom.member-unresolved"]);
  });

  it("accepts the declared member through the same receivers", async () => {
    const errs = await codes(
      wrap(`
        operation probe() {
          let xs = [this.addr]
          title := xs.first().street
        }
        operation probe2() {
          let m = this.addrs.map(x => x)
          title := m.first().street
        }`),
    );
    expect(errs).toEqual([]);
  });

  it("does not double-report what the AST validator already refuses", async () => {
    // `this.addr.nope` types fine in the language layer, so the AST check
    // owns it. The IR backstop fires too, which is fine, but the AST message
    // must still be there.
    const errs = await codes(
      wrap(`
        derived d: string = this.addr.nope`),
    );
    expect(
      errs.map((e) => e.message).some((m) => m.includes("'nope' is not a member of 'Addr'")),
    ).toBe(true);
  });

  it("refuses a typo'd page-body field read off a QueryView row", async () => {
    // `data: o => … o.totl` in a QueryView over `Order`: AST-clean (the lambda
    // param is untyped in the language layer), refused here.
    const src = `
system X {
  subdomain S { context C {
    aggregate Order with crudish { total: int  derived display: string = "x" }
    repository Orders for Order { }
  } }
  api OrderApi from S
  ui Web with scaffold(subdomains: [S]) {
    framework: react
    api S: OrderApi
    page Bad(id: Order id) {
      route: "/bad/:id"
      body: QueryView { of: S.Order.byId(id), single: true,
        loading: Loader { }, empty: Empty { "none" },
        data: o => Stack { KeyValueRow { "Total", o.totl } } }
    }
  }
  storage p { type: postgres }
  resource r { for: C, kind: state, use: p }
  deployable api { platform: node, contexts: [C], dataSources: [r], serves: OrderApi, port: 3000 }
  deployable web { platform: react, targets: api, ui: Web { S: api }, port: 3001 }
}
`;
    const errs = await codes(src);
    expect(errs.map((e) => e.code)).toContain("loom.member-unresolved");
    expect(errs.find((e) => e.code === "loom.member-unresolved")?.message).toContain("'totl'");
  });
});
