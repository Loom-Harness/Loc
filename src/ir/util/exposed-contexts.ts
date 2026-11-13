// The bounded contexts a system serves over HTTP: those of every subdomain an
// `api` exposes, and those a deployable hosts by name (`contexts: [...]`, which
// mounts the context's routes without an `api` declaration).  The one answer
// to "is this context's surface on the wire", so the Frontend Contract and its
// gate cannot disagree.

import type { EnrichedBoundedContextIR, EnrichedSystemIR } from "../types/loom-ir.js";

export function exposedContexts(sys: EnrichedSystemIR): EnrichedBoundedContextIR[] {
  const modules = new Set(sys.apis.map((a) => a.sourceModule));
  const hosted = new Set(sys.deployables.flatMap((d) => d.contextNames));
  return sys.subdomains.flatMap((sd) =>
    sd.contexts.filter((c) => modules.has(sd.name) || hosted.has(c.name)),
  );
}
