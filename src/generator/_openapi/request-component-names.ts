// OpenAPI request-component naming, collision-aware (F-026).
//
// TWO INDEPENDENT RULES mint request-component names, and they can produce the
// same string without any name being shared:
//
//   * an aggregate operation  → `<Op><Agg>Request`   (op `schedule` on `WorkOrder`)
//   * a workflow              → `<Workflow>Request`  (workflow `scheduleWorkOrder`)
//
// Both spell `ScheduleWorkOrderRequest`.  Neither rule is wrong alone; they are
// two halves of one contract — the document's component namespace — computed
// with nothing checking they agree (`experience_gathered.md` §89's class).
//
// What the collision COSTS, measured rather than assumed.  `@hono/zod-openapi`
// does not throw on a duplicate component name: both endpoints end up `$ref`-ing
// one component, and the one that survives carries the WORKFLOW's shape.  So the
// operation endpoint is PUBLISHED as requiring the workflow's body.  On the
// generated Java app (same two rules, springdoc, same collapse) that is provably
// a broken client: POSTing the shape the spec publishes answers 422 while the
// shape the code wants answers 204.  Runtime binding was never wrong — the
// published contract was.
//
// THE CONVENTION IS NOT NEW.  The .NET emitter already solved this for its own
// namespace collisions (`src/generator/dotnet/schema-ids.ts`): detect the short
// names that genuinely collide and publish an OWNER-QUALIFIED id for those,
// `Application.<Plural>` → `<Plural><Name>` and `Application.Workflows` →
// `Workflows<Name>`.  This module lifts that same convention to the shared
// layer, with the same qualifiers, so a fixed backend AGREES with the ids .NET
// already publishes rather than inventing a third spelling.
//
// Two properties are load-bearing, both inherited from the .NET precedent:
//
//   1. Only GENUINE collisions are qualified.  Qualifying everything would close
//      the defect and break component-name parity with the backends that are
//      already correct — the shape `.loom/wire-spec.json` and the
//      conformance-parity gate compare.  A collision-free context therefore gets
//      byte-identical output.
//   2. A qualified id never SHADOWS a name that keeps its short form, so
//      resolving one collision cannot silently create another.

import type { BoundedContextIR } from "../../ir/types/loom-ir.js";
import { emitsCommandRoute } from "../../ir/util/workflow-command-route.js";
import { plural, upperFirst } from "../../util/naming.js";

/** Who a request component belongs to — the two minting rules, as data. */
export type RequestComponentOwner =
  | { readonly kind: "operation"; readonly aggregate: string; readonly operation: string }
  | { readonly kind: "workflow"; readonly workflow: string };

/** The name today's rules produce, before any collision handling. This stays the
 *  published name whenever it is unique in the context, which is the common
 *  case — so nothing moves for a model that never collided. */
export function baseRequestComponentName(o: RequestComponentOwner): string {
  return o.kind === "operation"
    ? `${upperFirst(o.operation)}${o.aggregate}Request`
    : `${upperFirst(o.workflow)}Request`;
}

/** The disambiguating prefix, matching the .NET namespace segment that already
 *  qualifies these ids: the aggregate PLURAL for an operation (`WorkOrders`),
 *  the literal `Workflows` for a workflow. */
function ownerQualifier(o: RequestComponentOwner): string {
  return o.kind === "operation" ? upperFirst(plural(o.aggregate)) : "Workflows";
}

/** A stable identity for an owner, so a resolved map can be keyed by it. */
function ownerKey(o: RequestComponentOwner): string {
  return o.kind === "operation" ? `op:${o.aggregate}.${o.operation}` : `wf:${o.workflow}`;
}

/**
 * Resolve the published component name for every owner in one document.
 *
 * Pure, and takes the owner LIST rather than re-deriving it: which owners get a
 * component is each backend's own call (node emits a workflow schema only for a
 * workflow with an HTTP command route), and re-implementing that predicate here
 * would rebuild the very drift this module exists to remove.
 */
export function resolveRequestComponentNames(
  owners: readonly RequestComponentOwner[],
): ReadonlyMap<string, string> {
  // base name → the owners that mint it (insertion order, deduped by key).
  const byBase = new Map<string, RequestComponentOwner[]>();
  const seenKeys = new Set<string>();
  for (const o of owners) {
    const key = ownerKey(o);
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    const base = baseRequestComponentName(o);
    const group = byBase.get(base);
    if (group) group.push(o);
    else byBase.set(base, [o]);
  }

  // Names that keep their short form are spoken for: a qualified id must never
  // shadow one, or fixing this collision would quietly mint the next.
  const taken = new Set<string>();
  for (const [base, group] of byBase) if (group.length === 1) taken.add(base);

  const resolved = new Map<string, string>();
  for (const [base, group] of byBase) {
    if (group.length === 1) {
      resolved.set(ownerKey(group[0]!), base);
      continue;
    }
    for (const o of group) {
      const qualified = `${ownerQualifier(o)}${base}`;
      // Last resort when even the qualified id is taken: append the owner's own
      // discriminator. Unreachable for the two rules above (an aggregate plural
      // and `Workflows` cannot coincide for the same base), but a third minting
      // rule must not be able to produce a silent duplicate.
      const name = taken.has(qualified) ? `${qualified}${upperFirst(ownerKey(o))}` : qualified;
      taken.add(name);
      resolved.set(ownerKey(o), name);
    }
  }
  return resolved;
}

/** The owners a bounded context mints request components for. Operations are the
 *  public ones (a private operation has no route); workflows are those with an
 *  HTTP command surface, per the shared `emitsCommandRoute` predicate. */
export function requestComponentOwners(ctx: BoundedContextIR): RequestComponentOwner[] {
  const owners: RequestComponentOwner[] = [];
  for (const agg of ctx.aggregates) {
    for (const op of agg.operations) {
      if (op.visibility !== "public") continue;
      owners.push({ kind: "operation", aggregate: agg.name, operation: op.name });
    }
  }
  for (const wf of ctx.workflows) {
    if (!emitsCommandRoute(wf)) continue;
    owners.push({ kind: "workflow", workflow: wf.name });
  }
  return owners;
}

/** Per-context memo: both the routes builder and the workflow builder ask for
 *  names, once per aggregate and once per file, and must agree. */
const cache = new WeakMap<BoundedContextIR, ReadonlyMap<string, string>>();

/**
 * The component name to publish for `owner` in `ctx` — short when unique,
 * owner-qualified when it would otherwise collide.
 *
 * Callers pass an owner they already emit; an owner outside the context's own
 * set falls back to the base name rather than throwing, so a backend that emits
 * a component this module does not yet know about keeps today's behaviour.
 */
export function requestComponentName(ctx: BoundedContextIR, owner: RequestComponentOwner): string {
  let names = cache.get(ctx);
  if (!names) {
    names = resolveRequestComponentNames(requestComponentOwners(ctx));
    cache.set(ctx, names);
  }
  return names.get(ownerKey(owner)) ?? baseRequestComponentName(owner);
}
