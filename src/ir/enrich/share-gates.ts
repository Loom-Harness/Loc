// `allow share on X [when C]` (D-SHARING) — who may create or revoke a share
// of the `shareable` aggregate X.  The rule gates the share aggregate's
// lifecycle: its canonical `create` and its `revoke` operation each get a
// leading `requires` that ORs the rules' conditions (a rule with no `when`
// admits every caller).  With no rule nobody may share: the gate is `false`.
//
// The share aggregate is found by the names the `shareable` unfold gives it
// (`<X>Share` with a `revoke` operation), so an unfolded, hand-edited share
// keeps its gate.  Which writes a share then OPENS is the policy row rules'
// business (`policy-scopes.ts`), not this pass's.

import type { AggregateIR, ExprIR, PolicyShareGateIR, StmtIR } from "../types/loom-ir.js";

const SHAREABLE = "shareable";

/** The share aggregate's name for shareable aggregate `x`. */
function shareAggregateName(x: string): string {
  return `${x}Share`;
}

/** The lifecycle gate a share of `x` carries — the rules' conditions ORed. */
function shareGateOf(x: string, gates: readonly PolicyShareGateIR[]): ExprIR {
  const mine = gates.filter((g) => g.aggregate === x);
  if (mine.length === 0) return bool(false);
  if (mine.some((g) => g.when === undefined)) return bool(true);
  return mine
    .map((g) => g.when!)
    .reduce((l, r) => ({
      kind: "binary",
      op: "||",
      left: l,
      right: r,
      leftType: BOOL,
      rightType: BOOL,
      resultType: BOOL,
    }));
}

const BOOL = { kind: "primitive", name: "bool" } as const;

function bool(value: boolean): ExprIR {
  return { kind: "literal", lit: "bool", value: String(value) };
}

/** Prepend each shareable aggregate's share gate to its share aggregate's
 *  canonical `create` and `revoke` operation. */
export function applyShareGates<A extends AggregateIR>(
  aggregates: readonly A[],
  gates: readonly PolicyShareGateIR[] | undefined,
): A[] {
  const shareOf = new Map<string, string>();
  for (const a of aggregates) {
    if (a.capabilities.includes(SHAREABLE)) shareOf.set(shareAggregateName(a.name), a.name);
  }
  if (shareOf.size === 0) return [...aggregates];
  return aggregates.map((a) => {
    const target = shareOf.get(a.name);
    if (!target) return a;
    const gate = shareGateOf(target, gates ?? []);
    const source = `allow share on ${target}`;
    const gated = (ops: readonly A["operations"][number][], pick: (n: string) => boolean) =>
      ops.map((op) =>
        pick(op.name)
          ? {
              ...op,
              statements: [{ kind: "requires", expr: gate, source } as StmtIR, ...op.statements],
            }
          : op,
      );
    return {
      ...a,
      creates: gated(a.creates, () => true),
      operations: gated(a.operations, (n) => n === "revoke"),
    };
  });
}
