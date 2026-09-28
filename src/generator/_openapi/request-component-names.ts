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

import { emitsRestCreate } from "../../ir/enrich/wire-projection.js";
import type { BoundedContextIR } from "../../ir/types/loom-ir.js";
import { emitsCommandRoute } from "../../ir/util/workflow-command-route.js";
import { plural, upperFirst } from "../../util/naming.js";

/** Who a request component belongs to — the minting rules, as data.
 *
 *  `create` is its own kind rather than an `operation` named "create", because
 *  the canonical create request is NOT an `agg.operations` entry: every backend
 *  emits it from a separate path, and `agg.operations` for a `crudish`
 *  aggregate measures as `[schedule, update]` with no `create` in it.  Leaving
 *  it out of this union is exactly how the first version of this module missed
 *  `Create<Agg>Request` vs a workflow named `create<Agg>` — a reachable
 *  collision it silently declined to qualify. */
export type RequestComponentOwner =
  | { readonly kind: "operation"; readonly aggregate: string; readonly operation: string }
  | { readonly kind: "create"; readonly aggregate: string }
  | { readonly kind: "workflow"; readonly workflow: string };

/** The name today's rules produce, before any collision handling. This stays the
 *  published name whenever it is unique in the context, which is the common
 *  case — so nothing moves for a model that never collided. */
export function baseRequestComponentName(o: RequestComponentOwner): string {
  switch (o.kind) {
    case "operation":
      return `${upperFirst(o.operation)}${o.aggregate}Request`;
    case "create":
      return `Create${o.aggregate}Request`;
    case "workflow":
      return `${upperFirst(o.workflow)}Request`;
  }
}

/** The disambiguating prefix, matching the .NET namespace segment that already
 *  qualifies these ids: the aggregate PLURAL for an operation (`WorkOrders`),
 *  the literal `Workflows` for a workflow. */
function ownerQualifier(o: RequestComponentOwner): string {
  return o.kind === "workflow" ? "Workflows" : upperFirst(plural(o.aggregate));
}

/** A stable identity for an owner, so a resolved map can be keyed by it. */
function ownerKey(o: RequestComponentOwner): string {
  switch (o.kind) {
    case "operation":
      return `op:${o.aggregate}.${o.operation}`;
    case "create":
      return `new:${o.aggregate}`;
    case "workflow":
      return `wf:${o.workflow}`;
  }
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
    // The canonical create request, gated by the SAME shared predicate the
    // emitters use — an aggregate with no REST create publishes no
    // `Create<Agg>Request`, and listing it anyway would invent a collision and
    // qualify a workflow that never actually clashed with anything.
    if (emitsRestCreate(agg)) owners.push({ kind: "create", aggregate: agg.name });
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

/**
 * A name lookup over an explicit owner list: resolve once, then ask it per owner.
 *
 * Deliberately a closure rather than a module-level memo — a cached `WeakMap`
 * would be module-global mutable state, which
 * `test/system/module-global-state-census.test.ts` requires a leak argument for,
 * and the argument would only be buying back work the caller can hoist itself.
 * An emitter calls this once per document and looks names up in O(1).
 *
 * Takes the owner LIST because the right SCOPE is the emitter's to decide, and
 * the backends genuinely differ: Hono writes one `http/workflows.ts` per
 * deployable but one routes file per aggregate, while Phoenix publishes every
 * schema into ONE `<App>Web.Api.Schemas` namespace for the whole deployable. A
 * namespace that spans contexts has to be resolved across them, so a
 * context-shaped entry point would be the wrong tool there.
 *
 * An owner outside the list falls back to the base name rather than throwing, so
 * a backend emitting a component this module does not yet know about keeps
 * today's behaviour.
 */
export function requestComponentNamerFor(
  owners: readonly RequestComponentOwner[],
): (owner: RequestComponentOwner) => string {
  const names = resolveRequestComponentNames(owners);
  return (owner) => names.get(ownerKey(owner)) ?? baseRequestComponentName(owner);
}

/** `requestComponentNamerFor` scoped to one bounded context's own owners — the
 *  right scope for a backend whose component namespace is per-context. */
export function requestComponentNamer(
  ctx: BoundedContextIR,
): (owner: RequestComponentOwner) => string {
  return requestComponentNamerFor(requestComponentOwners(ctx));
}
