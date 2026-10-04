// -------------------------------------------------------------------------
// Default-deny enforcement (auth.md / quickstart §4.3).  Split out of
// system-checks.ts by packet 2.6 (wave-2) — mechanical move, no logic
// change.
// -------------------------------------------------------------------------

import { diagMessage } from "../../../diagnostics/messages.js";
import { descriptorFor } from "../../../platform/metadata.js";
import { plural, snake } from "../../../util/naming.js";
import type { SystemIR, WorkflowIR, WorkflowStmtIR } from "../../types/loom-ir.js";
import { isMacroEmitted, macroNameOf } from "../../types/origin.js";
import { deriveContextOperations, isAllFind } from "../../util/api-surface.js";
import { esCreateGateUnsupportedOn } from "../../util/op-gates.js";
import { aggregateIsEventSourced } from "../../util/resolve-datasource.js";
import type { LoomDiagnostic } from "./diagnostic.js";

// Page/component `derived name: T = expr` bindings are supported on every
// frontend now — React/Vue/Svelte/Angular hoist a reactive computed
// (`useMemo` / `computed` / `$derived` / `computed`); Phoenix/HEEx
// inline-recomputes the expr at each use.  No framework gate is needed.

// Default-deny enforcement (auth.md / quickstart §4.3).  When the system's
// `auth { … }` block is in `enforcement: denyByDefault` — the LANGUAGE DEFAULT
// since M-T3.1, so an `auth` block that writes no `enforcement:` is in it too
// (`DEFAULT_ENFORCEMENT`, `src/ir/lower/lower-auth.ts`) — every reachable
// *command* on an `auth: required` backend must declare a `requires` gate —
// otherwise it serves ungated.  An explicit `enforcement: opt` keeps the
// pre-flip per-`requires` opt-in.  A system with no `auth` block has no
// posture (`sys.auth` is undefined) and is not checked.  Escape hatch:
// `requires true` marks a command intentionally public.
//
// Scope: every client-reachable command (mutation) endpoint —
//   - public aggregate actions: operations, **creates**, destroys (each
//     carries `requires` in its body);
//   - **workflows**: every command-triggered starter (`create … {}`) and named
//     `handle …(){}` continuation command (POST endpoints; their bodies carry
//     `requires`).  Event-triggered creates / `on(...)` reactors are not
//     client-reachable, so they are excluded.
//
// Read endpoints — **views** and repository **finds** — are in scope too: each
// is a GET endpoint, and both carry an optional `requires <expr>` gate (the
// read-side twin of an operation's in-handler 403).  An ungated read under
// denyByDefault serves to any caller; `requires true` is the explicit
// intentionally-public escape.

export function validateDefaultDeny(sys: SystemIR, diags: LoomDiagnostic[]): void {
  if (sys.auth?.enforcement !== "denyByDefault") return;
  // Contexts hosted by any `auth: required` backend deployable.  A frontend
  // (auth: ui) has `auth.required === false`, so it's excluded here.
  const guarded = new Set<string>();
  // …and the BACKEND platforms serving each of them.  The ES-create arm below
  // needs to know whether a gate could be enforced on any host: it is a
  // per-backend fact (Phoenix hoists the gate to its context function and binds
  // a principal; the other four render it into a principal-less `_init`), so
  // whether the author has recourse depends on who is serving the route.
  const guardedPlatforms = new Map<string, Set<string>>();
  for (const d of sys.deployables) {
    if (!d.auth?.required) continue;
    for (const cn of d.contextNames) {
      guarded.add(cn);
      if (!descriptorFor(d.platform).needsDb) continue;
      const set = guardedPlatforms.get(cn) ?? new Set<string>();
      set.add(d.platform);
      guardedPlatforms.set(cn, set);
    }
  }
  if (guarded.size === 0) return;
  const isGated = (statements: { kind: string }[]): boolean =>
    statements.some((s) => s.kind === "requires");
  for (const sd of sys.subdomains) {
    for (const c of sd.contexts) {
      if (!guarded.has(c.name)) continue;
      // Aggregate command actions: operations + creates + destroys (all
      // OperationIR with a `requires`-bearing body).
      for (const a of c.aggregates) {
        for (const op of [...a.operations, ...(a.creates ?? []), ...(a.destroys ?? [])]) {
          if (op.visibility !== "public") continue;
          if (!isGated(op.statements)) {
            // ── an EVENT-SOURCED create has no gate surface at all ──────────
            //
            // The generic arm below names a `requires` the author should write.
            // On an event-sourced aggregate that instruction is UNSATISFIABLE:
            // write the gate and `loom.lifecycle-guard-event-sourced` refuses it
            // (the ES create body renders into the domain `_init`, which has no
            // principal in scope), omit it and this check errors.  Two
            // validators demanding contradictory things made
            // `enforcement: denyByDefault` and `persistedAs: eventLog` mutually
            // exclusive for any aggregate with a creation endpoint — measured,
            // not theorised: gate present → 1 error, gate absent → 1 error.
            //
            // So this is the same RECOURSE test the by-id arm below is built on,
            // and it resolves the same way: a WARNING with its own code, not an
            // arm of `loom.default-deny-ungated`.  Every
            // `loom.default-deny-ungated` arm names a `requires` the author CAN
            // write; the arms with no such surface are exempted rather than
            // reported.  An ES create is exactly such a site, so erroring here
            // makes the model unbuildable with nothing the author could do —
            // which is the one thing the by-id comment says an error must never
            // be.  Making the ES create route genuinely gateable means hoisting
            // the gate out of `_init` to each backend's own chokepoint: a
            // five-backend change owned by mission M-T3.16, not a validator fix.
            // …and only where NO host can enforce it.  On an elixir-only host the
            // author DOES have recourse — a body `requires` is accepted and
            // emitted there — so the hard error stays; exempting it would quietly
            // drop the gate requirement on the one backend that honours it.
            const esUngateableOn =
              op.kind === "create" && aggregateIsEventSourced(a)
                ? esCreateGateUnsupportedOn(guardedPlatforms.get(c.name) ?? [])
                : [];
            if (esUngateableOn.length > 0) {
              diags.push({
                severity: "warning",
                code: "loom.default-deny-es-create-ungateable",
                message: diagMessage("loom.default-deny-es-create-ungateable", {
                  name: a.name,
                  opName: op.name,
                  path: `/api/${plural(snake(a.name))}`,
                }),
                source: `${a.name}/${op.name}`,
              });
              continue;
            }
            // A macro-emitted member has no declaration header of its own —
            // an aggregate `create` / `destroy` carries its gate as a body
            // STATEMENT, and that body belongs to the macro.  Telling the
            // author to "add a `requires`" to it names a line they cannot
            // edit, so point at the `with <macro>(...)` call they own
            // instead (crudish / softDelete take `requires: <Policy>`).
            const macroName = macroNameOf(op.origin);
            // ── a HAND-WRITTEN `create` / `destroy` ─────────────────────────
            //
            // Its gate is the first STATEMENT of the body, not a header clause.
            // The generic arm below says "add a `requires <expr>`" without
            // saying where, and every SIBLING declaration (`operation` / `find`
            // / `projection` / `handle`) takes one in the header — so the author
            // writes `create(...) requires P() { }`, gets `Expecting token of
            // type '{'`, and concludes the posture is unsatisfiable.  That is
            // how finding F-004 reached "denyByDefault and persistedAs: eventLog
            // are mutually exclusive" — a claim that was false for the
            // state-based case the whole time.  Name the position; the trap goes.
            //
            // Its OWN push rather than a third arm on the ternary below: the
            // catalog gate resolves the key statically and admits exactly ONE
            // ternary level between two catalogued calls, so a NESTED ternary
            // reads to it as inline wording (`keysOf`,
            // `test/system/diagnostic-catalog.test.ts`).  Same reason
            // `loom.lifecycle-guard-unreadable` spells two pushes.
            const lifecycleLabel =
              op.kind === "create" ? "create" : op.kind === "destroy" ? "destroy" : null;
            if (lifecycleLabel && !macroName) {
              diags.push({
                severity: "error",
                code: "loom.default-deny-ungated",
                message: diagMessage(
                  "loom.default-deny-ungated#denybydefault-lifecycle-is-reachable",
                  { name: a.name, opName: op.name, label: lifecycleLabel },
                ),
                source: `${a.name}/${op.name}`,
              });
              continue;
            }
            diags.push({
              severity: "error",
              code: "loom.default-deny-ungated",
              message: macroName
                ? diagMessage("loom.default-deny-ungated#denybydefault-is-reachable-macro", {
                    name: a.name,
                    opName: op.name,
                    macroName,
                  })
                : diagMessage("loom.default-deny-ungated#denybydefault-is-reachable", {
                    name: a.name,
                    opName: op.name,
                  }),
              source: `${a.name}/${op.name}`,
            });
          }
        }
      }
      // Workflow command endpoints: command-triggered starters + named
      // handlers.  Each is a POST route a client can reach.
      for (const wf of c.workflows) {
        for (const entry of workflowCommandEntries(wf)) {
          if (!isGated(entry.statements)) {
            diags.push({
              severity: "error",
              code: "loom.default-deny-ungated",
              message: diagMessage("loom.default-deny-ungated#denybydefault-workflow", {
                label: entry.label,
              }),
              source: `${wf.name}/${entry.key}`,
            });
          }
        }
      }
      // The two COMPILER-DERIVED aggregate reads — `GET /api/<aggs>/{id}`
      // (F-009 / mission M-T3.19) and the list `GET /api/<aggs>` backed by the
      // enrichment-injected `find all` (Commons F-006).  Both serve on all five
      // backends; before M-T3.19 the by-id read had no surface to gate it at
      // all (a model could gate `find all` admin-only and still hand the same
      // rows out one id at a time) and the injected list read was exempted.
      //
      // Both now have a surface named AT THE DECLARATION (the #2877 ruling — no
      // inherited aggregate-level default gate): the author declares the read
      // in the repository with its gate —
      //     find byId(id: T id): T? requires <expr>
      //     find all(): T paged    requires <expr>
      // — and every backend's route renders that gate before the load (403).
      // So the instruction is satisfiable, and under denyByDefault an ungated
      // one is an ERROR (fail closed: the build is refused rather than the
      // route served open).  `requires true` is the explicit public escape.
      //
      // Read off `deriveContextOperations` — the same derivation every backend
      // route builder renders — so the check covers exactly the routes that
      // exist (abstract bases serve neither).
      for (const op of deriveContextOperations(c)) {
        if (op.kind === "getById") {
          // A DECLARED by-id find is reported (if ungated) by the named-find
          // loop below — it also serves its own `/by_id` route — so only the
          // undeclared case is reported here, once.
          if (op.find) continue;
          diags.push({
            severity: "error",
            code: "loom.default-deny-by-id-ungated",
            message: diagMessage("loom.default-deny-by-id-ungated", {
              name: op.aggregate,
              path: op.path,
            }),
            source: `${c.name}/${op.aggregate}`,
          });
        } else if (isAllFind(op) && !op.find?.requires) {
          const returns =
            op.find?.returnType.kind === "array" ? `${op.aggregate}[]` : `${op.aggregate} paged`;
          diags.push({
            severity: "error",
            code: "loom.default-deny-ungated",
            message: diagMessage("loom.default-deny-ungated#denybydefault-list-read", {
              name: op.aggregate,
              path: op.path,
              returns,
            }),
            source: `find/${c.name}.${op.aggregate}.all`,
          });
        }
      }
      // Repository finds: each author-declared named find is its own GET route
      // and carries the same optional `requires <expr>` gate.  `all` is
      // reported by the list-read arm above (declared or injected, once).
      // Internal synthesized finds (paged-run helpers) are never their own route.
      for (const repo of c.repositories) {
        for (const find of repo.finds) {
          if (find.synthesized || find.name === "all") continue;
          if (!find.requires) {
            diags.push({
              severity: "error",
              code: "loom.default-deny-ungated",
              message: diagMessage("loom.default-deny-ungated#denybydefault-find-is-reachable", {
                name: repo.name,
                findName: find.name,
              }),
              source: `find/${repo.name}.${find.name}`,
            });
          }
        }
        // Entity history (docs/audit.md): `GET /<agg>/{id}/history` replays the
        // `before`/`after` snapshots of every successful command on a row.  It
        // is compiler-synthesized like `find all` — but unlike `find all` the
        // author HAS a surface to gate it from, because history copies the list
        // read's gate at enrichment.  So an ungated one is actionable, and
        // under denyByDefault an ungated CHANGE HISTORY is a worse default than
        // an ungated current-state read: it discloses who changed what and
        // when, over the row's whole lifetime, in one request.
        if (repo.historyFind && !repo.historyFind.requires) {
          diags.push({
            severity: "error",
            code: "loom.audit-history-ungated",
            message: diagMessage("loom.audit-history-ungated", {
              aggregateName: repo.aggregateName,
              aggregateName2: snake(plural(repo.aggregateName)),
              name: repo.name,
            }),
            source: `find/${repo.name}.history`,
          });
        }
      }
      // Projections.  Every projection — folded or query-time — is served as a
      // GET endpoint (`/projections/<name>`, plus `/{key}` for a keyed folded
      // one), so under denyByDefault an ungated one publishes its rows to any
      // caller exactly as an ungated find publishes an aggregate's.
      //
      // Folded projections are in scope like every other read surface: a
      // projection can SPELL a `requires` gate and the backends emit it, so
      // demanding one is satisfiable.
      for (const proj of c.projections) {
        if (proj.query?.requires) continue;
        // A MACRO-emitted projection has no declaration header, so the
        // diagnostic's "add a `requires` after its declaration header" names a
        // line the author cannot open — `scaffoldDashboard` emits one singleton
        // totals projection per aggregate, which made `scaffold` and
        // `denyByDefault` an uncompilable pair.  Exempt for the same stated
        // reason the enrichment-injected `find all` is exempt one loop up: it
        // is compiler-synthesized and has no author source line
        // (`src/ir/util/read-gates.ts`).  Derived from the origin chain the
        // lowering already records — nothing new is stamped.
        if (isMacroEmitted(proj.origin)) continue;
        diags.push({
          severity: "error",
          code: "loom.default-deny-ungated",
          message: diagMessage("loom.default-deny-ungated#denybydefault-projection", {
            name: proj.name,
          }),
          source: `projection/${proj.name}`,
        });
      }
      // Workflow INSTANCE reads (`/workflows/<wf>/instances[/{id}]`).  An
      // observable workflow — one with a correlation field, hence an
      // `instanceWireShape` — publishes every instance's correlation id and
      // state on two GET routes, so under denyByDefault it needs a gate for
      // the same reason an ungated find or projection does.
      //
      // It could not be required before: the routes are compiler-derived and a
      // workflow had no surface to declare a read gate on, so demanding one
      // would have demanded the impossible — the identical situation the folded
      // projection was in.  The header `requires` clause is that surface, so
      // the exemption has no reason left.
      //
      // Keyed on `instanceWireShape`: a stateless workflow (no correlation
      // field) serves no instance routes, so there is nothing to gate.
      for (const wf of c.workflows) {
        if (!wf.instanceWireShape || wf.instanceReadGate) continue;
        diags.push({
          severity: "error",
          code: "loom.default-deny-ungated",
          message: diagMessage("loom.default-deny-ungated#denybydefault-workflow-instances", {
            name: wf.name,
          }),
          source: `workflow/${wf.name}`,
        });
      }
    }
  }

  // Explicit handlers (`commandHandler` / `queryHandler`) reachable through an
  // `api { route <METHOD> "<path>" -> <Ctx>.<Handler> }` binding.  These are
  // real HTTP endpoints on all five backends, and default-deny walked right
  // past them: it enumerated aggregate actions, workflow command entries,
  // finds and history, but never `ctx.commandHandlers` / `ctx.queryHandlers`.
  //
  // Scoped to ROUTE-BOUND handlers deliberately — an unrouted handler has no
  // transport surface, so demanding a gate from it would be noise.  The route
  // is the reachability proof, exactly as `visibility === "public"` is for an
  // aggregate operation.
  const ctxByName = new Map<string, (typeof sys.subdomains)[number]["contexts"][number]>();
  for (const sd of sys.subdomains) for (const c of sd.contexts) ctxByName.set(c.name, c);
  for (const api of sys.apis) {
    for (const route of api.routes) {
      const c = ctxByName.get(route.target.context);
      if (!c || !guarded.has(c.name)) continue;
      const cmd = (c.commandHandlers ?? []).find((h) => h.name === route.target.handler);
      const qry = cmd
        ? undefined
        : (c.queryHandlers ?? []).find((h) => h.name === route.target.handler);
      const handler = cmd ?? qry;
      // A workflow `handle` can also be a route target; those are already
      // covered by `workflowCommandEntries` above, so skip rather than
      // double-report.
      if (!handler) continue;
      if (isGated(handler.statements)) continue;
      const params = {
        kind: cmd ? "commandHandler" : "queryHandler",
        ctx: c.name,
        handler: handler.name,
        method: route.method,
        path: route.path,
      };
      // An `extern` handler has NO body — there is nowhere to put a gate — so
      // "add a `requires`" would be an unsatisfiable instruction.  Say what is
      // actually actionable instead (drop `extern`, or drop the route).  The
      // two arms are separate `diags.push` calls, not a ternary on `message:`,
      // because the catalog scanner (`diagnostic-catalog.test.ts`) reads the key
      // off a DIRECT `diagMessage("literal", …)` call expression — a ternary or
      // a computed key reads to it as inline wording.
      const source = `${c.name}/handler/${handler.name}`;
      if (handler.extern) {
        diags.push({
          severity: "error",
          code: "loom.default-deny-ungated",
          message: diagMessage("loom.default-deny-ungated#denybydefault-handler-extern", params),
          source,
        });
      } else {
        diags.push({
          severity: "error",
          code: "loom.default-deny-ungated",
          message: diagMessage("loom.default-deny-ungated#denybydefault-handler", params),
          source,
        });
      }
    }
  }
}

/** The client-reachable command endpoints of a workflow: each command-triggered
 *  `create` starter and each named `handle` continuation.  Event-triggered
 *  creates and `on(...)` reactors fire on internal events, never a client POST,
 *  so they are excluded — the validate-layer analogue of the generator's
 *  `emitsCommandRoute`. */

function workflowCommandEntries(
  wf: WorkflowIR,
): { label: string; key: string; statements: WorkflowStmtIR[] }[] {
  const entries: { label: string; key: string; statements: WorkflowStmtIR[] }[] = [];
  for (const cr of wf.creates) {
    if (cr.triggerKind !== "command") continue;
    entries.push({
      label: cr.name ? `${wf.name}.${cr.name}` : wf.name,
      key: cr.name ?? "create",
      statements: cr.statements,
    });
  }
  for (const h of wf.handlers ?? []) {
    entries.push({ label: `${wf.name}.${h.name}`, key: h.name, statements: h.statements });
  }
  return entries;
}
