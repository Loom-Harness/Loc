import { foldFloorTerms, foldTenancyFor } from "../../../ir/enrich/fold-tenancy.js";
import { projectionTableName } from "../../../ir/enrich/storage-names.js";
import type {
  EnrichedBoundedContextIR,
  EnumIR,
  ProjectionIR,
  SystemIR,
  ValueObjectIR,
} from "../../../ir/types/loom-ir.js";
import { exprUsesCurrentUser, isMaterializedProjection } from "../../../ir/types/loom-ir.js";
import { enumPool, valueObjectPool } from "../../../ir/util/reachable-types.js";
import { resolveContextSchema } from "../../../ir/util/resolve-datasource.js";
import { snake, upperFirst } from "../../../util/naming.js";
import type { ApiRoute } from "../api-emit.js";
import { ectoIdType, projectionRowModule } from "../dispatch-emit.js";
import { renderExpr } from "../render-expr.js";
import { denialOverrides, denialResponse } from "./denial.js";
import { effectiveGate } from "./gate.js";
import { mapTypeToEcto, renderValueColumnsFn, valueObjectColumns } from "./schema-emit.js";
// ---------------------------------------------------------------------------
// Vanilla foundation — projection read models (projection.md), the read half.
//
// A projection folds foreign events into a read-model row.  The fold + dispatch
// wiring lives in `dispatch-emit.ts` (a pure `<Proj>.On<Event>` handler joined
// into the context Dispatcher); THIS module emits the two pieces the read side
// needs:
//
//   - `<App>.<Ctx>.Projections.<Proj>Row` — a plain `Ecto.Schema` over the
//     read-model table the shared `MigrationsIR` already derives (PK = the
//     `keyed by` correlation column, non-key columns nullable).  Enum fields
//     map to `Ecto.Enum` exactly like the aggregate schema, so the fold's
//     `%{state | status: :Placed}` atom round-trips to the declared string.
//   - `<App>Web.ProjectionsController` — ONE project-wide controller (mirrors
//     `ViewsController`) exposing `GET /api/projections/<slug>` (list) +
//     `/<slug>/:key` (one by correlation id, RFC-7807 404 if absent), reading
//     the row via `<App>.Repo` and projecting the projection `wireShape`.
//
// A context with no projections emits nothing here (byte-identical additivity).
// ---------------------------------------------------------------------------

export interface VanillaProjectionRef {
  ctx: EnrichedBoundedContextIR;
  proj: ProjectionIR;
}

/** Emit the read-model `<Proj>Row` Ecto schema for every projection in a
 *  context, and collect the `{ ctx, proj }` refs the project-wide controller is
 *  built from.  The fold handler + dispatcher wiring is emitted separately by
 *  `emitDispatch`. */
export function emitVanillaProjectionSchemas(
  appName: string,
  appModule: string,
  ctx: EnrichedBoundedContextIR,
  out: Map<string, string>,
  sys?: SystemIR,
): VanillaProjectionRef[] {
  // FOLDED (materialized) projections only — the event-folded read model with a
  // physical `<Proj>Row` table.  Query-time projections (read-path-architecture.md
  // rev.13) have no read-model table; they are emitted by
  // `emitVanillaQueryProjectionModules` instead.
  const folded = ctx.projections.filter(isMaterializedProjection);
  if (folded.length === 0) return [];
  const ctxSnake = snake(ctx.name);
  const contextModule = `${appModule}.${upperFirst(ctx.name)}`;
  const schema = sys ? resolveContextSchema(ctx, sys) : undefined;
  const enumsByName = new Map<string, EnumIR>(enumPool(ctx).map((e) => [e.name, e]));
  const refs: VanillaProjectionRef[] = [];
  for (const proj of folded) {
    out.set(
      `lib/${appName}/${ctxSnake}/projections/${snake(proj.name)}_row.ex`,
      renderProjectionRowSchema(contextModule, proj, enumsByName, valueObjectPool(ctx), schema),
    );
    refs.push({ ctx, proj });
  }
  return refs;
}

/** The read-model row `Ecto.Schema`.  PK = the correlation column (matching the
 *  migration + saga state PK type); non-key fields map through `mapTypeToEcto`
 *  (so enums are `Ecto.Enum`, ids `:binary_id`, etc.). */
function renderProjectionRowSchema(
  contextModule: string,
  proj: ProjectionIR,
  enumsByName: Map<string, EnumIR>,
  valueObjects: readonly ValueObjectIR[],
  schema?: string,
): string {
  const corr = proj.correlationField as string;
  const corrField = proj.stateFields.find((f) => f.name === corr);
  const pkType = corrField && corrField.type.kind === "id" ? ectoIdType() : ":string";
  const table = projectionTableName(proj);
  // A value object is its leaf columns plus a virtual field (D-ONE-SCHEMA).
  // Every non-key read-model column is nullable — a fold writes only what its
  // event carries — so the value object is optional here whatever its
  // declared optionality.
  const voPools = { vos: new Map(valueObjects.map((v) => [v.name, v])), enums: enumsByName };
  const valueSpecs: string[] = [];
  const fieldLines = proj.stateFields
    .filter((f) => f.name !== corr)
    .flatMap((f) => {
      const cols = valueObjectColumns(f, voPools, enumsByName, true);
      if (cols) {
        valueSpecs.push(cols.spec);
        return [...cols.lines];
      }
      const ecto = mapTypeToEcto(f.type, enumsByName);
      if (!ecto) {
        throw new Error(
          `elixir projection: unsupported read-model field '${f.name}' on '${proj.name}' (${f.type.kind}).`,
        );
      }
      return `    field :${snake(f.name)}, ${ecto}`;
    });
  const prefixLine = schema ? `  @schema_prefix ${JSON.stringify(schema)}\n` : "";
  // A tenant-scoped fold (`fold-tenancy.ts`) keys its row by
  // `(tenant_id, <key>)` — a composite primary key.
  const tenancy = foldTenancyFor(proj);
  if (tenancy) {
    const keyLines = [
      ...tenancy.metadata.map((m) => `    field :${m.column}, :string, primary_key: true`),
      `    field :${snake(corr)}, ${pkType}, primary_key: true`,
    ];
    return `# Auto-generated.
defmodule ${projectionRowModule(contextModule, proj)} do
  @moduledoc "Read model folded from foreign events for the ${upperFirst(proj.name)} projection."

  use Ecto.Schema

${prefixLine}  @primary_key false
  schema "${table}" do
${[...keyLines, ...fieldLines].join("\n")}
  end
${renderValueColumnsFn(valueSpecs)}end
`;
  }
  return `# Auto-generated.
defmodule ${projectionRowModule(contextModule, proj)} do
  @moduledoc "Read model folded from foreign events for the ${upperFirst(proj.name)} projection."

  use Ecto.Schema

${prefixLine}  @primary_key {:${snake(corr)}, ${pkType}, autogenerate: false}
  schema "${table}" do
${fieldLines.length > 0 ? fieldLines.join("\n") + "\n" : ""}  end
${renderValueColumnsFn(valueSpecs)}end
`;
}

/** The single project-wide `ProjectionsController` over every hosted context's
 *  projections (mirrors `emitVanillaViewsController`), plus the read routes.
 *  Returns `[]` (and emits no controller) when there are no projections. */
export function emitVanillaProjectionsController(
  appName: string,
  appModule: string,
  projections: VanillaProjectionRef[],
  out: Map<string, string>,
): ApiRoute[] {
  if (projections.length === 0) return [];
  const webModule = `${appModule}Web`;
  const byCtx = new Map<string, VanillaProjectionRef[]>();
  for (const r of projections) byCtx.set(r.ctx.name, [...(byCtx.get(r.ctx.name) ?? []), r]);
  for (const [ctxName, refs] of byCtx) {
    const contextModule = `${appModule}.${upperFirst(ctxName)}`;
    out.set(
      `lib/${appName}/${snake(ctxName)}/projection_reads.ex`,
      renderProjectionReads(appModule, contextModule, refs),
    );
  }
  const actions = projections
    .map(({ ctx, proj }) =>
      renderProjectionActions(`${appModule}.${upperFirst(ctx.name)}`, proj, ctx),
    )
    .join("\n\n");

  out.set(
    `lib/${appName}_web/controllers/projections_controller.ex`,
    `# Auto-generated.
defmodule ${webModule}.ProjectionsController do
  use ${webModule}, :controller
  alias ${webModule}.ProblemDetails

  @moduledoc """
  Read-only HTTP entry points for projection read models (projection.md).
  Each action reads the projection's read-model Ecto schema via the app Repo
  and encodes the projection wire shape.
  """

${actions}
end
`,
  );

  const routes: ApiRoute[] = [];
  for (const { proj } of projections) {
    const slug = snake(proj.name);
    routes.push({
      method: "get",
      path: `/projections/${slug}`,
      controller: "ProjectionsController",
      action: `:${slug}_index`,
    });
    routes.push({
      method: "get",
      path: `/projections/${slug}/:key`,
      controller: "ProjectionsController",
      action: `:${slug}_show`,
    });
  }
  return routes;
}

/** The list + by-key actions for one projection.  Each row projects through the
 *  projection `wireShape` (`f.name: row.<snake>`), 404 via `ProblemDetails`. */
function renderProjectionActions(
  contextModule: string,
  proj: ProjectionIR,
  ctx: EnrichedBoundedContextIR,
): string {
  const slug = snake(proj.name);
  // The `requires` gate — 403 before the read, mirroring the query-time
  // projection action in `query-projections-emit.ts`.  A folded projection is a
  // table of rows a client can GET; being written by folds rather than queried
  // live says nothing about who may read it.  Ungated ⇒ byte-identical.
  const projGate = effectiveGate(proj.query?.requires);
  const gateExpr = projGate
    ? renderExpr(projGate, {
        thisName: "record",
        contextModule,
      })
    : null;
  const cuBind =
    projGate && exprUsesCurrentUser(projGate)
      ? "    current_user = Map.get(conn.assigns, :current_user)\n"
      : "";
  const denial = denialResponse(
    "forbidden",
    JSON.stringify(`Forbidden: projection ${proj.name}`),
    denialOverrides(ctx),
  );
  // Every read of a scoped fold applies its read scope (`fold-tenancy.ts`):
  // the row's tenant column equals the request principal's claim.
  const tenancy = foldTenancyFor(proj);
  const floor = tenancy ? foldFloorTerms(tenancy) : [];
  const reads = projectionReadsModule(contextModule);
  const userArg = floor.length > 0 ? "Map.get(conn.assigns, :current_user)" : undefined;
  const listRead = `${reads}.${projectionRowsFn(proj)}(${userArg ?? ""})`;
  const keyRead = `${reads}.${projectionRowFn(proj)}(${["key", ...(userArg ? [userArg] : [])].join(", ")})`;
  const wire = `${reads}.${projectionWireFn(proj)}`;
  const indent = (text: string, by: string): string =>
    text
      .split("\n")
      .map((l) => (l === "" ? l : by + l))
      .join("\n");
  const indexBody = [`data = Enum.map(${listRead}, &${wire}/1)`, `json(conn, data)`].join("\n");
  const showBody = [
    `case ${keyRead} do`,
    `  nil ->`,
    `    ProblemDetails.not_found_response(conn, "${upperFirst(proj.name)}", key)`,
    ``,
    `  row ->`,
    `    json(conn, ${wire}(row))`,
    `end`,
  ].join("\n");
  const guarded = (body: string): string =>
    gateExpr
      ? `${cuBind}    if not (${gateExpr}) do\n      ${denial}\n    else\n${indent(body, "      ")}\n    end`
      : indent(body, "    ");
  return `  @doc "GET /api/projections/${slug}"
  def ${slug}_index(conn, _params) do
${guarded(indexBody)}
  end

  @doc "GET /api/projections/${slug}/:key"
  def ${slug}_show(conn, %{"key" => key}) do
${guarded(showBody)}
  end`;
}

/** `<App>.<Ctx>.ProjectionReads` — every folded projection's reads: all rows
 *  and one row by key, each under the fold's read scope, and a row's wire map.
 *  The read routes and a handler body's `P.all()` / `P.get(k)` call the same
 *  functions. */
function renderProjectionReads(
  appModule: string,
  contextModule: string,
  refs: VanillaProjectionRef[],
): string {
  const scopedAny = refs.some(({ proj }) => foldTenancyFor(proj));
  const fns = refs.map(({ proj }) => {
    const rowMod = projectionRowModule(contextModule, proj);
    const tenancy = foldTenancyFor(proj);
    const floor = tenancy ? foldFloorTerms(tenancy) : [];
    const corrCol = snake(proj.correlationField as string);
    const scopeBinds = floor.map(
      (t, i) => `    scope${i} = to_string(Map.get(current_user, :${snake(t.claim)}))`,
    );
    const mapFields = (proj.wireShape ?? [])
      .map((f) => `${f.name}: row.${snake(f.name)}`)
      .join(", ");
    const userParam = floor.length > 0 ? "current_user" : "";
    const all =
      floor.length > 0
        ? `${appModule}.Repo.Records.all(from(r in ${rowMod}, where: ${floor.map((t, i) => `r.${t.column} == ^scope${i}`).join(" and ")}))`
        : `${appModule}.Repo.Records.all(${rowMod})`;
    const one =
      floor.length > 0
        ? `${appModule}.Repo.Records.get_by(${rowMod}, ${[`${corrCol}: key`, ...floor.map((t, i) => `${t.column}: scope${i}`)].join(", ")})`
        : `${appModule}.Repo.Records.get(${rowMod}, key)`;
    return [
      `  @doc "Every ${proj.name} row."`,
      `  def ${projectionRowsFn(proj)}(${userParam}) do`,
      ...scopeBinds,
      `    ${all}`,
      `  end`,
      ``,
      `  @doc "One ${proj.name} row by its key, or nil."`,
      `  def ${projectionRowFn(proj)}(${["key", ...(userParam ? [userParam] : [])].join(", ")}) do`,
      ...scopeBinds,
      `    ${one}`,
      `  end`,
      ``,
      `  @doc "A ${proj.name} row as its wire map."`,
      `  def ${projectionWireFn(proj)}(row), do: %{${mapFields}}`,
    ].join("\n");
  });
  return `# Auto-generated.
defmodule ${projectionReadsModule(contextModule)} do
  @moduledoc """
  Reads of the context's folded projections, shared by the projection routes
  and the handler bodies that read them.
  """
${scopedAny ? "\n  import Ecto.Query, only: [from: 2]\n" : ""}
${fns.join("\n\n")}
end
`;
}

/** The module holding a context's folded-projection reads. */
export function projectionReadsModule(contextModule: string): string {
  return `${contextModule}.ProjectionReads`;
}

/** `<p>_rows` — every row of a folded projection. */
export function projectionRowsFn(p: { name: string }): string {
  return `${snake(p.name)}_rows`;
}

/** `<p>_row` — one row by its key, `nil` when absent. */
export function projectionRowFn(p: { name: string }): string {
  return `${snake(p.name)}_row`;
}

/** `<p>_wire` — a row as its wire map. */
export function projectionWireFn(p: { name: string }): string {
  return `${snake(p.name)}_wire`;
}
