// Context-scoped INTEGRATION test emission (test-placement.md) — the
// node/Hono backend.  A `test … for <Context>` (or a `context`-nested `test`)
// runs cross-aggregate behaviour IN-PROCESS against live repositories, no HTTP:
// a create persists via `repo.save(...)`, an operation mutates-then-saves, a
// repository find reads back.  The emitted file is provisioning-agnostic — it
// reads a `PG_URL` (a Loom app already ships a compose Postgres), applies the
// generated drizzle migrations, wires the context's repositories, and runs the
// body.
//
// A context with workflows, in a deployable whose `http/workflows.ts` exports
// the SYNCHRONOUS `createInProcessDispatcher(db)` (it has event subscriptions or
// durable events), wires that dispatcher so a `save`'s emitted event fires its
// reactors inline (a placed order reserves stock before the next read); any
// other context has nothing to fan out and uses the no-op dispatcher.
//
// v1 constraint (`loom.integration-find-must-bind`): a repository find must be
// LET-BOUND (`let inv = Inventory.forSku(x)`), not written inline inside an
// `expect(...)`, so the `await` stays a statement-level concern and the assertion
// expressions render synchronously.

import { integrationIsolation } from "../../../ir/plan/test-isolation.js";
import { type TestPrincipalShape, testPrincipal } from "../../../ir/plan/test-principal.js";
import { pagedReturn } from "../../../ir/stdlib/generics.js";
import type {
  AggregateIR,
  BoundedContextIR,
  ExprIR,
  FindIR,
  TestIR,
  TestPrincipalIR,
  TestStmtIR,
} from "../../../ir/types/loom-ir.js";
import { enumPool } from "../../../ir/util/reachable-types.js";
import { escapeTsIdent, lowerFirst } from "../../../util/naming.js";
import { repoVerbMethod, repoVerbOpAt } from "../../../util/repository-contract.js";
import { RUNTIME_ENV } from "../../../util/runtime-wire-names.js";
import { renderTestPrincipal } from "../../_test/principal-target.js";
import { renderTsExpr } from "../render-expr.js";
import { T } from "../ts-symbols.js";
import {
  domainRejectionPrelude,
  renderCreateInput,
  renderExplicitMatcher,
  renderRejection,
  renderTestExpr,
  TEST_PRINCIPAL_CALL,
  TS_PRINCIPAL,
  testBodyValueImports,
} from "./tests.js";

/** A repository find on `agg` named `name`, or undefined. */
function findRepoQuery(name: string, aggName: string, ctx: BoundedContextIR): FindIR | undefined {
  for (const r of ctx.repositories) {
    if (r.aggregateName !== aggName) continue;
    const f = r.finds.find((q) => q.name === name);
    if (f) return f;
  }
  return undefined;
}

/** A `<Agg>.create(...)` / named create-action call → the owning aggregate + the
 *  create method name; undefined when the call is not a create. */
function createCallOf(
  e: ExprIR,
  ctx: BoundedContextIR,
): { agg: AggregateIR; method: string } | undefined {
  if (e.kind !== "method-call" || e.receiver.kind !== "ref") return undefined;
  const agg = ctx.aggregates.find((a) => a.name === (e.receiver as { name: string }).name);
  if (!agg) return undefined;
  if (e.member === "create" || (agg.creates ?? []).some((c) => c.name === e.member)) {
    return { agg, method: e.member };
  }
  return undefined;
}

/** A `<Agg>.<find>(...)` repository read → the aggregate + method + args, whether
 *  a declared custom find or a built-in (findById / getById / findAll);
 *  undefined otherwise.  `nullable` marks reads whose emitted method returns
 *  `<Agg> | null` (findById + an optional/union custom find) — those get a
 *  non-null assertion so a strict-null test body typechecks (a genuinely-null
 *  read then fails the test at the `.field` access). */
function findCallOf(
  e: ExprIR,
  ctx: BoundedContextIR,
):
  | { aggName: string; method: string; args: ExprIR[]; nullable: boolean; paged: boolean }
  | undefined {
  if (e.kind !== "method-call" || e.receiver.kind !== "ref") return undefined;
  const aggName = (e.receiver as { name: string }).name;
  const hasRepo = ctx.repositories.some((r) => r.aggregateName === aggName);
  if (!hasRepo) return undefined;
  const custom = findRepoQuery(e.member, aggName, ctx);
  // The built-in reads a context integration test accepts (the contract's
  // `integration-test` position), beside the context's declared finds.
  const op = repoVerbOpAt(e.member, "integration-test");
  if (!op && !custom) return undefined;
  const nullable =
    op === "load-optional" ||
    custom?.returnType.kind === "optional" ||
    custom?.returnType.kind === "union";
  // A built-in read calls the repository method its verb is emitted as
  // (`get` → `getById`); a declared find keeps its own name.
  // The whole-collection read (`all()`) is the repository's list method, which
  // pages when the list read is paged: ask for one page large enough to hold
  // every row a test writes, and read its items.
  const paged =
    op === "select-many" && custom !== undefined && pagedReturn(custom.returnType) !== null;
  return {
    aggName,
    method: custom ? e.member : repoVerbMethod(e.member),
    args: e.args,
    nullable,
    paged,
  };
}

const repoHandle = (aggName: string): string => `repos.${lowerFirst(aggName)}`;

/** Names of let-bound aggregates that a later operation mutates — those
 *  bindings are reassigned (reloaded fresh before the op), so they must be
 *  `let`, not `const`. */
function reassignedBindings(t: TestIR): Set<string> {
  const names = new Set<string>();
  for (const s of t.statements) {
    if (
      s.kind === "expression" &&
      s.expr.kind === "method-call" &&
      s.expr.receiverType.kind === "entity" &&
      !s.expr.isCollectionOp &&
      s.expr.receiver.kind === "ref"
    ) {
      names.add(s.expr.receiver.name);
    }
  }
  return names;
}

/** Render one integration-test statement.  Creates and mutating ops persist via
 *  the repository; let-bound finds await a repository read; everything else
 *  defers to the shared expression / matcher renderers. */
function renderStmt(
  s: TestStmtIR,
  ctx: BoundedContextIR,
  reassigned: Set<string>,
  user: TestPrincipalShape | undefined,
): string[] {
  switch (s.kind) {
    case "let": {
      const create = createCallOf(s.expr, ctx);
      if (create && s.expr.kind === "method-call" && s.expr.args[0]?.kind === "object") {
        const input = renderCreateInput(s.expr.args[0], create.agg, ctx);
        // A binding a later op mutates must be `let` — the op reloads it fresh
        // from the repo (so its optimistic-concurrency version matches the DB
        // row) before mutating + re-saving.
        const decl = reassigned.has(s.name) ? "let" : "const";
        return [
          `${decl} ${escapeTsIdent(s.name)} = ${create.agg.name}.${create.method}(${input});`,
          `await ${repoHandle(create.agg.name)}.save(${escapeTsIdent(s.name)});`,
        ];
      }
      const find = findCallOf(s.expr, ctx);
      if (find) {
        const args = find.paged
          ? `1, 1000, "id", "asc"`
          : find.args.map((a) => renderTsExpr(a)).join(", ");
        const read = `await ${repoHandle(find.aggName)}.${find.method}(${args})`;
        const call = find.paged ? `(${read}).items` : read;
        return [`const ${escapeTsIdent(s.name)} = ${find.nullable ? `(${call})!` : call};`];
      }
      return [`const ${escapeTsIdent(s.name)} = ${renderTsExpr(s.expr)};`];
    }
    case "expression": {
      // A mutating operation on a let-bound aggregate instance → RELOAD fresh,
      // mutate, then persist (the route handler's load → mutate → save).  The
      // reload matters: after the create's save the in-memory aggregate's
      // optimistic-concurrency version is stale (the DB row advanced), so
      // re-saving the same object would raise a ConcurrencyError.
      if (
        s.expr.kind === "method-call" &&
        s.expr.receiverType.kind === "entity" &&
        !s.expr.isCollectionOp &&
        s.expr.receiver.kind === "ref"
      ) {
        const aggName = s.expr.receiverType.name;
        const recv = renderTsExpr(s.expr.receiver);
        // The unit tier's call renderer: arguments coerced to the declared
        // parameter types, and a currentUser-reading operation handed
        // `testPrincipal()`, which this file defines as the bound principal.
        return [
          `${recv} = (await ${repoHandle(aggName)}.findById(${recv}.id))!;`,
          `${renderTestExpr(s.expr, ctx)};`,
          `await ${repoHandle(aggName)}.save(${recv});`,
        ];
      }
      return [`${renderTsExpr(s.expr)};`];
    }
    case "expect": {
      const explicit = renderExplicitMatcher(s.expr, ctx);
      if (explicit) return [explicit.trimStart()];
      throw new Error("expect requires a matcher (e.g. expect(x).toBe(y)).");
    }
    case "expect-throws":
      return [renderRejection(s, ctx)];
    case "principal":
      // A body `as { … }` line: rebind the ambient frame's principal.
      if (!user) return [];
      return [`await ${T.actAsUser}(${renderPrincipalClaims(s.principal, user, ctx)});`];
    default:
      // let / expression / expect(-throws) are the surviving integration shapes;
      // anything else is an IR-validator gap.
      throw new Error(`unsupported integration-test statement '${s.kind}'`);
  }
}

/** One `as { … }` claim value as a TS literal of the claim's declared type:
 *  an id claim goes through its branded `Ids` factory, every other settable
 *  claim (`string` / `guid` / `string[]`) is plain JSON. */
/** The principal a test runs as (`testPrincipal`): the dev-stub identity with
 *  the test's `as { … }` claims replacing the fields they name — the same
 *  principal the unit tier passes. */
function renderPrincipalClaims(
  p: TestPrincipalIR | undefined,
  user: TestPrincipalShape,
  ctx: BoundedContextIR,
): string {
  return renderTestPrincipal(testPrincipal(user, p, enumPool(ctx)), TS_PRINCIPAL);
}

function renderTest(
  t: TestIR,
  ctx: BoundedContextIR,
  user: TestPrincipalShape | undefined,
): string[] {
  const reassigned = reassignedBindings(t);
  const body = t.statements.flatMap((s) => renderStmt(s, ctx, reassigned, user));
  // Each test runs inside `isolated` (the file's rollback-per-test
  // transaction, `integrationIsolation`).
  if (!user) {
    return [
      `  it(${JSON.stringify(t.name)}, () =>`,
      "    isolated(async () => {",
      ...body.map((l) => `      ${l}`),
      "    }));",
    ];
  }
  // Under auth every repository reads its principal from the ambient request
  // frame, so the body runs inside one — the test principal, with the test's
  // `as { … }` claims.
  return [
    `  it(${JSON.stringify(t.name)}, () =>`,
    "    isolated(() =>",
    `      ${T.runAsUser}(${renderPrincipalClaims(t.principal, user, ctx)}, async () => {`,
    ...body.map((l) => `        ${l}`),
    "      })));",
  ];
}

/** Emit `test/<ctx>.integration.test.ts` for a context that declares integration
 *  tests, or null when it declares none.  `inProcessDispatcher` says whether the
 *  deployable's `http/workflows.ts` exports `createInProcessDispatcher` — the
 *  caller reads it off the emitted file, so the import cannot name a symbol
 *  that does not exist. */
export function renderContextIntegrationTest(
  ctx: BoundedContextIR,
  opts: {
    inProcessDispatcher: boolean;
    /** Module `migrate` is imported from — the project's `db/migrate.ts` when
     *  it ships one, else drizzle-orm's own migrator. */
    migrator?: string;
    /** The system's `user { … }` fields when the project emits the auth
     *  layer (`auth/middleware.ts` + `auth/dev-stub.ts`): every test then runs
     *  inside `runAsUser`.  Absent ⇒ no principal is bound. */
    user?: TestPrincipalShape;
  },
): string | null {
  if (ctx.tests.length === 0) return null;

  const body: string[] = [`describe(${JSON.stringify(`${ctx.name} (integration)`)}, () => {`];
  for (const t of ctx.tests) {
    body.push(...renderTest(t, ctx, opts.user));
    body.push("");
  }
  body.push("});");
  const bodyStr = body.join("\n");

  // Repositories referenced by the body (a create/op/find on the aggregate) →
  // the ones to import + wire.  Narrow so an unused import doesn't trip tsc/biome.
  const refs = (n: string): boolean => new RegExp(`\\b${n}\\b`).test(bodyStr);
  const usedAggs = ctx.aggregates.filter(
    (a) => ctx.repositories.some((r) => r.aggregateName === a.name) && refs(a.name),
  );
  // Value objects, enums, `Ids` and `Decimal` the body constructs or names —
  // the same body-derived set the aggregate-level unit tests import.
  const value = testBodyValueImports(bodyStr, ctx, "../domain");
  // A context that runs workflows wires the SYNCHRONOUS in-process dispatcher
  // so a `save`'s emitted event fires its reactors inline (a placed order
  // reserves stock before the next read) — when the deployable emits one;
  // without event subscriptions there is no reactor to fire and
  // `createInProcessDispatcher` does not exist, so the no-op stands in.
  const cascade = ctx.workflows.length > 0 && opts.inProcessDispatcher;

  const lines: string[] = [];
  lines.push("// Auto-generated.  Do not edit by hand.");
  lines.push(`import { describe, it, expect, beforeAll } from "vitest";`);
  lines.push(...value.decimal);
  lines.push(`import { Pool } from "pg";`);
  lines.push(`import { TransactionRollbackError } from "drizzle-orm";`);
  lines.push(`import { drizzle } from "drizzle-orm/node-postgres";`);
  lines.push(
    `import { migrate } from ${JSON.stringify(opts.migrator ?? "drizzle-orm/node-postgres/migrator")};`,
  );
  lines.push(`import * as schema from "../db/schema";`);
  if (cascade) {
    lines.push(`import { createInProcessDispatcher } from "../http/workflows";`);
  } else {
    lines.push(`import { NoopDomainEventDispatcher } from "../domain/events";`);
  }
  for (const a of usedAggs) {
    lines.push(`import { ${a.name} } from "../domain/${lowerFirst(a.name)}";`);
    lines.push(
      `import { ${a.name}Repository } from "../db/repositories/${lowerFirst(a.name)}-repository";`,
    );
  }
  lines.push(...value.domain);
  const uses = {
    rejection: bodyStr.includes("expectDomainRejection("),
    gate: bodyStr.includes("requireGate("),
  };
  if (uses.rejection || uses.gate) lines.push(...domainRejectionPrelude("../domain/errors", uses));
  if (bodyStr.includes(TEST_PRINCIPAL_CALL)) {
    // The principal a currentUser-reading operation takes: the one the test
    // has bound in the ambient frame.
    lines.push(
      "",
      `function ${TEST_PRINCIPAL_CALL.slice(0, -2)}() {`,
      `  return ${T.requireCurrentUser}();`,
      "}",
    );
  }
  lines.push("");
  lines.push(
    `let repos: { ${usedAggs.map((a) => `${lowerFirst(a.name)}: ${a.name}Repository`).join("; ")} };`,
  );
  lines.push("");
  // Rollback per test is the one isolation the plan answers; a new answer
  // fails this line at compile time until the emitter renders it.
  integrationIsolation(ctx).kind satisfies "rollback-per-test";
  lines.push("let pool: Pool;");
  lines.push("");
  lines.push(`beforeAll(async () => {`);
  lines.push(
    `  pool = new Pool({ connectionString: process.env.${RUNTIME_ENV.testDatabaseUrl} ?? "postgres://postgres:postgres@localhost:5432/postgres" });`,
  );
  lines.push(
    `  await migrate(drizzle(pool, { schema }), { migrationsFolder: "./db/migrations" });`,
  );
  lines.push(`});`);
  lines.push("");
  lines.push(
    "/** Run one test inside a transaction rolled back at its end, so every test starts",
    " *  from the database the migrations left.  The repositories' own transactions",
    " *  become savepoints inside it. */",
    "async function isolated(body: () => Promise<void>): Promise<void> {",
    "  const db = drizzle(pool, { schema });",
    "  await db",
    "    .transaction(async (tx) => {",
    "      const scoped = tx as unknown as typeof db;",
    cascade
      ? "      const events = createInProcessDispatcher(scoped);"
      : "      const events = NoopDomainEventDispatcher;",
    `      repos = { ${usedAggs
      .map((a) => `${lowerFirst(a.name)}: new ${a.name}Repository(scoped, events)`)
      .join(", ")} };`,
    "      await body();",
    "      tx.rollback();",
    "    })",
    "    .catch((err: unknown) => {",
    "      if (!(err instanceof TransactionRollbackError)) throw err;",
    "    });",
    "}",
  );
  lines.push("");
  lines.push(...body);
  return `${lines.join("\n")}\n`;
}
