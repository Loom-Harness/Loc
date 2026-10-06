// -------------------------------------------------------------------------
// UI ↔ backend wiring gates.
//
// A frontend deployable names ONE backend in `targets:`, and that is what its
// generated surface is built from: enrichment copies the target's
// `contextNames` onto the frontend so the page emitter has every served
// aggregate's wire shape in scope, and the emitted client reads ONE
// `API_BASE_URL`.
//
// A `ui` may nevertheless declare several api parameters and bind each to a
// different backend (`ui: U { O: apiOne, T: apiTwo }`).  That parses, binds,
// and type-checks in the model — and then the two halves disagree: only the
// `targets:` backend's aggregates reach the emitter, so a page reading the
// second handle imports an api module that is never written
// (`TS2307: Cannot find module '../api/beta'`) while compose bakes a single
// `VITE_API_BASE_URL` pointing at the first backend.  `0 error(s), 0
// warning(s)`, 101 files, a frontend that does not build.
//
// Until per-handle clients and base URLs land, the honest answer is to refuse
// the combination rather than emit a bundle whose requests go to a backend
// that does not serve them.  Refusing costs nothing today: the shape does not
// compile, so no working model can be relying on it.
// -------------------------------------------------------------------------

import { diagMessage } from "../../../diagnostics/messages.js";
import { descriptorFor } from "../../../platform/metadata.js";
import type { ActionIR, DerivedIR, ExprIR, StateFieldIR, SystemIR } from "../../types/loom-ir.js";
import { walkExprDeep, walkStmtExprsDeep } from "../../util/walk.js";
import type { LoomDiagnostic } from "./diagnostic.js";

export function validateUiBackendBindings(sys: SystemIR, diags: LoomDiagnostic[]): void {
  for (const d of sys.deployables) {
    const bindings = d.uiBindings ?? [];
    if (bindings.length < 2) continue;
    // Several handles onto the SAME backend is the ordinary case (one contract
    // per subdomain, one service serving them all) and is fully supported —
    // only a genuine fan-out across distinct deployables is the unsupported
    // shape.
    const sources = [...new Set(bindings.map((b) => b.sourceDeployableName))].sort();
    if (sources.length < 2) continue;
    // Deterministic, and it names the handles the author wrote rather than
    // just the backends, because the handle is what they would edit.
    const pairs = bindings
      .slice()
      .sort((a, b) => a.paramName.localeCompare(b.paramName))
      .map((b) => `${b.paramName} → ${b.sourceDeployableName}`)
      .join(", ");
    diags.push({
      severity: "error",
      code: "loom.ui-multi-backend-unsupported",
      message: diagMessage("loom.ui-multi-backend-unsupported", {
        dName: d.name,
        uiName: d.uiName ?? "(none)",
        pairs,
        targetName: d.targetName ?? "(none)",
        count: sources.length,
      }),
      source: `${d.name}/${d.uiName ?? "ui"}`,
    });
  }
}

// -------------------------------------------------------------------------
// A ui page reading an aggregate its `targets:` backend does not serve.
//
// The same one-backend fact from the other side.  Enrichment narrows a
// frontend's `contextNames` to its `targets:` backend's, and every frontend
// emitter builds its api modules and hooks from that narrowed set.  A page
// that reads an aggregate from any OTHER context — most often because
// `with scaffold(subdomains: [A, B])` selected a subdomain the target does
// not serve — therefore reached the walker with nothing to bind to:
//
//   - with no api handle, `Task.all` fell through the api-hook detector and
//     `generate` failed on the generated page (`loom.method-call-unresolved-
//     receiver web/src/pages/tasks/list.tsx:24`), naming neither the `.ddd`
//     scaffold nor `targets:`;
//   - with one handle bound (`ui: Web { Notes: api }`), the scaffold routed
//     `Notes.Task.all` through it, `generate` exited 0, and the page imported
//     `../../api/task` — a module never written (TS2307 at build time).
//
// `parse` reported 0 errors both times.  This check makes it a phase-⑦ error
// naming the ui, the subdomain and the `targets:` deployable, once per
// (frontend, ui, unserved context).  It reads ONLY what the emitter binds an
// api read to: a bare aggregate ref (`Task.all`, `CreateForm { of: Task }`) or
// a handle-rooted one (`Notes.Task.all`).  Locals, params and lambda bindings
// lower to other `refKind`s and never match.  (The handle-rooted arm is a
// belt: a HAND-WRITTEN `Notes.Task` is already refused at phase ④ — "Aggregate
// 'Task' not found in api 'NotesApi'" — and today's scaffold pages always carry
// a bare `Task` ref beside the handle-rooted read, which the first arm sees.)
// -------------------------------------------------------------------------

interface ScannedBody {
  state: StateFieldIR[];
  derived: DerivedIR[];
  actions: ActionIR[];
  body?: ExprIR;
  title?: ExprIR;
}

export function validateUiReadsServed(sys: SystemIR, diags: LoomDiagnostic[]): void {
  // aggregate name → its owning context + subdomain, within this system.
  const owner = new Map<string, { ctx: string; subdomain: string }>();
  for (const sd of sys.subdomains) {
    for (const c of sd.contexts) {
      for (const a of c.aggregates) owner.set(a.name, { ctx: c.name, subdomain: sd.name });
    }
  }
  for (const d of sys.deployables) {
    // A frontend reads through its `targets:` backend; a backend that mounts
    // a ui itself (`ui: X { … }` on a fullstack deployable — HEEx LiveView,
    // or a static bundle served beside the api) reads through its OWN
    // contexts.  Either way only those contexts' aggregates have a client or
    // a context function for a page to call.
    const selfHosted = !descriptorFor(d.platform).isFrontend;
    if (!selfHosted && !d.targetName) continue;
    if (selfHosted && !d.uiName) continue;
    // A self-hosted ui whose api handles bind ANOTHER deployable reads
    // through that backend too — not judged here.
    if (selfHosted && d.uiBindings.some((b) => b.sourceDeployableName !== d.name)) continue;
    const target = selfHosted ? d : sys.deployables.find((t) => t.name === d.targetName);
    // An unknown `targets:` is refused elsewhere; nothing to compare against.
    if (!target) continue;
    const served = new Set(d.contextNames);
    const uiNames = [...new Set([d.uiName, ...(d.hostedUiNames ?? [])])].filter(
      (n): n is string => !!n,
    );
    for (const uiName of uiNames) {
      const ui = sys.uis.find((u) => u.name === uiName);
      if (!ui) continue;
      const handles = new Set(ui.apiParams.map((p) => p.name));
      // unserved context → the subdomain, the aggregates read, and where.
      const misses = new Map<
        string,
        { subdomain: string; aggregates: Set<string>; sites: Set<string> }
      >();
      const note = (aggName: string, site: string): void => {
        const o = owner.get(aggName);
        if (!o || served.has(o.ctx)) return;
        const m = misses.get(o.ctx) ?? {
          subdomain: o.subdomain,
          aggregates: new Set<string>(),
          sites: new Set<string>(),
        };
        m.aggregates.add(aggName);
        m.sites.add(site);
        misses.set(o.ctx, m);
      };
      const scan = (site: string, s: ScannedBody): void => {
        const visit = (e: ExprIR): void => {
          if (e.kind === "ref") {
            if (e.refKind === "unknown") note(e.name, site);
            return;
          }
          if (
            e.kind === "member" &&
            e.receiver.kind === "ref" &&
            e.receiver.refKind === "unknown" &&
            handles.has(e.receiver.name)
          ) {
            note(e.member, site);
          }
        };
        walkExprDeep(s.title, visit);
        for (const f of s.state) walkExprDeep(f.init, visit);
        for (const dv of s.derived) walkExprDeep(dv.expr, visit);
        for (const a of s.actions) for (const st of a.body) walkStmtExprsDeep(st, visit);
        walkExprDeep(s.body, visit);
      };
      for (const p of ui.pages) scan(p.route ? `page ${p.name} (${p.route})` : `page ${p.name}`, p);
      for (const c of ui.components) scan(`component ${c.name}`, c);
      for (const [ctx, m] of [...misses].sort(([a], [b]) => a.localeCompare(b))) {
        const p = {
          uiName,
          dName: d.name,
          targetName: target.name,
          subdomain: m.subdomain,
          ctx,
          aggregates: [...m.aggregates].sort().join(", "),
          sites: [...m.sites].sort().join(", "),
          served: [...served].sort().join(", ") || "(none)",
        };
        diags.push({
          severity: "error",
          code: "loom.ui-aggregate-unserved",
          message: selfHosted
            ? diagMessage("loom.ui-aggregate-unserved#self-hosted", p)
            : diagMessage("loom.ui-aggregate-unserved", p),
          source: `${d.name}/${uiName}`,
        });
      }
    }
  }
}
