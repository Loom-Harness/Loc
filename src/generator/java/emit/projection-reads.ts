import { foldFloorTerms, foldTenancyFor } from "../../../ir/enrich/fold-tenancy.js";
import { foldRowSeeds } from "../../../ir/plan/index.js";
import type {
  EnrichedBoundedContextIR,
  ProjectionIR,
  TypeIR,
  WireField,
} from "../../../ir/types/loom-ir.js";
import { exprUsesCurrentUser, isMaterializedProjection } from "../../../ir/types/loom-ir.js";
import { lines } from "../../../util/code-builder.js";
import { lowerFirst, snake, upperFirst } from "../../../util/naming.js";
import { javaRef } from "../../_imports/java.js";
import { jid } from "../java-ident.js";
import { renderJavaExpr } from "../render-expr.js";
import { javaNotFoundThrow } from "./common.js";
import { projectionCorrIdClass } from "./projection-state.js";
import { domainToWire, javaIdValueType, wireJavaType } from "./wire.js";

// ---------------------------------------------------------------------------
// Read-only projection endpoints (projection.md), the Java read half.  For
// every projection emit a `<Proj>Response` record and one per-context controller
// exposing `GET /projections/<snake>` (list) + `/projections/<snake>/{key}` (one
// by correlation id, 404 if absent) over the persisted `<Proj>Row` read-model
// row the dispatcher fold upserts.  The read-side analogue of a workflow's
// instance reads (`workflow-instances.ts`), mirroring the shipped Hono / Python
// projection routes.
//
// The row is read through the Spring Data `<Proj>RowRepository`:
// `findAll()` for the list, `findById(new <Corr>Id(key))` for one.  Each row
// projects through the projection's `wireShape` (correlation field as an id
// token, then the state fields), id → `.value()`, datetime/money coded exactly
// like the aggregate `<Agg>Response`.
// ---------------------------------------------------------------------------

export interface ProjectionReadsCtx {
  basePkg: string;
  /** Response-DTO package (application.workflows — shared with instance reads). */
  pkg: string;
  /** Route prefix ("/api" — the shared API base path). */
  routePrefix?: string;
  /** Read-model row Spring Data repository package (infrastructure.repositories). */
  rowRepoPkg: string;
  /** Read-model row entity package (infrastructure.persistence). */
  rowPkg: string;
}

/** The read-model row repository field name (`orderBookRowRepository`). */
export function projectionRepoField(proj: ProjectionIR): string {
  return `${lowerFirst(proj.name)}RowRepository`;
}

export function renderJavaProjectionReads(
  ctx: EnrichedBoundedContextIR,
  pctx: ProjectionReadsCtx,
): Map<string, { category: "workflow-service" | "api-common"; content: string }> | null {
  // FOLDED (materialized) projections only — the event-folded read model with a
  // physical `<Proj>Row` table.  Query-time projections (read-path-architecture.md
  // rev.13) have no read-model row; they are served by
  // `renderJavaQueryProjections` instead.
  const folded = ctx.projections.filter(isMaterializedProjection);
  if (folded.length === 0) return null;
  const out = new Map<string, { category: "workflow-service" | "api-common"; content: string }>();

  for (const proj of folded) {
    out.set(`${upperFirst(proj.name)}Response.java`, {
      category: "workflow-service",
      content: renderProjectionResponseDto(proj, pctx),
    });
  }
  out.set(`${ctx.name}ProjectionsController.java`, {
    category: "api-common",
    content: renderProjectionsController(ctx, pctx),
  });
  out.set(`${javaProjectionReadsClass(ctx)}.java`, {
    category: "workflow-service",
    content: renderProjectionReadsService(ctx, pctx),
  });
  return out;
}

/** The projection Response record — `wireShape` projected to wire types, the
 *  read-model analogue of a workflow instance's `<Wf>InstanceResponse`. */
function renderProjectionResponseDto(proj: ProjectionIR, pctx: ProjectionReadsCtx): string {
  const shape = proj.wireShape ?? [];
  const components = shape.map((f) => {
    guardProjectionField(proj, f);
    return `${wireJavaType(f.type, "Response")} ${f.name}`;
  });
  return lines(
    `package ${pctx.pkg};`,
    ``,
    `import ${pctx.basePkg}.domain.enums.*;`,
    `import ${pctx.basePkg}.domain.ids.*;`,
    `import ${pctx.basePkg}.domain.valueobjects.*;`,
    ``,
    `public record ${upperFirst(proj.name)}Response(${components.join(", ")}) {`,
    `}`,
    ``,
  );
}

/** One controller per context exposing every projection's read model as
 *  `GET projections/<snake>` + `.../<snake>/{key}`, reading the read-model row
 *  via its Spring Data repository and projecting each row through `wireShape`. */
function renderProjectionsController(
  ctx: EnrichedBoundedContextIR,
  pctx: ProjectionReadsCtx,
): string {
  const className = `${ctx.name}ProjectionsController`;
  const folded = ctx.projections.filter(isMaterializedProjection);
  const corrValueType = (proj: ProjectionIR): string => {
    const t = corrWire(proj).type;
    const inner = t.kind === "optional" ? t.inner : t;
    if (inner.kind !== "id") {
      throw new Error(`java projection-reads: correlation of '${proj.name}' must be id-typed`);
    }
    return javaIdValueType();
  };
  const forbidden = javaRef(`${pctx.basePkg}.domain.common`, "ForbiddenException");
  const accessor = javaRef(`${pctx.basePkg}.auth`, "CurrentUserAccessor");

  const routes: string[] = [];
  // The `requires` gate — the folded read model's twin of the query-time
  // projection gate in `query-projection-reads.ts`: bind the principal (only
  // when the predicate reads it), then 403 BEFORE the read.  Collected across
  // projections because the import set and the accessor injection are
  // controller-wide decisions.
  let anyGateUsesUser = false;
  for (const proj of folded) {
    const g = proj.query?.requires;
    if (g && exprUsesCurrentUser(g)) anyGateUsesUser = true;
  }
  const gateLines = (proj: ProjectionIR): string[] => {
    const g = proj.query?.requires;
    if (!g) return [];
    const gl: string[] = [];
    if (exprUsesCurrentUser(g)) gl.push(`        var currentUser = currentUserAccessor.user();`);
    gl.push(
      `        if (!(${renderJavaExpr(g, { thisName: "this" })})) throw new ${forbidden}(${JSON.stringify(
        `Forbidden: projection ${proj.name}`,
      )});`,
    );
    return gl;
  };
  const reads = JAVA_PROJECTION_READS_FIELD;
  for (const proj of folded) {
    const T = `${upperFirst(proj.name)}Response`;
    const slug = snake(proj.name);
    // The `{key}` param binds the correlation id's Java value type (UUID / int /
    // long / String), so springdoc emits the matching param schema — parity with
    // Hono / Python by construction (non-guid-id-http-params.md).
    const paramJava = corrValueType(proj);
    routes.push(
      `    @GetMapping("/${slug}")`,
      `    public List<${T}> list${upperFirst(proj.name)}() {`,
      ...gateLines(proj),
      `        return ${reads}.${javaProjectionRowsMethod(proj)}().stream()`,
      `            .map(${reads}::${javaProjectionWireMethod(proj)})`,
      `            .toList();`,
      `    }`,
      ``,
      `    @GetMapping("/${slug}/{key}")`,
      `    public ResponseEntity<${T}> get${upperFirst(proj.name)}(@PathVariable ${paramJava} key) {`,
      // Gate before the lookup: a caller who fails it must not learn whether
      // the key exists.
      ...gateLines(proj),
      `        return ${reads}.${javaProjectionRowMethod(proj)}(key)`,
      `            .map(x -> ResponseEntity.ok(${reads}.${javaProjectionWireMethod(proj)}(x)))`,
      // The shared carrier routes the 404 through `ApiExceptionAdvice.onNotFound`,
      // the cross-backend envelope.
      `            .orElseThrow(() -> ${javaNotFoundThrow(upperFirst(proj.name), "key")});`,
      `    }`,
      ``,
    );
  }
  while (routes[routes.length - 1] === "") routes.pop();

  const readsClass = javaProjectionReadsClass(ctx);
  const fieldDecls = [
    `    private final ${readsClass} ${reads};`,
    ...(anyGateUsesUser ? [`    private final ${accessor} currentUserAccessor;`] : []),
  ];
  const ctorParams = [
    `${readsClass} ${reads}`,
    ...(anyGateUsesUser ? [`${accessor} currentUserAccessor`] : []),
  ].join(", ");
  const ctorAssigns = [
    `        this.${reads} = ${reads};`,
    ...(anyGateUsesUser ? [`        this.currentUserAccessor = currentUserAccessor;`] : []),
  ];

  return lines(
    `package ${pctx.basePkg}.api;`,
    ``,
    `import java.util.List;`,
    ``,
    `import org.springframework.http.ResponseEntity;`,
    `import org.springframework.web.bind.annotation.*;`,
    ``,
    // The 404 carrier the show route raises (M-T6.31) — unconditional, since
    // every projection emits a show route.
    `import ${pctx.basePkg}.domain.common.AggregateNotFoundException;`,
    `import ${pctx.pkg}.*;`,
    ``,
    `@RestController`,
    `@RequestMapping("${pctx.routePrefix ?? ""}/projections")`,
    `public class ${className} {`,
    ...fieldDecls,
    ``,
    `    public ${className}(${ctorParams}) {`,
    ...ctorAssigns,
    `    }`,
    ``,
    ...routes,
    `}`,
    ``,
  );
}

/** The correlation field's wire row (`source: "id"`, always first). */
function corrWire(proj: ProjectionIR): WireField {
  const shape = proj.wireShape ?? [];
  const f = shape.find((w) => w.source === "id");
  if (!f) throw new Error(`java projection-reads: '${proj.name}' has no id-source wire field`);
  return f;
}

/** A VO-typed read-model row field projects through its `<Vo>Response` record,
 *  co-located in `application.workflows` by `renderReadModelVoResponseDtos`
 *  (`domainToWire` emits `<Vo>Response.from(...)`).  An entity (containment
 *  part) type would need a `<Part>Response` DTO — but a part type resolves only
 *  inside its own aggregate (`ddd-scope.ts`), so `projection P { line: Line }`
 *  never links and this arm is an INTERNAL INVARIANT, not a backend gap.  The
 *  `loom.java-projection-field-unsupported` code that used to mirror it was
 *  retired as a phantom (M-T6.36); the unreachability is pinned instead by
 *  `test/generator/java/generator-java-readmodel-gates.test.ts`. */
function guardProjectionField(proj: ProjectionIR, f: WireField): void {
  const t = f.type.kind === "optional" ? f.type.inner : f.type;
  const leaf =
    t.kind === "array" ? (t.element.kind === "optional" ? t.element.inner : t.element) : t;
  if (leaf.kind === "entity") {
    throw new Error(
      `java projection-reads: row field '${f.name}' of '${proj.name}' is entity-typed — unreachable: a part type never resolves in projection scope.`,
    );
  }
}

/** The context's folded-projection reads: every row and one row by key, each
 *  under the fold's read scope, and a row's Response.  The read routes and a
 *  query handler's `P.all()` / `P.get(k)` call the same methods. */
function renderProjectionReadsService(
  ctx: EnrichedBoundedContextIR,
  pctx: ProjectionReadsCtx,
): string {
  const folded = ctx.projections.filter(isMaterializedProjection);
  const accessor = javaRef(`${pctx.basePkg}.auth`, "CurrentUserAccessor");
  const scoped = folded.some((p) => foldTenancyFor(p) !== undefined);
  const methods: string[] = [];
  for (const proj of folded) {
    const T = `${upperFirst(proj.name)}Response`;
    const Row = `${upperFirst(proj.name)}Row`;
    const repo = projectionRepoField(proj);
    const idClass = projectionCorrIdClass(proj);
    const shape = proj.wireShape ?? [];
    // A required column with no starting value (`foldRowSeeds`) reads null
    // until a fold writes it, so it converts null-safely.
    const seeded = new Set(foldRowSeeds(proj).map((sd) => sd.field.name));
    const rowType = (f: WireField): TypeIR =>
      f.source === "id" || f.type.kind === "optional" || seeded.has(f.name)
        ? f.type
        : { kind: "optional", inner: f.type };
    const projRow = (rowVar: string): string =>
      shape.map((f) => domainToWire(rowType(f), `${rowVar}.${jid(f.name)}()`)).join(", ");
    // Every read of a scoped fold applies its read scope (`fold-tenancy.ts`):
    // the row's tenant equals the request principal's claim.
    const tenancy = foldTenancyFor(proj);
    const floor = tenancy ? foldFloorTerms(tenancy) : [];
    const scopeTenant = floor[0]
      ? `String.valueOf(currentUserAccessor.user().${jid(floor[0].claim)}())`
      : undefined;
    const listCall = scopeTenant ? `${repo}.findAllByTenant(${scopeTenant})` : `${repo}.findAll()`;
    const byKey = scopeTenant
      ? `${repo}.findByTenantAndKey(${scopeTenant}, new ${idClass}(key))`
      : `${repo}.findById(new ${idClass}(key))`;
    methods.push(
      `    public List<${Row}> ${javaProjectionRowsMethod(proj)}() {`,
      `        return ${listCall};`,
      `    }`,
      ``,
      `    public Optional<${Row}> ${javaProjectionRowMethod(proj)}(${javaIdValueType()} key) {`,
      `        return ${byKey};`,
      `    }`,
      ``,
      `    public ${T} ${javaProjectionWireMethod(proj)}(${Row} x) {`,
      `        return new ${T}(${projRow("x")});`,
      `    }`,
      ``,
    );
  }
  while (methods[methods.length - 1] === "") methods.pop();
  const cls = javaProjectionReadsClass(ctx);
  const fields = [
    ...folded.map(
      (p) => `    private final ${upperFirst(p.name)}RowRepository ${projectionRepoField(p)};`,
    ),
    ...(scoped ? [`    private final ${accessor} currentUserAccessor;`] : []),
  ];
  const params = [
    ...folded.map((p) => `${upperFirst(p.name)}RowRepository ${projectionRepoField(p)}`),
    ...(scoped ? [`${accessor} currentUserAccessor`] : []),
  ].join(", ");
  const assigns = [
    ...folded.map((p) => `        this.${projectionRepoField(p)} = ${projectionRepoField(p)};`),
    ...(scoped ? [`        this.currentUserAccessor = currentUserAccessor;`] : []),
  ];
  return lines(
    `package ${pctx.pkg};`,
    ``,
    `import java.util.List;`,
    `import java.util.Optional;`,
    ``,
    `import org.springframework.stereotype.Service;`,
    `import org.springframework.transaction.annotation.Transactional;`,
    ``,
    `import ${pctx.rowRepoPkg}.*;`,
    pctx.rowPkg !== pctx.rowRepoPkg ? `import ${pctx.rowPkg}.*;` : null,
    `import ${pctx.basePkg}.domain.ids.*;`,
    ``,
    `@Service`,
    `@Transactional(readOnly = true)`,
    `public class ${cls} {`,
    ...fields,
    ``,
    `    public ${cls}(${params}) {`,
    ...assigns,
    `    }`,
    ``,
    ...methods,
    `}`,
    ``,
  );
}

/** `<Ctx>ProjectionReads` — the context's folded-projection read service. */
export function javaProjectionReadsClass(ctx: { name: string }): string {
  return `${ctx.name}ProjectionReads`;
}

/** The handler and controller field holding the projection read service. */
export const JAVA_PROJECTION_READS_FIELD = "projectionReads";

/** `list<P>Rows` — every row of a folded projection. */
export function javaProjectionRowsMethod(p: { name: string }): string {
  return `list${upperFirst(p.name)}Rows`;
}

/** `find<P>Row` — one row by its key. */
export function javaProjectionRowMethod(p: { name: string }): string {
  return `find${upperFirst(p.name)}Row`;
}

/** `<p>Wire` — a row as the projection's Response record. */
export function javaProjectionWireMethod(p: { name: string }): string {
  return `${lowerFirst(p.name)}Wire`;
}
