// The names the GENERATED code binds, which a domain type may not take.
//
// Some backends import framework and runtime types by simple name into the
// same compilation units that import the model's types, or generate a module
// at a fixed path: FastAPI's `Request` in every python route module, the
// TypeScript global `Promise` in every node repository port, `domain/errors.ts`
// beside the domain modules.  A domain type of the same name makes two
// bindings of one simple name, and the unit fails to build.  A backend that can
// spell a clashing platform name another way does, and binds nothing here: the
// Java units import each type by its single name and spell a platform type
// fully qualified where a type of the model's shares its simple name.
//
// Such a name is REFUSED at validation (`loom.reserved-type-name`), on every
// target alike, so a model that validates stays portable across the backend
// matrix.  Nothing is renamed or escaped.  This is not the keyword rule:
// a member or parameter named like a target KEYWORD is escaped per backend and
// never refused (D-TARGET-RESERVED-NAMES), and the .NET backend's ambient
// aliasing (`src/generator/_symbols/plan.ts`) keeps repairing the BCL names it
// can alias.  See D-RESERVED-GENERATED-NAMES.
//
// Completeness is gated, not trusted:
//   - `test/system/reserved-type-names.test.ts` derives every simple name the
//     emitters can bind (their import lines, typed import symbols, annotations
//     and the language-level names they mention) and requires each one to be
//     in this table or in its admitted list;
//   - `test/e2e/reserved-type-names-proof.test.ts` (opt-in,
//     `LOOM_RESERVED_NAMES_PROOF=1`) generates one model per entry with the
//     refusal ignored and requires it to break the build of a target the entry
//     lists, and compiles every admitted name as a domain type on each backend.
//
// The table names only types: it applies to the declarations that become a
// generated type (aggregate, entity, valueobject, enum, event, the payload
// records, domainService).  Pure module roots (an Elixir context named `Repo`)
// are a separate question this table does not answer.

/** A backend whose generated code binds a reserved name. */
export type ReservedTypeTarget = "node" | "dotnet" | "java" | "python" | "elixir";

/** One binding of a reserved name in one target's generated code. */
export interface ReservedTypeBinding {
  readonly target: ReservedTypeTarget;
  /** What binds the name there — the imported type, the global, or the
   *  generated type — spelled fully qualified. */
  readonly binder: string;
}

export interface ReservedTypeName {
  readonly name: string;
  readonly bindings: readonly ReservedTypeBinding[];
}

const n = (target: ReservedTypeTarget, binder: string): ReservedTypeBinding => ({ target, binder });

export const RESERVED_TYPE_NAMES: readonly ReservedTypeName[] = [
  { name: "APIRouter", bindings: [n("python", "fastapi.APIRouter")] },
  {
    name: "AggregateNotFoundError",
    bindings: [
      n("node", "<project>/domain/errors AggregateNotFoundError"),
      n("python", "app.domain.errors.AggregateNotFoundError"),
    ],
  },
  {
    name: "AggregateNotFoundException",
    bindings: [n("dotnet", "<project>.Domain.Common.AggregateNotFoundException")],
  },
  { name: "Annotated", bindings: [n("python", "typing.Annotated")] },
  { name: "AnyPgColumn", bindings: [n("node", "drizzle-orm/pg-core AnyPgColumn")] },
  { name: "Array", bindings: [n("dotnet", "System.Array")] },
  { name: "AsyncSession", bindings: [n("python", "sqlalchemy.ext.asyncio.AsyncSession")] },
  { name: "Base", bindings: [n("python", "app.db.schema.Base")] },
  { name: "BaseModel", bindings: [n("python", "pydantic.BaseModel")] },
  { name: "CalendarDate", bindings: [n("python", "datetime.date (imported as CalendarDate)")] },
  {
    name: "ConcurrencyError",
    bindings: [
      n("node", "<project>/domain/errors ConcurrencyError"),
      n("python", "app.domain.errors.ConcurrencyError"),
    ],
  },
  {
    name: "Create",
    bindings: [
      n("dotnet", "the generated factory method Create (a member may not share its type name)"),
    ],
  },
  { name: "Date", bindings: [n("node", "the TypeScript global Date")] },
  { name: "DateTime", bindings: [n("dotnet", "System.DateTime")] },
  { name: "Decimal", bindings: [n("node", "decimal.js Decimal"), n("python", "decimal.Decimal")] },
  { name: "Depends", bindings: [n("python", "fastapi.Depends")] },
  { name: "DisallowedError", bindings: [n("node", "<project>/domain/errors DisallowedError")] },
  {
    name: "DisallowedException",
    bindings: [n("dotnet", "<project>.Domain.Common.DisallowedException")],
  },
  { name: "DomainError", bindings: [n("node", "<project>/domain/errors DomainError")] },
  { name: "DomainEvent", bindings: [n("python", "app.domain.events.DomainEvent")] },
  {
    name: "DomainEventDispatcher",
    bindings: [
      n("node", "<project>/domain/events DomainEventDispatcher"),
      n("python", "app.domain.events.DomainEventDispatcher"),
    ],
  },
  { name: "DomainException", bindings: [n("dotnet", "<project>.Domain.Common.DomainException")] },
  {
    name: "Enum",
    bindings: [
      n(
        "dotnet",
        "the generated namespace <project>.Domain.Enums, where an aggregate Enum would live",
      ),
    ],
  },
  {
    name: "Errors",
    bindings: [
      n("node", "the generated module domain/errors.ts"),
      n("python", "the generated module app/domain/errors.py"),
    ],
  },
  {
    name: "Events",
    bindings: [
      n("node", "the generated module domain/events.ts"),
      n("python", "the generated module app/domain/events.py"),
    ],
  },
  {
    name: "ExternHandlerError",
    bindings: [n("node", "<project>/domain/errors ExternHandlerError")],
  },
  {
    name: "FileRef",
    bindings: [n("elixir", "the generated OpenAPI schema module <App>Web.Api.Schemas.FileRef")],
  },
  { name: "ForbiddenError", bindings: [n("node", "<project>/domain/errors ForbiddenError")] },
  {
    name: "ForbiddenException",
    bindings: [n("dotnet", "<project>.Domain.Common.ForbiddenException")],
  },
  { name: "HTTPException", bindings: [n("node", "hono/http-exception HTTPException")] },
  { name: "HttpMetrics", bindings: [n("dotnet", "<project>.Observability.HttpMetrics")] },
  {
    name: "Id",
    bindings: [
      n(
        "dotnet",
        "the generated namespace <project>.Domain.Ids, where an aggregate Id would live (and its own Id member)",
      ),
    ],
  },
  {
    name: "Ids",
    bindings: [
      n("node", "the generated module domain/ids.ts"),
      n("python", "the generated module app/domain/ids.py"),
    ],
  },
  { name: "InitErrorDetails", bindings: [n("python", "pydantic_core.InitErrorDetails")] },
  { name: "IntegrityError", bindings: [n("python", "sqlalchemy.exc.IntegrityError")] },
  { name: "JSON", bindings: [n("node", "the TypeScript global JSON")] },
  { name: "Math", bindings: [n("node", "the TypeScript global Math")] },
  { name: "NodePgDatabase", bindings: [n("node", "drizzle-orm/node-postgres NodePgDatabase")] },
  {
    name: "NoopDomainEventDispatcher",
    bindings: [n("python", "app.domain.events.NoopDomainEventDispatcher")],
  },
  { name: "Number", bindings: [n("node", "the TypeScript global Number")] },
  { name: "Object", bindings: [n("node", "the TypeScript global Object")] },
  { name: "OpenAPIHono", bindings: [n("node", "@hono/zod-openapi OpenAPIHono")] },
  { name: "OpenTelemetry", bindings: [n("dotnet", "the OpenTelemetry namespace")] },
  { name: "PROBLEM_JSON", bindings: [n("python", "app.http.problem.PROBLEM_JSON")] },
  { name: "PagedResult", bindings: [n("python", "app.domain.paging.PagedResult")] },
  { name: "Paging", bindings: [n("python", "the generated module app/domain/paging.py")] },
  { name: "Path", bindings: [n("python", "pathlib.Path")] },
  {
    name: "Persistence",
    bindings: [n("dotnet", "the generated namespace <project>.Infrastructure.Persistence")],
  },
  {
    name: "ProblemDetails",
    bindings: [
      n("node", "<project>/problem-details ProblemDetails"),
      n("python", "app.http.problem.ProblemDetails"),
      n("elixir", "<project>.ProblemDetails"),
    ],
  },
  { name: "ProblemDetailsError", bindings: [n("dotnet", "<project>.Api.ProblemDetailsError")] },
  { name: "Promise", bindings: [n("node", "the TypeScript global Promise")] },
  { name: "Protocol", bindings: [n("python", "typing.Protocol")] },
  { name: "PydanticCustomError", bindings: [n("python", "pydantic_core.PydanticCustomError")] },
  { name: "Query", bindings: [n("python", "fastapi.Query")] },
  { name: "Record", bindings: [n("node", "the TypeScript global Record")] },
  {
    name: "RepositoryPorts",
    bindings: [n("python", "the generated module app/domain/repository_ports.py")],
  },
  { name: "Request", bindings: [n("python", "fastapi.Request")] },
  { name: "RequestContext", bindings: [n("dotnet", "<project>.Domain.Common.RequestContext")] },
  { name: "Response", bindings: [n("python", "fastapi.Response")] },
  { name: "RootModel", bindings: [n("python", "pydantic.RootModel")] },
  { name: "String", bindings: [n("node", "the TypeScript global String")] },
  { name: "Symbol", bindings: [n("node", "the TypeScript global Symbol")] },
  {
    name: "System",
    bindings: [
      n("dotnet", "the BCL root namespace System, which the generated units spell as a qualifier"),
    ],
  },
  { name: "UuidString", bindings: [n("node", "<project>/problem-details UuidString")] },
  { name: "ValidationError", bindings: [n("python", "pydantic.ValidationError")] },
  { name: "ValueError", bindings: [n("python", "builtins.ValueError")] },
  {
    name: "ValueObject",
    bindings: [
      n(
        "dotnet",
        "the generated namespace <project>.Domain.ValueObjects, where an aggregate ValueObject would live",
      ),
    ],
  },
  {
    name: "ValueObjects",
    bindings: [n("python", "the generated module app/domain/value_objects.py")],
  },
  {
    name: "WireFormatException",
    bindings: [n("dotnet", "<project>.Domain.Common.WireFormatException")],
  },
];

/** A name a `context` may not take, and why.  Unlike the type entries these
 *  are refused for LANGUAGE ambiguity, not for a clash in generated code, so
 *  they need no compile proof: the `.ddd` spelling itself would read two ways. */
export interface ReservedContextName {
  readonly name: string;
  readonly reason: string;
}

export const RESERVED_CONTEXT_NAMES: readonly ReservedContextName[] = [
  {
    name: "permissions",
    reason:
      "`<Context>.permissions.<name>` is the qualified spelling of a context's permission, so a context named `permissions` would make `permissions.<x>` read two ways",
  },
];

/** The reserved-context entry for `name`, when a context may not take it. */
export function reservedContextName(name: string): ReservedContextName | undefined {
  return RESERVED_CONTEXT_NAMES.find((e) => e.name === name);
}

const BY_NAME: ReadonlyMap<string, ReservedTypeName> = new Map(
  RESERVED_TYPE_NAMES.map((e) => [e.name, e]),
);

/** The table entry for `name`, when a domain type may not take it. */
export function reservedTypeName(name: string): ReservedTypeName | undefined {
  return BY_NAME.get(name);
}
