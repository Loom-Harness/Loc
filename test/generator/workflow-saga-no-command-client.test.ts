// Regression for the claims D12 follow-up: an event-only saga
// (`create(e: Event) by …`) has no `POST /workflows/<wf>` route on any backend
// (the shared `emitsCommandRoute` rule), so no frontend may emit a request
// schema / call helper / service method that POSTs to it — dead code that 404s
// if called.  The saga's read-only instance hooks stay.

import { describe, expect, it } from "vitest";
import type { WorkflowIR } from "../../src/ir/types/loom-ir.js";
import { frontendRequestNames } from "../../src/ir/util/request-names.js";
import { generateSystemFiles } from "../_helpers/generate.js";

// A `web` deployable renders the framework its ui names; feliz, flutter and
// elixir are their own platforms.
const WEB_FRAMEWORKS = new Set(["react", "vue", "svelte", "angular"]);

const SYS = (opts: {
  withCommand: boolean;
  target: string;
  design?: string;
  /** Add a hand-written page hosting `WorkflowForm(runs: replicatePolicies)`. */
  page?: boolean;
}) => `
  system R { subdomain S { context A {
    aggregate P with crudish { name: string  derived display: string = name  operation go() { emit Went { p: id } } }
    aggregate R2 { p: P id }
    repository Ps for P { }
    repository R2s for R2 { }
    event Went { p: P id }
    ${opts.withCommand ? "workflow Cmd { create(n: string) { let p = P.create(name: n) } }" : ""}
    workflow replicatePolicies { p: P id  create(e: Went) by e.p { let r = R2.create(p: e.p) } }
  } }
    ui W with scaffold(subdomains: [S]) {
      ${WEB_FRAMEWORKS.has(opts.target) ? `framework: ${opts.target}` : ""}
      ${opts.page ? 'page Rp { route: "/rp" body: Card(WorkflowForm(runs: replicatePolicies)) }' : ""}
    }
    storage primary { type: postgres }
    resource a { for: A, kind: state, use: primary }
    ${
      opts.target === "elixir"
        ? "deployable api { platform: elixir, contexts: [A], dataSources: [a], port: 3000, ui: W }"
        : `deployable api { platform: node, contexts: [A], dataSources: [a], port: 3000 }
    deployable web { platform: ${WEB_FRAMEWORKS.has(opts.target) ? "web" : opts.target}, targets: api, ui: W, port: 3001${opts.design ? `, design: ${opts.design}` : ""} }`
    }
  }
`;

/** The four static-bundle frontends emit a `workflows.ts` API module. */
const MODULE_FRONTENDS = [
  { target: "react", design: "mantine", path: "web/src/api/workflows.ts" },
  { target: "vue", design: "vuetify", path: "web/src/api/workflows.ts" },
  { target: "svelte", design: "shadcnSvelte", path: "web/src/lib/api/workflows.ts" },
  { target: "angular", design: "angularMaterial", path: "web/src/api/workflows.ts" },
];

/** A POST to the saga's command route, in any of the emitted spellings. */
const SAGA_POST = /\/workflows\/replicate_policies[`"']/;

function webText(files: Map<string, string>): string {
  return [...files.entries()]
    .filter(([p]) => p.startsWith("web/"))
    .map(([, c]) => c)
    .join("\n");
}

describe("an event-only saga gets no frontend command call helper", () => {
  for (const fe of MODULE_FRONTENDS) {
    it(`${fe.target}: the command workflow keeps its call; the saga keeps only its instance reads`, async () => {
      const files = await generateSystemFiles(SYS({ withCommand: true, ...fe }));
      const mod = files.get(fe.path);
      expect(mod, `${fe.path} emitted`).toBeDefined();
      expect(mod).toContain("/workflows/cmd");
      expect(mod).toMatch(/CmdRequest/);
      expect(mod).not.toMatch(SAGA_POST);
      expect(mod).not.toMatch(/ReplicatePoliciesRequest|useReplicatePoliciesWorkflow/);
      // The saga is observable — its instance reads stay.
      expect(mod).toContain("/workflows/replicate_policies/instances");
      expect(webText(files)).not.toMatch(SAGA_POST);
    });

    it(`${fe.target}: with only the saga, no mutation import is left dangling`, async () => {
      const files = await generateSystemFiles(SYS({ withCommand: false, ...fe }));
      const mod = files.get(fe.path) ?? "";
      expect(mod).not.toMatch(SAGA_POST);
      expect(mod).not.toMatch(/useMutation|createMutation|injectMutation/);
      expect(mod).toContain("/workflows/replicate_policies/instances");
    });
  }

  it("request-name minting ignores an event-only saga (it publishes no `<Wf>Request`)", () => {
    // `createFoo` collides with aggregate Foo's `CreateFoo` and falls back to
    // `WorkflowCreateFoo` — unless a saga still "prefers" that spelling.
    const cmd = (name: string) =>
      ({ name, creates: [{ name: null, triggerKind: "command" }] }) as unknown as WorkflowIR;
    const saga = (name: string) =>
      ({ name, creates: [{ name: null, triggerKind: "event" }] }) as unknown as WorkflowIR;
    const names = frontendRequestNames(
      [{ name: "Foo", operations: [] }],
      [cmd("createFoo"), saga("workflowCreateFoo")],
    );
    expect(names.workflow("createFoo")).toBe("WorkflowCreateFoo");
  });
});

// A hand-written `WorkflowForm(runs: <saga>)` has nothing to submit to: every
// frontend's walker (the shared one, HEEx's form override included) gives
// up with `loom.page-ref-unreachable` instead of wiring a call to the
// non-existent route (or, on Phoenix, a `run/2` the backend never emits).
describe("WorkflowForm(runs: <event-only saga>) gives up on every frontend", () => {
  const GIVE_UP =
    /loom:unrendered \[loom\.page-ref-unreachable\] WorkflowForm\(runs: replicatePolicies\)/;
  const TARGETS = [
    { target: "react", design: "mantine" },
    { target: "vue", design: "vuetify" },
    { target: "svelte", design: "shadcnSvelte" },
    { target: "angular", design: "angularMaterial" },
    { target: "feliz" },
    { target: "flutter" },
    { target: "elixir" },
  ];
  for (const fe of TARGETS) {
    it(fe.target, async () => {
      const files = await generateSystemFiles(SYS({ withCommand: true, page: true, ...fe }));
      const all = [...files.values()].join("\n");
      expect(all).toMatch(GIVE_UP);
      expect(all).not.toMatch(SAGA_POST);
      expect(all).not.toMatch(
        /useReplicatePoliciesWorkflow|runReplicatePolicies|ReplicatePoliciesWorkflowForm|run_replicate_policies/,
      );
    });
  }
});
