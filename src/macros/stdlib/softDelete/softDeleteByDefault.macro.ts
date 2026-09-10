import { defineMacro, implementsCapabilityRef } from "../../api/index.js";

/** Apply soft-delete to every aggregate in a context (typed-capabilities.md).
 *
 * Emits a typed `implements softDeletable` on the CONTEXT host — the expander
 * applies that capability (isDeleted/deletedAt + filter) to every aggregate in
 * the context — and invokes the `softDelete` ops macro against each child to add
 * the `softDelete()`/`restore()` operations.
 *
 *   context Sales with softDeleteByDefault {
 *     aggregate Order   { subject: string }
 *     aggregate Customer { name: string }
 *   }
 *
 *   ↓ every aggregate gains isDeleted/deletedAt + `filter !this.isDeleted`
 *     (capability) and softDelete()/restore() (ops macro).
 *
 * The context-scoped typed `implements` is spliced during this macro's
 * expansion; the context's own typed-`implements` pass (which runs after the
 * `with` clause in `expandHost`) then fans the capability to the children.
 *
 * `requires:` forwards straight through to every `softDelete` invocation, so
 * one named policy gates the whole context's soft-delete surface — without it,
 * `softDeleteByDefault` under `enforcement: denyByDefault` would leave two
 * ungated commands per aggregate with nowhere to put a gate. */
export default defineMacro({
  name: "softDeleteByDefault",
  target: "context",
  apiVersion: 1,
  params: {
    /** Forwarded verbatim to each per-aggregate `softDelete` invocation. */
    requires: { kind: "ref", of: "Policy", optional: true },
  },
  description:
    "Applies the softDeletable capability (state + filter) and the softDelete " +
    "operations to every aggregate in the context.",
  expand({ target, args, invokeMacro }) {
    const aggregates = ((target as { members?: unknown[] }).members ?? []).filter(
      (m): m is { $type: "Aggregate" } =>
        !!m && typeof m === "object" && (m as { $type?: string }).$type === "Aggregate",
    );
    return [
      // Capability application on the context host → fans state + filter to all.
      implementsCapabilityRef("softDeletable"),
      // Operations on each child aggregate.
      // `invokeMacro` args skip `bindArgs`, so pass the already-resolved
      // policy node straight through — same value `softDelete` would have
      // received from its own `requires:` arg.
      ...aggregates.flatMap((agg) =>
        invokeMacro("softDelete", { target: agg, args: { requires: args.requires } }),
      ),
    ] as never[];
  },
});
