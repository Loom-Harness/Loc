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
// `TS2300: Duplicate identifier`.  Angular escaped THAT one only by accident:
// its op-form emitter builds a `FormGroup` and never imports the operation's
// request interface, so no single file held both names.  The two colliding
// exports were emitted all the same, which is why the module-level assertion
// below covers Angular too.
//
// Angular had a SECOND, independent half.  It is the one frontend that turns a
// form into named CLASS MEMBERS of the page component (`<wf>Form`,
// `<wf>Run`, `onRun<Wf>`) rather than into generic function-scope locals
// (`form` / `run` on React, Vue and Svelte), and those members were derived
// from the raw workflow name.  The op form's `<op><Agg>Form` and the workflow
// form's `<wf>Form` therefore collapsed onto ONE spelling, and the component
// declared `scheduleWorkOrderForm` twice in one class body — `TS2393` /
// `TS2300`, with no import and no module export anywhere in it.  Legs 1 and 2
// read import bindings and top-level `export` declarations ONLY, so neither
// could ever see it; leg 4 reads the class bodies, which is the gap it closes.
//
// The gate has four legs, because the fix must hold on all four:
//   1. no emitted file imports one name from two modules (the compile error);
//   2. `api/workflows.ts` and the aggregate modules export disjoint names (the
//      cause, independent of which page happens to host which form);
//   3. a NON-colliding model keeps the historical spelling byte-for-byte (the
//      ratchet against "fix it by renaming everything"); and
//   4. no emitted Angular component declares one class member twice.
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

/** Every top-level member an emitted Angular component's class body declares,
 *  in order.  The emitter writes one member per line at exactly two spaces of
 *  indent — fields as `[modifiers] <name> = …`, methods as
 *  `[modifiers] <name>(…)` — and everything inside a method body is indented
 *  four or more, so a two-space line that opens with an identifier IS a member
 *  declaration.  Returns duplicates rather than a Set: the duplicate is the
 *  subject. */
function classMemberNames(src: string): string[] {
  const out: string[] = [];
  const lines = src.split("\n");
  let depth = 0; // class-body nesting, so a nested object literal can't contribute
  let inClass = false;
  for (const line of lines) {
    if (!inClass) {
      if (/^export\s+(?:abstract\s+)?class\s+[A-Za-z_$][\w$]*/.test(line)) inClass = true;
      continue;
    }
    if (/^\}/.test(line)) {
      inClass = false;
      continue;
    }
    const m =
      /^ {2}(?:(?:public|private|protected|readonly|static|override|async|declare)\s+)*([A-Za-z_$][\w$]*)\s*(?:[:=(<?!]|$)/.exec(
        line,
      );
    if (m && depth === 0) out.push(m[1]);
    // Tracked after the match so a member's own opening brace doesn't hide it.
    depth += (line.match(/\{/g)?.length ?? 0) - (line.match(/\}/g)?.length ?? 0);
    if (depth < 0) depth = 0;
  }
  return out;
}

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

  it("never declares one class member twice in an emitted Angular component", async () => {
    const files = await generateSystemFiles(COLLIDING);
    const components = [...files.keys()].filter((p) => /^weba\/.*\.component\.ts$/.test(p));
    expect(components.length).toBeGreaterThan(0);

    // Non-vacuity: the page under test really does host BOTH forms as class
    // members, so the assertion below is reading the colliding pair and not an
    // empty/unparsed class body.  Without this, a `classMemberNames` that
    // silently matched nothing would pass forever.
    const sched = files.get("weba/src/app/pages/sched.component.ts");
    expect(sched).toBeDefined();
    const schedMembers = classMemberNames(sched!);
    expect(schedMembers.filter((n) => n.endsWith("Form")).length).toBe(2);

    const offenders: string[] = [];
    for (const path of components) {
      const counts = new Map<string, number>();
      for (const name of classMemberNames(files.get(path)!))
        counts.set(name, (counts.get(name) ?? 0) + 1);
      for (const [name, n] of counts)
        if (n > 1) offenders.push(`${path}: '${name}' declared ${n}×`);
    }
    expect(offenders).toEqual([]);
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
    // Angular's class members hang off the same base, so they are covered by
    // the same ratchet — historical spelling, no kind qualifier.
    const ngPage = files.get("weba/src/app/pages/sched.component.ts");
    expect(ngPage).toBeDefined();
    expect(ngPage).toContain("  readonly dispatchRunForm = new FormGroup({");
    expect(ngPage).toContain("  readonly dispatchRunRun = useDispatchRunWorkflow();");
    expect(ngPage).toContain("  async onRunDispatchRun(): Promise<void> {");
    expect(ngPage).not.toContain("WorkflowDispatchRun");
  });
});
