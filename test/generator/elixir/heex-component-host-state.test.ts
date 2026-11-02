import { describe, expect, it } from "vitest";
import {
  HEEX_HOST_STATE_PRIMITIVES,
  hostStatefulComponents,
} from "../../../src/ir/util/heex-component-host-state.js";
import { generateSystemFiles } from "../../_helpers/index.js";

// ---------------------------------------------------------------------------
// A HEEx function component is a pure render function with no process of its
// own, so a form / QueryView / Table / FileUpload / Chart written inside one
// needs the HOST LiveView to supply its assign, its `allow_upload/3` and its
// `handle_event/3` clause.  A component that (transitively) renders one is
// therefore INLINED into its caller by the walker: its bindings register on the
// host page, and no function component is emitted for it.
//
// Before the inlining, the markup was emitted inside the component and the host
// got nothing — output that passed `mix compile --warnings-as-errors` and then
// raised on page load for the assign that was never made.  Each case below
// asserts the binding that used to be missing is now on the host.
// ---------------------------------------------------------------------------

/** component body → a marker that must appear in the host LiveView. */
const CASES: Record<string, { body: string; host: string[] }> = {
  CreateForm: {
    body: "CreateForm { of: Customer }",
    host: ['handle_event("save_customer"', "assign(:form,"],
  },
  OperationForm: {
    body: "OperationForm { of: Customer, op: rename }",
    // `of:` + `op:` outside a Modal renders the aggregate-bound form shape.
    host: ['handle_event("save_customer"', "assign(:form,"],
  },
  WorkflowForm: {
    body: "WorkflowForm { runs: Signup }",
    host: ['handle_event("run_signup"'],
  },
  DestroyForm: {
    body: "DestroyForm { of: Customer }",
    host: ['handle_event("destroy_customer"'],
  },
  QueryView: {
    body: 'QueryView { of: Customer.all, data: rows => Text { "rows" } }',
    host: ["PhoenixApp.C.list_customers()", "assign(socket, :items, items)"],
  },
  Table: {
    body: 'QueryView { of: Customer.all, data: rows => Table { rows: rows, page: pg, Column { "Name", c => Text { c.name } } } }',
    // The page cursor is the component's own state: lifted under its namespaced assign.
    host: ['handle_event("loom-page"', "assign(socket, :inner_pg, page_num)"],
  },
  FileUpload: {
    body: "FileUpload { bind: pic }",
    // The upload key, the progress consumer and the FileRef write-back all use
    // the component's namespaced state assign.
    host: [
      "allow_upload(:inner_pic,",
      "defp handle_inner_pic_progress(:inner_pic,",
      "assign(socket, :inner_pic, file_ref)",
    ],
  },
  Chart: {
    body: 'Chart { kind: "bar", of: C.ByName, x: r => r.name, y: r => r.n }',
    host: ["assign(socket, :by_name, load_by_name(socket))"],
  },
};

const src = (componentBody: string, pageBody = "Inner()", stateful = true): string => `
system Demo {
  subdomain S {
    context C {
      aggregate Customer with crudish {
        name: string
        avatar: File?
        operation rename(n: string) { name := n }
      }
      repository Customers for Customer { }
      projection ByName {
        name: string
        n: int
        from Customer as c
        group by c.name
        select name = c.name, n = count()
      }
      workflow Signup { create(n: string) { let c = Customer.create(name: n) } }
    }
  }
  api CApi from S
  ui Web {
    api C: CApi
    component Inner() {
      ${stateful ? "state { shown: bool = false  pg: int = 1  pic: File }" : ""}
      body: ${componentBody}
    }
    page Home { route: "/customers/new" body: ${pageBody} }
    page Detail(id: Customer id) { route: "/customers/:id" body: Text { "d" } }
  }
  storage primary { type: postgres }
  storage blobs { type: localDisk }
  resource cState { for: C, kind: state, use: primary }
  resource cBlobs { for: C, kind: objectStore, use: blobs }
  deployable phoenixApp {
    platform: elixir contexts: [C] dataSources: [cState, cBlobs] serves: CApi
    ui: Web { C: phoenixApp } port: 4000
  }
}
`;

async function gen(
  componentBody: string,
  pageBody?: string,
  stateful?: boolean,
): Promise<{ host: string; components: string; all: Map<string, string> }> {
  const all = await generateSystemFiles(src(componentBody, pageBody, stateful));
  const find = (suffix: string): string => {
    for (const [p, c] of all) if (p.endsWith(suffix)) return c;
    throw new Error(`${suffix} not generated`);
  };
  return { host: find("/home_live.ex"), components: find("/ui_components.ex"), all };
}

describe("a host-state primitive inside a HEEx component is hoisted to the host LiveView", () => {
  for (const [primitive, { body, host }] of Object.entries(CASES)) {
    it(`${primitive} in a component registers its binding on the host page`, async () => {
      const out = await gen(body);
      for (const marker of host) expect(out.host).toContain(marker);
      // The component is inlined, not invoked: no function component exists for
      // it, and the page renders its markup directly.
      expect(out.components).not.toContain("def inner(");
      expect(out.host).not.toContain("UiComponents.inner");
    });
  }

  it("the inlined set is exactly the documented primitive set — a new member needs its own case", () => {
    expect([...HEEX_HOST_STATE_PRIMITIVES].sort()).toEqual(Object.keys(CASES).sort());
  });

  it("leaves a display-only component a function component", async () => {
    const out = await gen('Stack { Text { "hi" }, Text { shown } }');
    expect(out.components).toContain("def inner(");
    expect(out.host).toContain("UiComponents.inner");
  });

  it("inlines a component that merely renders a host-stateful one", () => {
    const body = (n: string) => `Stack { ${n} }`;
    void body;
    // Pure IR predicate: Outer calls Inner (stateful), Plain calls nothing.
    const ui = {
      components: [
        { name: "Inner", extern: false, body: { kind: "call", name: "CreateForm", args: [] } },
        { name: "Outer", extern: false, body: { kind: "call", name: "Inner", args: [] } },
        { name: "Plain", extern: false, body: { kind: "call", name: "Text", args: [] } },
      ],
    } as never;
    expect([...hostStatefulComponents(ui)].sort()).toEqual(["Inner", "Outer"]);
  });

  it("registers a component rendered twice once — one load, one submit clause", async () => {
    const out = await gen("CreateForm { of: Customer }", "Stack { Inner(), Inner() }", false);
    expect(out.host.match(/def handle_event\("save_customer"/g)).toHaveLength(1);
    expect(out.host.match(/assign\(:form,/g)).toHaveLength(1);
    // …while the markup is rendered at both call sites.
    expect(out.host.match(/phx-submit="save_customer"/g)).toHaveLength(2);
  });

  it("does not fire on a non-LiveView frontend, where the same body renders", async () => {
    const files = await generateSystemFiles(`
      system Demo2 {
        subdomain S { context C { aggregate Customer with crudish { name: string } repository Customers for Customer { } } }
        api CApi from S
        ui Web {
          api C: CApi
          component Inner() { body: CreateForm { of: Customer } }
          page Home { route: "/" body: Inner() }
        }
        storage primary { type: postgres }
        resource cState { for: C, kind: state, use: primary }
        deployable api { platform: node contexts: [C] dataSources: [cState] serves: CApi port: 4000 }
        deployable web { platform: react targets: api ui: Web { C: api } port: 3000 }
      }
    `);
    expect([...files.keys()].some((k) => k.endsWith("/pages/home.tsx"))).toBe(true);
  });
});
