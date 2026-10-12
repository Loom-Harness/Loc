// The read name an author-declared `retrieval` is served under — one
// derivation, read by both the language layer (which resolves a page-body
// `<api>.<Agg>.<read>(…)` and the scaffold filter bar against the AST) and
// the IR (whose enrich pass derives the route's `FindIR` under this name).
//
//   retrieval DoctorAgenda(d: Doctor id) of Appointment { … }
//     → read name `doctorAgenda`  → GET /api/appointments/doctor_agenda?d=…
//
// The read name lives in the same namespace as the repository's `find`s and
// the standard ops (`all` / `byId` / `history` / `create` / …); a collision is
// refused (`loom.retrieval-route-collision`) rather than letting one route
// shadow the other.

import { lowerFirst } from "./naming.js";

/** The read (find / client-method) name a retrieval's GET route answers to. */
export function retrievalReadName(retrievalName: string): string {
  return lowerFirst(retrievalName);
}

/** The facts of a retrieval's target aggregate that decide whether its read
 *  is served over HTTP — spelled neutrally so the AST (`persistedAs` /
 *  `shape` / `superType` / `isAbstract`) and the IR (`persistedAs` /
 *  `savingShape` / `extendsAggregate` / `isAbstract`) ask the same question. */
export interface RetrievalRouteTarget {
  readonly eventLog: boolean;
  readonly shape: string | undefined;
  readonly extendsBase: boolean;
  readonly abstract: boolean;
}

/** True when a retrieval over this aggregate gets its GET route: a concrete,
 *  single-table relational aggregate — the shape whose `run<Retrieval>` read
 *  (filter + declared `sort:` + `offset`/`limit` window) every backend
 *  implements.  An event log, a `document` / `embedded` aggregate and an
 *  inheritance subtype are refused a route with `loom.retrieval-unrouted`
 *  rather than half-served. */
export function retrievalRouteServed(t: RetrievalRouteTarget): boolean {
  return !t.abstract && !t.eventLog && !t.extendsBase && (t.shape ?? "relational") === "relational";
}
