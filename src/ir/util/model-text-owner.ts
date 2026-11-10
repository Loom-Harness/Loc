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

/** The contexts that declare `typeName` when the home context does not (neither
 *  as its own nor as a system-level type), sorted by name; empty when the home
 *  context settles it.  More than one entry means the implicit path has no
 *  single owner to key under. */
export function modelTextFallbackOwners(
  typeName: string,
  home: BoundedContextIR | undefined,
  others: Iterable<BoundedContextIR> = [],
): string[] {
  if (home && declares(home, typeName) !== undefined) return [];
  const owners = new Set<string>();
  for (const bc of others) if (declares(bc, typeName) === "own") owners.add(bc.name);
  return [...owners].sort();
}

/** The context name `typeName` is keyed under, looked up first in `home` (the
 *  context the rendering form belongs to), then in `others`; `undefined` for a
 *  system-level (root-declared) type or one no given context declares.
 *
 *  The home context wins outright: a type it declares is the one its own pages
 *  mean, exactly as an unqualified `label(X)` there reads.  A type the home
 *  does not declare is looked up across `others`; when several contexts declare
 *  it the explicit `label(X)` path reports the name ambiguous and the IR check
 *  `loom.model-text-implicit-ambiguous` reports the implicit reference, so the
 *  alphabetically first owner taken here only keeps emission deterministic for
 *  a model already rejected — it depends on the names alone, never on the order
 *  the contexts were enumerated in. */
export function modelTextContextOf(
  typeName: string,
  home: BoundedContextIR | undefined,
  others: Iterable<BoundedContextIR> = [],
): string | undefined {
  if (home) {
    const d = declares(home, typeName);
    if (d === "own") return home.name;
    if (d === "system") return undefined;
  }
  return modelTextFallbackOwners(typeName, undefined, others)[0];
}
