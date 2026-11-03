// ---------------------------------------------------------------------------
// The bounded context a model type's identity text is keyed under — the
// `<Ctx>` segment of `src/util/model-text-key.ts`, for the IMPLICIT sites a
// frontend renders without a `label(…)` call in the source (a form field's
// label, an enum option, a submit button).
//
// The explicit `label(…)` path resolves on the AST (`src/language/model-text.ts`)
// where declaration scope is plain; an emitter only holds enriched contexts, in
// which a root-level enum / value object has been folded into EVERY context.
// `systemLevel` records the declaration scope, so both paths agree that such a
// type is keyed under `_system`.
// ---------------------------------------------------------------------------

import type { BoundedContextIR } from "../types/loom-ir.js";

function declares(bc: BoundedContextIR, typeName: string): "own" | "system" | undefined {
  if (bc.aggregates.some((a) => a.name === typeName || a.parts?.some((p) => p.name === typeName)))
    return "own";
  if (bc.workflows.some((w) => w.name === typeName)) return "own";
  const en = bc.enums.find((e) => e.name === typeName);
  if (en) return en.systemLevel ? "system" : "own";
  const vo = bc.valueObjects.find((v) => v.name === typeName);
  if (vo) return vo.systemLevel ? "system" : "own";
  return undefined;
}

/** The context name `typeName` is keyed under, looked up first in `home` (the
 *  context the rendering form belongs to), then in `others`; `undefined` for a
 *  system-level (root-declared) type or one no given context declares. */
export function modelTextContextOf(
  typeName: string,
  home: BoundedContextIR | undefined,
  others: Iterable<BoundedContextIR> = [],
): string | undefined {
  for (const bc of home ? [home, ...others] : others) {
    const d = declares(bc, typeName);
    if (d === "own") return bc.name;
    if (d === "system") return undefined;
  }
  return undefined;
}
