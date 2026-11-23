// The names the GENERATED code binds, which a domain type may not take.
//
// A backend that can spell a clashing platform name another way does, and
// binds nothing here: the Java units import each type by its single name and
// spell a platform type fully qualified where a type of the model's shares its
// simple name; the python and node import finalizers alias the framework side
// of a clash; the .NET units spell a taken BCL or project name `global::`.
// What remains falls in three categories (`ReservedCategory`):
//   - `language`: a language-level global every module sees and the emitted
//     code calls (the TypeScript `Promise`), which no emitter can re-spell;
//   - `generated`: a generated type, module file or member the model's types
//     share a namespace with (`app/domain/errors.py` beside a domain `Errors`,
//     the .NET factory member `Create`);
//   - `import-style`: a name an emitter still spells bare where it could alias
//     it — parked work, so the entry carries an expiring `deferral`.
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
//     the language-level names they mention, and the runtime's own names in
//     `src/generator/_symbols/runtime-names/`) and requires each one to be in
//     this table or in its admitted list;
//   - `test/e2e/reserved-type-names-proof.test.ts` (opt-in,
//     `LOOM_RESERVED_NAMES_PROOF=1`) generates one model per entry with the
//     refusal ignored and requires it to break the build of every target the
//     entry lists, and compiles every admitted name as a value object, an
//     aggregate, an event and an enum on each backend.
//
// The table names only types: it applies to the declarations that become a
// generated type (aggregate, entity, valueobject, enum, event, the payload
// records, domainService).  Pure module roots (an Elixir context named `Repo`)
// are a separate question this table does not answer.

/** A backend whose generated code binds a reserved name. */
export type ReservedTypeTarget = "node" | "dotnet" | "java" | "python" | "elixir";

/** Why no emitter can step around a reserved name (see the header). */
export type ReservedCategory = "language" | "generated" | "import-style";

/** One binding of a reserved name in one target's generated code. */
export interface ReservedTypeBinding {
  readonly target: ReservedTypeTarget;
  /** What binds the name there — the global, or the generated type, module or
   *  member — spelled fully qualified. */
  readonly binder: string;
}

/** Parked work behind an `import-style` entry: the emitter fix that frees the
 *  name, the date the deferral is due, and the open issue it waits on.
 *  `test/system/reserved-type-names.test.ts` fails it once `reviewUntil`
 *  passes, once it is parked more than 60 days out, and once `blockedBy` is no
 *  longer a live fence. */
export interface ReservedDeferral {
  readonly deferred: string;
  readonly reviewUntil: string;
  readonly blockedBy: string;
}

export interface ReservedTypeName {
  readonly name: string;
  readonly category: ReservedCategory;
  readonly bindings: readonly ReservedTypeBinding[];
  /** Present exactly on an `import-style` entry. */
  readonly deferral?: ReservedDeferral;
}

const n = (target: ReservedTypeTarget, binder: string): ReservedTypeBinding => ({ target, binder });

const tsGlobal = (name: string): ReservedTypeName => ({
  name,
  category: "language",
  bindings: [n("node", `the TypeScript global ${name}, which the emitted code calls`)],
});

const domainModule = (
  name: string,
  nodeFile: string | undefined,
  pyFile: string,
): ReservedTypeName => ({
  name,
  category: "generated",
  bindings: [
    ...(nodeFile
      ? [n("node", `the generated module ${nodeFile}, which an aggregate ${name} would write`)]
      : []),
    n("python", `the generated module ${pyFile}, which an aggregate ${name} would write`),
  ],
});

const EVENTS_MODULE: Readonly<Partial<Record<ReservedTypeTarget, string>>> = {
  node: "domain/events.ts",
  python: "app/domain/events.py",
  java: "<project>.domain.events",
};

/** A runtime name the generated events module declares beside the context's
 *  event classes, so an event of that name is a second declaration there. */
const eventsRuntime = (
  name: string,
  targets: readonly ReservedTypeTarget[],
  what: string,
): ReservedTypeName => ({
  name,
  category: "generated",
  bindings: targets.map((t) =>
    n(
      t,
      `${name}, ${what}, declared in the generated events module ${EVENTS_MODULE[t]} beside every event`,
    ),
  ),
});

export const RESERVED_TYPE_NAMES: readonly ReservedTypeName[] = [
  {
    name: "Bus",
    category: "generated",
    bindings: [n("elixir", "the generated context bus module <App>.<Context>.Bus")],
  },
  {
    name: "Create",
    category: "generated",
    bindings: [
      n(
        "dotnet",
        "the generated factory method Create, which a type of that name cannot hold as a member (CS0542)",
      ),
    ],
  },
  tsGlobal("Date"),
  {
    name: "Dispatch",
    category: "generated",
    bindings: [n("elixir", "the generated context dispatch module <App>.<Context>.Dispatch")],
  },
  eventsRuntime(
    "DomainEvent",
    ["node", "python", "java"],
    "the type every event of the context has",
  ),
  eventsRuntime("DomainEventDispatcher", ["node", "python"], "the dispatcher boundary"),
  domainModule("Errors", "domain/errors.ts", "app/domain/errors.py"),
  domainModule("Events", "domain/events.ts", "app/domain/events.py"),
  {
    name: "FileRef",
    category: "generated",
    bindings: [n("elixir", "the generated OpenAPI schema module <App>Web.Api.Schemas.FileRef")],
  },
  {
    name: "Id",
    category: "generated",
    bindings: [
      n(
        "dotnet",
        "the generated Id member of every aggregate, which a type of that name cannot hold (CS0542)",
      ),
    ],
  },
  domainModule("Ids", "domain/ids.ts", "app/domain/ids.py"),
  tsGlobal("JSON"),
  tsGlobal("Math"),
  eventsRuntime("NoopDomainEventDispatcher", ["python"], "the default dispatcher"),
  tsGlobal("Number"),
  tsGlobal("Object"),
  domainModule("Paging", undefined, "app/domain/paging.py"),
  eventsRuntime("PostCommitDispatcher", ["python"], "the post-commit dispatcher"),
  {
    name: "ProblemDetails",
    category: "generated",
    bindings: [n("elixir", "the generated module <App>.ProblemDetails")],
  },
  tsGlobal("Promise"),
  tsGlobal("Record"),
  domainModule("RepositoryPorts", undefined, "app/domain/repository_ports.py"),
  tsGlobal("String"),
  tsGlobal("Symbol"),
  domainModule("ValueObjects", undefined, "app/domain/value_objects.py"),
  {
    name: "WaitForDatabaseAsync",
    category: "generated",
    bindings: [
      n(
        "dotnet",
        "the top-level local function Program.WaitForDatabaseAsync (DOTNET_RUNTIME.waitForDatabase), which every unit of the project sees (CS8801)",
      ),
    ],
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
