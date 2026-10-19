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

import type { BoundedContextIR, TypeIR, UserIR, WorkflowIR } from "../types/loom-ir.js";

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

/** Every `TypeIR` position of the HOSTED contexts' own declaration surface —
 *  aggregate / part fields, derived and function types, operation / create /
 *  destroy params and returns, value-object, event and payload fields,
 *  repository finds, workflows, projections, command / query handlers and
 *  domain-service operations (claims D18).
 *
 *  A cross-context `X id` is legal (`aggregate Clm { pol: Pol id }` in context B
 *  against `aggregate Pol` in sibling context A), so a deployable hosting B
 *  alone names `PolId` from its domain class, schema, repository and routes —
 *  and, with only workflows / events / claims as sources, declared it nowhere:
 *  node TS2694, python an ImportError at boot, javac / csc "cannot find
 *  symbol".  The same position list as `foreignValueTypeSeeds`
 *  (`foreign-event-types.ts`), which answers the value-object / enum half of
 *  the same question. */
export function hostedContextIdTypeSources(contexts: readonly BoundedContextIR[]): TypeIR[] {
  const out: TypeIR[] = [];
  const params = (ps: readonly { type: TypeIR }[]): void => {
    for (const p of ps) out.push(p.type);
  };
  const ret = (t: TypeIR | undefined): void => {
    if (t) out.push(t);
  };
  for (const c of contexts) {
    for (const owner of [...c.aggregates, ...c.aggregates.flatMap((a) => a.parts)]) {
      params(owner.fields);
      params(owner.derived);
      for (const fn of owner.functions) {
        params(fn.params);
        ret(fn.returnType);
      }
    }
    for (const a of c.aggregates) {
      for (const op of [...a.operations, ...(a.creates ?? []), ...(a.destroys ?? [])]) {
        params(op.params);
        ret(op.returnType);
      }
    }
    for (const v of c.valueObjects) {
      params(v.fields);
      params(v.derived);
    }
    for (const e of c.events) params(e.fields);
    for (const p of c.payloads) {
      params(p.fields);
      for (const t of p.variants ?? []) out.push(t);
    }
    for (const r of c.repositories) {
      for (const f of r.finds) {
        params(f.params);
        ret(f.returnType);
      }
    }
    for (const w of c.workflows) {
      params(w.params);
      ret(w.returnType);
    }
    out.push(...workflowIdTypeSources(c.workflows));
    for (const p of c.projections) {
      params(p.params);
      params(p.stateFields);
    }
    for (const h of [...(c.commandHandlers ?? []), ...(c.queryHandlers ?? [])]) {
      params(h.params);
      ret(h.returnType);
    }
    for (const s of c.domainServices) {
      for (const op of s.operations) {
        params(op.params);
        ret(op.returnType);
      }
    }
  }
  return out;
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
