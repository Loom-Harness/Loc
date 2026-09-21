import { diagMessage } from "../../../diagnostics/messages.js";
import { forCreateInput, isConstructible } from "../../enrich/wire-projection.js";
import type { BoundedContextIR, EnrichedAggregateIR, FieldIR } from "../../types/loom-ir.js";
import type { LoomDiagnostic } from "./diagnostic.js";

// ---------------------------------------------------------------------------
// Server-initialised-field constructibility (F-017).
//
// `managed` / `internal` take a field OFF the create input — the server owns
// its value.  But "the server owns it" is only half a contract: something has
// to WRITE it.  A field that is
//
//   * non-optional (so `null` is not a legal value for it),
//   * off the create input (so the client cannot supply it),
//   * carries no `= <default>` (so construction has no declared value), and
//   * is written by no lifecycle `stamp` (so persist-time supplies none),
//
// has NO input, anywhere, that gives it a value.  The aggregate cannot be
// created — which is not a per-backend detail but a property of the MODEL, and
// exactly why this is a validate-time refusal rather than an emitter seed:
//
//   aggregate Thing with crudish { label: string  total: money managed }
//
// | backend | what the synthesized create does with `total` |
// |---|---|
// | node    | `total: null` into a non-nullable `Decimal` slot — TS2322, the emitted project does not compile; reached at runtime it was `HTTP 500` / "Cannot read properties of null (reading 'toString')" |
// | dotnet  | never assigns it — `default!`, so a fabricated `0` is persisted silently |
// | java    | never assigns it — `null` into a `NOT NULL` column, the insert fails at flush |
// | elixir  | never casts it — `nil` against `null: false`, the insert raises |
// | python  | `None` into a `NOT NULL` column |
//
// Seeding a value in the emitters would make the model compile while leaving
// the VALUE fabricated — a silently-wrong `0` is worse than a refusal.  The
// honest outcome is to say the aggregate is unconstructible and name the three
// ways to make it constructible (`= <default>`, a `stamp onCreate`, or `T?`).
//
// What is deliberately NOT flagged — each has a language-defined value for an
// absent field, so "unwritten" is well-defined rather than missing:
//
//   * `bool`        — absent is `false` (`createOmissionValue`'s own rule, the
//                     one the create-input required-set already applies).
//   * a COLLECTION  — absent is the empty collection.  `party: Pokemon id[]
//                     managed` built up by later operations is ordinary
//                     modelling, and every backend already lands `[]` there.
//   * `token`       — `id` / `version` are minted by the factory itself.
//   * event-sourced — state is folded from the creation event by the appliers,
//                     not written by a create factory.
//   * abstract      — never instantiated.
//   * non-constructible — no create factory is emitted at all
//                     (`isConstructible`), so there is no site to leave unset.
//
// The capability prelude is the false-positive hazard this check is shaped
// around: `auditable` (createdAt/updatedAt/createdBy/updatedBy), `tenantOwned`
// (tenantId/dataKey), `versioned` (version) and `softDeletable` (deletedAt) all
// put `managed` fields on an aggregate — and all of them either STAMP the field
// or declare it optional, which is exactly what the two exemptions below read.
// ---------------------------------------------------------------------------

/** Whether an absent value for this field is language-DEFINED rather than
 *  missing: a bare `bool` is `false`, an absent collection is empty.  Mirrors
 *  `createOmissionValue`'s `{kind:"false"}` arm plus the reading the create
 *  contract already takes for a collection. */
function hasLanguageDefinedAbsence(f: FieldIR): boolean {
  const base = f.type.kind === "optional" ? f.type.inner : f.type;
  if (base.kind === "array") return true;
  return base.kind === "primitive" && base.name === "bool";
}

/** Every field any lifecycle stamp writes — `onCreate` AND `onUpdate`.
 *
 *  Both events count, and the `onUpdate` half is not laxity: `auditable`
 *  stamps `createdAt`/`createdBy` onCreate and `updatedAt`/`updatedBy`
 *  onUpdate, and the backends apply the stamp set at PERSIST time, so the
 *  very first insert writes the update columns too.  Keying on
 *  `event === "create"` alone would reject every `with auditable` aggregate in
 *  the repo. */
function stampedFields(agg: EnrichedAggregateIR): ReadonlySet<string> {
  return new Set((agg.contextStamps ?? []).flatMap((s) => s.assignments.map((a) => a.field)));
}

/** Fields that are server-owned but that nothing writes — see the module
 *  header.  One diagnostic per offending field. */
export function validateServerInitialisedFields(
  ctx: BoundedContextIR,
  diags: LoomDiagnostic[],
): void {
  for (const agg of ctx.aggregates as EnrichedAggregateIR[]) {
    if (agg.isAbstract) continue;
    if (agg.persistedAs === "eventLog") continue;
    if (!isConstructible(agg)) continue;
    const suppliable = new Set(forCreateInput(agg.fields).map((f) => f.name));
    const stamped = stampedFields(agg);
    for (const f of agg.fields) {
      if (suppliable.has(f.name)) continue;
      if (f.access === "token") continue;
      if (f.optional || f.type.kind === "optional") continue;
      if (f.default !== undefined) continue;
      if (stamped.has(f.name)) continue;
      if (hasLanguageDefinedAbsence(f)) continue;
      diags.push({
        severity: "error",
        code: "loom.unconstructible-server-field",
        message: diagMessage("loom.unconstructible-server-field", {
          agg: agg.name,
          field: f.name,
          access: f.access ?? "managed",
        }),
        source: `${ctx.name}/${agg.name}.${f.name}`,
      });
    }
  }
}
