// The AST-side read shape of a query-time projection — the one rule the
// typing pass uses to type a page body's `QueryView { of: <handle>.<Proj> }`
// read before any `ProjectionIR` exists.

import { PROJECTION_AGGREGATE_OPS } from "../../util/projection-aggregate-ops.js";
import type { Projection, ProjectionSelect } from "../generated/ast.js";
import {
  isCallSuffix,
  isNameRef,
  isPostfixChain,
  isProjectionOn,
  isProperty,
} from "../generated/ast.js";

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

/** Does this `select` aggregate the whole source (`count`, `sum(a.x)`, …)? */
function isAggregateSelect(s: ProjectionSelect): boolean {
  const e = s.expr;
  if (isNameRef(e)) return e.name === "count";
  if (!isPostfixChain(e) || !isNameRef(e.head) || e.suffixes.length !== 1) return false;
  const call = e.suffixes[0];
  if (!isCallSuffix(call) || !PROJECTION_AGGREGATE_OPS.has(e.head.name)) return false;
  return e.head.name === "count" ? call.args.length === 0 : call.args.length === 1;
}

/** The RESPONSE SHAPE a backend's query route answers for this AST
 *  `projection` (what a `test e2e` `api.<proj>.list()` receives), or
 *  `undefined` when it has no query route.  An AST-side mirror of the
 *  backends' `wholeTableAggregates` (`src/ir/util/projection-aggregate.ts`):
 *  ONE row only when every `select` aggregates the whole table and nothing
 *  groups it; every other read answers an array of rows. */
export function astProjectionWireShape(p: Projection): "one" | "many" | undefined {
  if (!p.source || p.members.some(isProjectionOn) || p.key !== undefined) return undefined;
  if (p.groupBys.length > 0 || p.selects.length === 0) return "many";
  return p.selects.every(isAggregateSelect) ? "one" : "many";
}
