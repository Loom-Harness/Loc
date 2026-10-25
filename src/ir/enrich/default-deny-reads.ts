// Phase ⑥ — the compiler-derived reads fail CLOSED under `denyByDefault`
// (mission M-T3.19).
//
// Every concrete aggregate serves a list read (`GET /<aggs>`, backed by the
// repository find `all` — usually the one `ensureFindAll` injects) and a by-id
// read (`GET /<aggs>/{id}`).  Under `enforcement: denyByDefault`, on a context
// hosted by an `auth: required` backend, a read the author declared no gate
// for must not serve "any authenticated caller": it is refused with 403 at
// runtime.  This pass marks the repository (`readsDefaultDenied`) and stamps
// the synthesised deny gate on an ungated `all` (`defaultDenied`), so the list
// read is denied by the SAME gate path every backend already renders for an
// author-written `find all … requires …`.  The by-id read's deny gate is
// synthesised on demand from the flag (`byIdRouteFind`, `read-gates.ts`).
//
// Runs AFTER `ensureHistoryFind` (inside `enrichContext`): history copies the
// list read's AUTHOR gate, and `loom.audit-history-ungated` keeps reporting an
// ungated history exactly as before — this pass does not widen into it.
//
// The build is non-breaking for one release (owner decision 2026-10-11): the
// validator WARNS (`loom.default-deny-list-ungated` /
// `loom.default-deny-by-id-ungated`) and tells the author which declaration
// restores access.

import type { EnrichedSubdomainIR, SystemIR } from "../types/loom-ir.js";
import { DEFAULT_DENY_GATE, defaultDenyGuardedContexts } from "../util/read-gates.js";

export function applyDefaultDenyReads(m: EnrichedSubdomainIR, sys: SystemIR): EnrichedSubdomainIR {
  const guarded = defaultDenyGuardedContexts(sys);
  if (guarded.size === 0) return m;
  return {
    ...m,
    contexts: m.contexts.map((c) => {
      if (!guarded.has(c.name)) return c;
      return {
        ...c,
        repositories: c.repositories.map((r) => ({
          ...r,
          readsDefaultDenied: true,
          finds: r.finds.map((f) =>
            f.name === "all" && !f.requires
              ? { ...f, requires: DEFAULT_DENY_GATE(), defaultDenied: true }
              : f,
          ),
        })),
      };
    }),
  };
}
