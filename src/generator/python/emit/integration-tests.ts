// Context-scoped INTEGRATION test emission (test-placement.md) — the
// Python/FastAPI backend.  The Python twin of the node renderer
// (`typescript/emit/integration-tests.ts`): a `test … for <Context>` (or a
// `context`-nested `test`) runs cross-aggregate behaviour IN-PROCESS against
// live SQLAlchemy repositories, no HTTP — a create persists via `repo.save(...)`,
// an operation mutates-then-saves, a repository find reads back.  The emitted
// file is provisioning-agnostic — it reads `LOOM_PG_URL` (a Loom app already
// ships a compose Postgres), applies the generated SQL migrations via
// `run_migrations(engine)`, wires the context's repositories, and runs the body.
//
// A context with workflows, in a deployable whose `app/dispatch.py` defines the
// SYNCHRONOUS `InProcessDispatcher(session)`, wires it so a `save`'s emitted
// event fires its reactors inline; any other context — including one whose
// deployable emits no `app/dispatch.py` at all — uses
// `NoopDomainEventDispatcher()`.
//
// v1 constraint (`loom.integration-find-must-bind`, shared with node): a
// repository find must be LET-BOUND, not written inline inside `expect(...)`.

import type {
  AggregateIR,
  BoundedContextIR,
  ExprIR,
  FindIR,
  TestIR,
  TestStmtIR,
} from "../../../ir/types/loom-ir.js";
import { snake } from "../../../util/naming.js";
import { type RepoOp, repoVerbOpAt } from "../../../util/repository-contract.js";
import { pyRef } from "../../_imports/python.js";
import { renderPyExpr } from "../render-expr.js";
import { renderCreateInput, renderExplicitMatcher, renderTestExpr, testFnName } from "./tests.js";

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

// The built-in reads a context integration test accepts → the Python
// repository method that serves each, beside the context's declared finds.
const BUILTIN_METHOD: Partial<Record<RepoOp, string>> = {
  "load-optional": "find_by_id",
  load: "get_by_id",
  "select-many": "all",
};

/** A `<Agg>.<find>(...)` repository read → the aggregate + method + args, whether
 *  a declared custom find or a built-in; undefined otherwise.  `nullable` marks
 *  reads whose method returns `<Agg> | None` (find_by_id + an optional/union
 *  custom find) — those get an `assert x is not None` so a mypy-strict test body
 *  typechecks. */
function findCallOf(
  e: ExprIR,
  ctx: BoundedContextIR,
): { aggName: string; method: string; args: ExprIR[]; nullable: boolean } | undefined {
  if (e.kind !== "method-call" || e.receiver.kind !== "ref") return undefined;
  const aggName = (e.receiver as { name: string }).name;
  const hasRepo = ctx.repositories.some((r) => r.aggregateName === aggName);
  if (!hasRepo) return undefined;
  const custom = findRepoQuery(e.member, aggName, ctx);
  const op = repoVerbOpAt(e.member, "integration-test");
  if (!op && !custom) return undefined;
  const method = (op && BUILTIN_METHOD[op]) ?? snake(e.member);
  const nullable =
    op === "load-optional" ||
    custom?.returnType.kind === "optional" ||
    custom?.returnType.kind === "union";
  return { aggName, method, args: e.args, nullable };
}

const repoVar = (aggName: string): string => `${snake(aggName)}_repo`;

/** The aggregate class, imported from its domain module. */
const aggClass = (aggName: string): string => pyRef(`app.domain.${snake(aggName)}`, aggName);

/** Render the RHS of a repository read, folding `findAll`'s paged result down to
 *  the `.items` list so the binding is a `list[<Agg>]` (node's `<Agg>[]`). */
function renderReadCall(find: { aggName: string; method: string; args: ExprIR[] }): string {
  if (find.method === "all") {
    return `(await ${repoVar(find.aggName)}.all(1, 1000, "id", "asc")).items`;
  }
  const args = find.args.map((a) => renderPyExpr(a)).join(", ");
  return `await ${repoVar(find.aggName)}.${find.method}(${args})`;
}

/** Render one integration-test statement (4-space body indent).  Creates and
 *  mutating ops persist via the repository; let-bound finds await a repository
 *  read (nullable → `assert is not None`); everything else defers to the shared
 *  expression / matcher renderers. */
function renderStmt(s: TestStmtIR, ctx: BoundedContextIR, lets: Map<string, string>): string[] {
  switch (s.kind) {
    case "let": {
      const create = createCallOf(s.expr, ctx);
      if (create && s.expr.kind === "method-call" && s.expr.args[0]?.kind === "object") {
        const input = renderCreateInput(s.expr.args[0], create.agg, ctx);
        return [
          `    ${snake(s.name)} = ${aggClass(create.agg.name)}.${create.method === "create" ? "create" : snake(create.method)}(${input})`,
          `    await ${repoVar(create.agg.name)}.save(${snake(s.name)})`,
          `    await session.flush()`,
        ];
      }
      const find = findCallOf(s.expr, ctx);
      if (find) {
        const lines = [`    ${snake(s.name)} = ${renderReadCall(find)}`];
        if (find.nullable) lines.push(`    assert ${snake(s.name)} is not None`);
        return lines;
      }
      return [`    ${snake(s.name)} = ${renderTestExpr(s.expr, ctx, lets)}`];
    }
    case "expression": {
      // A mutating operation on a let-bound aggregate instance → mutate in place,
      // then persist (mirrors the route handler's load → mutate → save).
      if (
        s.expr.kind === "method-call" &&
        s.expr.receiverType.kind === "entity" &&
        !s.expr.isCollectionOp
      ) {
        const aggName = s.expr.receiverType.name;
        const recv = renderTestExpr(s.expr.receiver, ctx, lets);
        return [
          `    ${renderTestExpr(s.expr, ctx, lets)}`,
          `    await ${repoVar(aggName)}.save(${recv})`,
          `    await session.flush()`,
        ];
      }
      return [`    ${renderTestExpr(s.expr, ctx, lets)}`];
    }
    case "expect": {
      const explicit = renderExplicitMatcher(s.expr, ctx, lets);
      if (explicit) return [explicit];
      return [`    assert ${renderTestExpr(s.expr, ctx, lets)}`];
    }
    case "expect-throws":
      return ["    with pytest.raises(Exception):", `        ${renderTestExpr(s.expr, ctx, lets)}`];
    default:
      // let / expression / expect(-throws) are the surviving integration shapes;
      // anything else is an IR-validator gap.
      throw new Error(`unsupported integration-test statement '${s.kind}'`);
  }
}

const mentions = (text: string, name: string): boolean => new RegExp(`\\b${name}\\b`).test(text);

/** One test function.  Its fixture locals are derived from ITS OWN rendered
 *  body, never pooled across the context's tests: a `<agg>_repo` only when the
 *  body reads it, `events` only when some repository is constructed, and the
 *  `session` fixture parameter only when a local or the body touches it.  A
 *  body that only builds value objects therefore declares nothing — ruff F841
 *  rejects an unused local, and a session-free test needs no Postgres. */
function renderTest(
  t: TestIR,
  ctx: BoundedContextIR,
  repoAggs: readonly AggregateIR[],
  cascade: boolean,
  used: Set<string>,
): string[] {
  const lets = new Map<string, string>();
  for (const s of t.statements) {
    if (s.kind === "let" && s.type?.kind === "entity") lets.set(s.name, s.type.name);
  }
  const body = t.statements.flatMap((s) => renderStmt(s, ctx, lets));
  const bodyStr = body.join("\n");
  const fixtures: string[] = [];
  const repos = repoAggs.filter((a) => mentions(bodyStr, repoVar(a.name)));
  if (repos.length > 0) {
    fixtures.push(
      cascade
        ? `    events = ${pyRef("app.dispatch", "InProcessDispatcher")}(session)`
        : `    events = ${pyRef("app.domain.events", "NoopDomainEventDispatcher")}()`,
    );
    for (const a of repos) {
      fixtures.push(
        `    ${repoVar(a.name)} = ${pyRef(`app.db.repositories.${snake(a.name)}_repository`, `${a.name}Repository`)}(session, events)`,
      );
    }
  }
  const usesSession = mentions([...fixtures, bodyStr].join("\n"), "session");
  const out: string[] = [
    `async def ${testFnName(t.name, used)}(${usesSession ? "session: AsyncSession" : ""}) -> None:`,
    ...fixtures,
  ];
  out.push(...(body.length > 0 ? body : ["    pass"]));
  return out;
}

/** Emit `tests/test_<ctx>_integration.py` for a context that declares
 *  integration tests, or null when it declares none.  `inProcessDispatcher` says
 *  whether the deployable's `app/dispatch.py` defines `InProcessDispatcher` — the
 *  caller reads it off the emitted module, so the import cannot name a module
 *  or class that does not exist. */
export function renderPyContextIntegrationTest(
  ctx: BoundedContextIR,
  opts: { inProcessDispatcher: boolean },
): string | null {
  if (ctx.tests.length === 0) return null;

  const used = new Set<string>();
  const cascade = ctx.workflows.length > 0 && opts.inProcessDispatcher;

  // Render every test first, then narrow imports to what the rendered module
  // names.
  const testBlocks: string[] = [];
  const repoAggs = ctx.aggregates.filter((a) =>
    ctx.repositories.some((r) => r.aggregateName === a.name),
  );
  for (const t of ctx.tests) {
    testBlocks.push("", "");
    testBlocks.push(...renderTest(t, ctx, repoAggs, cascade, used));
  }
  const bodyStr = testBlocks.join("\n");

  const out: string[] = [];
  out.push(`"""Integration tests for ${ctx.name}.  Auto-generated."""`);
  out.push(
    "",
    // Unconditional — every integration module uses all of these; anything
    // the body names beyond them rides a marker (M-T9.84).
    ...[
      "import os",
      "from collections.abc import AsyncIterator",
      "",
      "import pytest",
      "from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine",
      "",
      "from app.db.migrate import run_migrations",
    ],
  );
  for (const a of repoAggs.filter((a) => mentions(bodyStr, a.name))) {
    out.push(`from app.domain.${snake(a.name)} import ${a.name}`);
  }
  out.push("");
  out.push("");
  // A per-test session bound to the app's real engine — LOOM_PG_URL-driven so it
  // is provisioning-agnostic (compose Postgres, Testcontainers, a CI service…).
  out.push("@pytest.fixture");
  out.push("async def session() -> AsyncIterator[AsyncSession]:");
  out.push(
    '    url = os.environ.get("LOOM_PG_URL", "postgresql+asyncpg://postgres:postgres@localhost:5432/postgres")',
  );
  out.push("    engine = create_async_engine(url)");
  out.push("    await run_migrations(engine)");
  out.push("    async with async_sessionmaker(engine, expire_on_commit=False)() as s:");
  out.push("        yield s");
  out.push("    await engine.dispose()");
  out.push(bodyStr);
  return `${out.join("\n")}\n`;
}
