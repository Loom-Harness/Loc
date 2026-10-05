// The AST-side read shape of a query-time projection — the one rule the
// typing pass uses to type a page body's `QueryView { of: <handle>.<Proj> }`
// read before any `ProjectionIR` exists.

import type { Projection } from "../generated/ast.js";
import { isProjectionOn, isProperty } from "../generated/ast.js";

/** The RESPONSE SHAPE a frontend read of this AST `projection` yields, or
 *  `undefined` when a frontend cannot read it at all.
 *
 *  An AST-side MIRROR of `projectionReadShape` / `isFrontendReadableProjection`
 *  (`src/ir/util/projection-read.ts`), which answer the same question over
 *  `ProjectionIR`.  The typing pass needs the answer first — a page body's
 *  `data:` lambda binds before any `ProjectionIR` exists — and the language
 *  layer cannot reach the IR predicates.
 *
 *  Two copies of one rule is exactly what `projection-read.ts`'s header warns
 *  against, so the copies are PINNED to agree:
 *  `test/ir/projection-read-shape-parity.test.ts` runs both over every
 *  projection in the shipped corpus and fails on any disagreement — the same
 *  device `adapter-metadata-consistency.test.ts` uses for its pure-data
 *  mirror.  Each clause below cites the IR predicate it mirrors.
 *
 *  Exported for the pass and for that gate: a parity test that re-transcribed these
 *  clauses would pin its own copy against the IR and leave THIS one free to
 *  drift — a green check that never reaches the thing it names. */
export function astProjectionReadShape(p: Projection): "one" | "many" | undefined {
  const handlers = p.members.filter(isProjectionOn); // → IR `handlers`
  const fields = p.members.filter(isProperty); // → IR `stateFields`
  // isQueryTimeProjection: a query source with no fold handlers.
  if (!p.source || handlers.length > 0) return undefined;
  // isSingletonProjection: no `keyed by` ⇒ no correlation field.
  if (p.key !== undefined) return undefined;
  // isGroupedProjection / isShorthandProjection — both ride the wire as an
  // array.  Ask "is it the whole-table aggregation", not "is it grouped":
  // a shorthand read (no declared fields, no `select`) returns the filtered
  // SOURCE ROWS, and is unkeyed too.
  if (p.groupBys.length > 0) return "many";
  if (fields.length === 0 && p.selects.length === 0) return "many";
  return "one";
}
