// ---------------------------------------------------------------------------
// Foreign id brands — the id types a deployable REFERENCES but whose owning
// aggregate it does not HOST, so it must emit the brand itself.
//
// Why this is shared rather than per-backend: the same collection was written
// out four times (hono, python, dotnet, java), and all four drew from the same
// two sources — foreign consumed-event fields and workflow STATE fields.  None
// covered workflow STARTER PARAMS, so `create(orderId: Order id)` on a
// deployable that doesn't host `Order` emitted a reference to an id brand that
// was never declared.  Every one of those backends produced code that failed
// its own compiler, and no vitest-tier gate saw it (the model is valid and
// every emitter "succeeds").
//
// A missing SOURCE is the bug this module exists to make unrepeatable: adding a
// new place ids can be referenced is one edit here, not four.
// ---------------------------------------------------------------------------

import type { TypeIR, UserIR, WorkflowIR } from "../types/loom-ir.js";

/** Every `TypeIR` position in a workflow that can name a foreign aggregate id:
 *  persisted correlation/saga STATE, plus the STARTER PARAMS a command or
 *  event hands the workflow. */
export function workflowIdTypeSources(workflows: readonly WorkflowIR[]): TypeIR[] {
  const out: TypeIR[] = [];
  for (const w of workflows) {
    for (const f of w.stateFields ?? []) out.push(f.type);
    for (const c of w.creates) for (const p of c.params) out.push(p.type);
  }
  return out;
}

/** Every `TypeIR` position in the system `user { … }` claim shape.  The auth
 *  tree's `User` type names each claim's type, so a `agentId: Agent id?` claim
 *  on a deployable that does not host `Agent` needs the `AgentId` brand
 *  declared locally — every `auth: required` deployable carries the SAME
 *  system-wide claim shape, whichever contexts it hosts. */
export function userClaimIdTypeSources(user: UserIR | undefined): TypeIR[] {
  return (user?.fields ?? []).map((f) => f.type);
}

/** The distinct id-target names among `sources` that `hostedIdNames` doesn't
 *  cover — i.e. the brands this deployable has to declare locally. */
export function foreignIdBrandNames(
  hostedIdNames: ReadonlySet<string>,
  sources: readonly TypeIR[],
): string[] {
  return [
    ...new Set(
      sources
        .map(unwrapIdType)
        .filter((t): t is Extract<TypeIR, { kind: "id" }> => t?.kind === "id")
        .map((t) => t.targetName)
        .filter((n) => !hostedIdNames.has(n)),
    ),
  ];
}

/** The `id` type a position names through its `optional` / `array` wrappers —
 *  `Agent id?` and `Agent id[]` reference the `AgentId` brand exactly as a bare
 *  `Agent id` does. */
function unwrapIdType(t: TypeIR): TypeIR | undefined {
  if (t.kind === "optional") return unwrapIdType(t.inner);
  if (t.kind === "array") return unwrapIdType(t.element);
  return t;
}
