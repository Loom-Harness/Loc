// ---------------------------------------------------------------------------
// F-023 — an aggregate OPERATION and a WORKFLOW whose names concatenate to the
// same identifier must not mint the same request type twice.
//
// `aggregate WorkOrder { operation schedule(…) }` beside
// `workflow scheduleWorkOrder(…)` is an ordinary naming pattern (docs/workflow.md's
// own examples use it).  It made `api/<agg>.ts` export `ScheduleWorkOrderRequest`
// (`<Op><Agg>Request`) and `api/workflows.ts` export `ScheduleWorkOrderRequest`
// (`<Wf>Request`) — two different shapes under one name — and a page hosting both
// forms imported both, so React / Vue / Svelte failed to compile with
// `TS2300: Duplicate identifier`.  Angular escaped only by accident: its op-form
// emitter builds a `FormGroup` and never imports the operation's request
// interface, so no single file held both names.  The two colliding exports were
// emitted all the same, which is why the module-level assertion below covers
// Angular too.
//
// The gate has three legs, because the fix must hold on all three:
//   1. no emitted file imports one name from two modules (the compile error);
//   2. `api/workflows.ts` and the aggregate modules export disjoint names (the
//      cause, independent of which page happens to host which form); and
//   3. a NON-colliding model keeps the historical spelling byte-for-byte (the
//      ratchet against "fix it by renaming everything").
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

/** A page hosting BOTH forms — the operation's and the workflow's — on the four
 *  TS frontends.  The op form needs a route `:id` (`loom.op-form-needs-route-id`). */
const COLLIDING = `
system P {
  api Pub from S
  subdomain S { context C {
    aggregate Tech with crudish { n: string  derived display: string = n }
    aggregate WorkOrder with crudish {
      techId: Tech id?
      at: datetime?
      derived display: string = "w"
      operation schedule(tech: Tech id, at: datetime) { techId := tech  at := at }
    }
    repository Techs for Tech {}
    repository WorkOrders for WorkOrder {}
    workflow scheduleWorkOrder {
      create(workOrder: WorkOrder id, technician: Tech id, at: datetime) {
        let w = WorkOrders.getById(workOrder)
        w.schedule(technician, at)
      }
    }
  } }
  storage db { type: postgres }
  resource st { for: C, kind: state, use: db }
  ui W {
    api P: Pub
    page Sched {
      route: "/sched/:id"
      body: Stack {
        WorkflowForm { runs: scheduleWorkOrder },
        OperationForm { of: WorkOrder, op: schedule }
      }
    }
  }
  deployable api { platform: node, contexts: [C], dataSources: [st], serves: Pub, port: 3000 }
  deployable web { platform: react, targets: api, ui: W { P: api }, port: 3001 }
  deployable webv { platform: vue, targets: api, ui: W { P: api }, port: 3002 }
  deployable webs { platform: svelte, targets: api, ui: W { P: api }, port: 3003 }
  deployable weba { platform: angular, targets: api, ui: W { P: api }, port: 3004 }
}
`;

/** The same system with the collision removed — the workflow renamed so no
 *  `<Op><Agg>` spells it.  Every emitted name must be the historical one. */
const CLEAN = COLLIDING.replace(/scheduleWorkOrder/g, "dispatchRun");

/** Every `import { a, b as c } from "…"` binding in one emitted file, as
 *  `localName → module`.  Covers `.ts` / `.tsx` and the `<script>` block of a
 *  `.vue` / `.svelte` file, which are all ES modules for this purpose. */
function importedBindings(src: string): Array<{ local: string; from: string }> {
  const out: Array<{ local: string; from: string }> = [];
  const re = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    for (const raw of m[1].split(",")) {
      const spec = raw.trim().replace(/^type\s+/, "");
      if (!spec) continue;
      const alias = spec.split(/\s+as\s+/);
      out.push({ local: (alias[1] ?? alias[0]).trim(), from: m[2] });
    }
  }
  return out;
}

/** Top-level `export const/type/interface/function/class <Name>` declarations. */
function exportedNames(src: string): Set<string> {
  const out = new Set<string>();
  const re =
    /^export\s+(?:declare\s+)?(?:const|type|interface|function|class)\s+([A-Za-z_$][\w$]*)/gm;
  for (let m = re.exec(src); m; m = re.exec(src)) out.add(m[1]);
  return out;
}

const SOURCE_EXT = /\.(ts|tsx|vue|svelte)$/;

describe("F-023: an operation and a workflow that share a name", () => {
  it("never imports one identifier from two modules into the same file", async () => {
    const files = await generateSystemFiles(COLLIDING);
    const offenders: string[] = [];
    for (const [path, src] of files) {
      if (!SOURCE_EXT.test(path)) continue;
      const seen = new Map<string, string>();
      for (const { local, from } of importedBindings(src)) {
        const prior = seen.get(local);
        // Two bindings of one local name is `TS2300: Duplicate identifier`
        // whether or not the modules differ; the module pair is what makes the
        // failure message diagnosable.
        if (prior !== undefined)
          offenders.push(`${path}: '${local}' from "${prior}" and "${from}"`);
        else seen.set(local, from);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("gives the workflow module and the aggregate modules disjoint exports", async () => {
    const files = await generateSystemFiles(COLLIDING);
    // One deployable per frontend; each has its own api module root.
    const workflowModules = [...files.keys()].filter((p) => /\/api\/workflows\.ts$/.test(p));
    expect(workflowModules.length).toBe(4);
    for (const wfPath of workflowModules) {
      const root = wfPath.slice(0, -"workflows.ts".length);
      const wfExports = exportedNames(files.get(wfPath)!);
      // The colliding pair really is in this module's scope — without this the
      // assertion below could pass on a module that emitted nothing.
      expect([...wfExports].some((n) => n.endsWith("Request"))).toBe(true);
      for (const [path, src] of files) {
        if (!path.startsWith(root) || path === wfPath || !path.endsWith(".ts")) continue;
        const clash = [...exportedNames(src)].filter((n) => wfExports.has(n));
        expect(clash, `${wfPath} and ${path} both export ${clash.join(", ")}`).toEqual([]);
      }
    }
  });

  it("leaves a collision-free model's names exactly as they were", async () => {
    const files = await generateSystemFiles(CLEAN);
    const react = files.get("web/src/api/workflows.ts");
    expect(react).toBeDefined();
    // The historical spelling — `<Wf>Request` / `use<Wf>Workflow`, no
    // kind qualifier.  A fix that renamed unconditionally would fail here.
    expect(react).toContain("export const DispatchRunRequest = z.object({");
    expect(react).toContain("export function useDispatchRunWorkflow() {");
    expect(react).not.toContain("WorkflowDispatchRun");
    const page = files.get("web/src/pages/sched.tsx");
    expect(page).toBeDefined();
    expect(page).toContain(
      `import { DispatchRunRequest, useDispatchRunWorkflow } from "../api/workflows";`,
    );
    // Angular, Vue and Svelte keep it too — the rule is shared, not per-target.
    expect(files.get("weba/src/api/workflows.ts")).toContain(
      "export interface DispatchRunRequest {",
    );
    expect(files.get("webv/src/api/workflows.ts")).toContain(
      "export const DispatchRunRequest = z.object({",
    );
    expect(files.get("webs/src/lib/api/workflows.ts")).toContain(
      "export const DispatchRunRequest = z.object({",
    );
  });
});
