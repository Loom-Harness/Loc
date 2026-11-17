// ---------------------------------------------------------------------------
// A stored OPTIONAL value object with no required field (advisory).
//
// An optional value object stored as leaf columns reads back as absent when
// the leaves it requires are NULL (`absenceProbe`, `ir/plan/
// value-object-columns.ts`).  A value object with no required leaf has nothing
// that tells "absent" from "present with every field unset": both are the
// all-NULL row, and every reader takes it as absent.  The model is legal and
// the reading is deterministic, so this is advice: make one field required.
//
// Only a field stored as leaf columns can be ambiguous — a relational
// aggregate's root and parts, and a projection row.  A document or embedded
// shape stores the value object as JSON, where absence is an explicit null.
//
// Delivery: the `Suggestions:` channel (`src/diagnostics/advisory.ts`).
// ---------------------------------------------------------------------------

import { diagMessage } from "../../../diagnostics/messages.js";
import {
  isFlattenedValueObject,
  requiredLeaves,
  type ValueObjectScope,
} from "../../plan/value-object-columns.js";
import type { EnrichedSystemIR, FieldIR } from "../../types/loom-ir.js";
import type { LoomDiagnostic } from "./diagnostic.js";

export function validateValueObjectNoRequiredField(
  sys: EnrichedSystemIR,
  diags: LoomDiagnostic[],
): void {
  for (const mod of sys.subdomains) {
    for (const ctx of mod.contexts) {
      const flag = (owner: string, fields: readonly FieldIR[]): void => {
        for (const f of fields) {
          if (!(f.optional || f.type.kind === "optional")) continue;
          if (!isFlattenedValueObject(f.type, ctx as ValueObjectScope)) continue;
          if (requiredLeaves(f.name, f.type, ctx as ValueObjectScope).length > 0) continue;
          const vo = f.type.kind === "optional" ? f.type.inner : f.type;
          diags.push({
            severity: "warning",
            code: "loom.valueobject-no-required-field",
            message: diagMessage("loom.valueobject-no-required-field", {
              field: `${owner}.${f.name}`,
              vo: vo.kind === "valueobject" ? vo.name : f.name,
            }),
            source: `${ctx.name}/${owner}`,
            origin: f.origin,
          });
        }
      };
      for (const agg of ctx.aggregates) {
        if (agg.persistedAs === "eventLog") continue;
        if ((agg.savingShape ?? "relational") !== "relational") continue;
        flag(agg.name, agg.fields);
        for (const part of agg.parts) flag(part.name, part.fields);
      }
      for (const p of ctx.projections) flag(p.name, p.stateFields);
    }
  }
}
