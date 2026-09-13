import {
  assignStmt,
  callExpr,
  defineMacro,
  nullLit,
  operation,
  requiresStmt,
} from "../../api/index.js";
import { boolLit, nowExpr } from "../../api/ui-factories.js";

/** Soft-delete operations (typed-capabilities.md).
 *
 * Adds the `softDelete()` / `restore()` mutations to an aggregate.  A capability
 * is a pure mixin (fields + filter + stamp), so the operations live here, in a
 * macro, while the STATE + query FILTER come from the built-in `softDeletable`
 * capability.  Compose them:
 *
 *   aggregate Order with softDeletable, softDelete { subject: string }
 *
 *   ↓  softDeletable (capability) → isDeleted, deletedAt, filter !this.isDeleted
 *      softDelete    (macro)      → operation softDelete() / restore()
 *
 * (Pre-Phase-3 this name was the *context* macro that declared the
 * `filter for "softDeletable"` predicate; the capability now co-locates that
 * filter, so `softDelete` is repurposed as the aggregate-level ops macro.)
 *
 * AUTHORIZATION (`requires:`).  Both emitted operations are public commands
 * with macro-owned bodies, so — exactly like `crudish` — under
 * `auth { enforcement: denyByDefault }` a bare `with softDelete` could not
 * validate: two `loom.default-deny-ungated` errors on members the author has
 * no surface to gate.  Hand the macro a function-form `policy` and both
 * operations open with `requires <Policy>()`:
 *
 *   with softDeletable, softDelete(requires: RecordsManager) */
export default defineMacro({
  name: "softDelete",
  target: "aggregate",
  apiVersion: 1,
  params: {
    /** Name of a parameterless function-form `policy` to gate both emitted
     * operations with.  Spliced as `requires <Policy>()`, the first statement
     * of each body.  See the `requires:` note above. */
    requires: { kind: "ref", of: "Policy", optional: true },
  },
  description:
    "Adds softDelete()/restore() operations to an aggregate.  Pair with the " +
    "built-in `softDeletable` capability, which supplies the isDeleted/deletedAt " +
    "state and the read filter.",
  expand({ args }) {
    // `requires:` resolves to the function-form `policy` node itself.  A
    // parameterised policy can't be called from here (the macro has nothing
    // to pass it), so refuse it at the call site rather than emit a body that
    // fails `loom.policy-fn-arity` on a line the author never wrote.
    const policy = args.requires as { name?: string; params?: readonly unknown[] } | undefined;
    if (policy && (policy.params?.length ?? 0) > 0) {
      throw new Error(
        `requires: policy '${policy.name}' takes ${policy.params?.length} parameter(s); ` +
          "softDelete can only call a parameterless policy — wrap it in one " +
          `(\`policy Gate(): bool = ${policy.name}(...)\`)`,
      );
    }
    // Built fresh per operation: an AST node has ONE container, so two
    // bodies need two statements, not one shared node.
    const gate = () => (policy?.name ? [requiresStmt(callExpr(policy.name, []))] : []);
    return [
      operation(
        "softDelete",
        [],
        [...gate(), assignStmt("isDeleted", boolLit(true)), assignStmt("deletedAt", nowExpr())],
      ),
      operation(
        "restore",
        [],
        [...gate(), assignStmt("isDeleted", boolLit(false)), assignStmt("deletedAt", nullLit())],
      ),
    ];
  },
});
