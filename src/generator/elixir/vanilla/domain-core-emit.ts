import type {
  AggregateIR,
  BoundedContextIR,
  EnrichedAggregateIR,
  ExprIR,
  FunctionIR,
  OperationIR,
  StmtIR,
  SystemIR,
  TestIR,
} from "../../../ir/types/loom-ir.js";
import { walkExprDeep, walkStmtExprsDeep } from "../../../ir/util/walk.js";
import { escapeElixirIdent, snake, upperFirst } from "../../../util/naming.js";
import { opUsesCurrentUser, stmtUsesParam } from "../domain/predicates.js";
import { type RenderCtx, renderExpr } from "../render-expr.js";
import { denialTerm, guardRaiseLine } from "./denial.js";
import { isVanillaDocAgg } from "./document-emit.js";
import { isEventSourced } from "./eventsourced-emit.js";
import { bodyUsesParam, bodyUsesReceiver, renderFunctionBodyLines } from "./function-emit.js";
import {
  isReturningOperation,
  renderPrivateOpHelpers,
  renderReturningStmt,
} from "./operation-returns-emit.js";

// ---------------------------------------------------------------------------
// Pure domain core for the vanilla (Ecto/Phoenix) aggregate module — the seam
// that makes generated domain `test "..."` blocks run as plain ExUnit WITHOUT a
// database (the elixir parity story; docs/audits/test-parity-generated-backends.md).
//
// The other four backends generate a rich-domain object whose factory + methods
// validate in memory, separable from persistence; the Loom `test` idiom
// (construct → call method → assert / catch throw) maps onto it 1:1.  Vanilla's
// context facade folds persistence in (`create_<agg>` → `Repo.insert`,
// `<op>_<agg>` → `persist_change`), so a literal port would need a DB.  But the
// rule layer underneath is already pure:
//
//   * invariants live in `<Agg>Changeset.base_changeset/2` — pure Ecto;
//   * a named-op precondition `raise`s BEFORE the persist tail;
//   * a `field := value` body re-binds `record = %{record | field: value}` in
//     memory (the persist tail only `put_change`s afterwards).
//
// So we expose that pure core as functions on the aggregate module:
//
//   def create(attrs)        :: {:ok, t} | {:error, Ecto.Changeset.t()}
//        = base_changeset(%__MODULE__{}, attrs) |> Ecto.Changeset.apply_action(:insert)
//   def <op>(record, params) :: t   (raises on a failed precondition)
//        = the op body's preconditions + in-memory mutations, returning the
//          updated struct — EMIT and persistence stripped (effects, not domain
//          state), so the core stays Repo-free.
//
// Verified DB-free in an Elixir/Ecto container (apply_action runs validations +
// applies changes with no Repo; the precondition raise fires before any persist).
// Additive: the context's persisting `create_<agg>` / `<op>_<agg>` are untouched,
// so no existing vanilla runtime / build / conformance behaviour changes.
// ---------------------------------------------------------------------------

/** Which pure core an aggregate gets — one per persistence shape, because the
 *  in-memory record differs:
 *
 *   * `relational` — the Ecto schema struct; `create/1` runs `base_changeset/2`.
 *   * `document` — the `<Agg>.Data` embed (the domain shape the jsonb blob folds
 *     into) carrying a virtual `id`; `create/1` runs `<Agg>.Data.changeset/2`,
 *     and op bodies render in document struct mode, exactly as the persisted
 *     document op does against `record = row.data`.
 *   * `eventSourced` — the plain `<Agg>` struct; `create/1` and each op run the
 *     command body in memory and fold the emitted events through
 *     `<Agg>Fold.apply_event/2`, the same fold the event store replays.  Rendered
 *     by `renderEventSourcedPureCore` in `eventsourced-emit.ts`. */
export type PureCoreShape = "relational" | "document" | "eventSourced";

export function pureCoreShape(
  agg: AggregateIR,
  ctx: BoundedContextIR,
  sys?: SystemIR,
): PureCoreShape {
  if (isEventSourced(agg)) return "eventSourced";
  return isVanillaDocAgg(agg, ctx, sys) ? "document" : "relational";
}

/** True when the aggregate's pure core must be emitted: it declares its own
 *  `test` blocks, OR some other unit test in the context constructs it.
 *
 *  A test body may legally reach for a SIBLING aggregate — the only way to
 *  exercise a value object holding a cross-aggregate reference (`Berth { ship:
 *  Ship id }` needs a `Ship` to take an id from).  `tests-emit.ts` renders
 *  that `Ship.create(...)` as `<App>.<Ctx>.Ship.create/1` — the pure core —
 *  so gating the core on the aggregate's OWN tests alone left the call naming
 *  a function nothing defined (`Ship.create/1 is undefined` at `mix test`).
 *  Context INTEGRATION tests are excluded: they persist through the context
 *  facade (`create_<agg>`), never the pure core. */
export function needsPureDomainCore(agg: AggregateIR, ctx: BoundedContextIR): boolean {
  return agg.tests.length > 0 || aggregatesCreatedInUnitTests(ctx).has(agg.name);
}

/** Names of the context's aggregates whose `create` a unit-test body (on an
 *  aggregate, value object or domain service) calls — `<Agg>.create(...)`,
 *  the receiver a bare aggregate name.  The same receiver shape `renderCreate`
 *  in `tests-emit.ts` keys the emitted module on. */
function aggregatesCreatedInUnitTests(ctx: BoundedContextIR): Set<string> {
  const aggNames = new Set(ctx.aggregates.map((a) => a.name));
  const created = new Set<string>();
  const visit = (e: ExprIR): void => {
    if (
      e.kind === "method-call" &&
      e.member === "create" &&
      !e.isIntrinsicMatcher &&
      e.receiver.kind === "ref" &&
      aggNames.has(e.receiver.name)
    ) {
      created.add(e.receiver.name);
    }
  };
  const tests: TestIR[] = [
    ...ctx.aggregates.flatMap((a) => a.tests),
    ...ctx.valueObjects.flatMap((v) => v.tests),
    ...ctx.domainServices.flatMap((s) => s.tests),
  ];
  for (const t of tests) {
    for (const s of t.statements) {
      if (s.kind === "expect" || s.kind === "expect-throws") walkExprDeep(s.expr, visit);
      else walkStmtExprsDeep(s, visit);
    }
  }
  return created;
}

/** The pure-core function bodies for one state-persisted aggregate, injected
 *  into its schema module by `schema-emit.ts` (2-space indented, schema-module
 *  body level) — the relational schema module, or a document aggregate's ROOT
 *  module.  Returns `[]` for an event-sourced aggregate, whose core rides its
 *  struct module instead (`renderEventSourcedPureCore`). */
export function renderAggregatePureCore(
  appModule: string,
  ctx: BoundedContextIR,
  agg: AggregateIR,
  sys?: SystemIR,
): string[] {
  const shape = pureCoreShape(agg, ctx, sys);
  if (shape === "eventSourced") return [];
  if (shape === "document") return renderDocumentPureCore(appModule, ctx, agg);
  const ctxModule = upperFirst(ctx.name);
  const changesetMod = `${appModule}.${ctxModule}.${upperFirst(agg.name)}Changeset`;

  // Relational containments (`has_many`) default to `Ecto.Association.NotLoaded`
  // on a freshly-built struct — but the pure-domain path never loads them, and
  // the in-memory op bodies treat a collection as a list (`record.lines ++ [x]`,
  // `Enum.count(record.lines)`).  `NotLoaded` is truthy, so the `|| []` guard in
  // those bodies doesn't catch it → `** (ArgumentError)`.  Initialise every
  // collection containment to `[]` on create so the pure-domain (no-DB) path
  // matches the loaded/persisted shape.  (Embedded `embeds_many` already default
  // to `[]`; the reset is harmless there.)
  const collectionContainments = agg.contains.filter((c) => c.collection).map((c) => snake(c.name));
  //
  // The id is minted up front, the way the persisted path mints it (the schema's
  // `@primary_key {:id, UUIDv7, autogenerate: true}` fills it at `Repo.insert`).
  // `apply_action/2` runs no autogenerate, so without this the in-memory record
  // carried `id: nil` — and a test comparing an id it copied elsewhere
  // (`expect(d.berth.ship == s.id)`) compared `nil == nil` and passed for any
  // value, where the other four backends compare two real ids.
  const fresh = "%__MODULE__{id: UUIDv7.generate()}";
  const createBody =
    collectionContainments.length === 0
      ? [
          `    ${changesetMod}.base_changeset(${fresh}, attrs)`,
          "    |> Ecto.Changeset.apply_action(:insert)",
        ]
      : [
          "    with {:ok, record} <-",
          `           ${changesetMod}.base_changeset(${fresh}, attrs)`,
          "           |> Ecto.Changeset.apply_action(:insert) do",
          `      {:ok, %{record | ${collectionContainments.map((n) => `${n}: []`).join(", ")}}}`,
          "    end",
        ];
  const out: string[] = [
    `  @doc "Pure create core — validates + applies the changeset in memory (no persistence)."`,
    "  def create(attrs) when is_map(attrs) do",
    ...createBody,
    "  end",
  ];
  return [...out, ...renderPureCoreMembers(appModule, ctx, agg, RELATIONAL_STRUCT)];
}

/** How the pure-core members address the in-memory record: the struct every
 *  function head matches on, and whether bodies render in document struct mode. */
export interface PureStruct {
  /** The struct named in every `def …(%<guard>{} = record, …)` head. */
  guard: string;
  /** Document struct mode for the shared body renderers (`RenderCtx.docStruct`). */
  docStruct: boolean;
}

const RELATIONAL_STRUCT: PureStruct = { guard: "__MODULE__", docStruct: false };

/** The `shape: document` pure core, on the aggregate's ROOT module.  The record
 *  is the `<Agg>.Data` embed — the struct the persisted document op binds as
 *  `record = row.data` — so op bodies render through the same struct-mode
 *  renderer, and a test reads `a.title` exactly as it does on every other shape.
 *
 *  The embed has no `id` (`@primary_key false` keeps identity on the root row,
 *  out of the blob), so the minted id is put onto the in-memory record as an
 *  extra key.  It is not added to the schema: the persisted path re-embeds
 *  `Map.from_struct(record)` and merges `row.id` with the embed's fields, and an
 *  `id` field there would put a `nil` over the row's real one. */
function renderDocumentPureCore(
  appModule: string,
  ctx: BoundedContextIR,
  agg: AggregateIR,
): string[] {
  const dataMod = `${appModule}.${upperFirst(ctx.name)}.${upperFirst(agg.name)}.Data`;
  const out: string[] = [
    `  @doc "Pure create core — validates + applies the document embed in memory (no persistence)."`,
    "  def create(attrs) when is_map(attrs) do",
    "    with {:ok, record} <-",
    `           ${dataMod}.changeset(%${dataMod}{}, attrs)`,
    "           |> Ecto.Changeset.apply_action(:insert) do",
    "      {:ok, Map.put(record, :id, UUIDv7.generate())}",
    "    end",
    "  end",
  ];
  return [
    ...out,
    ...renderPureCoreMembers(appModule, ctx, agg, { guard: dataMod, docStruct: true }),
  ];
}

/** The ops, functions, derived accessors and private-op helpers of a pure core —
 *  shared by the relational and document cores, which differ only in the
 *  record's struct and the body render mode. */
function renderPureCoreMembers(
  appModule: string,
  ctx: BoundedContextIR,
  agg: AggregateIR,
  struct: PureStruct,
): string[] {
  const ctxModule = upperFirst(ctx.name);
  const out: string[] = [];
  for (const op of agg.operations) {
    out.push("", ...renderPureOp(appModule, ctxModule, ctx, op, agg, struct));
  }
  // Aggregate `function` members (§11b) — pure helpers the op bodies above may
  // call (`precondition passed()` / a bare `passed()` statement).  The pure core
  // lives ON the aggregate's schema module, so emit the functions here too (the
  // context-facade copy lives in `context-emit.ts`); a `<fn>(record, …)` call
  // then resolves in whichever module the body renders into.  The struct guard
  // is the record's own struct (`%__MODULE__{}` on the relational schema module).
  for (const fn of agg.functions ?? []) {
    out.push("", ...renderPureFunction(`${appModule}.${ctxModule}`, fn, struct));
  }
  // Derived fields (§B18) — an Ecto struct carries no computed field, so a
  // `derived isDraft: bool = …` has no `record.is_draft` to read (the wire path
  // computes it inline).  Expose each PURE derived as an accessor function on the
  // schema module (`def is_draft(record), do: record.status == :Draft`) so a
  // domain `test` can read it exactly like node/java/dotnet/python's getter.
  out.push(
    ...derivedAccessorLines(`${appModule}.${ctxModule}`, agg as EnrichedAggregateIR, struct),
  );
  // `defp __op_<name>/n` for every PRIVATE operation the pure bodies above call
  // (M-T6.55 F24).  The public pure twin `def <op>(record, params)` is emitted
  // just above for the SAME operation, but it takes a params MAP and is the
  // module's own entry point; the helper takes the call site's POSITIONAL
  // arguments, which is what `renderReturningStmt`'s `call` arm renders.
  out.push(
    ...renderPrivateOpHelpers(
      agg.operations ?? [],
      agg,
      ctx,
      `${appModule}.${ctxModule}`,
      agg as EnrichedAggregateIR,
      struct.docStruct,
    ),
  );
  return out;
}

/** The derived-field names that get a pure-core accessor on the aggregate schema
 *  module.  A derived whose expression can't render as a pure struct function
 *  (e.g. it references a repository find) is omitted — no accessor emitted, no
 *  codegen crash.  Shared with `tests-emit.ts` so a domain test reading a derived
 *  routes to `Agg.<derived>(record)` exactly when an accessor exists (and skips
 *  honestly otherwise, rather than emitting a `KeyError`-raising struct read). */
export function pureDerivedAccessorNames(
  contextModule: string,
  agg: EnrichedAggregateIR,
): Set<string> {
  const names = new Set<string>();
  const rc: RenderCtx = { thisName: "record", contextModule, agg };
  for (const d of agg.derived) {
    if (d.name === "inspect") continue; // the synthesized redaction derived (inspect-emit.ts owns it)
    try {
      renderExpr(d.expr, rc);
      names.add(d.name);
    } catch {
      // Non-pure derived — leave it to the wire path; no domain accessor.
    }
  }
  return names;
}

/** `def <derived>(%<struct>{} = record), do: <expr>` lines for each pure derived
 *  (blank-line separated, schema-module body indent), mirroring `pureDerivedAccessorNames`. */
export function derivedAccessorLines(
  contextModule: string,
  agg: EnrichedAggregateIR,
  struct: PureStruct = RELATIONAL_STRUCT,
): string[] {
  const emit = pureDerivedAccessorNames(contextModule, agg);
  const rc: RenderCtx = {
    thisName: "record",
    contextModule,
    agg,
    ...(struct.docStruct ? { docStruct: true } : {}),
  };
  const out: string[] = [];
  for (const d of agg.derived) {
    if (!emit.has(d.name)) continue;
    const body = renderExpr(d.expr, rc);
    out.push(
      "",
      `  @doc "Pure derived \`${d.name}\` — computed from struct state (no persistence)."`,
    );
    // A block-bodied derived — a `match` renders to `cond do … end`, a find /
    // option unwrap to `case … do … end`.  Bare in the one-liner `, do:` keyword
    // form the trailing `do … end` binds to `def` itself, so Elixir sees
    // `def/3` ("undefined function def/3") and won't compile.  Wrapping the block
    // in parens rebinds the `do … end` to the block expression and keeps the
    // keyword-form layout for the simple (single-line) deriveds unchanged.
    const rendered = body.includes("\n") ? `(${body})` : body;
    out.push(`  def ${snake(d.name)}(%${struct.guard}{} = record), do: ${rendered}`);
  }
  return out;
}

/** One `function` member as a `def <fn>(%__MODULE__{} = record, …)` on the
 *  aggregate schema module — the pure-core sibling of `function-emit.ts`'s
 *  context-facade copy. */
export function renderPureFunction(
  facadeMod: string,
  fn: FunctionIR,
  struct: PureStruct = RELATIONAL_STRUCT,
): string[] {
  const fnSnake = snake(fn.name);
  const rc: RenderCtx = {
    thisName: "record",
    contextModule: facadeMod,
    ...(struct.docStruct ? { docStruct: true } : {}),
  };
  const params = fn.params.map((p) =>
    bodyUsesParam(fn.body, p.name) ? snake(p.name) : `_${snake(p.name)}`,
  );
  // Same rule the facade copy applies to its receiver: a body that never reads
  // the struct (`function inList(q: int): int { let xs = [q, 2, 3] … }`) must
  // not bind `record`, or `mix compile --warnings-as-errors` fails on the
  // unused variable.  Only the pure-core copy was missing it, so the shape
  // compiled on the facade module and failed here.
  const recv = bodyUsesReceiver(fn.body) ? "record" : "_record";
  const head = `%${struct.guard}{} = ${recv}`;
  const sig = params.length > 0 ? `${head}, ${params.join(", ")}` : head;
  return [
    `  @doc "Pure domain function \`${fn.name}\`."`,
    `  def ${fnSnake}(${sig}) do`,
    ...renderFunctionBodyLines(fn.body, rc),
    "  end",
  ];
}

function renderPureOp(
  appModule: string,
  ctxModule: string,
  ctx: BoundedContextIR,
  op: OperationIR,
  agg: AggregateIR,
  struct: PureStruct,
): string[] {
  const opSnake = snake(op.name);
  const rc: RenderCtx = {
    thisName: "record",
    contextModule: `${appModule}.${ctxModule}`,
    // No lineage capture in the pure core — that's a persist-path effect; a
    // capture without the draining transaction would orphan the trace buffer.
    captureProvenance: false,
    // Document struct mode reads/writes the `<Agg>.Data` embed the way the
    // persisted document op does (`docOpStructBody`), part constructors included.
    ...(struct.docStruct ? { docStruct: true, agg: agg as EnrichedAggregateIR } : {}),
  };
  // EMIT is an effect (PubSub broadcast needs a running server), not domain
  // state — strip it so the core stays pure / Repo-free.  Lets it depends on
  // survive (only the broadcast statement is dropped).
  const stmts = op.statements.filter((s) => s.kind !== "emit");
  const usedParams = op.params.filter((p) => stmts.some((s) => stmtUsesParam(s, p.name)));
  const paramsArg = usedParams.length > 0 ? "params" : "_params";
  const guard = usedParams.length > 0 ? " when is_map(params)" : "";
  const paramBinds = usedParams.map(
    (p) => `    ${snake(p.name)} = Map.get(params, ${JSON.stringify(p.name)})`,
  );
  const bodyLines = stmts.map((s, i) => renderReturningStmt(s, ctx, rc, i));
  // A void op returns the mutated struct; a value-returning op's `return`
  // statement is already the body's tail value (renderReturningStmt emits it).
  const tail = isReturningOperation(op) ? [] : ["    record"];
  // A `requires currentUser.<…>` (or any `currentUser` reference) in the body
  // renders `current_user.<…>`, so the pure-core fn must accept the actor — same
  // `current_user \\ nil` arity the context wrapper carries (context-emit.ts).
  // Without this the var is unbound → `mix compile --warnings-as-errors` fails.
  const actorArg = opUsesCurrentUser(op) ? ", current_user \\\\ nil" : "";
  return [
    `  @doc "Pure domain core of \`${op.name}\` — preconditions + in-memory mutation (no persistence)."`,
    `  def ${opSnake}(%${struct.guard}{} = record, ${paramsArg}${actorArg})${guard} do`,
    ...paramBinds,
    ...bodyLines,
    ...tail,
    "  end",
  ];
}

// ---------------------------------------------------------------------------
// Event-sourced pure core — on the `<Agg>` struct module (eventsourced-emit.ts).
//
// The persisted command runner (`renderCommandRunner`) decides, builds the
// emitted event structs, APPENDS them, then folds them into state.  The pure
// core is the same decide-and-fold with the append removed: the events are
// folded through `<Agg>Fold`, the module the event store replays a stream
// through, so a test sees exactly the state a load would rebuild.
//
//   def create(attrs)        :: {:ok, t} | {:error, {atom(), term()}}
//        = mint the id, check the create's guards, fold its events from zero
//   def <op>(state, params)  :: t   (raises <App>.GuardError on a failed guard)
//        = the op's guards + its events folded onto `state`
//
// The create's failed guard RETURNS `{:error, term}` (the denial term the
// runner short-circuits to) because a domain test asserts a failed create as
// `{:error, _}` on every shape; an op RAISES, matching the relational op core.
// ---------------------------------------------------------------------------

/** The CRUD names the event-sourced command surface never runs as a command
 *  (mirrors the context block's filter in `eventsourced-emit.ts`). */
const ES_CRUD_OP_NAMES = new Set(["create", "update", "delete", "destroy", "list", "get"]);

/** The pure-core functions for one event-sourced aggregate, spliced into its
 *  struct module (2-space indented, module body level). */
export function renderEventSourcedPureCore(
  appModule: string,
  ctx: BoundedContextIR,
  agg: AggregateIR,
): string[] {
  const facadeMod = `${appModule}.${upperFirst(ctx.name)}`;
  const aggModule = `${facadeMod}.${upperFirst(agg.name)}`;
  const foldMod = `${aggModule}Fold`;
  const eventsModule = `${facadeMod}.Events`;
  const out: string[] = [];
  const create = agg.creates?.[0];
  if (create) out.push(...renderEsPureCreate(facadeMod, foldMod, eventsModule, create));
  for (const op of agg.operations) {
    if (ES_CRUD_OP_NAMES.has(op.name)) continue;
    out.push("", ...renderEsPureOp(appModule, facadeMod, foldMod, eventsModule, op));
  }
  for (const fn of agg.functions ?? []) {
    out.push("", ...renderPureFunction(facadeMod, fn));
  }
  out.push(...derivedAccessorLines(facadeMod, agg as EnrichedAggregateIR));
  return out;
}

/** `%<Events>.<Event>{…}` for one `emit` statement. */
function esEventStruct(
  s: Extract<StmtIR, { kind: "emit" }>,
  eventsModule: string,
  rc: RenderCtx,
): string {
  const fields = s.fields.map((f) => `${snake(f.name)}: ${renderExpr(f.value, rc)}`).join(", ");
  return `%${eventsModule}.${upperFirst(s.eventName)}{${fields}}`;
}

function renderEsPureCreate(
  facadeMod: string,
  foldMod: string,
  eventsModule: string,
  create: OperationIR,
): string[] {
  const rc: RenderCtx = { thisName: "state", contextModule: facadeMod, idLocal: "id" };
  // A test passes the create input as an ATOM-keyed map (`%{owner: "Ada"}`); the
  // string key is the wire spelling, read as the fallback.
  const reads = create.params
    .filter((p) => create.statements.some((s) => stmtUsesParam(s, p.name)))
    .map(
      (p) =>
        `    ${escapeElixirIdent(snake(p.name))} = Map.get(attrs, :${snake(p.name)}, Map.get(attrs, ${JSON.stringify(p.name)}))`,
    );
  const lets: string[] = [];
  const guards: string[] = [];
  const events: string[] = [];
  for (const s of create.statements) {
    if (s.kind === "let") {
      lets.push(`    ${escapeElixirIdent(snake(s.name))} = ${renderExpr(s.expr, rc)}`);
    } else if (s.kind === "precondition" || s.kind === "requires") {
      guards.push(
        `:ok <- if(${renderExpr(s.expr, rc)}, do: :ok, else: {:error, ${denialTerm(s)}})`,
      );
    } else if (s.kind === "emit") {
      events.push(esEventStruct(s, eventsModule, rc));
    }
  }
  const attrsArg = reads.length > 0 ? "attrs" : "_attrs";
  const actorArg = opUsesCurrentUser(create) ? ", current_user \\\\ nil" : "";
  const fold = [`events = [${events.join(", ")}]`, `{:ok, ${foldMod}.from_events(id, events)}`];
  const body =
    guards.length > 0
      ? [`    with ${guards.join(",\n         ")} do`, ...fold.map((l) => `      ${l}`), "    end"]
      : fold.map((l) => `    ${l}`);
  return [
    `  @doc "Pure create core — runs \`${create.name}\` in memory and folds its events (no event log)."`,
    `  def create(${attrsArg}${actorArg}) when is_map(${attrsArg}) do`,
    ...reads,
    "    id = UUIDv7.generate()",
    ...lets,
    ...body,
    "  end",
  ];
}

function renderEsPureOp(
  appModule: string,
  facadeMod: string,
  foldMod: string,
  eventsModule: string,
  op: OperationIR,
): string[] {
  const rc: RenderCtx = { thisName: "state", contextModule: facadeMod };
  const used = op.params.filter((p) => op.statements.some((s) => stmtUsesParam(s, p.name)));
  const reads = used.map(
    (p) => `    ${escapeElixirIdent(snake(p.name))} = Map.get(params, ${JSON.stringify(p.name)})`,
  );
  const body: string[] = [];
  const events: string[] = [];
  for (const s of op.statements) {
    if (s.kind === "let") {
      body.push(`    ${escapeElixirIdent(snake(s.name))} = ${renderExpr(s.expr, rc)}`);
    } else if (s.kind === "precondition" || s.kind === "requires") {
      body.push(guardRaiseLine(s, renderExpr(s.expr, rc), appModule));
    } else if (s.kind === "emit") {
      events.push(esEventStruct(s, eventsModule, rc));
    }
  }
  const paramsArg = used.length > 0 ? "params" : "_params";
  const guard = used.length > 0 ? " when is_map(params)" : "";
  const actorArg = opUsesCurrentUser(op) ? ", current_user \\\\ nil" : "";
  return [
    `  @doc "Pure domain core of \`${op.name}\` — guards + its events folded in memory (no event log)."`,
    `  def ${snake(op.name)}(%__MODULE__{} = state, ${paramsArg}${actorArg})${guard} do`,
    ...reads,
    ...body,
    `    events = [${events.join(", ")}]`,
    `    Enum.reduce(events, state, fn ev, acc -> ${foldMod}.apply_event(acc, ev) end)`,
    "  end",
  ];
}
