// ---------------------------------------------------------------------------
// "Does this deployable CONSUME this event?" — one derivation, two consumers.
//
// A deployable listing a `channelSource` is not necessarily a consumer of it:
// `brokerChannelBindings` emits a binding (and a consumer-group name) for every
// channelSource the deployable lists, because the ACL it feeds has to cover the
// producer side too.  Whether a queue is actually drained is a different
// question, answered from the hosted contexts: a reactor (`on(e: …)`), an
// event-triggered `create … by`, or a projection fold.
//
// It lived as a closure inside `system-compose-channel-checks.ts`, where
// `loom.deployable-channel-unrelated` and `loom.channel-consumer-unwired` both
// read it — and the broker-topology renderer, which needs exactly the same
// answer, could not.  Pre-declaring a queue for a deployable that does not
// consume would create a durable queue bound to a fanout exchange that nothing
// ever drains: it grows without bound.  Getting that wrong is worse than the
// bug the topology is there to fix, so the two sites share one derivation.
// ---------------------------------------------------------------------------

import type { BoundedContextIR, DeployableIR, SystemIR } from "../types/loom-ir.js";

/** Contexts by name across every subdomain — the lookup both callers need. */
export function contextsByName(sys: SystemIR): Map<string, BoundedContextIR> {
  const out = new Map<string, BoundedContextIR>();
  for (const m of sys.subdomains) for (const c of m.contexts) out.set(c.name, c);
  return out;
}

/** The event names a deployable's hosted contexts consume — reactor `on`,
 *  event-triggered `create … by`, and projection folds: the same trigger set
 *  `deriveEventSubscriptions` wires for in-process dispatch. */
export function consumedEventNames(
  dep: DeployableIR,
  ctxByName: ReadonlyMap<string, BoundedContextIR>,
): Set<string> {
  const consumed = new Set<string>();
  for (const ctxName of dep.contextNames) {
    const ctx = ctxByName.get(ctxName);
    if (!ctx) continue;
    for (const wf of ctx.workflows ?? []) {
      for (const on of wf.subscriptions ?? []) consumed.add(on.event);
      for (const create of wf.creates ?? []) {
        if (create.triggerKind === "event" && create.eventRef) consumed.add(create.eventRef);
      }
    }
    for (const proj of ctx.projections ?? [])
      for (const on of proj.handlers) consumed.add(on.event);
  }
  return consumed;
}
