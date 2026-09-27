// ---------------------------------------------------------------------------
// Cross-field aggregate-invariant enforcement for the vanilla (Ecto/Phoenix)
// changeset — the `validate_invariants/1` seam.
//
// `changeset-emit.ts` renders SINGLE-field invariants (`amount >= 0`,
// `sku.length > 0`, `email.matches(...)`) as idiomatic `validate_number` /
// `validate_length` / `validate_format` lines (via `singleFieldConstraints`).
// A CROSS-field invariant (`handle != email`, `startDate <= endDate`) fits no
// single-field native chain, so the classifier returns null.  Without this
// module such an invariant is **silently dropped on every path** — create,
// PATCH and operation persist all skip it — while the other four backends 400
// it at the domain floor.
//
// So this mirrors the other backends' `AssertInvariants()`: a custom Ecto
// validation that reads the PROPOSED struct (`apply_changes/1` — the record with
// the changeset's changes applied, valid or not) and `add_error`s when the
// predicate is false.  The predicate is rendered by the same vanilla
// expression renderer the domain bodies use, with `this.<prop>` bound to the
// applied `data` struct — so `handle != email` renders `data.handle != data.email`,
// byte-for-byte the comparison the domain core would run.
//
// Scope is deliberately tight: only invariants whose every leaf is a SCALAR
// `this`-property / enum-value / literal (no collection walks, no method calls,
// no derived getters, no `currentUser`) — exactly the cross-field comparisons.
// Collection / derived / actor-gated invariants stay out (they need machinery a
// changeset validator can't host); single-field ones already have their native
// line.  Empty when an aggregate has no such invariant → byte-identical output.
// ---------------------------------------------------------------------------

import type { AggregateIR, ExprIR, InvariantIR } from "../../../ir/types/loom-ir.js";
// The PURE "can this carrier enforce the rule?" judgement lives in `ir/util` so
// the phase-⑦ validator can read the same answer — see that module's header.
import {
  renderableHere,
  unreadableCollections,
  unrenderableInvariants,
} from "../../../ir/util/changeset-invariant-carrier.js";
import { walkExprDeep } from "../../../ir/util/walk.js";
import { pickErrorPath, singleFieldConstraints } from "../../../ir/validate/invariant-classify.js";
import { messageCode } from "../../../util/message-code.js";
import { elixirString, snake } from "../../../util/naming.js";
import { type RenderCtx, renderExpr } from "../render-expr.js";

/** True when a rule leans on one of the shapes `structEvaluable` admits only
 *  since #3023 — a member read, a method call, or a `this-derived` inline.
 *
 *  Those three need TWO things the pre-existing scalar residuals do not, and
 *  both are carrier concerns rather than renderer concerns:
 *
 *    1. a `changeset.valid?` guard.  `String.trim(nil)` raises
 *       (`FunctionClauseError`), and `apply_changes/1` yields `nil` for a
 *       required field the request omitted — so an invariant reading that field
 *       would answer 500 where the request should get the 422 that
 *       `validate_required` already queued.  A scalar comparison never had this
 *       problem (`nil > 5` is `false` under Elixir's term order, it does not
 *       raise), which is why the existing residuals run unguarded and KEEP
 *       doing so: gating them too would drop error entries from a response that
 *       already 422s, a wire-visible change this defect does not call for.
 *    2. containment normalisation — see `referencedContainments`.
 *
 *  Rides `walkExprDeep` rather than a second hand-rolled traversal, so a new
 *  `ExprIR` kind cannot silently fall out of this judgement (CLAUDE.md's
 *  no-hand-rolled-IR-walks rule; the census pins it). */
function extendedShape(inv: InvariantIR): boolean {
  let found = false;
  const look = (e: ExprIR): void => {
    if (e.kind === "member" || e.kind === "method-call") found = true;
    if (e.kind === "ref" && e.refKind === "this-derived") found = true;
  };
  walkExprDeep(inv.expr, look);
  walkExprDeep(inv.guard, look);
  return found;
}

/** The aggregate's containment / value-collection field names this rule reads.
 *
 *  A `has_many` is `%Ecto.Association.NotLoaded{}` on a struct nobody preloaded,
 *  and `Enum.count/1` on that raises `Protocol.UndefinedError` — which would
 *  make `lines.count > 0` a 500 instead of the silent skip it is today, i.e.
 *  strictly worse.  Both write paths are safe once normalised:
 *
 *    • CREATE — `cast_assoc(:lines, …)` puts the children in the changeset, so
 *      `apply_changes/1` materialises them.  When the payload omits the key
 *      there is no change and the field stays `NotLoaded`, which SEMANTICALLY
 *      means "no children" — exactly the `[]` the other four backends hold, so
 *      `lines.count > 0` correctly fails rather than crashing.
 *    • UPDATE / operation-persist — the record comes from the repository, whose
 *      every read path ends `|> Repo.preload([:lines])`, so it is a real list.
 *
 *  So normalising `NotLoaded`/`nil` to `[]` is correct on both, and the
 *  normalisation is emitted ONCE per referenced collection rather than wrapping
 *  each read (which would have to thread through `renderExpr`). */
function referencedContainments(inv: InvariantIR, collectionFields: ReadonlySet<string>): string[] {
  const hit = new Set<string>();
  const look = (e: ExprIR): void => {
    if (e.kind === "ref" && e.refKind === "this-prop" && collectionFields.has(e.name)) {
      hit.add(e.name);
    }
  };
  walkExprDeep(inv.expr, look);
  walkExprDeep(inv.guard, look);
  return [...hit];
}

export { unrenderableInvariants };

/** A MESSAGED rule routes to the `validate_invariants/1` residual carrier — so
 *  its wire `code` rides the `add_error` metadata (Ecto's native validators
 *  can't carry a custom key) — when its predicate is renderable against the
 *  applied struct: either a struct-evaluable cross-field comparison OR a
 *  recognized single-field shape (`.length` / `.matches` / numeric bound, which
 *  `renderExpr` renders as `String.length` / `Regex.match?` / `Decimal.compare`).
 *  A message-LESS UNGUARDED single-field rule is unaffected — it keeps its
 *  native `validate_*` line (byte-identical). Consumed by BOTH
 *  `residualInvariants` (to include it here) and `changeset-emit`'s native path
 *  (to exclude it there), so the two never double-emit. */
export function messagedRoutesToResidual(
  inv: InvariantIR,
  /** The aggregate/part the rule belongs to, for `unreadableCollections`.
   *  Optional so the native path in `changeset-emit` (which asks only "does
   *  this route away from me?") keeps its existing call shape; omitting it
   *  excludes nothing, which is the pre-#3023 answer. */
  owner?: Pick<AggregateIR, "invariants"> & Partial<Pick<AggregateIR, "associations">>,
): boolean {
  if (inv.message == null) return false;
  return renderableHere(inv, owner ? unreadableCollections(owner) : new Set());
}

/** Aggregate invariants that need the `validate_invariants/1` seam: message-less
 *  cross-field comparisons (fully evaluable against the applied struct), every
 *  GUARDED rule (no native `validate_*` line can carry an implication, so this
 *  is the only carrier it has — M-T6.55 F15), plus every MESSAGED rule that
 *  routes here to carry its wire `code`.
 *
 *  The three arms cannot double-emit with the native path: `changeset-emit`
 *  renders `singleFieldConstraints(inv) ?? []`, which is null for a guarded rule
 *  and empty for a cross-field one, and it skips `messagedRoutesToResidual`
 *  explicitly. */
export function residualInvariants(
  agg: Pick<AggregateIR, "invariants"> & Partial<Pick<AggregateIR, "associations">>,
): InvariantIR[] {
  const opaque = unreadableCollections(agg);
  return (agg.invariants ?? []).filter(
    (inv) =>
      (inv.message == null &&
        (inv.guard !== undefined || singleFieldConstraints(inv) === null) &&
        renderableHere(inv, opaque)) ||
      messagedRoutesToResidual(inv, agg),
  );
}

/** True when the aggregate carries at least one cross-field invariant the
 *  `validate_invariants/1` seam enforces — gates both the changeset pipe and the
 *  operation-persist pipe (byte-identical when false). */
export function aggregateHasResidualInvariants(agg: AggregateIR): boolean {
  return residualInvariants(agg).length > 0;
}

/** The `validate_invariants/1` function body — a public `def` (the context
 *  facade's operation-persist path pipes through it too, not just the module's
 *  own `base_changeset`/`update_changeset`).  Empty string when the aggregate
 *  has no residual invariant.  `contextModule` is the `<App>.<Ctx>` prefix the
 *  expression renderer uses for `this`-rooted references. */
export function renderInvariantValidatorFn(
  /** Structural, not `AggregateIR`: an ENTITY PART carries its own invariants
   *  and its own `changeset/2`, and renders the identical validator (M-T6.55
   *  F14).
   *
   *  `derived` joins `invariants`/`fields` since #3023: a `this-derived` read
   *  INLINES its defining expression, and `renderExpr` can only do that when
   *  `ctx.agg` carries the index — without it the arm falls back to
   *  `data.<name>`, a struct key that does not exist, and the rule ships a
   *  runtime `KeyError` instead of enforcing anything.  A part carries its own
   *  `derived`, so both call sites supply it. */
  agg: Pick<AggregateIR, "invariants" | "fields" | "derived"> &
    Partial<Pick<AggregateIR, "contains">>,
  contextModule: string,
): string {
  const residuals = residualInvariants(agg);
  if (residuals.length === 0) return "";
  // `renderExpr` reads exactly one member off `ctx.agg` — `derived`, for the
  // `this-derived` inliner.  A part is not an `EnrichedAggregateIR` and cannot
  // be widened into one, so the index is handed over under that shape; the cast
  // is narrow and deliberate, and `derived-inline` tests pin the behaviour it
  // buys (a missing index is a runtime KeyError, not a type error).
  const rc: RenderCtx = {
    thisName: "data",
    contextModule,
    agg: { derived: agg.derived ?? [] } as RenderCtx["agg"],
  };
  const fallbackField = agg.fields?.[0]?.name ?? "id";
  // Collection-valued reads needing the `NotLoaded` normalisation: a
  // CONTAINMENT (`contains lines: Line[]` → `has_many`, the one that can be
  // `%NotLoaded{}`) and a value collection (`tags: Tag[]`, an array FIELD).
  // Containments live on `agg.contains`, not `agg.fields` — a part call site
  // passes no `contains` at all, hence the optional read.
  const collectionFields = new Set<string>([
    ...(agg.contains ?? []).filter((c) => c.collection).map((c) => c.name),
    ...(agg.fields ?? []).filter((f) => f.type.kind === "array").map((f) => f.name),
  ]);
  const normalised = new Set<string>();

  const checks = residuals.map((inv) => {
    const pred = renderExpr(inv.expr, rc);
    const field = snake(pickErrorPath(inv) ?? fallbackField);
    const msg = inv.message ? inv.message.text : `must satisfy: ${inv.source}`;
    // A messaged rule attaches the stable content-hash wire `code` (the i18n
    // key) as `add_error` metadata (`loom_code:`), surfaced by the 422 handler;
    // a message-less rule adds no metadata (byte-identical).
    const codeOpt = inv.message
      ? `, loom_code: ${JSON.stringify(messageCode(inv.message.text))}`
      : "";
    // The message goes through the shared escaping funnel: a raw `#{` in the
    // author's `message "…"` (or in the derived `must satisfy: <source>`) would
    // interpolate when the changeset runs, not read as text.
    const violate = `add_error(changeset, :${field}, ${elixirString(msg)}${codeOpt})`;
    for (const c of referencedContainments(inv, collectionFields)) normalised.add(c);
    const core = inv.guard
      ? `      if ${renderExpr(inv.guard, rc)} do
        if ${pred}, do: changeset, else: ${violate}
      else
        changeset
      end`
      : `      if ${pred}, do: changeset, else: ${violate}`;
    // The `valid?` gate is carried ONLY by the shapes widened in #3023 — see
    // `extendedShape`.  A pre-existing scalar residual keeps its exact previous
    // form, so its emitted bytes do not move.
    if (!extendedShape(inv)) return `    changeset =\n${core}`;
    return `    changeset =
      if changeset.valid? do
${core.replace(/^/gm, "  ")}
      else
        changeset
      end`;
  });

  // One normalisation per referenced collection, before any check reads it.
  const normLines = [...normalised]
    .map((n) => `    data = %{data | ${snake(n)}: __loom_list(data.${snake(n)})}`)
    .join("\n");
  const normBlock = normLines ? `${normLines}\n\n` : "";
  const helper = normalised.size
    ? `

  # A \`has_many\` nobody preloaded is \`%Ecto.Association.NotLoaded{}\`, and
  # \`Enum.count/1\` on that raises.  An unloaded collection means "no children"
  # here — on CREATE the payload omitted the key, on UPDATE the repository
  # preloads — which is the empty list the other backends hold.
  defp __loom_list(%Ecto.Association.NotLoaded{}), do: []
  defp __loom_list(nil), do: []
  defp __loom_list(v), do: v`
    : "";

  return `  @doc "Assert the aggregate's cross-field invariants on the proposed struct — an unmet one surfaces as a changeset error (422), the domain floor the other backends enforce at construction."
  def validate_invariants(changeset) do
    data = apply_changes(changeset)

${normBlock}${checks.join("\n\n")}

    changeset
  end${helper}`;
}
