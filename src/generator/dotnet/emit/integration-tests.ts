// Context-scoped INTEGRATION test emission (test-placement.md) — the .NET
// backend.  The .NET twin of the node renderer
// (`typescript/emit/integration-tests.ts`): a `test … for <Context>` (or a
// `context`-nested `test`) runs cross-aggregate behaviour IN-PROCESS against
// the deployable's live repositories, no HTTP — a create persists via
// `repo.SaveAsync(...)`, an operation mutates-then-saves, a repository find
// reads back.  The emitted class is provisioning-agnostic — it reads
// `LOOM_PG_URL` (a Loom app already ships a compose Postgres), brings the
// schema up the way the app's own boot does, wires the context's repositories,
// and runs the body.
//
// The boot follows the deployable's persistence adapter, because the test
// project references only the API project's packages: on EF it applies the
// migrations (`db.Database.MigrateAsync()`) and builds `AppDbContext`-backed
// repositories; on Dapper (`persistence: dapper`) the API project carries no
// EF Core at all, so it applies `DbSchema.EnsureAsync` over an
// `NpgsqlDataSource` and builds the Dapper repositories over that.
//
// v1 constraints: a repository find must be LET-BOUND
// (`loom.integration-find-must-bind`, shared with node), and the dispatcher is
// the no-op — synchronous workflow cascade for the non-node backends is the
// tracked 3b follow-up (the app's in-process cascade is DI-resolved, so it needs
// a service provider the plain test harness doesn't build).

import type {
  AggregateIR,
  BoundedContextIR,
  ExprIR,
  FieldIR,
  FindIR,
  TestIR,
  TestPrincipalIR,
  TestStmtIR,
  UserIR,
} from "../../../ir/types/loom-ir.js";
import { aggHasAuditedTarget } from "../../../ir/util/audit-capability.js";
import { enumPool, valueObjectPool } from "../../../ir/util/reachable-types.js";
import { bindingsAssertedAbsent } from "../../../ir/util/test-null-subjects.js";
import { lowerFirst, plural, upperFirst } from "../../../util/naming.js";
import { repoVerbOpAt } from "../../../util/repository-contract.js";
import { csRef, csUsing } from "../../_imports/dotnet.js";
import { renderCsDevStubUserArgs } from "../auth-emit.js";
import { CS } from "../cs-symbols.js";
import { csFindMethodName } from "../find-method-name.js";
import { renderCsExpr } from "../render-expr.js";
import {
  csBareToThrow,
  renderCreateCall,
  renderExplicitMatcherToAwesome,
  renderTestExpr,
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

/** A `<Agg>.create(...)` / named create-action call → the owning aggregate;
 *  undefined when the call is not a create. */
function createAggOf(e: ExprIR, ctx: BoundedContextIR): AggregateIR | undefined {
  if (e.kind !== "method-call" || e.receiver.kind !== "ref") return undefined;
  const agg = ctx.aggregates.find((a) => a.name === (e.receiver as { name: string }).name);
  if (!agg) return undefined;
  if (e.member === "create" || (agg.creates ?? []).some((c) => c.name === e.member)) return agg;
  return undefined;
}

/** A `<Agg>.<find>(...)` repository read → the aggregate + emitted call + whether
 *  it is nullable; undefined otherwise.  `.NET`'s `GetByIdAsync` returns
 *  `<Agg>?` (there is no throwing variant), so both `findById` and `getById` map
 *  to it and get a `!` non-null assertion.  `findAll` folds its `Paged<T>` down
 *  to `.Items` (node's `<Agg>[]`); a custom find keeps its return arity. */
function findCallOf(
  e: ExprIR,
  ctx: BoundedContextIR,
): { call: string; nullable: boolean } | undefined {
  if (e.kind !== "method-call" || e.receiver.kind !== "ref") return undefined;
  const aggName = (e.receiver as { name: string }).name;
  if (!ctx.repositories.some((r) => r.aggregateName === aggName)) return undefined;
  const custom = findRepoQuery(e.member, aggName, ctx);
  const op = repoVerbOpAt(e.member, "integration-test");
  if (!op && !custom) return undefined;
  const repo = repoVar(aggName);
  const args = e.args.map((a) => renderCsExpr(a)).join(", ");
  if (op === "load" || op === "load-optional") {
    return { call: `await ${repo}.GetByIdAsync(${args})`, nullable: true };
  }
  if (op === "select-many") {
    return { call: `(await ${repo}.All(1, 1000, "id", "asc")).Items`, nullable: false };
  }
  const nullable = custom?.returnType.kind === "optional" || custom?.returnType.kind === "union";
  return { call: `await ${repo}.${csFindMethodName(e.member)}(${args})`, nullable };
}

const repoVar = (aggName: string): string => `${lowerFirst(aggName)}Repo`;
const aggNamespace = (aggName: string, ns: string): string =>
  `${ns}.Domain.${upperFirst(plural(aggName))}`;

/** Render one integration-test statement (8-space body indent).  Creates and
 *  mutating ops persist via the repository; let-bound finds await a repository
 *  read (nullable → `!`); everything else defers to the shared expression /
 *  matcher renderers. */
/** One `as { … }` claim value as a C# expression of the claim's declared
 *  type. */
function renderClaimValue(field: FieldIR | undefined, value: string | readonly string[]): string {
  const t = field?.type.kind === "optional" ? field.type.inner : field?.type;
  if (typeof value !== "string") {
    return `new System.Collections.Generic.List<string> { ${value.map((v) => JSON.stringify(v)).join(", ")} }`;
  }
  if (t?.kind === "id") return `new ${t.targetName}Id(System.Guid.Parse(${JSON.stringify(value)}))`;
  if (t?.kind === "primitive" && t.name === "guid")
    return `System.Guid.Parse(${JSON.stringify(value)})`;
  return JSON.stringify(value);
}

/** `DevUser()` with the test's `as { … }` claims replaced. */
function renderPrincipal(p: TestPrincipalIR | undefined, user: UserIR): string {
  const inits = (p?.claims ?? []).map(
    (c) =>
      `${upperFirst(c.name)} = ${renderClaimValue(
        user.fields.find((f) => f.name === c.name),
        c.value,
      )}`,
  );
  return inits.length > 0 ? `DevUser() with { ${inits.join(", ")} }` : "DevUser()";
}

interface PrincipalScope {
  user: UserIR | undefined;
  /** Bindings the test asserts null — their read is not narrowed. */
  absent: Set<string>;
}

const NO_PRINCIPAL: PrincipalScope = { user: undefined, absent: new Set() };

function renderStmt(
  s: TestStmtIR,
  ctx: BoundedContextIR,
  /** Position in the test body: mints a collision-free local per throw assertion. */
  index = 0,
  scope: PrincipalScope = NO_PRINCIPAL,
): string[] {
  const I = "        ";
  switch (s.kind) {
    case "let": {
      const agg = createAggOf(s.expr, ctx);
      if (agg && s.expr.kind === "method-call" && s.expr.args[0]?.kind === "object") {
        const create = renderCreateCall(s.expr, ctx) ?? renderTestExpr(s.expr, ctx);
        return [
          `${I}var ${s.name} = ${create};`,
          `${I}await ${repoVar(agg.name)}.SaveAsync(${s.name});`,
        ];
      }
      const find = findCallOf(s.expr, ctx);
      if (find) {
        const narrow = find.nullable && !scope.absent.has(s.name);
        return [`${I}var ${s.name} = ${narrow ? `(${find.call})!` : find.call};`];
      }
      return [`${I}var ${s.name} = ${renderTestExpr(s.expr, ctx)};`];
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
        const recv = renderCsExpr(s.expr.receiver);
        return [
          `${I}${renderTestExpr(s.expr, ctx)};`,
          `${I}await ${repoVar(aggName)}.SaveAsync(${recv});`,
        ];
      }
      return [`${I}${renderTestExpr(s.expr, ctx)};`];
    }
    case "expect": {
      const explicit = renderExplicitMatcherToAwesome(s.expr);
      if (explicit) return [`${I}${explicit}`];
      throw new Error("expect requires a matcher (e.g. expect(x).toBe(y)).");
    }
    case "expect-throws": {
      const inner = renderTestExpr(s.expr, ctx);
      const isInvocation = s.expr.kind === "method-call" || s.expr.kind === "call";
      const body = isInvocation ? `${inner};` : `var __ = ${inner};`;
      const family = csBareToThrow(s.expr, body, `__thrown${index}`, I, ctx, true);
      if (family) return [family];
      return [
        `${I}await Assert.ThrowsAsync<DomainException>(async () => { ${body} await Task.CompletedTask; });`,
      ];
    }
    case "principal":
      // A body `as { … }` line: enter a frame bound to the new principal.
      return scope.user
        ? [
            `${I}using var __principal${index} = ActAs(${renderPrincipal(s.principal, scope.user)});`,
          ]
        : [];
    default:
      throw new Error(`unsupported integration-test statement '${s.kind}'`);
  }
}

function renderTest(
  t: TestIR,
  ctx: BoundedContextIR,
  usedAggs: readonly AggregateIR[],
  dapper: boolean,
  opts: IntegrationAuthOpts,
): string[] {
  const methodName = upperFirst(t.name.replace(/[^A-Za-z0-9]+/g, "_")) || "Test";
  const out: string[] = [];
  out.push(`    [Fact(DisplayName = ${JSON.stringify(t.name)})]`);
  out.push(`    public async Task ${methodName}()`);
  out.push("    {");
  // Under auth every principal reader (the tenancy query filters, the save
  // interceptor's stamps) reads the ambient request frame, so the test opens
  // one first: the dev-stub identity with the test's `as { … }` claims.
  if (opts.user) {
    out.push(`        using var __principal = ActAs(${renderPrincipal(t.principal, opts.user)});`);
  }
  if (dapper) {
    out.push(`        await using var db = ${CS.NpgsqlDataSource}.Create(ConnString());`);
    out.push("        await DbSchema.EnsureAsync(db);");
  } else {
    out.push(
      `        var opts = new DbContextOptionsBuilder<AppDbContext>()${CS.EfCore}.UseNpgsql(ConnString())${opts.interceptor ? ".AddInterceptors(new AuditableInterceptor())" : ""}.Options;`,
    );
    // The context's tenancy filters resolve the principal through the
    // accessor the app injects — the one that reads the ambient frame.
    out.push(
      `        await using var db = new AppDbContext(opts${opts.dbContextTakesUser ? ", new HttpContextCurrentUserAccessor()" : ""});`,
    );
    out.push("        await db.Database.MigrateAsync();");
  }
  out.push("        var events = new NoopDomainEventDispatcher();");
  for (const a of usedAggs) {
    // A Dapper repository of an audited aggregate drains the request-scoped
    // audit buffer inside its own transaction, so it takes the buffer too.
    const ctorArgs = dapper
      ? `db, events${aggHasAuditedTarget(a) ? ", new AuditWriter()" : ""}`
      : `db, events, ${csRef("Microsoft.Extensions.Logging.Abstractions", "NullLogger")}<${a.name}Repository>.Instance`;
    out.push(`        var ${repoVar(a.name)} = new ${a.name}Repository(${ctorArgs});`);
  }
  const scope: PrincipalScope = { user: opts.user, absent: bindingsAssertedAbsent(t.statements) };
  for (const [i, s] of t.statements.entries()) out.push(...renderStmt(s, ctx, i, scope));
  out.push("    }");
  return out;
}

/** Emit `Tests/<ns>.Tests/<Ctx>IntegrationTests.cs` for a context that declares
 *  integration tests, or null when it declares none.  `dapper` selects the
 *  `persistence: dapper` boot (see the file header). */
export interface IntegrationAuthOpts {
  /** `AppDbContext`'s constructor takes an `ICurrentUserAccessor` (it carries
   *  a principal query filter). */
  dbContextTakesUser?: boolean;
  /** The project registers `AuditableInterceptor` (it stamps on save). */
  interceptor?: boolean;
  /** The system's `user { … }` block when the project emits the auth layer:
   *  every test then runs inside a request frame bound to a principal. */
  user?: UserIR;
}

export function renderContextIntegrationTest(
  ctx: BoundedContextIR,
  ns: string,
  dapper = false,
  opts: IntegrationAuthOpts = {},
): string | null {
  if (ctx.tests.length === 0) return null;

  // Which aggregates (with a repo) the bodies reference → wire + import.  Detect
  // from the rendered statement bodies (before the per-test wiring is prepended).
  const bodyOnly = ctx.tests
    .flatMap((t) => t.statements)
    .flatMap((s) => renderStmt(s, ctx))
    .join("\n");
  const usedAggs = ctx.aggregates.filter(
    (a) =>
      ctx.repositories.some((r) => r.aggregateName === a.name) &&
      new RegExp(`\\b${a.name}\\b`).test(bodyOnly),
  );
  const methodBlocks = ctx.tests.map((t) => renderTest(t, ctx, usedAggs, dapper, opts));
  // Value objects and enums the bodies construct or name (`new Berth(...)`,
  // `Size.Large`) live in their own namespaces; derive each `using` from the
  // names the rendered bodies spell, so a body that touches neither keeps a
  // using-clean header.
  const spells = (n: string): boolean => new RegExp(`\\b${n}\\b`).test(bodyOnly);
  const usesValueObjects = valueObjectPool(ctx).some((v) => spells(v.name));
  const usesEnums = enumPool(ctx).some((e) => spells(e.name));

  const className = `${upperFirst(ctx.name)}IntegrationTests`;
  // The persistence slots render iff the test bodies spell the EF boot
  // (`UseNpgsql`, `NullLogger`) or the Dapper one (`NpgsqlDataSource`).
  const lines: string[] = [
    "// Auto-generated.  Do not edit by hand.",
    "using System;",
    "using System.Threading.Tasks;",
    csUsing("Microsoft.EntityFrameworkCore"),
    csUsing("Microsoft.Extensions.Logging.Abstractions"),
    csUsing("Npgsql"),
    "using Xunit;",
    "using AwesomeAssertions;",
  ];
  lines.push(`using ${ns}.Domain.Common;`);
  if (ctx.aggregates.length > 0) lines.push(`using ${ns}.Domain.Ids;`);
  if (usesValueObjects) lines.push(`using ${ns}.Domain.ValueObjects;`);
  if (usesEnums) lines.push(`using ${ns}.Domain.Enums;`);
  for (const nsp of [...new Set(usedAggs.map((a) => aggNamespace(a.name, ns)))].sort()) {
    lines.push(`using ${nsp};`);
  }
  if (opts.user) lines.push(`using ${ns}.Auth;`);
  lines.push(`using ${ns}.Infrastructure.Persistence;`);
  lines.push(`using ${ns}.Infrastructure.Repositories;`);
  lines.push(`using ${ns}.Infrastructure.Events;`);
  lines.push("");
  lines.push(`namespace ${ns}.Tests;`);
  lines.push("");
  lines.push(`public sealed class ${className}`);
  lines.push("{");
  // Provisioning-agnostic connection: LOOM_PG_URL (a libpq URL, the same knob
  // the other backends read) → an Npgsql keyword connection string.
  lines.push("    private static string ConnString()");
  lines.push("    {");
  lines.push('        var url = Environment.GetEnvironmentVariable("LOOM_PG_URL");');
  lines.push("        if (string.IsNullOrEmpty(url))");
  lines.push(
    '            return "Host=localhost;Port=5432;Username=postgres;Password=postgres;Database=postgres";',
  );
  lines.push('        if (!url.StartsWith("postgres", StringComparison.Ordinal)) return url;');
  lines.push("        var uri = new Uri(url);");
  lines.push("        var userInfo = uri.UserInfo.Split(':');");
  lines.push("        var db = uri.AbsolutePath.TrimStart('/');");
  lines.push(
    '        return $"Host={uri.Host};Port={(uri.Port > 0 ? uri.Port : 5432)};Username={userInfo[0]};Password={(userInfo.Length > 1 ? userInfo[1] : "")};Database={db}";',
  );
  lines.push("    }");
  lines.push("");
  if (opts.user) {
    lines.push(
      "    /// <summary>The dev-stub identity the app's DevStubUserVerifier grants.</summary>",
    );
    lines.push(
      `    private static User DevUser() => new User(${renderCsDevStubUserArgs(opts.user)});`,
    );
    lines.push("");
    lines.push('    /// <summary>Make <paramref name="user"/> the ambient request principal until');
    lines.push("    /// disposed — the frame UserMiddleware binds per request.</summary>");
    lines.push("    private static IDisposable ActAs(User user)");
    lines.push("    {");
    lines.push(
      '        var frame = RequestContext.OpenRoot(Guid.NewGuid().ToString(), "en", DateTimeOffset.UtcNow);',
    );
    lines.push("        frame.CurrentUser = user;");
    lines.push("        return RequestContext.Enter(frame);");
    lines.push("    }");
    lines.push("");
  }
  for (const block of methodBlocks) {
    lines.push(...block);
    lines.push("");
  }
  lines.push("}");
  return lines.join("\n") + "\n";
}
