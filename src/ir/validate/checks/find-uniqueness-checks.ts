// -------------------------------------------------------------------------
// Single-row finds over a non-unique key (`loom.single-row-find-not-unique`).
//
// `find byNumber(number: string): Ticket?` reads ONE row by equality on
// `number`.  Unless a `unique (number)` invariant makes that key a natural key,
// nothing stops two rows from sharing it, and every backend then returns
// whichever row the database yields first — silently, with no error and no
// deterministic choice.  The fix is the domain's own: declare the key unique
// (which also derives the DB unique index and the 409 mapping).
//
// Fires only when the read is unambiguously a key lookup: the return type is a
// single aggregate row (`T` / `T?`), and the filter is a pure conjunction of
// `this.<field> == <param>` equalities (or a clause-less find, whose params
// match fields by name — the convention every backend applies).  A filter with
// any other shape (ranges, `||`, computed operands) is a query, not a key
// lookup, and is left alone.  The read is covered when some `unique (...)` key's
// columns are all among the matched fields, or the match includes `id`.
// -------------------------------------------------------------------------

import { diagMessage } from "../../../diagnostics/messages.js";
import type { AggregateIR, BoundedContextIR, ExprIR, FindIR, TypeIR } from "../../types/loom-ir.js";
import type { LoomDiagnostic } from "./diagnostic.js";

/** The aggregate field read by `this.<f>` / a bare `this-prop` ref, else null. */
function thisField(e: ExprIR): string | null {
  if (e.kind === "member" && e.receiver.kind === "this") return e.member;
  if (e.kind === "ref" && e.refKind === "this-prop") return e.name;
  return null;
}

function isParamRef(e: ExprIR): boolean {
  return e.kind === "ref" && e.refKind === "param";
}

/** The fields a pure `this.f == p && …` conjunction matches, or null when the
 *  predicate has any other shape. */
function equalityKeyFields(e: ExprIR): string[] | null {
  if (e.kind !== "binary") return null;
  if (e.op === "&&") {
    const l = equalityKeyFields(e.left);
    const r = equalityKeyFields(e.right);
    return l && r ? [...l, ...r] : null;
  }
  if (e.op !== "==") return null;
  const lf = thisField(e.left);
  if (lf !== null && isParamRef(e.right)) return [lf];
  const rf = thisField(e.right);
  if (rf !== null && isParamRef(e.left)) return [rf];
  return null;
}

/** Clause-less convention: each param pairs with the field of the same name
 *  (or its `<field>Id` spelling) — the match every backend's repository
 *  emitter applies. */
function conventionKeyFields(agg: AggregateIR, find: FindIR): string[] {
  const out: string[] = [];
  for (const p of find.params) {
    const f = agg.fields.find(
      (x) => x.name === p.name || `${x.name.replace(/Id$/, "")}Id` === p.name,
    );
    if (f) out.push(f.name);
  }
  return out;
}

function singleRowOf(t: TypeIR, aggName: string): boolean {
  const b = t.kind === "optional" ? t.inner : t;
  return b.kind === "entity" && b.name === aggName;
}

export function validateSingleRowFindUniqueness(
  ctx: BoundedContextIR,
  diags: LoomDiagnostic[],
): void {
  for (const repo of ctx.repositories) {
    const agg = ctx.aggregates.find((a) => a.name === repo.aggregateName);
    if (!agg) continue;
    for (const find of repo.finds) {
      if (find.synthesized || find.auditHistory) continue;
      if (!singleRowOf(find.returnType, agg.name)) continue;
      const keyFields = find.filter
        ? equalityKeyFields(find.filter)
        : conventionKeyFields(agg, find);
      if (!keyFields || keyFields.length === 0) continue;
      if (keyFields.includes("id")) continue;
      const matched = new Set(keyFields);
      const covered = (agg.uniqueKeys ?? []).some((uk) => uk.columns.every((c) => matched.has(c)));
      if (covered) continue;
      const cols = [...matched].join(", ");
      diags.push({
        severity: "warning",
        code: "loom.single-row-find-not-unique",
        message: diagMessage("loom.single-row-find-not-unique", {
          repo: repo.name,
          find: find.name,
          agg: agg.name,
          cols,
        }),
        source: `${ctx.name}/${repo.name}.${find.name}`,
        origin: repo.origin,
      });
    }
  }
}
