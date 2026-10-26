// -------------------------------------------------------------------------
// Application- + transport-layer checks (unfoldable-api-derivation.md,
// Layers 3-4).  These gate the explicit `commandHandler` / `queryHandler`
// context members and the `route <METHOD> <PATH> -> <Context>.<Handler>`
// api-body bindings.  All three need the resolved / enriched IR
// (savesAtExit derivation + cross-context handler lookup), so they live at
// the IR-validate altitude rather than the AST-side validators.
// -------------------------------------------------------------------------

import { diagMessage } from "../../../diagnostics/messages.js";
import { descriptorFor } from "../../../platform/metadata.js";
import type {
  BoundedContextIR,
  CommandHandlerIR,
  EnrichedLoomModel,
  QueryHandlerIR,
  SystemIR,
  WorkflowStmtIR,
} from "../../types/loom-ir.js";
import { allContexts } from "../../types/loom-ir.js";
import { walkWorkflowStmtsDeep } from "../../util/walk.js";
import { handlerWrites, validateHandlerEffectVocabulary } from "./body-effect-vocabulary.js";
import type { LoomDiagnostic } from "./diagnostic.js";
import { isBadIfLetSource } from "./optional-binding-checks.js";

/** Visit every workflow statement in `stmts`, descending into the nested
 *  bodies of `for-each` / `if-let` so a mutation buried in a branch is seen.
 *  Rides `walkWorkflowStmtsDeep` — the hand-rolled twin it replaces named the
 *  two nesting kinds inline, which is exactly the copy that goes stale the day
 *  a third one lands. */
function forEachStmtDeep(stmts: WorkflowStmtIR[], fn: (s: WorkflowStmtIR) => void): void {
  for (const s of stmts) walkWorkflowStmtsDeep(s, fn);
}

/** The distinct set of aggregates a handler body touches — every aggregate it
 *  loads, creates, mutates, or iterates.  A `commandHandler` may touch at most
 *  one (else it must be a `workflow`). */
function aggregatesTouched(h: CommandHandlerIR | QueryHandlerIR): Set<string> {
  const aggs = new Set<string>();
  for (const s of h.savesAtExit) aggs.add(s.aggName);
  forEachStmtDeep(h.statements, (s) => {
    switch (s.kind) {
      case "factory-let":
      case "repo-let":
      case "repo-run":
      case "op-call":
      case "repo-delete":
      case "if-let":
        aggs.add(s.aggName);
        break;
      case "for-each":
        aggs.add(s.varAggName);
        break;
      // The kinds that name no aggregate: the two guards, a pure `let`, an
      // own-state write, an event, a resource call and a domain-service call
      // (whose aggregates are reached through its argument expressions, not a
      // statement field).  Named rather than left to a fall-through so a new
      // `WorkflowStmtIR` kind that DOES carry one is a `tsc` error here.
      case "precondition":
      case "requires":
      case "expr-let":
      case "assign":
      case "emit":
      case "resource-call":
      case "domain-service-call":
        break;
      default: {
        const _exhaustive: never = s;
        void _exhaustive;
      }
    }
  });
  aggs.delete("");
  return aggs;
}

/** Per-context: the layering contracts on the two explicit handler kinds
 *  (unfoldable-api-derivation.md, Layer 3 — "why three handler kinds"):
 *    - `loom.query-handler-saves` — a `queryHandler` must not mutate/save.
 *    - `loom.command-handler-multi-aggregate` — a `commandHandler` may touch
 *      only ONE aggregate; a cross-aggregate orchestration must be a workflow.
 *    - `loom.iflet-bad-source` — an `if let` source must be an optional read
 *      (`Repo.find(<Criterion>)`, `findById`, `findBy`, a declared optional
 *      find) or an optional binding, the forms every backend renders.
 *    - `loom.handler-param-reserved-id` — a handler parameter may not be named
 *      `id`: in Loom's expression scope a bare `id` always means "the current
 *      entity's id", so a body reference to an `id` param silently resolves to
 *      the implicit instead (e.g. `getById(id)` lowers to a `this`-prop read),
 *      emitting code that references an id that isn't in scope. Rename the param
 *      (e.g. `orderId`).
 */
export function validateApplicationHandlers(ctx: BoundedContextIR, diags: LoomDiagnostic[]): void {
  const handlerKinds: [readonly (CommandHandlerIR | QueryHandlerIR)[], string][] = [
    [ctx.commandHandlers ?? [], "commandHandler"],
    [ctx.queryHandlers ?? [], "queryHandler"],
  ];
  for (const [handlers, kind] of handlerKinds) {
    for (const h of handlers) {
      forEachStmtDeep(h.statements, (s) => {
        // An `if let` source the lowerer recognised as no optional read has
        // no repository read to render — every backend would emit a call on
        // an empty receiver.
        if (s.kind === "if-let" && isBadIfLetSource(s)) {
          diags.push({
            severity: "error",
            code: "loom.iflet-bad-source",
            message: diagMessage("loom.iflet-bad-source#handler", {
              kind,
              name: h.name,
              var: s.var,
            }),
            source: `${ctx.name}/${h.name}`,
            origin: ctx.origin,
          });
        }
      });
      for (const p of h.params) {
        if (p.name === "id") {
          diags.push({
            severity: "error",
            code: "loom.handler-param-reserved-id",
            message: diagMessage("loom.handler-param-reserved-id", {
              name: ctx.name,
              kind,
              hName: h.name,
            }),
            source: `${ctx.name}/${h.name}`,
            origin: ctx.origin,
          });
        }
      }
    }
  }
  // `loom.query-handler-saves` and `loom.workflow-mutation-unsaved`: each body
  // against its position's effect vocabulary.
  validateHandlerEffectVocabulary(ctx, diags);
  for (const c of ctx.commandHandlers ?? []) {
    // Extern: no DSL body, so the single-aggregate gate has nothing to count.
    if (c.extern) continue;
    const touched = aggregatesTouched(c);
    if (touched.size > 1) {
      diags.push({
        severity: "error",
        code: "loom.command-handler-multi-aggregate",
        message: diagMessage("loom.command-handler-multi-aggregate", {
          name: ctx.name,
          cName: c.name,
          size: touched.size,
          touched: [...touched].sort().join(", "),
        }),
        source: `${ctx.name}/${c.name}`,
        origin: ctx.origin,
      });
    }
  }
}

/** HTTP methods that denote a READ position — a route that only retrieves.
 *  Loom's `HttpMethod` grammar admits GET|POST|PUT|PATCH|DELETE, so GET is the
 *  sole read verb.  A read route may reach the repository's read-only face only;
 *  binding it to a writing handler is the transport-level twin of the
 *  `reading`-tier `loom.domain-service-no-repo-write` gate
 *  (read-path-architecture.md, "The read-only setting" →
 *  `loom.read-context-repo-write`). */
const READ_ROUTE_METHODS = new Set(["GET"]);

/** Whole-model: every `route` target must resolve to a `commandHandler`
 *  or `queryHandler` member in the named context
 *  (`loom.route-handler-unresolved`).  The route's `target.context` is a real
 *  Langium cross-ref (already resolved), but the `handler` segment is a plain
 *  name the linker doesn't chase, so it's checked here.
 *
 *  Also gates `loom.read-context-repo-write` (read-path-architecture.md): a
 *  READ-method route (GET/HEAD) may not target a handler on the WRITE face — a
 *  mutating `commandHandler`.  This generalises the
 *  shipped `reading`-tier read-only setting (`domain-service-no-repo-write`) and
 *  the `queryHandler` read-only gate (`query-handler-saves`) to the remaining
 *  read position — the api read route — so a read structurally cannot save. */
export function validateRoutes(loom: EnrichedLoomModel, diags: LoomDiagnostic[]): void {
  const ctxByName = new Map<string, BoundedContextIR>();
  for (const c of allContexts(loom)) ctxByName.set(c.name, c);
  for (const sys of loom.systems) {
    for (const api of sys.apis) {
      for (const route of api.routes ?? []) {
        const label = `${route.method} ${route.path}`;
        const ctx = ctxByName.get(route.target.context);
        if (!ctx) {
          diags.push({
            severity: "error",
            code: "loom.route-handler-unresolved",
            message: diagMessage("loom.route-handler-unresolved#api-route-targets-context", {
              name: api.name,
              label,
              context: route.target.context,
            }),
            source: `${sys.name}/${api.name}`,
          });
          continue;
        }
        const handlerNames = new Set<string>([
          ...(ctx.commandHandlers ?? []).map((h) => h.name),
          ...(ctx.queryHandlers ?? []).map((h) => h.name),
        ]);
        if (!handlerNames.has(route.target.handler)) {
          diags.push({
            severity: "error",
            code: "loom.route-handler-unresolved",
            message: diagMessage("loom.route-handler-unresolved#api-route-targets-but-context", {
              name: api.name,
              label,
              context: route.target.context,
              handler: route.target.handler,
            }),
            source: `${sys.name}/${api.name}`,
          });
          continue;
        }
        // `loom.read-context-repo-write` — a READ-method route may only reach the
        // read-only face (a `queryHandler`).  A mutating `commandHandler` is the
        // WRITE face, so a GET/HEAD bound to one lets a
        // read save — exactly what the `reading`-tier gate forbids in a service
        // body, generalised here to the transport edge.
        if (READ_ROUTE_METHODS.has((route.method ?? "").toUpperCase())) {
          const cmd = (ctx.commandHandlers ?? []).find((h) => h.name === route.target.handler);
          if (cmd && !cmd.extern && handlerWrites(ctx, cmd)) {
            diags.push({
              severity: "error",
              code: "loom.read-context-repo-write",
              message: diagMessage("loom.read-context-repo-write", {
                name: api.name,
                label,
                method: route.method,
                context: route.target.context,
                handler: route.target.handler,
              }),
              source: `${sys.name}/${api.name}`,
            });
          }
        }
      }
    }
  }
}

/** `loom.api-unserved` (eval item #29): an `api` no backend deployable lists in
 *  its `serves:`.  Nothing mounts its explicit routes and nothing pins its
 *  contract, so the declaration is dead — and before this it was silent
 *  (`0 error(s), 0 warning(s)`), which reads as "served".  A WARNING: the model
 *  still generates, it just does not do what the declaration suggests.
 *
 *  IR-level, not beside `checkDeployableServes`: top-level `api` / `deployable`
 *  declarations from sibling files fold into the one system at lowering, so
 *  only the lowered system knows every `serves:` list.  Two cases stay quiet:
 *  a system with no deployables at all (a domain-only model serves nothing on
 *  purpose), and an api a `resource { kind: api, use: … }` binds — that one
 *  already raises the `loom.resource-api-unserved` ERROR. */
export function validateUnservedApis(sys: SystemIR, diags: LoomDiagnostic[]): void {
  if (sys.deployables.length === 0) return;
  const served = new Set(
    sys.deployables.filter((d) => !descriptorFor(d.platform).isFrontend).flatMap((d) => d.serves),
  );
  const resourceBound = new Set(sys.dataSources.map((r) => r.apiName).filter(Boolean));
  const backends = sys.deployables
    .filter((d) => !descriptorFor(d.platform).isFrontend)
    .map((d) => `'${d.name}'`);
  for (const api of sys.apis) {
    if (served.has(api.name) || resourceBound.has(api.name)) continue;
    diags.push({
      severity: "warning",
      code: "loom.api-unserved",
      message: diagMessage("loom.api-unserved", {
        name: api.name,
        backends: backends.length > 0 ? backends.join(", ") : "(none declared)",
      }),
      source: `${sys.name}/${api.name}`,
    });
  }
}
