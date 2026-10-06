// ---------------------------------------------------------------------------
// WHERE A RESOURCE OPERATION MAY APPEAR — one declared list (M-T9.80).
//
// A resource-op (`salesFiles.get(k)`, `mail.send(…)`) only renders where the
// emitter threads a resource client into its render context.  The set of such
// positions used to live in two places that disagreed: the gate below walked a
// hand-written DENY list of member surfaces, and every surface it forgot
// reached codegen.  Three did, each a generate-time crash in `render-expr.ts`:
//
//   - a workflow `function` body — node emitted `await` inside a sync
//     `function` (TS1308) against an unimported helper (TS2304), python the
//     same `await` in a bare `def` (SyntaxError), .NET threw; only Java and
//     Elixir rendered it.  Now refused on every backend.
//   - a projection fold's assignment VALUE (`blob := salesFiles.get("x")`) —
//     owned by `loom.projection-fold-impure`, which only looked at statement
//     KINDS (`assign` is pure) and never inside their values.
//   - a raw verb (`orders.get("/x")`) on an `api` resource bound to an
//     in-system api — no backend has a raw-verb client for it (node/python
//     emit an undefined helper, .NET/Java/Elixir throw).  That is a
//     VOCABULARY question, not a position one: `loom.resource-verb-invalid`.
//
// THE CLOSE.  {@link RESOURCE_OP_SITES} is now the one list.  It is keyed by
// the census site id `forEachContextExpr` (`src/ir/util/model-exprs.ts`)
// reports for every expression a context holds — a walk with its own
// completeness gate against `loom-ir.ts` — and the check walks THAT, not a
// list of its own.  A site the table does not name is REFUSED (fail-closed),
// so a new expression-bearing IR position cannot silently reach codegen: it
// is an error until someone declares it legal AND
// `test/system/resource-op-positions.test.ts` proves it renders on all five
// backends (that census is keyed by this same table).
// ---------------------------------------------------------------------------

import { diagMessage } from "../../../diagnostics/messages.js";
import type { BoundedContextIR, ExprIR } from "../../types/loom-ir.js";
import { forEachContextExpr } from "../../util/model-exprs.js";
import type { LoomDiagnostic } from "./diagnostic.js";

/** What one expression site does with a resource-op.
 *
 *  - `legal` — the emitter has the client in scope on every backend.
 *  - `refused` — `loom.resource-op-outside-workflow` fires; `what` names the
 *    position in the message.
 *  - `owned` — another check owns the refusal (its code is named so the census
 *    can prove it fires); this gate stays silent there to avoid a duplicate. */
export type ResourceOpSitePolicy =
  | { readonly verdict: "legal" }
  | { readonly verdict: "refused"; readonly what: string }
  | {
      readonly verdict: "owned";
      readonly code: "loom.projection-fold-impure" | "loom.workflow-handle-unsupported";
    };

const refused = (what: string): ResourceOpSitePolicy => ({ verdict: "refused", what });
const LEGAL: ResourceOpSitePolicy = { verdict: "legal" };

/** Every expression site a bounded context can hold (the leaf site ids
 *  `forEachContextExpr` reports), and what a resource-op there means.
 *  The application layer — workflow bodies and command/query handler bodies —
 *  is the legal set; everything else is domain, query, routing or test code
 *  with no resource client in scope. */
export const RESOURCE_OP_SITES: Readonly<Record<string, ResourceOpSitePolicy>> = {
  // --- legal: the application layer ---------------------------------------
  "WorkflowIR.statements": LEGAL,
  "CreateIR.statements": LEGAL,
  "OnIR.statements": LEGAL,
  "CommandHandlerIR.statements": LEGAL,
  "QueryHandlerIR.statements": LEGAL,
  // --- owned by another check ---------------------------------------------
  // A fold must be a pure, replayable function of the event.
  "ProjectionOnIR.statements": { verdict: "owned", code: "loom.projection-fold-impure" },
  // A named `handle` is emitted by no backend at all; the whole body is refused.
  "HandleIR.statements": { verdict: "owned", code: "loom.workflow-handle-unsupported" },
  // --- refused: no resource client in scope -------------------------------
  "OperationIR.statements": refused("an aggregate operation / lifecycle body"),
  "OperationIR.when": refused("an operation `when` guard"),
  "InvariantIR.expr": refused("an invariant"),
  "InvariantIR.guard": refused("an invariant guard"),
  "DerivedIR.expr": refused("a derived property"),
  "FunctionBodyIR.expr": refused("a `function` body"),
  "FunctionBodyIR.stmts": refused("a `function` body"),
  "ParamIR.default": refused("a parameter default"),
  "FieldIR.default": refused("a field default"),
  "FieldIR.maskUnless": refused("a field mask"),
  "WireField.maskUnless": refused("a wire-field mask"),
  "ApplyIR.statements": refused("an event-sourced `apply` fold"),
  "AggregateIR.contextFilters": refused("a context filter"),
  "AggregateIR.contextFilterRefs": refused("a context filter"),
  "AggregateIR.writeScopeFilter": refused("a write-scope filter"),
  "ContextStampAssignmentIR.value": refused("a context stamp"),
  "WorkflowIR.instanceReadGate": refused("a workflow instance read gate"),
  "CreateIR.correlation": refused("a workflow correlation"),
  "OnIR.correlation": refused("a workflow correlation"),
  "CommandHandlerIR.returnValue": refused("a handler `return` value"),
  "QueryHandlerIR.returnValue": refused("a handler `return` value"),
  "FindIR.filter": refused("a repository find filter"),
  "FindIR.requires": refused("a repository find guard"),
  "FindIR.criterionRef": refused("a repository find criterion argument"),
  "CriterionIR.body": refused("a criterion"),
  "RetrievalIR.where": refused("a retrieval filter"),
  "RetrievalIR.criterionRef": refused("a retrieval criterion argument"),
  "ProjectionOnIR.correlation": refused("a projection correlation"),
  "ProjectionQueryIR.filter": refused("a query-time projection"),
  "ProjectionQueryIR.requires": refused("a query-time projection"),
  "ProjectionQueryIR.criterionRef": refused("a query-time projection"),
  "ProjectionQueryIR.groupBy": refused("a query-time projection"),
  "ProjectionQueryIR.selects": refused("a query-time projection"),
  "ProjectionJoinIR.idRef": refused("a query-time projection"),
  "ProjectionAggregateIR.arg": refused("a query-time projection"),
  "DomainServiceOperationIR.body": refused("a domainService operation"),
  "SeedRowIR.fields": refused("a seed row"),
  "TestIR.statements": refused("a `test` body"),
  "TestStmtIR.expr": refused("a `test` body"),
};

/** The policy for one site — REFUSED when the table does not name it. */
export function resourceOpSitePolicy(site: string): ResourceOpSitePolicy {
  return RESOURCE_OP_SITES[site] ?? refused(`an undeclared position (${site})`);
}

// ---------------------------------------------------------------------------
// `loom.resource-op-outside-workflow` — a resource verb call may only appear
// where a backend actually has the resource client in scope.
//
// A resource handle (`salesFiles`, `mail`, …) is AMBIENT over the whole
// context: `lowerContext` seeds `resources` into the same `Env` an aggregate
// body resolves against, and `lower-expr.ts` resolves the bare name ahead of
// locals — so `salesFiles.put(k, v)` inside an aggregate `operation` lowers to
// a perfectly well-formed `callKind: "resource-op"` with no complaint at all.
//
// Only the WORKFLOW / handler / domain-service emitters thread the resource
// client map into their render context (`resourceClasses` on .NET+Java,
// `resourceModules` on Phoenix, the client-module import on TS/Python).  An
// aggregate member body has none of that, and the five backends fail five
// different ways:
//
//   .NET / Java / Phoenix — `render-expr.ts` THROWS mid-generation ("reached
//       the … renderer without a resource class mapping"), so `ddd generate`
//       dies with a stack trace and writes nothing.
//   TS / Python — emit an awaited helper call (`(await salesFiles$put(…))`)
//       into a module that never imports it → TS2304 / `F821`.  Worse, the
//       plain aggregate method renders `salesFiles.put(…)` unawaited against
//       an unimported symbol.
//
// `docs/resources.md` § "Verb vocabulary" already states the rule ("workflows
// only — resource-ops are not allowed in aggregate operations"); nothing
// enforced it.  This is that enforcement, at the IR tier, once for all five
// backends — the same shape as `loom.resource-op-in-transaction`, which is the
// OTHER placement rule resource-ops carry.
//
// LIFECYCLE GUARDS ARE INCLUDED.  `structural-checks`'s
// `lifecycleGuardIllegalReads` notes in passing that a `resource-op` "renders a
// module- or class-qualified call — none of them touches the receiver", and
// defers the question with "(A guard doing IO is a different objection, not
// this one.)".  That deferral is settled here, empirically: a `create { requires
// salesFiles.list("x").count == 0 }` CRASHES the .NET generator inside
// `lifecycleGate`, and on Hono emits `(await salesFiles$list("x"))` into
// `http/<agg>.routes.ts`, a file that imports no resource client → TS2304.  A
// guard is rendered in a route/authz position, which is exactly where no
// resource client is in scope.  So guards are gated too — and the walk gets
// them for free, since a lifecycle `requires` is a statement in the
// create/destroy body.
//
// The LEGAL sites are workflow bodies and command/query handler bodies —
// the application layer, which owns the transaction and all outbound I/O.
// Everything else on an aggregate / part / value object is rejected.
//
// DOMAIN SERVICES ARE *NOT* A LEGAL SITE.  The first cut of this gate listed
// `domainService` operation bodies as legal, matching the ambient-resource
// `Env` and the three sites `deriveNeeds` scans.  No domain-service emitter
// threads a resource client in, so the "legal" third site failed in the SAME
// five ways the aggregate bodies did — re-verified against a `domainService
// Archiver { operation archived(name: string): bool { let existing =
// salesFiles.list("orders/" + name) … } }`:
//
//   .NET   — THROWS "reached the .NET renderer without a resource class
//            mapping" out of `emit/domain-service.ts` → `renderOperation`.
//   Java   — THROWS the Java twin out of `emit/domain-service.ts`.
//   Phoenix— THROWS "reached the Phoenix renderer without a module mapping"
//            out of `domain-service-emit.ts` → `renderOperation`.
//   TS     — emits `(await salesFiles$list(…))` into `domain/services.ts`, a
//            file importing no resource client, inside a NON-async
//            `export function` → TS1308 + TS2304.
//   Python — emits the same `await` into a bare `def` in
//            `app/domain/services/<svc>.py` → SyntaxError + F821.
//
// And porting it is a LANGUAGE change, not plumbing.  `docs/domain-services.md`
// defines a domain service as a stateless calculator whose only infrastructure
// touch is a read-only repository query, with the `workflow` owning "the
// transaction and all outbound I/O"; a resource-op is outbound I/O.  Admitting
// one would also (1) re-open the aggregate hole this gate just closed — a
// `pure`-tier op is callable from an aggregate `operation`, so the tier ladder
// (`classifyDomainServiceTier`) would need a new tier plus a call-site gate,
// (2) force async signatures onto the sync static/module shapes four of five
// backends emit for the pure/reading tiers, and (3) let a resource-op hide from
// `loom.resource-op-in-transaction`, which only walks the workflow span.  So
// the honest answer is an error at the source, not five silent failures.

/** `loom.resource-op-outside-workflow` over {@link RESOURCE_OP_SITES}, plus the
 *  api-bound vocabulary rule (`loom.resource-verb-invalid#api-bound`).
 *
 *  One diagnostic per (location, resource.verb) — an operation calling the same
 *  verb twice is one authoring mistake, not two. */
export function validateResourceOpPlacement(ctx: BoundedContextIR, diags: LoomDiagnostic[]): void {
  const seen = new Set<string>();
  // The walk can reach one node through two sites (`WorkflowIR.statements` is
  // a facade over the primary create's `CreateIR.statements`); report it once.
  const seenNodes = new Set<ExprIR>();
  const prefix = `${ctx.name}/`;
  forEachContextExpr(ctx, ({ expr, source, site }) => {
    const op = resourceOpOf(expr);
    if (!op || seenNodes.has(expr)) return;
    seenNodes.add(expr);
    const location = source.startsWith(prefix) ? source.slice(prefix.length) : source;
    const key = `${location}\0${op.resourceName}.${op.verb}`;
    if (seen.has(key)) return;
    seen.add(key);
    const policy = resourceOpSitePolicy(site);
    if (policy.verdict === "refused") {
      diags.push({
        severity: "error",
        code: "loom.resource-op-outside-workflow",
        message: diagMessage("loom.resource-op-outside-workflow", {
          location: `${location} (${policy.what})`,
          resourceName: op.resourceName,
          verb: op.verb,
        }),
        source: `${ctx.name}/${location}`,
      });
      return;
    }
    // A raw verb on an `api` resource bound to an IN-SYSTEM api.  Such a
    // resource's vocabulary is the callee's typed operation set (M-T4.8) —
    // lowering resolves `orders.getOrderById(id)` to a `remote-api-op` and
    // only a name that is NOT one of those operations falls through to here.
    // No backend emits a raw-verb client for an api-bound resource (its client
    // module is DERIVED from the callee's operations), so node/python emitted
    // an undefined helper and .NET/Java/Phoenix threw.  Checked at every
    // position: wherever the op sits, there is nothing to render it with.
    if (op.boundApi) {
      diags.push({
        severity: "error",
        code: "loom.resource-verb-invalid",
        message: diagMessage("loom.resource-verb-invalid#api-bound", {
          location,
          resourceName: op.resourceName,
          verb: op.verb,
          apiName: op.boundApi,
        }),
        source: `${ctx.name}/${location}`,
      });
    }
  });
}

function resourceOpOf(
  e: ExprIR,
): { resourceName: string; verb: string; boundApi?: string } | undefined {
  if (e.kind !== "call" || e.callKind !== "resource-op" || !e.resourceOp) return undefined;
  return e.resourceOp;
}
