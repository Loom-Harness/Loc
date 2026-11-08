// The Phoenix backend's TYPED DENIAL protocol — one place that owns the term a
// failed `requires` / `precondition` short-circuits to, and the controller
// clause that turns it into an RFC 7807 response.
//
// Why it exists.  A bare atom (`{:error, :forbidden}` /
// `{:error, :precondition_failed}`) carries the STATUS but not the MESSAGE, so
// every controller answers with a hardcoded generic string ("A precondition
// failed") where node/dotnet/java/python name the failed predicate
// ("Precondition failed: status != \"cancelled\"").  RFC 7807 wants `detail`
// specific to the OCCURRENCE, and the wire-golden gate is byte-exact — it
// cannot carry an error-envelope assertion while one backend's `detail` is
// generic.
//
// So a denial is a 2-TUPLE — `{:precondition_failed, "<message>"}` — and the
// reason term flows through `{:error, reason}` catch-alls exactly as a bare
// atom would.  The message is built by the SAME rule the other four
// backends use (the `raise(<App>.GuardError, …)` path below here, and the
// `DomainError`/`DomainException` throws there): an explicit `message:` if the
// statement declares one, else the derived `"<Prefix>: <source>"`.
//
// Every producer (`operation-returns-emit`, `eventsourced-emit`,
// `workflow-execution-emit`, `workflow-eventsourced-emit`, `dispatch-emit`) and
// every consumer (`api-emit`, `explicit-handlers-emit`, and the two
// `respond/2` renderers) goes through this module, so the two halves cannot
// drift into a shape the other doesn't match — which would silently fall to the
// unrecognised-term arm and answer a sanitized 500.
//
// Statuses are RS-15's ladder — `when` → 409, `requires` → 403,
// `precondition` → 422, plus `NotFound` → 404 — but NONE of them is a literal
// here.  Every rung resolves through `resolveErrorStatus`
// against the api's `httpStatus <Error> -> <Code>` map, the same call shape the
// structural-conflict rungs use, so a remap moves the runtime arm and
// the OpenAPI declaration together and no rung is silently un-overridable.

import {
  type FieldLimitCheck,
  fieldCode,
  fieldLimitChecks,
  notFoundStmtDetail,
  ruleStage,
  wireSentence,
} from "../../../ir/enrich/wire-policy.js";
import type { ExprIR, StmtIR, WorkflowStmtIR } from "../../../ir/types/loom-ir.js";
import { disallowedDetail } from "../../../ir/util/denial-detail.js";
import { ruleParamRefs } from "../../../ir/util/rule-params.js";
import { pickErrorPath, singleFieldShape } from "../../../ir/validate/invariant-classify.js";
import { elixirString } from "../../../util/naming.js";
import { domainFloorPointer } from "../../_i18n/domain-floor.js";
import { floorRuleText, ruleCode, ruleText } from "../../_i18n/rule-text.js";
import { singleFieldMessage } from "../../zod-refine.js";
import {
  type DenialRung,
  exFieldCode,
  exInternalFallback,
  exLit,
  exMissingSuffix,
  exProblemResponse,
  exSentence,
  exStatus,
  exTitleText,
  RUNG_CLASS,
} from "../wire-policy-ex.js";

type GuardStmt = Extract<StmtIR | WorkflowStmtIR, { kind: "requires" | "precondition" }>;

/** The per-api `httpStatus <Error> -> <Code>` map, folded app-wide by
 *  `enrichLoomModel` and carried on every context / system IR as
 *  `structuralErrorStatuses`.  Threaded into every denial site here so a rung's
 *  runtime status is resolved once, in one place. */
export type ErrorStatusMap = Record<string, number> | undefined;

/** The `httpStatus` map a denial site resolves against, assembled from the two
 *  places the IR keeps one:
 *
 *   - `errorStatusOverrides` — the per-subdomain merge of every `httpStatus
 *     <Error> -> <Code>` clause on the apis serving it.  Carries EVERY declared
 *     name, so this is the only place a `httpStatus DomainError -> 400` /
 *     `Forbidden` / `NotFound` remap is visible;
 *   - `structuralErrorStatuses` — the app-wide fold, which by construction only
 *     enumerates the four structural-conflict names (`STRUCTURAL_CONFLICT_ERRORS`).
 *
 *  Structural names come last so the app-global fold stays authoritative for the
 *  four it owns (an app-global handler has no per-context tag to resolve with).
 *  When the shared enrichment fold learns to carry the whole ladder, this
 *  collapses to reading one map — the merge is a no-op either way. */
export function denialOverrides(ctx: {
  errorStatusOverrides?: Record<string, number>;
  structuralErrorStatuses?: Record<string, number>;
}): ErrorStatusMap {
  const merged = { ...ctx.errorStatusOverrides, ...ctx.structuralErrorStatuses };
  return Object.keys(merged).length > 0 ? merged : undefined;
}

export type { DenialRung };

/** The resolved HTTP status for a denial rung — the api's `httpStatus` override
 *  if the author declared one, else the `STDLIB_ERROR_STATUS` default.  The same
 *  call shape the structural-conflict rungs (`ReferencedInUse`, …) already use,
 *  so no rung of the ladder is a hardcoded literal any more. */
export function denialStatus(rung: DenialRung, overrides?: ErrorStatusMap): number {
  return exStatus(RUNG_CLASS[rung], overrides);
}

/** The RFC 7807 `title` for a denial rung — the wire-policy fact's, so it can
 *  never disagree with the status next to it: `Disallowed` titles on the error
 *  NAME, the other rungs on the RESOLVED status's reason phrase (`httpStatus
 *  NotFound -> 410` titles "Gone", not "Not Found"). */
export function denialTitle(rung: DenialRung, overrides?: ErrorStatusMap): string {
  return exTitleText(RUNG_CLASS[rung], overrides);
}

/** A whole `ProblemDetails.problem_response(conn, <status>, <title>, <detail>)`
 *  call for one rung — the single place a denial's status/title pair is spelled,
 *  so a call site can't half-resolve one of them.  `detailExpr` is emitted
 *  VERBATIM (an Elixir expression: a bound `detail` variable, `guard_msg`, or an
 *  already-quoted literal).  `problemModule` lets a call site that hasn't
 *  `alias`d the module spell it fully (`<App>Web.ProblemDetails`). */
export function denialResponse(
  rung: DenialRung,
  detailExpr: string,
  overrides?: ErrorStatusMap,
  problemModule = "ProblemDetails",
): string {
  return exProblemResponse(RUNG_CLASS[rung], detailExpr, overrides, problemModule);
}

/** The sanitized catch-all for an UNRECOGNISED `{:error, reason}` term.
 *  An error term no denial clause matched is a fault the server did not model —
 *  a 500, not a 400 — and its `detail` is the fixed string `"internal"`, never
 *  `inspect(reason)`: inspecting renders struct names / module paths / raw
 *  internal state into a public response body.  Byte-identical to the other four
 *  backends' unhandled-fault arm. */
export function internalFallbackResponse(): string {
  return exInternalFallback();
}

/** The message a denial carries — a precondition's rule text, which is the
 *  ProblemDetails `detail`; a `requires` gate's `Forbidden: <source>`, which is
 *  the SERVER LOG's account of which gate refused.  The `.ddd` source never
 *  reaches a response: `ProblemDetails.problem_response/5` answers a
 *  `problem.forbidden` rejection with the constant detail and its code, after
 *  logging this message. */
export function denialMessage(s: GuardStmt): string {
  if (s.kind === "requires") return `Forbidden: ${s.source}`;
  return floorRuleText(s);
}

/** An Elixir map literal carrying the VALUES of the identifiers `rule` reads
 *  (`ruleParamRefs`) — a named rule's wire `params` — or undefined when it
 *  reads none.  `render` spells one reference where the rule trips. */
export function exRuleParams(
  rule: { expr: ExprIR; guard?: ExprIR },
  render: ((e: ExprIR) => string) | undefined,
): string | undefined {
  if (render === undefined) return undefined;
  const refs = ruleParamRefs(rule);
  if (refs.length === 0) return undefined;
  return `%{${refs.map(({ name, ref }) => `${elixirString(name)} => ${render(ref)}`).join(", ")}}`;
}

// ---------------------------------------------------------------------------
// The RAISE path — the TYPED GUARD EXCEPTION.
//
// The `ensure` chain above is only reachable from an HTTP-boundary operation.
// A guard in a PURE body — an aggregate `function`, a `domainService`, the
// pure-core operation form — has no `with` chain to short-circuit through, so
// it RAISES, and a controller `rescue` maps the raise to a status.
//
// The rescue must NOT route by MESSAGE PREFIX (`String.starts_with?(guard_msg,
// "Precondition failed: ")`): that makes the message the ROUTING KEY, so an
// authored `message "…"` would miss the prefix and `reraise` into a 500.
//
// The classification is OUT OF BAND: one domain-layer `defexception`
// carrying a `kind` field (`:forbidden` / `:precondition`) that the rescue
// reads.  The `:message` is free text, so `denialMessage(s)` — the SAME
// rule the `ensure` path and the other four backends' `DomainException` /
// `DomainError` use — can be spelled here verbatim.
//
// The module lives in the DOMAIN layer (`<App>.GuardError`, under
// `lib/<app>/`), not `<App>Web.*`: `function-emit` / `domain-service-emit`
// render into `lib/<app>/` and must not reference the Web namespace.
//
// ONE module with a `kind` field rather than two exception types, because the
// generated ExUnit domain tests assert on it too (`assert_raise <App>.GuardError`
// in `tests-emit.ts`) and cannot tell from a `toThrow()` expression which rung
// the op will trip.
// ---------------------------------------------------------------------------

/** The app module a `<App>.<Ctx>` context module belongs to — the prefix
 *  `RenderCtx.contextModule` carries at every raise site. */
export function appModuleOf(contextModule: string): string {
  return contextModule.split(".")[0] ?? contextModule;
}

/** The reference a controller calls the `<App>.<Ctx>` facade through.  Normally
 *  the bare `<Ctx>` (under `alias <App>.<Ctx>`), but when the context is named
 *  like the app (`deployable claims` hosting `context Claims`) that alias would
 *  rebind `<App>` itself — every `<App>.GuardError` / `<App>.Repo` in the file
 *  would then resolve to `<App>.<App>.…` and fail to compile.  In that case the
 *  facade is referenced fully qualified and no alias is emitted
 *  ({@link contextAliasLine}). */
export function contextCallRef(appModule: string, ctxModule: string): string {
  return ctxModule === appModule ? `${appModule}.${ctxModule}` : ctxModule;
}

/** The `alias <App>.<Ctx>` line (with trailing newline) a controller needs for
 *  {@link contextCallRef}'s bare `<Ctx>` — empty when the ref is fully qualified. */
export function contextAliasLine(appModule: string, ctxModule: string): string {
  return contextCallRef(appModule, ctxModule) === ctxModule
    ? `  alias ${appModule}.${ctxModule}\n`
    : "";
}

/** `<App>.GuardError` — the typed exception a guard raises on the pure paths. */
export function guardErrorModule(appModule: string): string {
  return `${appModule}.GuardError`;
}

/** The `raise(<App>.GuardError, kind: …, message: …)` call a failed guard
 *  raises.  `kind` is the routing key the controller rescue reads; `message` is
 *  the author's `message "…"` when there is one, byte-identical to the string
 *  the `ensure` path puts in the same denial's `detail`. */
export function guardRaise(s: GuardStmt, appModule: string): string {
  const kind = s.kind === "requires" ? ":forbidden" : ":precondition";
  return `raise(${guardErrorModule(appModule)}, kind: ${kind}, message: ${elixirString(
    denialMessage(s),
  )})`;
}

/** The whole `if not (<pred>), do: raise(…)` guard line, at the four-space body
 *  indent every pure-body renderer emits at.  One helper so the three raise
 *  sites (`operation-returns-emit` / `function-emit` / `domain-service-emit`)
 *  cannot drift from each other or from the rescue that catches them. */
export function guardRaiseLine(s: GuardStmt, predicate: string, appModule: string): string {
  return `    if not (${predicate}), do: ${guardRaise(s, appModule)}`;
}

/** The `lib/<app>/guard_error.ex` source — the one `defexception` both the
 *  raise sites and the controller rescue go through. */
export function renderGuardErrorModule(appModule: string): string {
  return `# Auto-generated.
defmodule ${guardErrorModule(appModule)} do
  @moduledoc """
  A domain guard denial raised from a PURE body — an aggregate \`function\`, a
  \`domainService\`, or the pure-core operation form, none of which has a
  \`with\` chain to short-circuit through.

  \`:kind\` is the ROUTING KEY the controller rescue reads to pick the HTTP
  status (\`:forbidden\` -> 403, \`:precondition\` -> 422).  It used to read the
  message PREFIX instead, which made the message unusable as a message: an
  author's \`message "..."\` missed the prefix and reraised into a 500.  With
  the classification out of band, \`:message\` is free text and carries exactly
  what the other four backends put in their \`DomainException\` / \`DomainError\`.

  \`:disallowed\` is an operation's \`when\` state gate refusing, raised only by
  the pure-core operation form (the domain unit tests' subject); the HTTP path
  checks the gate in its \`with\` chain and answers 409 from there.
  """
  defexception [:message, :kind]

  @type kind :: :forbidden | :precondition | :disallowed
end
`;
}

/** The `lib/<app>/not_implemented_error.ex` source — the exception an unfilled
 *  `extern` operation stub raises.  The fault handler answers it `501
 *  problem.not-implemented` with its own message (the file to fill in), where
 *  any other unmodelled raise is the sanitized 500. */
export function renderNotImplementedErrorModule(appModule: string): string {
  return `# Auto-generated.
defmodule ${appModule}.NotImplementedError do
  @moduledoc """
  An \`extern\` operation whose hand-written body was never filled in.
  """
  defexception [:message]
end
`;
}

/** The `lib/<app>/malformed_if_match_error.ex` source — the exception a
 *  controller raises for an `If-Match` header that names no version.  The fault
 *  handler answers it `400 problem.malformed-if-match` with the sentence the
 *  wire-policy fact owns. */
export function renderMalformedIfMatchErrorModule(appModule: string): string {
  return `# Auto-generated.
defmodule ${appModule}.MalformedIfMatchError do
  @moduledoc """
  An \`If-Match\` request header that is not \`*\` or a version tag.
  """
  defexception [:message]

  @impl true
  def exception(header) when is_binary(header),
    do: %__MODULE__{message: ${elixirString(wireSentence("malformed-if-match").prefix)} <> header}
end
`;
}

/** The Elixir reason TERM a failed guard short-circuits to:
 *  `{:forbidden, "Forbidden: …"}` / `{:precondition_failed, "Precondition
 *  failed: …"}`.  Rendered into `ensure(<cond>, <term>)` and into the inline
 *  `if …, do: :ok, else: {:error, <term>}` workflow form alike. */
export function denialTerm(
  s: GuardStmt,
  wireAvailable?: ReadonlySet<string>,
  /** Spells one identifier a named rule reads — its VALUE rides the wire `params`. */
  renderRef?: (e: ExprIR) => string,
): string {
  if (deniesAtWire(s, wireAvailable)) return wireValidationTerm(s, renderRef);
  // A NAMED precondition in an aggregate OPERATION (the only
  // call site that passes `wireAvailable`) that the wire cannot see answers the
  // domain floor WITH its `errors[]` entry: the detail travels as a map carrying
  // the rule's identity-key code and pointer, and `ProblemDetails.problem_response/4`
  // answers that map through the same domain-floor entry sender the body-built
  // value object uses.  Every other denial keeps the plain string detail.
  if (wireAvailable !== undefined && s.kind === "precondition" && s.message) {
    return codedPreconditionTerm(s, s.message.key, renderRef);
  }
  const tag = s.kind === "requires" ? ":forbidden" : ":precondition_failed";
  return `{${tag}, ${elixirString(denialMessage(s))}}`;
}

/** The term a `notFound` statement fails with: the same `{:not_found, detail}`
 *  a tagged `getById` miss threads, so the dispatcher's detail-carrying
 *  not-found arm answers the identical ProblemDetails.  The dispatchers gate
 *  that arm on `handlerLoadsById` / `workflowLoadsById`, which count this
 *  statement. */
export function notFoundStmtTerm(st: { detail?: string; subject?: string }): string {
  return `{:not_found, ${elixirString(notFoundStmtDetail(st))}}`;
}

/** The with-clause a `notFound` statement lowers to in a command-path chain. */
export function notFoundStmtClause(st: { detail?: string; subject?: string }): string {
  return `:ok <- {:error, ${notFoundStmtTerm(st)}}`;
}

/** The denial term for a guard in a WORKFLOW / command-handler body.  An
 *  orchestration precondition never lifts into a request validator, so a
 *  MESSAGED one always answers the domain floor WITH its `errors[]` entry —
 *  the same coded map an operation precondition's domain-floor denial carries
 *  (banking eval B-02).  The workflow controller hands the detail to
 *  `ProblemDetails.problem_response/4`, whose map arm the domain-floor gate
 *  (`hasDomainFloorMessages`, which sees workflow preconditions) switches on. */
export function workflowDenialTerm(s: GuardStmt, renderRef?: (e: ExprIR) => string): string {
  if (s.kind === "precondition" && s.message)
    return codedPreconditionTerm(s, s.message.key, renderRef);
  return denialTerm(s);
}

function codedPreconditionTerm(
  s: GuardStmt,
  code: string,
  renderRef?: (e: ExprIR) => string,
): string {
  const params = s.kind === "precondition" ? exRuleParams(s, renderRef) : undefined;
  return `{:precondition_failed, %{detail: ${elixirString(denialMessage(s))}, code: ${JSON.stringify(
    code,
  )}, pointer: ${JSON.stringify(domainFloorPointer(s))}${params ? `, params: ${params}` : ""}}}`;
}

// ---------------------------------------------------------------------------
// The WIRE-VALIDATION rung.
//
// The other four backends lift an operation's `precondition`s into the SAME
// request validator the aggregate invariants use (`preconditionsAsInvariants`
// → zod `refine` / FluentValidation / pydantic / bean-validation), so a tripped
// precondition over the operation's own params answers the WIRE-VALIDATION 422:
// title "Validation failed", detail "One or more fields are invalid.", and an
// `errors[]` entry carrying the RFC 6901 pointer + the identity-key code.
//
// Elixir lowers preconditions to the `ensure/2` control-flow chain instead, so
// without this rung the same denial would answer the DOMAIN-FLOOR 422 —
// authored message in `detail`, no `errors[]`, hence no pointer and no code,
// and a frontend ACL's `applyServerErrors` would bind nothing on this backend
// (the `corpus/validation-messages` wire-golden pins the agreement).
//
// SCOPE — a precondition whose predicate `classifyForWire` admits against the
// operation's params.  The `available` set is the op's params, exactly what
// `routes-builder.ts` / `validation-catalog.ts` classify against, so a
// precondition reading `this.<state>` (e.g. `wire-contract`'s
// `availability != Availability.Discontinued`) is NOT wire-translatable on any
// backend and rightly stays on the domain floor here too.
//
// A NAMED precondition carries its text and identity-key `code`.  An unnamed
// one carries the sentence node's validator chain sends for the same rule
// (D-MESSAGELESS-RULE-WIRE-MESSAGE): `singleFieldMessage` for a single-field
// shape ("Amount must be at least 1"), the generic `ruleText` for any other —
// and no `code`.
// ---------------------------------------------------------------------------

/** True when this guard is a wire-translatable `precondition` — the one denial
 *  shape that must answer the wire-validation 422 rather than the domain floor.
 *  `available` is the operation's param names; `undefined` (every
 *  non-operation call site: lifecycle gates, workflows, dispatch handlers) means
 *  "no request body to point into", so the answer is always false and those
 *  paths stay byte-identical. */
function deniesAtWire(s: GuardStmt, available: ReadonlySet<string> | undefined): boolean {
  if (available === undefined) return false;
  if (s.kind !== "precondition") return false;
  return ruleStage({ expr: s.expr, source: s.source, message: s.message }, available) === "schema";
}

/** `{:validation_failed, [%{pointer: "/amount", message: "…", code: "Ctx.Owner.rule.name"}]}`
 *  — the reason term a wire-translatable precondition short-circuits to.  One
 *  entry, because one precondition denies at a time (the `with` chain
 *  short-circuits); the list shape matches the `errors[]` extension the
 *  changeset path already produces so the controller can render both through
 *  one responder. */
export function wireValidationTerm(s: GuardStmt, renderRef?: (e: ExprIR) => string): string {
  const path = pickErrorPath({ expr: s.expr, source: s.source });
  const pointer = path === null ? "" : `/${rfc6901(path)}`;
  const authored = s.kind === "precondition" ? s.message : undefined;
  const single = authored ? null : singleFieldShape({ expr: s.expr, source: s.source });
  const text = authored
    ? denialMessage(s)
    : single
      ? singleFieldMessage(single.field, single.pattern)
      : ruleText({ expr: s.expr, source: s.source });
  const entry = [
    `pointer: ${JSON.stringify(pointer)}`,
    // The author's `message "…"` goes through the shared escaping funnel — a
    // raw `#{` here would interpolate into the 422 body at request time.
    `message: ${elixirString(text)}`,
    `code: ${elixirString(ruleCode({ expr: s.expr, source: s.source, message: authored }))}`,
    ...(authored && exRuleParams(s, renderRef) ? [`params: ${exRuleParams(s, renderRef)}`] : []),
  ].join(", ");
  return `{:validation_failed, [%{${entry}}]}`;
}

/** A message-less wire-rung precondition that is a declared field limit, as
 *  one `{expr, term}` per side (`fieldLimitChecks`): the side's own predicate
 *  (a conjunct of the precondition) and the `{:validation_failed, …}` term
 *  carrying its `field.<limit>` code and bound.  A two-sided limit is the two
 *  `&&` conjuncts `singleFieldShape` folded, in the same order (min side
 *  first).  `null` when the guard is not such a limit, so the caller keeps its
 *  one `ensure`. */
export function wireLimitSides(
  s: GuardStmt,
  available: ReadonlySet<string> | undefined,
): { expr: ExprIR; term: string }[] | null {
  if (s.kind !== "precondition" || s.message || !deniesAtWire(s, available)) return null;
  const single = singleFieldShape({ expr: s.expr, source: s.source });
  if (!single) return null;
  const checks = fieldLimitChecks(single.pattern);
  const strip = (e: ExprIR): ExprIR => (e.kind === "paren" ? strip(e.inner) : e);
  const top = strip(s.expr);
  const sides =
    checks.length === 1
      ? [s.expr]
      : top.kind === "binary" && top.op === "&&"
        ? [top.left, top.right]
        : null;
  if (!sides || sides.length !== checks.length) return null;
  const pointer = `/${rfc6901(single.field)}`;
  const text = singleFieldMessage(single.field, single.pattern);
  return checks.map((check, i) => ({
    expr: sides[i] as ExprIR,
    term: limitTerm(pointer, text, check),
  }));
}

function limitTerm(pointer: string, text: string, check: FieldLimitCheck): string {
  const entries = Object.entries(check.params).map(([k, v]) => `${k}: ${v}`);
  const params = entries.length > 0 ? `, params: %{${entries.join(", ")}}` : "";
  return `{:validation_failed, [%{pointer: ${JSON.stringify(pointer)}, message: ${elixirString(text)}, code: ${elixirString(fieldCode(check.reason))}${params}}]}`;
}

/** RFC 6901 segment escaping (`~` → `~0`, `/` → `~1`) — the same escaping the
 *  emitted `ProblemDetails.pointer_of/1` and Hono's `pointerOf` apply. */
function rfc6901(segment: string): string {
  return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}

/** Does any of the operation's guards deny at the wire rung?  Gates the
 *  controller's `{:error, {:validation_failed, errors}}` clause, so an op with
 *  no such guard emits no unreachable clause (`--warnings-as-errors`). */
export function opHasWireDenial(op: {
  statements: readonly StmtIR[];
  params: readonly { name: string }[];
}): boolean {
  const available = new Set(op.params.map((p) => p.name));
  return op.statements.some(
    (s) => (s.kind === "requires" || s.kind === "precondition") && deniesAtWire(s, available),
  );
}

/** Does any aggregate operation across these contexts carry a wire-rung denial?
 *  Gates the ProblemDetails responder AND the shared `respond/2` error tail —
 *  a workflow `op-call` / explicit handler that invokes such an operation
 *  propagates the term to its own dispatcher, which would otherwise fall to the
 *  sanitized 500 catch-all.  False ⇒ every one of those seams is byte-identical. */
export function contextsHaveWireDenials(
  contexts: readonly {
    aggregates: readonly {
      operations?: readonly {
        statements: readonly StmtIR[];
        params: readonly { name: string }[];
      }[];
    }[];
  }[],
): boolean {
  return contexts.some((c) =>
    c.aggregates.some((agg) => (agg.operations ?? []).some((op) => opHasWireDenial(op))),
  );
}

/** The controller arm that answers a wire-rung denial with the §3.2 `errors[]`
 *  422 — the SAME body `ProblemDetails.validation_error_response/2` builds from
 *  a changeset, so both 422 rungs share one wire shape. */
export function wireValidationResponse(problemModule = "ProblemDetails"): string {
  return `${problemModule}.validation_errors_response(conn, errors)`;
}

/** The WIRE-VALIDATION 422 for a workflow request that omits a param its body
 *  reads (L1-E / E7, #3017).  Node's request validator answers this with the
 *  §3.2 `errors[]` extension — one `{pointer, message}` entry per missing
 *  field, title "Validation failed" — and so does every other backend; elixir
 *  answered the DOMAIN-FLOOR rung with the names folded into `detail`, so a
 *  frontend ACL's `applyServerErrors` bound nothing.  The entries carry no
 *  `code` (a structural error, like zod's), and go through the same
 *  `validation_errors_response/2` sender the wire-rung precondition uses. */
function missingParamsResponse(problemModule = "ProblemDetails"): string {
  return `${problemModule}.validation_errors_response(conn, Enum.map(missing, &%{pointer: "/" <> &1, message: &1 <> ${exLit(` ${exMissingSuffix()}`)}, code: ${exFieldCode("missing")}}))`;
}

/** The two ProblemDetails clauses a controller needs to answer a typed denial,
 *  as `<head>` / `<body>` pairs so each call site can wrap them in its own
 *  `def respond(conn, …)` / `def <op>_<agg>_result(conn, …)` shape.
 *
 *  `detail` is bound from the tuple, so the response names the predicate that
 *  actually failed rather than a fixed sentence. */
export function denialClause(
  kind: "forbidden" | "precondition",
  fnName = "respond",
  overrides?: ErrorStatusMap,
): { readonly head: string; readonly body: string } {
  const tag = kind === "forbidden" ? ":forbidden" : ":precondition_failed";
  return {
    head: `def ${fnName}(conn, {:error, {${tag}, detail}})`,
    body: denialResponse(kind, "detail", overrides),
  };
}

/** Both denial clauses rendered as a `def …,\n    do: …` pair, the shape the
 *  `respond/2` renderers in `explicit-handlers-emit` / `workflow-execution-emit`
 *  splice inline.  `indent` prefixes each `def` (the controller bodies emit at
 *  column 2 in some renderers and 0 in others). */
export function denialResponders(
  fnName = "respond",
  indent = "",
  overrides?: ErrorStatusMap,
): string {
  return (["forbidden", "precondition"] as const)
    .map((k) => {
      const { head, body } = denialClause(k, fnName, overrides);
      return `${indent}${head},\n${indent}  do: ${body}`;
    })
    .join("\n\n");
}

/** The shared ERROR TAIL of a `respond/2` dispatcher: the `:not_found` arm, both
 *  typed-denial arms, and the sanitized unrecognised-term catch-all — in that
 *  order (the catch-all must stay LAST or Elixir 1.18 flags every clause after
 *  it as unreachable under `--warnings-as-errors`).
 *
 *  The catch-all binds `_reason`, not `reason`: nothing reads the term any more
 *  (see `internalFallbackResponse`), and an unused plain binding is itself a
 *  `--warnings-as-errors` failure. */
export function respondErrorTail(
  fnName = "respond",
  indent = "  ",
  overrides?: ErrorStatusMap,
  /** True when some aggregate operation reachable from this dispatcher denies at
   *  the WIRE rung.  A workflow `op-call` threads that operation's
   *  `{:error, reason}` straight through here, so without the arm the denial
   *  would fall to the sanitized 500 catch-all instead of the 422 the direct
   *  controller answers.  Gated so a project without one emits no such arm —
   *  and never references a `validation_errors_response/2` the
   *  ProblemDetails module didn't emit (an undefined remote call is itself a
   *  `--warnings-as-errors` failure). */
  wireDenials = false,
  /** True for the WORKFLOWS dispatcher only.  A workflow's public `run/1`
   *  answers `{:error, {:invalid_params, missing}}` when the request omits a
   *  param its body destructures — a bare match would RAISE, so the fault
   *  handler would answer 500 on a route whose own OpenAPI declares 422 and
   *  where the other four backends validate.  Gated rather than always-on so
   *  no other dispatcher carries the arm: no other caller can
   *  produce this term, and an arm nothing reaches is a clause a reader has to
   *  disprove. */
  invalidParams = false,
  /** True when a workflow body here loads through `getById`.  The
   *  load tags its miss `{:not_found, "<Agg> <id> not found"}` — the detail the
   *  other four backends' `AggregateNotFound` carries and the GET-by-id route
   *  here already answers — so the workflow 404 names the row rather than the
   *  generic "Resource not found".  Gated so a dispatcher that cannot produce
   *  the term carries no arm for it. */
  notFoundDetail = false,
  /** True when some aggregate this dispatcher can reach is `versioned` or
   *  event-sourced (`aggregatesNeedConcurrency`) — the same predicate that
   *  emits `ProblemDetails.conflict_response/1`.  A stale save inside a
   *  workflow / handler body (`persist_change/1` / the document `update` rescue
   *  `Ecto.StaleEntryError`, the event-log append rescues the
   *  `(stream_id, version)` unique_violation, all to `{:error, :conflict}`)
   *  rolls the transaction back and threads that term here; without the arm it
   *  fell to the sanitized 500 catch-all where the single-aggregate route and
   *  the other four backends answer the concurrency 409 (M-T6.92).  Gated so a
   *  project without concurrency never references a responder it didn't emit. */
  conflict = false,
): string {
  const clause = (head: string, body: string): string =>
    `${indent}${head},\n${indent}  do: ${body}`;
  return [
    clause(
      `def ${fnName}(conn, {:error, :not_found})`,
      denialResponse("notFound", exSentence("not-found", "Resource"), overrides),
    ),
    ...(notFoundDetail
      ? [
          clause(
            `def ${fnName}(conn, {:error, {:not_found, detail}})`,
            denialResponse("notFound", "detail", overrides),
          ),
        ]
      : []),
    ...(invalidParams
      ? [
          clause(
            `def ${fnName}(conn, {:error, {:invalid_params, missing}})`,
            missingParamsResponse(),
          ),
        ]
      : []),
    ...(wireDenials
      ? [
          clause(
            `def ${fnName}(conn, {:error, {:validation_failed, errors}})`,
            wireValidationResponse(),
          ),
        ]
      : []),
    ...(conflict
      ? [
          clause(
            `def ${fnName}(conn, {:error, :conflict})`,
            "ProblemDetails.conflict_response(conn)",
          ),
        ]
      : []),
    denialResponders(fnName, indent, overrides),
    clause(`def ${fnName}(conn, {:error, _reason})`, internalFallbackResponse()),
  ].join("\n\n");
}

/** `{:disallowed, "operation '…' is not allowed …"}` — the reason term a failed
 *  `when` gate short-circuits to.
 *
 *  The `when` STATE-GATE rung of the same ladder (RS-17).  A `when`-gated
 *  operation invoked in a state its predicate refuses answers 409 with title
 *  "Disallowed" and the shared `disallowedDetail` — byte-identical to
 *  node/.NET/Java/Python's `DisallowedException(...)` message.
 *
 *  Same shape and same reason as the guard rungs above: the bare `:disallowed`
 *  atom carried the status but not the message, so the controller answered a
 *  fixed sentence ("Operation not allowed in the current state") where the other
 *  four name the occurrence.  Carrying the message in the tuple also dissolves
 *  what looked like the hard part — the event-sourced `command_error/2` clause is
 *  SHARED across every command of an aggregate and so has no `op` in scope, but
 *  it never needs one: the PRODUCER has `op`, and the consumer just binds the
 *  detail. */
export function disallowedTerm(aggName: string, op: { name: string }): string {
  return `{:disallowed, ${elixirString(disallowedDetail(op.name, aggName))}}`;
}

/** The state-gate consumer half — `ProblemDetails.problem_response(conn,
 *  <Disallowed status>, "Disallowed", detail)`.  Status resolves through the
 *  same `httpStatus` map as its sibling rungs; the title stays the error NAME
 *  (matching java's `problem(disallowedStatus, "Disallowed", …)`) so a remap
 *  can't turn the wire's error identity into a bare reason phrase. */
export function disallowedResponse(
  detailExpr = "detail",
  overrides?: ErrorStatusMap,
  problemModule = "ProblemDetails",
): string {
  return denialResponse("disallowed", detailExpr, overrides, problemModule);
}
