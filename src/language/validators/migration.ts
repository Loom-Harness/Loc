// Migration-block checks (M-T2.1, https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/new-plan/missions/M-T2.1-migration-surface-design.md).
//
// A top-level `migration "<name>" { rename Agg.old -> new }` block is a
// permanent, ledger-style record whose `rename` steps disambiguate the derived
// snapshot→model migration diff.  These checks are deliberately STRUCTURAL and
// snapshot-independent: a historical ledger block legitimately references field
// names that have since moved on (a column renamed a second time), so we must
// NOT require `to` to be a currently-live field — that would make an old,
// correct block fail forever.  We only reject the unambiguously-broken shapes:
//
//   - `loom.migration-duplicate-name`   — two blocks share a name.
//   - `loom.rename-to-self`             — `from` == `to` (a no-op rename), on a
//                                         COLUMN or a TABLE/aggregate rename.
//   - `loom.rename-duplicate-source`    — one aggregate column / one old table
//                                         renamed twice FROM (ambiguous origin).
//   - `loom.rename-duplicate-target`    — two renames collide ON one target
//                                         column / aggregate (ambiguous dest.).
//
// A column step's `aggregate` is a real cross-reference (`[Aggregate:ID]`), so
// an unknown live aggregate is already a Langium linking error — not re-checked
// here.  A table step's names are bare on both sides (the old side is gone, the
// new side may be an aggregate, workflow or projection in another file), so
// only its structure is checked here; its target is resolved on the merged IR
// (`validateTableSteps`, phase ⑦).

import { AstUtils, type ValidationAcceptor } from "langium";
import { diagMessage } from "../../diagnostics/messages.js";
import type { Aggregate, Migration, Model } from "../generated/ast.js";
import { isMigration, isProperty, isSqlStep, isTableRename } from "../generated/ast.js";

export function checkMigrations(model: Model, accept: ValidationAcceptor): void {
  const seenNames = new Set<string>();
  // (aggregate, column) → seen once, across ALL blocks: a column may be a
  // rename source at most once and a rename target at most once.
  const seenSource = new Set<string>();
  const seenTarget = new Set<string>();
  // (aggregate, column) → at most one backfill per block (`loom.backfill-duplicate`
  // keys on block + column: re-backfilling the same column in a LATER block is
  // legitimate ledger history, within one block it is ambiguous).
  const seenBackfill = new Set<string>();
  for (const node of AstUtils.streamAllContents(model)) {
    if (!isMigration(node)) continue;
    seenBackfill.clear();
    checkMigration(node, seenNames, seenSource, seenTarget, seenBackfill, accept);
  }
}

function checkMigration(
  m: Migration,
  seenNames: Set<string>,
  seenSource: Set<string>,
  seenTarget: Set<string>,
  seenBackfill: Set<string>,
  accept: ValidationAcceptor,
): void {
  if (seenNames.has(m.name)) {
    accept(
      "error",
      diagMessage("loom.migration-duplicate-name", { name: JSON.stringify(m.name) }),
      {
        node: m,
        property: "name",
        code: "loom.migration-duplicate-name",
      },
    );
  } else {
    seenNames.add(m.name);
  }

  for (const step of m.steps) {
    if (isTableRename(step)) {
      // Table step (`Old -> New`, or the move `A.Old -> B.New`).  Structural
      // checks only: both sides are bare names (the old one is gone, the new
      // one may live in another file), resolved at phase ⑦.  Keys carry the
      // context on the move form, so `A.Note -> B.Note` is no self-rename.
      const from =
        step.fromContext !== undefined ? `${step.fromContext}.${step.fromTable}` : step.fromTable;
      const to = step.toContext !== undefined ? `${step.toContext}.${step.to}` : step.to;
      if (from === to) {
        accept("error", diagMessage("loom.rename-to-self#table", { fromTable: from, to }), {
          node: step,
          property: "to",
          code: "loom.rename-to-self",
        });
        continue;
      }
      if (seenSource.has(from)) {
        accept(
          "error",
          diagMessage("loom.rename-duplicate-source#table-is-renamed-more-than", {
            fromTable: from,
          }),
          { node: step, property: "fromTable", code: "loom.rename-duplicate-source" },
        );
      } else {
        seenSource.add(from);
      }
      if (seenTarget.has(to)) {
        accept(
          "error",
          diagMessage("loom.rename-duplicate-target#two-renames-target-aggregate", { to }),
          { node: step, property: "to", code: "loom.rename-duplicate-target" },
        );
      } else {
        seenTarget.add(to);
      }
      continue;
    }
    if (isSqlStep(step)) {
      // Raw `sql "…"` step (M-T2.3) — structural check only: non-empty.
      if (step.sql.trim() === "") {
        accept("error", diagMessage("loom.migration-sql-empty"), {
          node: step,
          property: "sql",
          code: "loom.migration-sql-empty",
        });
      }
      // `sql <placement> "…"` (B-20): the only placement is `before`.
      if (step.placement !== undefined && step.placement !== "before") {
        accept(
          "error",
          diagMessage("loom.migration-sql-placement", { placement: step.placement }),
          { node: step, property: "placement", code: "loom.migration-sql-placement" },
        );
      }
      continue;
    }
    // A column step is scoped to a specific aggregate; key collisions per aggregate.
    const agg = step.aggregate.ref?.name ?? step.aggregate.$refText;
    if (step.value !== undefined) {
      // Backfill (`Agg.field = <expr>`, M-T2.3).  Unlike a rename's dead-side
      // names, the target field must be LIVE — it names the newly-added /
      // newly-required column.  (The expression's SQL-renderability and type
      // fit are IR-level checks — phase ⑦ — where the lowered ExprIR exists.)
      const fields = step.aggregate.ref?.members.filter(isProperty).map((p) => p.name) ?? [];
      if (step.aggregate.ref && !fields.includes(step.field)) {
        // An inherited field is backfilled where it is declared: the base's
        // step reaches every table that stores it (the shared TPH table, or
        // each TPC concrete's own), so one spelling covers every layout.
        const base = declaringAncestor(step.aggregate.ref, step.field);
        accept(
          "error",
          base
            ? diagMessage("loom.backfill-unknown-field#inherited", {
                field: step.field,
                agg,
                base,
              })
            : diagMessage("loom.backfill-unknown-field", { field: step.field, agg }),
          { node: step, property: "field", code: "loom.backfill-unknown-field" },
        );
      }
      const key = `${agg}.${step.field}`;
      if (seenBackfill.has(key)) {
        accept("error", diagMessage("loom.backfill-duplicate", { key }), {
          node: step,
          property: "field",
          code: "loom.backfill-duplicate",
        });
      } else {
        seenBackfill.add(key);
      }
      continue;
    }
    const stepTo = step.renamedTo ?? step.field;
    if (step.field === stepTo) {
      accept("error", diagMessage("loom.rename-to-self#field", { agg, field: step.field }), {
        node: step,
        property: "renamedTo",
        code: "loom.rename-to-self",
      });
      continue;
    }
    const sourceKey = `${agg}.${step.field}`;
    const targetKey = `${agg}.${stepTo}`;
    if (seenSource.has(sourceKey)) {
      accept(
        "error",
        diagMessage("loom.rename-duplicate-source#field-is-renamed-more-than", { sourceKey }),
        { node: step, property: "field", code: "loom.rename-duplicate-source" },
      );
    } else {
      seenSource.add(sourceKey);
    }
    if (seenTarget.has(targetKey)) {
      accept(
        "error",
        diagMessage("loom.rename-duplicate-target#two-renames-target-a-column", { targetKey }),
        { node: step, property: "renamedTo", code: "loom.rename-duplicate-target" },
      );
    } else {
      seenTarget.add(targetKey);
    }
  }
}

/** The nearest `extends` ancestor of `agg` that declares the property
 *  `field`, or undefined.  A `seen` guard keeps a malformed cycle finite. */
function declaringAncestor(agg: Aggregate, field: string): string | undefined {
  const seen = new Set<Aggregate>([agg]);
  let cur = agg.superType?.ref;
  while (cur && !seen.has(cur)) {
    if (cur.members.some((m) => isProperty(m) && m.name === field)) return cur.name;
    seen.add(cur);
    cur = cur.superType?.ref;
  }
  return undefined;
}
