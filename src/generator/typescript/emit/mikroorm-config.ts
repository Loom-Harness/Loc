// -------------------------------------------------------------------------
// MikroORM CLI config, outbox-drain / save-transaction line builders, and
// connection setup + package deps.  Split out of mikroorm.ts by packet 2.6
// (wave-2) — mechanical move, no logic change.
// -------------------------------------------------------------------------

import type { AggregateIR } from "../../../ir/types/loom-ir.js";
import { lines } from "../../../util/code-builder.js";
import { inRowTenant } from "../row-tenant.js";
import { T } from "../ts-symbols.js";

// ---------------------------------------------------------------------------
// mikro-orm.config.ts — the standard MikroORM config module.
// ---------------------------------------------------------------------------

/** `searchPath`: the schemas the migration chain puts this deployable's tables
 *  in (`searchPathSchemas`).  The entities name their tables unqualified, so
 *  every pooled connection starts with that `search_path`. */
export function renderMikroConfig(searchPath: readonly string[] = ["public"]): string {
  const path = searchPath.map((s) => `"${s}"`).join(",");
  return (
    lines(
      "// Auto-generated.  MikroORM configuration (persistence: mikroorm).",
      `import { defineConfig } from "@mikro-orm/postgresql";`,
      `import { entities } from "./db/entities";`,
      "",
      "if (!process.env.DATABASE_URL) {",
      "  throw new Error(",
      '    "DATABASE_URL is required.  Set it in the environment " +',
      '      "(e.g. postgres://user:pass@host:5432/db).",',
      "  );",
      "}",
      "",
      "export default defineConfig({",
      "  clientUrl: process.env.DATABASE_URL,",
      "  entities,",
      "  // No RequestContext middleware in the generated server, so repositories",
      "  // fork the EntityManager per call instead of relying on the global EM.",
      "  allowGlobalContext: true,",
      "  // The migrations create each context's tables in its own schema.",
      `  driverOptions: { options: ${JSON.stringify(`-c search_path=${path}`)} },`,
      "});",
    ) + "\n"
  );
}

/** Wrap a repository `save`'s WRITE statements in one real database
 *  transaction.
 *
 *  Every mikro save used to open only `this.em.fork({ keepTransactionContext:
 *  true })`, and there is no `RequestContext` middleware in the generated
 *  server (see `mikroConfig`'s `allowGlobalContext` comment), so on an ordinary
 *  route that flag has nothing to keep: the root upsert, the association writes
 *  and the containment writes each ran on their own implicit transaction.  A
 *  multi-statement save that failed part-way therefore left the root row
 *  written and its children not — while the drizzle sibling has always run the
 *  same statements inside `this.db.transaction(...)` (G2667-C4).
 *
 *  `em.transactional` defaults to `TransactionPropagation.NESTED` (MikroORM
 *  `TransactionManager.handle`), so this composes with the ambient
 *  `db.transactional(...)` the audited / provenanced routes open: an existing
 *  transaction context yields a SAVEPOINT rather than a competing transaction,
 *  and the callback's forked EM is the handle its writes must go through —
 *  which is why the callback parameter takes the name `em` and the fork is no
 *  longer bound to a local.  The read half (the `findOne` behind the CAS
 *  version guard) is inside the same transaction on purpose: a read-then-write
 *  guard outside one is a race by construction. */
/** The two lines that DRAIN the aggregate's pending events ahead of the save
 *  transaction, so the durable ones can be recorded on that transaction's own
 *  handle and only the rest are dispatched after it commits.  The drizzle
 *  sibling (repository-save-builder.ts) has always emitted this pair; the mikro
 *  save dispatched straight off `aggregate.pullEvents()` after the tx closed, so
 *  the outbox insert (which the mikro dispatcher's `dispatch` arm performs on a
 *  `keepTransactionContext` fork) committed SEPARATELY on any route that opens
 *  no ambient transaction — i.e. every ordinary mutation route.  A crash in
 *  that window lost a durable event with the aggregate already written. */

export const MIKRO_OUTBOX_DRAIN_LINES: readonly string[] = [
  `    const pendingEvents = aggregate.pullEvents();`,
  `    let dispatchAfterCommit = pendingEvents;`,
];

/** The capture call itself, emitted as the LAST statement inside the save
 *  transaction: `tx` is the forked EntityManager `em.transactional` hands the
 *  callback, so the outbox rows commit (or roll back) with the aggregate rows.
 *  Optional-chained — a project with no durable channel wires a dispatcher
 *  without the hook, and then every event stays on the after-commit path,
 *  byte-identical in behaviour to before. */

export function mikroOutboxRecordLine(
  agg: Pick<AggregateIR, "capabilities" | "persistedAs">,
): string {
  return `    dispatchAfterCommit = (await ${inRowTenant(agg, "this.events.recordDurable?.(pendingEvents, em)")}) ?? pendingEvents;`;
}

export function mikroSaveTxLines(writeLines: readonly (string | null)[]): (string | null)[] {
  return [
    `    await this.em.fork({ keepTransactionContext: true }).transactional(async (em) => {`,
    ...writeLines.map((l) => (l === null || l === "" ? l : `  ${l}`)),
    `    });`,
  ];
}

/** index.ts connection lines: MikroORM over the schema the shared migration
 *  chain creates (applied by `db/migrate.ts` right after), exposing the
 *  EntityManager as `db`. */
export function mikroConnectionSetup(): readonly string[] {
  return [`const orm = await MikroORM.init(mikroConfig);`, `const db = orm.em;`];
}

/** Drizzle import lines in index.ts to swap out, and the MikroORM ones to swap
 *  in, when the deployable selects mikroorm. */

export const MIKRO_INDEX_IMPORTS: readonly string[] = [
  `import { MikroORM } from "@mikro-orm/postgresql";`,
  `import mikroConfig from "./mikro-orm.config";`,
];

/** package.json dependency rows (JSON-shaped, like the drizzle adapter). */

export const MIKRO_ORM_VERSION = "7.2.5";

export const MIKRO_DEPS: readonly string[] = [
  `"@mikro-orm/core": "${MIKRO_ORM_VERSION}",`,
  `"@mikro-orm/postgresql": "${MIKRO_ORM_VERSION}",`,
];
