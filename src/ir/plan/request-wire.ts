// Where each field of a request record rides on the wire.
//
// A `command` / `query` record states a request; the route that carries it
// decides where each field travels.  A `{token}` of the path binds the field
// of that name, a bodyless method or a paged run reads the rest from the
// query string, a `send` route's binding block takes a field from a header or
// the raw body, and everything else is the JSON body.  Two kinds of route
// carry a record:
//   - an explicit `route`, whose handler takes the record (`send` or `->`),
//     binding each field by `routedParamSource`, the rule every backend's
//     explicit-route emitter binds by;
//   - a derived route (`api X from S`), which carries the record the context
//     declares for it (`declaredRequestFor`) and binds each field where the
//     derived operation's own parameter of that name rides.
// A field no route carries is reported in the body: the record as a
// dispatcher hands it over.  The wire spec describes the body with this, so
// a record that carries the path `id` does not claim the client sends it in
// the body.

import type { BoundedContextIR, EnrichedSystemIR } from "../types/loom-ir.js";
import { deriveContextOperations } from "../util/api-surface.js";
import { declaredRequestFor } from "../util/declared-request.js";
import { requestRecordFor } from "../util/handler-contracts.js";
import { routedPagedRun, routedParamSource } from "../util/routed-handler.js";
import { resolveRoute } from "./route-handler.js";

/** Where one request field rides. */
export type RequestFieldSource = "path" | "query" | "body" | "header" | "raw-body";

/** Every place each field of each request record rides, across the routes
 *  that carry it: `<context>` → `<record>` → `<field>` → sources.  A record
 *  no route carries is absent. */
export type RequestFieldSources = ReadonlyMap<
  string,
  ReadonlyMap<string, ReadonlyMap<string, ReadonlySet<RequestFieldSource>>>
>;

export function requestFieldSources(sys: EnrichedSystemIR): RequestFieldSources {
  const out = new Map<string, Map<string, Map<string, Set<RequestFieldSource>>>>();
  const note = (ctx: string, record: string, field: string, source: RequestFieldSource) => {
    const byRecord = out.get(ctx) ?? new Map<string, Map<string, Set<RequestFieldSource>>>();
    out.set(ctx, byRecord);
    const byField = byRecord.get(record) ?? new Map<string, Set<RequestFieldSource>>();
    byRecord.set(record, byField);
    const sources = byField.get(field) ?? new Set<RequestFieldSource>();
    byField.set(field, sources);
    sources.add(source);
  };
  const contexts: BoundedContextIR[] = sys.subdomains.flatMap((sd) => sd.contexts);

  for (const route of sys.apis.flatMap((a) => a.routes ?? [])) {
    const resolved = resolveRoute(route, contexts);
    if (!resolved) continue;
    const { context, routed } = resolved;
    const paged = routedPagedRun(routed.handler);
    const binds = route.binding.kind === "send" ? route.binding.binds : [];
    for (const p of routed.handler.params) {
      const rec = requestRecordFor(p.type, context);
      if (!rec) continue;
      for (const f of rec.fields) {
        const bound = binds.find((b) => b.field === f.name);
        note(
          context.name,
          rec.name,
          f.name,
          bound ? bound.source : routedParamSource(f.name, route, paged),
        );
      }
    }
  }

  for (const ctx of contexts) {
    for (const op of deriveContextOperations(ctx)) {
      // A slot an explicit route claims is still this operation's slot: the
      // explicit route replaces the server, not the request, and its path
      // carries the same aggregate id (under its own placeholder name).  So
      // the operation's own parameter locations still describe the record.
      const rec = declaredRequestFor(ctx.payloads, ctx.aggregates, op);
      if (!rec) continue;
      for (const f of rec.fields) {
        const param = op.params.find((p) => p.name === f.name);
        note(ctx.name, rec.name, f.name, param?.location ?? "body");
      }
    }
  }
  return out;
}
