// ---------------------------------------------------------------------------
// drizzle — the real PersistenceAdapter for the hono platform.  Wraps the
// existing TypeScript/Hono emit fns (`src/generator/typescript/*` +
// `src/platform/hono/shared/emit.ts`) so produced source is byte-identical
// with the orchestrator's direct calls.
//
// Parallel of the dotnet `efcorePersistenceAdapter` (F5a) — same
// contract, mapped to the Hono backend's drizzle-orm + pg stack.
// The orchestrator (`src/platform/hono/shared/emit.ts`) still calls the
// underlying emit fns directly today; this adapter is the public
// surface the F5d-equivalent (Hono) rewire will dispatch through.
// ---------------------------------------------------------------------------

import type { EmitCtx, Lines, PersistenceAdapter } from "../../../../generator/_adapters/index.js";
import { renderSchema } from "../../../../generator/typescript/emit/schema.js";
import type { EnrichedBoundedContextIR } from "../../../../ir/types/loom-ir.js";
import { dedupeByName } from "../../../../util/dedupe.js";
import type { BackendPins } from "../emit.js";

/** Find the matching repository declaration across the deployable's
 *  contexts.  Mirrors `findRepoFor` in the dotnet adapter. */
function _findRepoFor(ctx: EmitCtx, aggName: string) {
  for (const c of ctx.contexts) {
    const r = c.repositories.find((repo) => repo.aggregateName === aggName);
    if (r) return r;
  }
  return undefined;
}

/** The owning bounded context for an aggregate — `buildRepositoryFile`
 *  needs the context to look up capability filters that share the table. */
function _contextOf(ctx: EmitCtx, aggName: string): EnrichedBoundedContextIR | undefined {
  return ctx.contexts.find((c) => c.aggregates.some((a) => a.name === aggName));
}

const splitLines = (s: string): Lines => s.split("\n");

/** JSON-key lines spliced into `package.json#dependencies`.  Returned
 *  as `"key": "version",` lines so the consumer can merge them into
 *  the JSON literal without parsing.  Drizzle + pg only — `hono`,
 *  `@hono/...`, `zod`, `pino` belong to the framework/style adapters. */
const persistenceDeps = (pins: BackendPins): Lines => [
  `"drizzle-orm": "${pins.dependencies["drizzle-orm"]}",`,
  `"pg": "${pins.dependencies.pg}",`,
];

/** The server-entry connection block (DATABASE_URL guard → pg pool →
 *  pool-error logging → drizzle db).  Consumed by the server-entry renderer
 *  (`emit.ts`), so the persistence adapter owns the connection code rather
 *  than it being hardcoded inline. */
export const DRIZZLE_CONNECTION_SETUP: Lines = [
  `if (!process.env.DATABASE_URL) {`,
  `  throw new Error(`,
  `    "DATABASE_URL is required.  Set it in the environment " +`,
  `      "(e.g. postgres://user:pass@host:5432/db).",`,
  `  );`,
  `}`,
  ``,
  `const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });`,
  `// Surface pool-level connection errors on the structured stream — a`,
  `// dropped backend connection (DB restart, network blip) emits 'error'`,
  `// on the pool, not per-query.  Without this hook the failure surfaces`,
  `// only as the NEXT request's 503 from /ready or a 500 from an`,
  `// aggregate route; logging here gives ops the heads-up + the cause.`,
  `pool.on("error", (err) => {`,
  `  baseLogger.warn({`,
  `    event: "db_disconnected",`,
  `    reason: err instanceof Error ? err.message : String(err),`,
  `  });`,
  `});`,
  `const db = drizzle(pool, { schema });`,
];

const persistenceDevDeps = (pins: BackendPins): Lines => [
  `"drizzle-kit": "${pins.devDependencies["drizzle-kit"]}",`,
  `"@types/pg": "${pins.devDependencies["@types/pg"]}",`,
];

/** The drizzle adapter for one registered version's dep pins — the shared
 *  dir never imports a version's `pins.ts`; the version's surface passes its
 *  pins in (D-HONO-SHARED). */
export const drizzlePersistenceAdapterFor = (pins: BackendPins): PersistenceAdapter => ({
  name: "drizzle",

  emitProjectDeps(_ctx: EmitCtx): Lines {
    // package.json deps + devDeps for the drizzle stack, JSON-shaped
    // so the orchestrator rewire can splice them into the existing
    // `projectPackageJson` literal.  Today `projectPackageJson` reads
    // `BACKEND_PINS.dependencies` wholesale (framework + persistence
    // mixed); the F6d-equivalent rewire will collect dep slices from
    // every adapter the deployable resolved and merge them at the
    // package.json render boundary.
    return [...persistenceDeps(pins), ...persistenceDevDeps(pins)];
  },
});

/** Drizzle schema emitter — the deployable's `db/schema.ts` file.  Not
 *  on the formal PersistenceAdapter contract today (the schema is a
 *  drizzle-specific construct); exposed here in the same shape the
 *  rewire will use to replace the inline `renderSchema(...)` call in
 *  `emit.ts`.
 *
 *  `renderSchema` takes a single merged context, so we synthesise one
 *  from every context the deployable hosts — same merge the existing
 *  orchestrator does inline. */
export function emitDrizzleSchema(
  ctx: EmitCtx,
  options: { audit?: boolean; provenance?: boolean } = {},
): Lines {
  const ns = ctx.deployable.name;
  const merged: EnrichedBoundedContextIR = {
    name: ns,
    // Dedupe the ambient root-level enums / VOs that enrichment folds into
    // every hosted context — a plain union would emit duplicate
    // `pgEnum` exports in the schema (rejected by the bundler).
    enums: dedupeByName(ctx.contexts.flatMap((c) => c.enums)),
    valueObjects: dedupeByName(ctx.contexts.flatMap((c) => c.valueObjects)),
    events: ctx.contexts.flatMap((c) => c.events),
    payloads: ctx.contexts.flatMap((c) => c.payloads),
    aggregates: ctx.contexts.flatMap((c) => c.aggregates),
    repositories: ctx.contexts.flatMap((c) => c.repositories),
    workflows: ctx.contexts.flatMap((c) => c.workflows),
    criteria: ctx.contexts.flatMap((c) => c.criteria),
    domainServices: ctx.contexts.flatMap((c) => c.domainServices ?? []),
    channels: ctx.contexts.flatMap((c) => c.channels),
    projections: ctx.contexts.flatMap((c) => c.projections ?? []),
    retrievals: ctx.contexts.flatMap((c) => c.retrievals),
    seeds: ctx.contexts.flatMap((c) => c.seeds),
    tests: ctx.contexts.flatMap((c) => c.tests ?? []),
    commandHandlers: ctx.contexts.flatMap((c) => c.commandHandlers),
    queryHandlers: ctx.contexts.flatMap((c) => c.queryHandlers),
    // Schema emission only — dispatch wiring reads the value computed in
    // `emit.ts`; flatMap the per-context derivations to satisfy the type.
    eventSubscriptions: ctx.contexts.flatMap((c) => c.eventSubscriptions),
  };
  return splitLines(renderSchema(merged, options));
}
