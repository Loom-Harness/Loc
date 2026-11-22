// The names the GENERATED code binds, which a domain type may not take.
//
// A backend imports framework and runtime types by simple name into the same
// compilation units that import the model's types: Spring Data's `Page` beside
// the controllers' domain types, FastAPI's `Request` in every route module, the
// TypeScript global `Promise` in every repository port.  A domain type of the
// same name makes two bindings of one simple name — the unit fails to build,
// or the import wins and a field silently takes the framework type.
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
  { name: "Access", bindings: [n("java", "jakarta.persistence.Access")] },
  { name: "AccessType", bindings: [n("java", "jakarta.persistence.AccessType")] },
  {
    name: "AggregateNotFoundError",
    bindings: [
      n("node", "<project>/domain/errors AggregateNotFoundError"),
      n("python", "app.domain.errors.AggregateNotFoundError"),
    ],
  },
  {
    name: "AggregateNotFoundException",
    bindings: [n("java", "<project>.domain.common.AggregateNotFoundException")],
  },
  { name: "Annotated", bindings: [n("python", "typing.Annotated")] },
  { name: "AnyPgColumn", bindings: [n("node", "drizzle-orm/pg-core AnyPgColumn")] },
  {
    name: "ApplicationEventPublisher",
    bindings: [n("java", "org.springframework.context.ApplicationEventPublisher")],
  },
  { name: "ArithmeticException", bindings: [n("java", "java.lang.ArithmeticException")] },
  { name: "Array", bindings: [n("dotnet", "System.Array")] },
  { name: "ArrayList", bindings: [n("java", "java.util.ArrayList")] },
  { name: "AssociationOverride", bindings: [n("java", "jakarta.persistence.AssociationOverride")] },
  {
    name: "AssociationOverrides",
    bindings: [n("java", "jakarta.persistence.AssociationOverrides")],
  },
  { name: "AsyncSession", bindings: [n("python", "sqlalchemy.ext.asyncio.AsyncSession")] },
  { name: "AttributeConverter", bindings: [n("java", "jakarta.persistence.AttributeConverter")] },
  { name: "AttributeNode", bindings: [n("java", "jakarta.persistence.AttributeNode")] },
  { name: "AttributeOverride", bindings: [n("java", "jakarta.persistence.AttributeOverride")] },
  { name: "AttributeOverrides", bindings: [n("java", "jakarta.persistence.AttributeOverrides")] },
  { name: "AutoCloseable", bindings: [n("java", "java.lang.AutoCloseable")] },
  { name: "Base", bindings: [n("python", "app.db.schema.Base")] },
  { name: "BaseModel", bindings: [n("python", "pydantic.BaseModel")] },
  { name: "Basic", bindings: [n("java", "jakarta.persistence.Basic")] },
  { name: "BigDecimal", bindings: [n("java", "java.math.BigDecimal")] },
  { name: "Boolean", bindings: [n("java", "java.lang.Boolean")] },
  { name: "Byte", bindings: [n("java", "java.lang.Byte")] },
  { name: "Cache", bindings: [n("java", "jakarta.persistence.Cache")] },
  { name: "CacheRetrieveMode", bindings: [n("java", "jakarta.persistence.CacheRetrieveMode")] },
  { name: "CacheStoreMode", bindings: [n("java", "jakarta.persistence.CacheStoreMode")] },
  { name: "Cacheable", bindings: [n("java", "org.springframework.cache.annotation.Cacheable")] },
  { name: "CalendarDate", bindings: [n("python", "datetime.date (imported as CalendarDate)")] },
  { name: "CascadeType", bindings: [n("java", "jakarta.persistence.CascadeType")] },
  { name: "CatalogLog", bindings: [n("java", "<project>.config.CatalogLog")] },
  { name: "CharSequence", bindings: [n("java", "java.lang.CharSequence")] },
  { name: "CheckConstraint", bindings: [n("java", "jakarta.persistence.CheckConstraint")] },
  { name: "Class", bindings: [n("java", "java.lang.Class")] },
  { name: "ClassCastException", bindings: [n("java", "java.lang.ClassCastException")] },
  { name: "CollectionTable", bindings: [n("java", "jakarta.persistence.CollectionTable")] },
  { name: "Column", bindings: [n("java", "jakarta.persistence.Column")] },
  { name: "ColumnResult", bindings: [n("java", "jakarta.persistence.ColumnResult")] },
  { name: "Comparable", bindings: [n("java", "java.lang.Comparable")] },
  {
    name: "ConcurrencyError",
    bindings: [
      n("node", "<project>/domain/errors ConcurrencyError"),
      n("python", "app.domain.errors.ConcurrencyError"),
    ],
  },
  { name: "ConnectionConsumer", bindings: [n("java", "jakarta.persistence.ConnectionConsumer")] },
  { name: "ConnectionFunction", bindings: [n("java", "jakarta.persistence.ConnectionFunction")] },
  { name: "ConstraintMode", bindings: [n("java", "jakarta.persistence.ConstraintMode")] },
  { name: "ConstructorResult", bindings: [n("java", "jakarta.persistence.ConstructorResult")] },
  { name: "Convert", bindings: [n("java", "jakarta.persistence.Convert")] },
  { name: "Converter", bindings: [n("java", "jakarta.persistence.Converter")] },
  { name: "Converts", bindings: [n("java", "jakarta.persistence.Converts")] },
  {
    name: "Create",
    bindings: [
      n("dotnet", "the generated factory method Create (a member may not share its type name)"),
    ],
  },
  { name: "Date", bindings: [n("node", "the TypeScript global Date")] },
  { name: "DateTime", bindings: [n("dotnet", "System.DateTime")] },
  { name: "Decimal", bindings: [n("node", "decimal.js Decimal"), n("python", "decimal.Decimal")] },
  {
    name: "DeleteMapping",
    bindings: [n("java", "org.springframework.web.bind.annotation.DeleteMapping")],
  },
  { name: "Depends", bindings: [n("python", "fastapi.Depends")] },
  { name: "DisallowedError", bindings: [n("node", "<project>/domain/errors DisallowedError")] },
  {
    name: "DisallowedException",
    bindings: [n("java", "<project>.domain.common.DisallowedException")],
  },
  { name: "DiscriminatorColumn", bindings: [n("java", "jakarta.persistence.DiscriminatorColumn")] },
  { name: "DiscriminatorType", bindings: [n("java", "jakarta.persistence.DiscriminatorType")] },
  { name: "DiscriminatorValue", bindings: [n("java", "jakarta.persistence.DiscriminatorValue")] },
  { name: "DomainError", bindings: [n("node", "<project>/domain/errors DomainError")] },
  {
    name: "DomainEvent",
    bindings: [
      n("java", "<project>.domain.events.DomainEvent"),
      n("python", "app.domain.events.DomainEvent"),
    ],
  },
  {
    name: "DomainEventDispatcher",
    bindings: [
      n("node", "<project>/domain/events DomainEventDispatcher"),
      n("python", "app.domain.events.DomainEventDispatcher"),
    ],
  },
  { name: "DomainException", bindings: [n("java", "<project>.domain.common.DomainException")] },
  { name: "Double", bindings: [n("java", "java.lang.Double")] },
  { name: "ElementCollection", bindings: [n("java", "jakarta.persistence.ElementCollection")] },
  { name: "Embeddable", bindings: [n("java", "jakarta.persistence.Embeddable")] },
  { name: "Embedded", bindings: [n("java", "jakarta.persistence.Embedded")] },
  { name: "EmbeddedId", bindings: [n("java", "jakarta.persistence.EmbeddedId")] },
  { name: "Entity", bindings: [n("java", "jakarta.persistence.Entity")] },
  {
    name: "EntityExistsException",
    bindings: [n("java", "jakarta.persistence.EntityExistsException")],
  },
  { name: "EntityGraph", bindings: [n("java", "jakarta.persistence.EntityGraph")] },
  { name: "EntityListeners", bindings: [n("java", "jakarta.persistence.EntityListeners")] },
  { name: "EntityManager", bindings: [n("java", "jakarta.persistence.EntityManager")] },
  {
    name: "EntityManagerFactory",
    bindings: [n("java", "jakarta.persistence.EntityManagerFactory")],
  },
  {
    name: "EntityNotFoundException",
    bindings: [n("java", "jakarta.persistence.EntityNotFoundException")],
  },
  { name: "EntityResult", bindings: [n("java", "jakarta.persistence.EntityResult")] },
  { name: "EntityTransaction", bindings: [n("java", "jakarta.persistence.EntityTransaction")] },
  { name: "Enum", bindings: [n("java", "java.lang.Enum")] },
  { name: "EnumType", bindings: [n("java", "jakarta.persistence.EnumType")] },
  { name: "Enumerated", bindings: [n("java", "jakarta.persistence.Enumerated")] },
  { name: "EnumeratedValue", bindings: [n("java", "jakarta.persistence.EnumeratedValue")] },
  { name: "Error", bindings: [n("java", "java.lang.Error")] },
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
  { name: "Exception", bindings: [n("java", "java.lang.Exception")] },
  {
    name: "ExcludeDefaultListeners",
    bindings: [n("java", "jakarta.persistence.ExcludeDefaultListeners")],
  },
  {
    name: "ExcludeSuperclassListeners",
    bindings: [n("java", "jakarta.persistence.ExcludeSuperclassListeners")],
  },
  {
    name: "ExternHandlerError",
    bindings: [n("node", "<project>/domain/errors ExternHandlerError")],
  },
  { name: "FetchType", bindings: [n("java", "jakarta.persistence.FetchType")] },
  { name: "FieldResult", bindings: [n("java", "jakarta.persistence.FieldResult")] },
  {
    name: "FileRef",
    bindings: [n("elixir", "the generated OpenAPI schema module <App>Web.Api.Schemas.FileRef")],
  },
  { name: "FindOption", bindings: [n("java", "jakarta.persistence.FindOption")] },
  { name: "Float", bindings: [n("java", "java.lang.Float")] },
  { name: "FlushModeType", bindings: [n("java", "jakarta.persistence.FlushModeType")] },
  { name: "ForbiddenError", bindings: [n("node", "<project>/domain/errors ForbiddenError")] },
  {
    name: "ForbiddenException",
    bindings: [n("java", "<project>.domain.common.ForbiddenException")],
  },
  { name: "ForeignKey", bindings: [n("java", "jakarta.persistence.ForeignKey")] },
  { name: "GeneratedValue", bindings: [n("java", "jakarta.persistence.GeneratedValue")] },
  { name: "GenerationType", bindings: [n("java", "jakarta.persistence.GenerationType")] },
  {
    name: "GetMapping",
    bindings: [n("java", "org.springframework.web.bind.annotation.GetMapping")],
  },
  { name: "Graph", bindings: [n("java", "jakarta.persistence.Graph")] },
  { name: "HTTPException", bindings: [n("node", "hono/http-exception HTTPException")] },
  { name: "HttpMetrics", bindings: [n("dotnet", "<project>.Observability.HttpMetrics")] },
  { name: "Id", bindings: [n("java", "jakarta.persistence.Id")] },
  { name: "IdClass", bindings: [n("java", "jakarta.persistence.IdClass")] },
  {
    name: "Ids",
    bindings: [
      n("node", "the generated module domain/ids.ts"),
      n("python", "the generated module app/domain/ids.py"),
    ],
  },
  { name: "IllegalArgumentException", bindings: [n("java", "java.lang.IllegalArgumentException")] },
  { name: "IllegalStateException", bindings: [n("java", "java.lang.IllegalStateException")] },
  { name: "Index", bindings: [n("java", "jakarta.persistence.Index")] },
  { name: "Inheritance", bindings: [n("java", "jakarta.persistence.Inheritance")] },
  { name: "InheritanceType", bindings: [n("java", "jakarta.persistence.InheritanceType")] },
  {
    name: "InitBinder",
    bindings: [n("java", "org.springframework.web.bind.annotation.InitBinder")],
  },
  { name: "InitErrorDetails", bindings: [n("python", "pydantic_core.InitErrorDetails")] },
  { name: "Instant", bindings: [n("java", "java.time.Instant")] },
  { name: "Integer", bindings: [n("java", "java.lang.Integer")] },
  { name: "IntegrityError", bindings: [n("python", "sqlalchemy.exc.IntegrityError")] },
  { name: "InterruptedException", bindings: [n("java", "java.lang.InterruptedException")] },
  { name: "Iterable", bindings: [n("java", "java.lang.Iterable")] },
  { name: "JSON", bindings: [n("node", "the TypeScript global JSON")] },
  { name: "JdbcTypeCode", bindings: [n("java", "org.hibernate.annotations.JdbcTypeCode")] },
  { name: "JoinColumn", bindings: [n("java", "jakarta.persistence.JoinColumn")] },
  { name: "JoinColumns", bindings: [n("java", "jakarta.persistence.JoinColumns")] },
  { name: "JoinTable", bindings: [n("java", "jakarta.persistence.JoinTable")] },
  {
    name: "JpaRepository",
    bindings: [n("java", "org.springframework.data.jpa.repository.JpaRepository")],
  },
  { name: "List", bindings: [n("java", "java.util.List")] },
  { name: "Lob", bindings: [n("java", "jakarta.persistence.Lob")] },
  { name: "LocalDate", bindings: [n("java", "java.time.LocalDate")] },
  { name: "LockModeType", bindings: [n("java", "jakarta.persistence.LockModeType")] },
  { name: "LockOption", bindings: [n("java", "jakarta.persistence.LockOption")] },
  {
    name: "LockTimeoutException",
    bindings: [n("java", "jakarta.persistence.LockTimeoutException")],
  },
  { name: "Long", bindings: [n("java", "java.lang.Long")] },
  { name: "ManyToMany", bindings: [n("java", "jakarta.persistence.ManyToMany")] },
  { name: "ManyToOne", bindings: [n("java", "jakarta.persistence.ManyToOne")] },
  { name: "MapKey", bindings: [n("java", "jakarta.persistence.MapKey")] },
  { name: "MapKeyClass", bindings: [n("java", "jakarta.persistence.MapKeyClass")] },
  { name: "MapKeyColumn", bindings: [n("java", "jakarta.persistence.MapKeyColumn")] },
  { name: "MapKeyEnumerated", bindings: [n("java", "jakarta.persistence.MapKeyEnumerated")] },
  { name: "MapKeyJoinColumn", bindings: [n("java", "jakarta.persistence.MapKeyJoinColumn")] },
  { name: "MapKeyJoinColumns", bindings: [n("java", "jakarta.persistence.MapKeyJoinColumns")] },
  { name: "MapKeyTemporal", bindings: [n("java", "jakarta.persistence.MapKeyTemporal")] },
  { name: "MappedSuperclass", bindings: [n("java", "jakarta.persistence.MappedSuperclass")] },
  { name: "MapsId", bindings: [n("java", "jakarta.persistence.MapsId")] },
  {
    name: "Math",
    bindings: [n("node", "the TypeScript global Math"), n("java", "java.lang.Math")],
  },
  { name: "Modifying", bindings: [n("java", "org.springframework.data.jpa.repository.Modifying")] },
  { name: "Module", bindings: [n("java", "java.lang.Module")] },
  { name: "NamedAttributeNode", bindings: [n("java", "jakarta.persistence.NamedAttributeNode")] },
  { name: "NamedEntityGraph", bindings: [n("java", "jakarta.persistence.NamedEntityGraph")] },
  { name: "NamedEntityGraphs", bindings: [n("java", "jakarta.persistence.NamedEntityGraphs")] },
  { name: "NamedNativeQueries", bindings: [n("java", "jakarta.persistence.NamedNativeQueries")] },
  { name: "NamedNativeQuery", bindings: [n("java", "jakarta.persistence.NamedNativeQuery")] },
  { name: "NamedQueries", bindings: [n("java", "jakarta.persistence.NamedQueries")] },
  { name: "NamedQuery", bindings: [n("java", "jakarta.persistence.NamedQuery")] },
  {
    name: "NamedStoredProcedureQueries",
    bindings: [n("java", "jakarta.persistence.NamedStoredProcedureQueries")],
  },
  {
    name: "NamedStoredProcedureQuery",
    bindings: [n("java", "jakarta.persistence.NamedStoredProcedureQuery")],
  },
  { name: "NamedSubgraph", bindings: [n("java", "jakarta.persistence.NamedSubgraph")] },
  { name: "NoResultException", bindings: [n("java", "jakarta.persistence.NoResultException")] },
  { name: "NodePgDatabase", bindings: [n("node", "drizzle-orm/node-postgres NodePgDatabase")] },
  {
    name: "NonUniqueResultException",
    bindings: [n("java", "jakarta.persistence.NonUniqueResultException")],
  },
  {
    name: "NoopDomainEventDispatcher",
    bindings: [n("python", "app.domain.events.NoopDomainEventDispatcher")],
  },
  {
    name: "NotImplementedException",
    bindings: [n("java", "<project>.domain.common.NotImplementedException")],
  },
  { name: "NullPointerException", bindings: [n("java", "java.lang.NullPointerException")] },
  {
    name: "Number",
    bindings: [n("node", "the TypeScript global Number"), n("java", "java.lang.Number")],
  },
  { name: "NumberFormatException", bindings: [n("java", "java.lang.NumberFormatException")] },
  {
    name: "Object",
    bindings: [n("node", "the TypeScript global Object"), n("java", "java.lang.Object")],
  },
  {
    name: "ObjectOptimisticLockingFailureException",
    bindings: [n("java", "org.springframework.orm.ObjectOptimisticLockingFailureException")],
  },
  { name: "OneToMany", bindings: [n("java", "jakarta.persistence.OneToMany")] },
  { name: "OneToOne", bindings: [n("java", "jakarta.persistence.OneToOne")] },
  { name: "OpenAPIHono", bindings: [n("node", "@hono/zod-openapi OpenAPIHono")] },
  { name: "OpenTelemetry", bindings: [n("dotnet", "the OpenTelemetry namespace")] },
  {
    name: "OptimisticLockException",
    bindings: [n("java", "jakarta.persistence.OptimisticLockException")],
  },
  { name: "Optional", bindings: [n("java", "java.util.Optional")] },
  { name: "OrderBy", bindings: [n("java", "jakarta.persistence.OrderBy")] },
  { name: "OrderColumn", bindings: [n("java", "jakarta.persistence.OrderColumn")] },
  { name: "Override", bindings: [n("java", "java.lang.Override")] },
  { name: "PROBLEM_JSON", bindings: [n("python", "app.http.problem.PROBLEM_JSON")] },
  { name: "Package", bindings: [n("java", "java.lang.Package")] },
  { name: "Page", bindings: [n("java", "org.springframework.data.domain.Page")] },
  { name: "PageRequest", bindings: [n("java", "org.springframework.data.domain.PageRequest")] },
  { name: "Pageable", bindings: [n("java", "org.springframework.data.domain.Pageable")] },
  { name: "Paged", bindings: [n("java", "<project>.domain.common.Paged")] },
  { name: "PagedResult", bindings: [n("python", "app.domain.paging.PagedResult")] },
  { name: "Paging", bindings: [n("python", "the generated module app/domain/paging.py")] },
  { name: "Param", bindings: [n("java", "org.springframework.data.repository.query.Param")] },
  { name: "Parameter", bindings: [n("java", "jakarta.persistence.Parameter")] },
  { name: "ParameterMode", bindings: [n("java", "jakarta.persistence.ParameterMode")] },
  { name: "Path", bindings: [n("python", "pathlib.Path")] },
  {
    name: "PathVariable",
    bindings: [n("java", "org.springframework.web.bind.annotation.PathVariable")],
  },
  { name: "Persistence", bindings: [n("java", "jakarta.persistence.Persistence")] },
  {
    name: "PersistenceConfiguration",
    bindings: [n("java", "jakarta.persistence.PersistenceConfiguration")],
  },
  { name: "PersistenceContext", bindings: [n("java", "jakarta.persistence.PersistenceContext")] },
  {
    name: "PersistenceContextType",
    bindings: [n("java", "jakarta.persistence.PersistenceContextType")],
  },
  { name: "PersistenceContexts", bindings: [n("java", "jakarta.persistence.PersistenceContexts")] },
  {
    name: "PersistenceException",
    bindings: [n("java", "jakarta.persistence.PersistenceException")],
  },
  { name: "PersistenceProperty", bindings: [n("java", "jakarta.persistence.PersistenceProperty")] },
  { name: "PersistenceUnit", bindings: [n("java", "jakarta.persistence.PersistenceUnit")] },
  {
    name: "PersistenceUnitTransactionType",
    bindings: [n("java", "jakarta.persistence.PersistenceUnitTransactionType")],
  },
  { name: "PersistenceUnitUtil", bindings: [n("java", "jakarta.persistence.PersistenceUnitUtil")] },
  { name: "PersistenceUnits", bindings: [n("java", "jakarta.persistence.PersistenceUnits")] },
  { name: "PersistenceUtil", bindings: [n("java", "jakarta.persistence.PersistenceUtil")] },
  {
    name: "PessimisticLockException",
    bindings: [n("java", "jakarta.persistence.PessimisticLockException")],
  },
  {
    name: "PessimisticLockScope",
    bindings: [n("java", "jakarta.persistence.PessimisticLockScope")],
  },
  { name: "PostLoad", bindings: [n("java", "jakarta.persistence.PostLoad")] },
  {
    name: "PostMapping",
    bindings: [n("java", "org.springframework.web.bind.annotation.PostMapping")],
  },
  { name: "PostPersist", bindings: [n("java", "jakarta.persistence.PostPersist")] },
  { name: "PostRemove", bindings: [n("java", "jakarta.persistence.PostRemove")] },
  { name: "PostUpdate", bindings: [n("java", "jakarta.persistence.PostUpdate")] },
  { name: "PrePersist", bindings: [n("java", "jakarta.persistence.PrePersist")] },
  { name: "PreRemove", bindings: [n("java", "jakarta.persistence.PreRemove")] },
  { name: "PreUpdate", bindings: [n("java", "jakarta.persistence.PreUpdate")] },
  {
    name: "PrimaryKeyJoinColumn",
    bindings: [n("java", "jakarta.persistence.PrimaryKeyJoinColumn")],
  },
  {
    name: "PrimaryKeyJoinColumns",
    bindings: [n("java", "jakarta.persistence.PrimaryKeyJoinColumns")],
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
  { name: "Process", bindings: [n("java", "java.lang.Process")] },
  { name: "ProcessHandle", bindings: [n("java", "java.lang.ProcessHandle")] },
  { name: "Promise", bindings: [n("node", "the TypeScript global Promise")] },
  { name: "Protocol", bindings: [n("python", "typing.Protocol")] },
  { name: "PydanticCustomError", bindings: [n("python", "pydantic_core.PydanticCustomError")] },
  {
    name: "Query",
    bindings: [
      n("java", "org.springframework.data.jpa.repository.Query"),
      n("python", "fastapi.Query"),
    ],
  },
  { name: "QueryHint", bindings: [n("java", "jakarta.persistence.QueryHint")] },
  {
    name: "QueryTimeoutException",
    bindings: [n("java", "jakarta.persistence.QueryTimeoutException")],
  },
  {
    name: "Record",
    bindings: [n("node", "the TypeScript global Record"), n("java", "java.lang.Record")],
  },
  { name: "RefreshOption", bindings: [n("java", "jakarta.persistence.RefreshOption")] },
  { name: "Repository", bindings: [n("java", "jakarta.persistence.Repository")] },
  {
    name: "RepositoryPorts",
    bindings: [n("python", "the generated module app/domain/repository_ports.py")],
  },
  { name: "Request", bindings: [n("python", "fastapi.Request")] },
  {
    name: "RequestBody",
    bindings: [n("java", "org.springframework.web.bind.annotation.RequestBody")],
  },
  { name: "RequestContext", bindings: [n("dotnet", "<project>.Domain.Common.RequestContext")] },
  {
    name: "RequestHeader",
    bindings: [n("java", "org.springframework.web.bind.annotation.RequestHeader")],
  },
  {
    name: "RequestMapping",
    bindings: [n("java", "org.springframework.web.bind.annotation.RequestMapping")],
  },
  {
    name: "RequestParam",
    bindings: [n("java", "org.springframework.web.bind.annotation.RequestParam")],
  },
  { name: "Response", bindings: [n("python", "fastapi.Response")] },
  {
    name: "ResponseStatus",
    bindings: [n("java", "org.springframework.web.bind.annotation.ResponseStatus")],
  },
  {
    name: "RestController",
    bindings: [n("java", "org.springframework.web.bind.annotation.RestController")],
  },
  { name: "RollbackException", bindings: [n("java", "jakarta.persistence.RollbackException")] },
  { name: "RootModel", bindings: [n("python", "pydantic.RootModel")] },
  { name: "Runnable", bindings: [n("java", "java.lang.Runnable")] },
  { name: "Runtime", bindings: [n("java", "java.lang.Runtime")] },
  { name: "RuntimeException", bindings: [n("java", "java.lang.RuntimeException")] },
  { name: "SchemaManager", bindings: [n("java", "jakarta.persistence.SchemaManager")] },
  {
    name: "SchemaValidationException",
    bindings: [n("java", "jakarta.persistence.SchemaValidationException")],
  },
  { name: "SecondaryTable", bindings: [n("java", "jakarta.persistence.SecondaryTable")] },
  { name: "SecondaryTables", bindings: [n("java", "jakarta.persistence.SecondaryTables")] },
  { name: "SequenceGenerator", bindings: [n("java", "jakarta.persistence.SequenceGenerator")] },
  { name: "SequenceGenerators", bindings: [n("java", "jakarta.persistence.SequenceGenerators")] },
  { name: "Service", bindings: [n("java", "org.springframework.stereotype.Service")] },
  { name: "SharedCacheMode", bindings: [n("java", "jakarta.persistence.SharedCacheMode")] },
  { name: "Short", bindings: [n("java", "java.lang.Short")] },
  { name: "Sort", bindings: [n("java", "org.springframework.data.domain.Sort")] },
  { name: "SqlResultSetMapping", bindings: [n("java", "jakarta.persistence.SqlResultSetMapping")] },
  {
    name: "SqlResultSetMappings",
    bindings: [n("java", "jakarta.persistence.SqlResultSetMappings")],
  },
  { name: "SqlTypes", bindings: [n("java", "org.hibernate.type.SqlTypes")] },
  {
    name: "StoredProcedureParameter",
    bindings: [n("java", "jakarta.persistence.StoredProcedureParameter")],
  },
  {
    name: "StoredProcedureQuery",
    bindings: [n("java", "jakarta.persistence.StoredProcedureQuery")],
  },
  {
    name: "String",
    bindings: [n("node", "the TypeScript global String"), n("java", "java.lang.String")],
  },
  { name: "StringBuilder", bindings: [n("java", "java.lang.StringBuilder")] },
  { name: "Subgraph", bindings: [n("java", "jakarta.persistence.Subgraph")] },
  { name: "SuppressWarnings", bindings: [n("java", "java.lang.SuppressWarnings")] },
  { name: "Symbol", bindings: [n("node", "the TypeScript global Symbol")] },
  { name: "SynchronizationType", bindings: [n("java", "jakarta.persistence.SynchronizationType")] },
  { name: "System", bindings: [n("java", "java.lang.System")] },
  { name: "Table", bindings: [n("java", "jakarta.persistence.Table")] },
  { name: "TableGenerator", bindings: [n("java", "jakarta.persistence.TableGenerator")] },
  { name: "TableGenerators", bindings: [n("java", "jakarta.persistence.TableGenerators")] },
  { name: "Temporal", bindings: [n("java", "jakarta.persistence.Temporal")] },
  { name: "TemporalType", bindings: [n("java", "jakarta.persistence.TemporalType")] },
  { name: "Thread", bindings: [n("java", "java.lang.Thread")] },
  { name: "ThreadLocal", bindings: [n("java", "java.lang.ThreadLocal")] },
  { name: "Throwable", bindings: [n("java", "java.lang.Throwable")] },
  { name: "Timeout", bindings: [n("java", "jakarta.persistence.Timeout")] },
  {
    name: "TransactionRequiredException",
    bindings: [n("java", "jakarta.persistence.TransactionRequiredException")],
  },
  {
    name: "Transactional",
    bindings: [n("java", "org.springframework.transaction.annotation.Transactional")],
  },
  { name: "Transient", bindings: [n("java", "jakarta.persistence.Transient")] },
  { name: "Tuple", bindings: [n("java", "jakarta.persistence.Tuple")] },
  { name: "TupleElement", bindings: [n("java", "jakarta.persistence.TupleElement")] },
  { name: "TypedQuery", bindings: [n("java", "jakarta.persistence.TypedQuery")] },
  { name: "TypedQueryReference", bindings: [n("java", "jakarta.persistence.TypedQueryReference")] },
  { name: "UUID", bindings: [n("java", "java.util.UUID")] },
  { name: "UniqueConstraint", bindings: [n("java", "jakarta.persistence.UniqueConstraint")] },
  {
    name: "UnsupportedOperationException",
    bindings: [n("java", "java.lang.UnsupportedOperationException")],
  },
  { name: "UuidString", bindings: [n("node", "<project>/problem-details UuidString")] },
  { name: "ValidationError", bindings: [n("python", "pydantic.ValidationError")] },
  { name: "ValidationMode", bindings: [n("java", "jakarta.persistence.ValidationMode")] },
  { name: "ValueError", bindings: [n("python", "builtins.ValueError")] },
  { name: "ValueObject", bindings: [n("java", "org.jmolecules.ddd.annotation.ValueObject")] },
  {
    name: "ValueObjects",
    bindings: [n("python", "the generated module app/domain/value_objects.py")],
  },
  { name: "Version", bindings: [n("java", "jakarta.persistence.Version")] },
  { name: "Void", bindings: [n("java", "java.lang.Void")] },
  {
    name: "WireFormatException",
    bindings: [n("java", "<project>.domain.common.WireFormatException")],
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
