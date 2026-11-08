// Context-scoped INTEGRATION test emission (test-placement.md) — the
// Java/Spring Boot backend.  The Java twin of the node renderer
// (`typescript/emit/integration-tests.ts`): a `test … for <Context>` (or a
// `context`-nested `test`) runs cross-aggregate behaviour against live JPA
// repositories.  Unlike the node/python/.NET renderers (which hand-construct a
// repository), the Spring Data repositories are DI beans wired to an
// EntityManager, so the class is a `@SpringBootTest` that autowires them and
// boots the full app — Flyway applies the migrations on context start.
//
// Provisioning-agnostic: a `@DynamicPropertySource` reads `LOOM_PG_URL` (the
// same libpq URL the other backends read) and binds `spring.datasource.*` from
// it; unset, it falls back to the app's own `SPRING_DATASOURCE_*` defaults.
//
// v1 constraints: a repository find must be LET-BOUND
// (`loom.integration-find-must-bind`, shared with node); the app's real event
// dispatcher runs (autowired), but synchronous workflow-cascade assertions are
// the tracked 3b follow-up.

import type {
  AggregateIR,
  BoundedContextIR,
  ExprIR,
  FieldIR,
  FindIR,
  TestIR,
  TestPrincipalIR,
  TestStmtIR,
} from "../../../ir/types/loom-ir.js";
import { bindingsAssertedAbsent } from "../../../ir/util/test-null-subjects.js";
import { lines } from "../../../util/code-builder.js";
import { lowerFirst } from "../../../util/naming.js";
import { repoVerbOpAt } from "../../../util/repository-contract.js";
import { jid } from "../java-ident.js";
import { packagePath } from "../naming.js";
import { type JavaRenderContext, renderJavaExpr } from "../render-expr.js";
import { stubUserValue } from "./auth.js";
import {
  javaBareToThrow,
  renderCreateCall,
  renderExplicitMatcher,
  renderOperationCall,
  testBodyRenderContext,
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

const repoField = (aggName: string): string => `${lowerFirst(aggName)}Repository`;

/** A `<Agg>.<find>(...)` repository read → the emitted call string, or undefined.
 *  `findById` (and an optional/union custom find) returns `Optional<Agg>` → we
 *  `.orElseThrow()` so the binding is a plain `Agg` (mirrors node's non-null
 *  assertion). `getById` already returns `Agg` (throws); `findAll` a `List`. */
function findCallOf(
  e: ExprIR,
  ctx: BoundedContextIR,
  rctx: JavaRenderContext,
  /** The binding is asserted null: unwrap an `Optional` to null, not a throw. */
  absent = false,
): string | undefined {
  if (e.kind !== "method-call" || e.receiver.kind !== "ref") return undefined;
  const aggName = (e.receiver as { name: string }).name;
  if (!ctx.repositories.some((r) => r.aggregateName === aggName)) return undefined;
  const custom = findRepoQuery(e.member, aggName, ctx);
  const op = repoVerbOpAt(e.member, "integration-test");
  if (!op && !custom) return undefined;
  const field = repoField(aggName);
  const args = e.args
    .map((a) => {
      return renderJavaExpr(a, rctx);
    })
    .join(", ");
  const unwrap = absent ? ".orElse(null)" : ".orElseThrow()";
  if (op === "load-optional") return `${field}.findById(${args})${unwrap}`;
  if (op === "load") return `${field}.getById(${args})`;
  if (op === "select-many") return `${field}.findAll()`;
  const optional = custom?.returnType.kind === "optional" || custom?.returnType.kind === "union";
  return `${field}.${jid(e.member)}(${args})${optional ? unwrap : ""}`;
}

/** One `as { … }` claim value as a Java expression of the claim's declared
 *  type. */
function renderClaimValue(field: FieldIR | undefined, value: string | readonly string[]): string {
  const t = field?.type.kind === "optional" ? field.type.inner : field?.type;
  if (typeof value !== "string") {
    return `java.util.List.of(${value.map((v) => JSON.stringify(v)).join(", ")})`;
  }
  const uuid = `java.util.UUID.fromString(${JSON.stringify(value)})`;
  if (t?.kind === "id") return `new ${t.targetName}Id(${uuid})`;
  if (t?.kind === "primitive" && t.name === "guid") return uuid;
  return JSON.stringify(value);
}

/** `CurrentUserAccessor.actAs(new User(…))` — the dev-stub identity, by
 *  position, with the test's `as { … }` claims replaced. */
function renderActAs(p: TestPrincipalIR | undefined, user: readonly FieldIR[]): string {
  const args = user.map((f) => {
    const claim = p?.claims.find((c) => c.name === f.name);
    return claim ? renderClaimValue(f, claim.value) : stubUserValue(f.type);
  });
  return `CurrentUserAccessor.actAs(new User(${args.join(", ")}));`;
}

interface PrincipalScope {
  user: readonly FieldIR[] | undefined;
  /** Bindings the test asserts null — their read is not unwrapped to a throw. */
  absent: Set<string>;
}

/** Render one integration-test statement (8-space body indent). */
function renderStmt(
  s: TestStmtIR,
  ctx: BoundedContextIR,
  rctx: JavaRenderContext,
  /** Position in the test body: mints a collision-free local per throw assertion. */
  index: number,
  scope: PrincipalScope,
): string[] {
  const I = "        ";
  switch (s.kind) {
    case "let": {
      const agg = createAggOf(s.expr, ctx);
      if (agg && s.expr.kind === "method-call" && s.expr.args[0]?.kind === "object") {
        const create = renderCreateCall(s.expr, ctx, rctx) ?? renderJavaExpr(s.expr, rctx);
        return [`${I}var ${s.name} = ${create};`, `${I}${repoField(agg.name)}.save(${s.name});`];
      }
      const find = findCallOf(s.expr, ctx, rctx, scope.absent.has(s.name));
      if (find) return [`${I}var ${s.name} = ${find};`];
      return [`${I}var ${s.name} = ${renderJavaExpr(s.expr, rctx)};`];
    }
    case "expression": {
      // A mutating operation on a let-bound aggregate instance → mutate in place,
      // then persist (JPA dirty-checking flushes at save/commit).
      if (
        s.expr.kind === "method-call" &&
        s.expr.receiverType.kind === "entity" &&
        !s.expr.isCollectionOp
      ) {
        const aggName = s.expr.receiverType.name;
        const recv = renderJavaExpr(s.expr.receiver, rctx);
        const call = renderOperationCall(s.expr, ctx, rctx) ?? renderJavaExpr(s.expr, rctx);
        return [`${I}${call};`, `${I}${repoField(aggName)}.save(${recv});`];
      }
      return [`${I}${renderJavaExpr(s.expr, rctx)};`];
    }
    case "expect": {
      const explicit = renderExplicitMatcher(s.expr, rctx);
      if (explicit) return [`${I}${explicit}`];
      return [`${I}assertTrue(${renderJavaExpr(s.expr, rctx)});`];
    }
    case "expect-throws": {
      const inner =
        renderCreateCall(s.expr, ctx, rctx) ??
        renderOperationCall(s.expr, ctx, rctx) ??
        renderJavaExpr(s.expr, rctx);
      return javaBareToThrow(s.expr, inner, `__thrown${index}`, I);
    }
    case "principal":
      // A body `as { … }` line: rebind the thread's ambient principal.
      return scope.user ? [`${I}${renderActAs(s.principal, scope.user)}`] : [];
    default:
      throw new Error(`unsupported integration-test statement '${s.kind}'`);
  }
}

function renderTest(
  t: TestIR,
  ctx: BoundedContextIR,
  user: readonly FieldIR[] | undefined,
): string[] {
  const methodName =
    t.name
      .replace(/[^A-Za-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .replace(/^([0-9])/, "_$1") || "test";
  // Locals are declared under their source name here (`var ${s.name}`).
  const rctx = testBodyRenderContext(t, (name) => name);
  const scope: PrincipalScope = { user, absent: bindingsAssertedAbsent(t.statements) };
  // Under auth every principal reader reads the thread's ambient principal,
  // so the test binds one first: the dev-stub identity with the test's
  // `as { … }` claims.
  const body = [
    ...(user ? [`        ${renderActAs(t.principal, user)}`] : []),
    ...t.statements.flatMap((s, i) => renderStmt(s, ctx, rctx, i, scope)),
  ];
  return [
    `    @Test`,
    `    @DisplayName(${JSON.stringify(t.name)})`,
    `    public void ${methodName}() {`,
    ...body,
    `    }`,
    ``,
  ];
}

/** Emit `src/test/java/<basePkg>/<Ctx>IntegrationTests.java` for a context that
 *  declares integration tests, or `[path, content]` null when it declares none.
 *  `entityPkgOf` / `repoPkgOf` resolve each aggregate's entity / repository
 *  package through the active layout adapter. */
export function renderJavaContextIntegrationTest(
  ctx: BoundedContextIR,
  basePkg: string,
  entityPkgOf: (aggName: string) => string,
  repoPkgOf: (aggName: string) => string,
  /** The system's `user { … }` fields when the project emits the auth layer
   *  (`auth/CurrentUserAccessor`): every test then binds a principal.
   *  Absent ⇒ none is bound. */
  userFields?: readonly FieldIR[],
): { path: string; content: string } | null {
  if (ctx.tests.length === 0) return null;

  const methods = ctx.tests.flatMap((t) => renderTest(t, ctx, userFields));
  while (methods[methods.length - 1] === "") methods.pop();
  const bodyStr = methods.join("\n");

  const usedAggs = ctx.aggregates.filter(
    (a) =>
      ctx.repositories.some((r) => r.aggregateName === a.name) &&
      new RegExp(`\\b${a.name}\\b`).test(bodyStr),
  );
  // Feature-package wildcards for every used aggregate's entity + repository.
  const imports = new Set<string>();
  for (const a of usedAggs) {
    imports.add(`${entityPkgOf(a.name)}.*`);
    imports.add(`${repoPkgOf(a.name)}.*`);
  }

  const className = `${upperFirst(ctx.name)}IntegrationTests`;
  const content = lines(
    `package ${basePkg};`,
    ``,
    ...[...imports].sort().map((i) => `import ${i};`),
    imports.size > 0 ? `` : null,
    `import static org.junit.jupiter.api.Assertions.*;`,
    ``,
    `import java.net.URI;`,
    userFields ? `import org.junit.jupiter.api.AfterEach;` : null,
    `import org.junit.jupiter.api.DisplayName;`,
    `import org.junit.jupiter.api.Test;`,
    `import org.springframework.beans.factory.annotation.Autowired;`,
    `import org.springframework.boot.test.context.SpringBootTest;`,
    `import org.springframework.test.context.DynamicPropertyRegistry;`,
    `import org.springframework.test.context.DynamicPropertySource;`,
    ``,
    // The same domain wildcards the unit-test emitter imports: a test body
    // constructs value objects (`new Berth(...)`) and names enum constants
    // (`Size.Large`), and both packages always exist.
    userFields ? `import ${basePkg}.auth.CurrentUserAccessor;` : null,
    userFields ? `import ${basePkg}.auth.User;` : null,
    `import ${basePkg}.domain.common.*;`,
    `import ${basePkg}.domain.enums.*;`,
    `import ${basePkg}.domain.ids.*;`,
    `import ${basePkg}.domain.valueobjects.*;`,
    ``,
    `@SpringBootTest`,
    `public class ${className} {`,
    ...usedAggs.map((a) => `    @Autowired\n    private ${a.name}Repository ${repoField(a.name)};`),
    ``,
    // Provisioning-agnostic: LOOM_PG_URL (libpq URL) → spring.datasource.*.
    `    @DynamicPropertySource`,
    `    static void datasource(DynamicPropertyRegistry registry) {`,
    `        String url = System.getenv("LOOM_PG_URL");`,
    `        if (url == null || url.isEmpty() || !url.startsWith("postgres")) return;`,
    `        URI uri = URI.create(url);`,
    `        String[] userInfo = uri.getUserInfo() != null`,
    `            ? uri.getUserInfo().split(":")`,
    `            : new String[] { "postgres", "postgres" };`,
    `        int port = uri.getPort() > 0 ? uri.getPort() : 5432;`,
    `        String db = uri.getPath().replaceFirst("^/", "");`,
    `        registry.add("spring.datasource.url", () -> "jdbc:postgresql://" + uri.getHost() + ":" + port + "/" + db);`,
    `        registry.add("spring.datasource.username", () -> userInfo[0]);`,
    `        registry.add("spring.datasource.password", () -> userInfo.length > 1 ? userInfo[1] : "");`,
    `    }`,
    ``,
    ...(userFields
      ? [
          `    /** The thread's principal must not outlive its test. */`,
          `    @AfterEach`,
          `    void clearPrincipal() {`,
          `        CurrentUserAccessor.actAs(null);`,
          `    }`,
          ``,
        ]
      : []),
    ...methods,
    `}`,
    ``,
  );
  return { path: `src/test/java/${packagePath(basePkg)}/${className}.java`, content };
}

function upperFirst(s: string): string {
  return s.length > 0 ? s[0]!.toUpperCase() + s.slice(1) : s;
}
