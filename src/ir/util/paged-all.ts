// ---------------------------------------------------------------------------
// Does an aggregate's `all` read return the PAGED envelope, or a bare array?
//
// ONE detector, because three parties have to agree about it and a
// disagreement is invisible:
//
//   - the client emitter    (`_frontend/api-module.ts`)  — which schema
//     `useAll<Agg>` parses (`<Agg>Paged` vs `<Agg>ListResponse`);
//   - the page walker       (`_walker/paged-query.ts`)   — whether a
//     `QueryView`'s arms read `.items` or the array itself;
//   - the form field VM     (`_walker/form-fields-vm.ts`) — what an `X id`
//     picker maps over to build its options.
//
// The third one did NOT ask.  Every `field-input-id-select` template on every
// pack hard-coded `<hook>.data?.items ?? []`, which is right for the
// paged-by-default auto-`findAll` (M-T2.6) and WRONG the moment the author
// declares the read explicitly:
//
//     repository Docs for Doc { find all(): Doc[] requires <expr> }
//
// — the only documented way to put an authorization gate on a list route
// (`docs/auth.md`).  Declaring it keeps the wire contract the signature asks
// for (a bare `Doc[]`), so `.items` is `undefined` there.  On a typed client
// that is `Property 'items' does not exist on type …` plus an implicit-`any`
// on the map callback, and the generated frontend does not build.  Where
// inference is weaker, `(x.data?.items ?? [])` quietly evaluates to `[]` and
// the picker renders ZERO OPTIONS with nothing, anywhere, reporting a problem.
//
// So: the gate or a working frontend, not both — until this answered the
// question in one place.
//
// Lives at the IR layer for the same reason `projection-read.ts` and
// `repo-read.ts` do: the fact is an IR fact (a declared find's return type),
// and `generator → ir` is with the pipeline while the reverse is not.
// ---------------------------------------------------------------------------

import { pagedReturn } from "../stdlib/generics.js";
import type { BoundedContextIR } from "../types/loom-ir.js";

/** The name every aggregate's list read carries — the auto-`findAll`'s, and
 *  the one a hand-written `find all(...)` must use to override it. */
export const ALL_READ = "all";

/** True when `<Agg>.all` returns the `paged<T>` envelope (`{items, page,
 *  pageSize, total, totalPages}`) rather than a bare `T[]`.
 *
 *  FALSE is the conservative answer and the one an unresolvable aggregate
 *  gets: a bare-array read of an envelope shows an empty list, while an
 *  `.items` read of a bare array is a type error AND a silent empty list. */
export function isPagedAllRead(
  aggregateName: string,
  bcByAggregate: ReadonlyMap<string, BoundedContextIR> | undefined,
): boolean {
  const bc = bcByAggregate?.get(aggregateName);
  if (!bc) return false;
  const repo = bc.repositories.find((r) => r.aggregateName === aggregateName);
  const all = repo?.finds.find((f) => f.name === ALL_READ);
  return all ? pagedReturn(all.returnType) !== null : false;
}
