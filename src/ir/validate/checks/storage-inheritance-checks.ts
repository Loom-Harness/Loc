// -------------------------------------------------------------------------
// Inheritance storage (TPC/TPH), event-sourced storage, provenanced
// storage, `mask unless` read-redaction support + laundering-through-`emit`
// detection, and audited-operation support.  Split out of system-checks.ts
// by packet 2.6 (wave-2) — mechanical move, no logic change.
// -------------------------------------------------------------------------

import { diagMessage } from "../../../diagnostics/messages.js";
import { descriptorFor } from "../../../platform/metadata.js";
import type {
  BoundedContextIR,
  EnrichedLoomModel,
  ExprIR,
  StmtIR,
  SystemIR,
} from "../../types/loom-ir.js";
import { nonRootFilterFields, rootBaseOf } from "../../util/inheritance.js";
import { walkExprDeep, walkStmtsDeep } from "../../util/walk.js";
import type { LoomDiagnostic } from "./diagnostic.js";
import { firstNonGateRef, GATE_ALLOWED_REFS } from "./query-checks.js";

// Aggregate-inheritance storage gate (aggregate-inheritance.md, I2/I3).
//
// `ownTable` (TPC) emission is wired on every backend: the abstract base is
// dropped from the generation view (system/index.ts `collectContextsFor`) and
// each concrete emits as a standalone table carrying the merged base + own
// fields (the `wireShape` merge in enrichContext).
//
// `sharedTable` (TPH) is implemented on every backend: Hono/Drizzle
// (hand-rolled shared table + `kind` discriminator, per-concrete columns
// nullable, repos filter/stamp `kind`), .NET/EF Core (native
// `HasDiscriminator`), Phoenix (plain Ecto shared table + a `kind`
// discriminator column), Python (SQLAlchemy) and Java (Hibernate). So a TPH
// hierarchy is allowed iff some backend deployable hosts its context;
// otherwise it's an error (not a warning) — there is no emission target.
// `sharedTable` is the omitted-modifier
// default, so an inheritance hierarchy with no `inheritanceUsing: …` is TPH
// too. Polymorphic `Party id` refs and `find all Party` remain deferred (the
// language validator rejects the former); document / TPT shapes are later.

const DEFAULT_INHERITANCE_LAYOUT = "sharedTable" as const;

/** Map each context name to the set of backend (needsDb) platforms that host
 *  it.  An empty / absent set means no backend emits the context at all. */

export function backendPlatformsHostingEachContext(
  loom: EnrichedLoomModel,
): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const sys of loom.systems) {
    for (const d of sys.deployables) {
      if (!descriptorFor(d.platform).needsDb) continue;
      for (const cn of d.contextNames) {
        const set = out.get(cn) ?? new Set<string>();
        set.add(d.platform);
        out.set(cn, set);
      }
    }
  }
  return out;
}

export function validateInheritanceStorage(
  ctx: BoundedContextIR,
  diags: LoomDiagnostic[],
  backendPlatforms: Set<string>,
): void {
  // TPH storage emission ships on every backend, so the hierarchy is
  // emittable as soon as any backend deployable hosts the context.
  if (backendPlatforms.size > 0) return;
  const byName = new Map(ctx.aggregates.map((a) => [a.name, a] as const));
  for (const agg of ctx.aggregates) {
    if (!agg.isAbstract && !agg.extendsAggregate) continue;
    // A concrete's layout defaults to its base's (resolved within the
    // context); a per-concrete `inheritanceUsing: …` override wins. The
    // abstract base uses its own declared layout. Either way an omitted
    // modifier means `sharedTable` (TPH), the documented default.
    const base = agg.extendsAggregate ? byName.get(agg.extendsAggregate) : undefined;
    const effective = agg.inheritanceUsing ?? base?.inheritanceUsing ?? DEFAULT_INHERITANCE_LAYOUT;
    if (effective !== "sharedTable") continue;
    const role = agg.isAbstract ? "abstract base" : `extends ${agg.extendsAggregate}`;
    const how = agg.inheritanceUsing
      ? "inheritanceUsing: sharedTable"
      : "the omitted-modifier default (sharedTable)";
    diags.push({
      severity: "error",
      code: "loom.tph-backend-unsupported",
      message: diagMessage("loom.tph-backend-unsupported", {
        name: agg.name,
        role,
        how,
      }),
      source: `${ctx.name}/${agg.name}`,
    });
  }
}

// ---------------------------------------------------------------------------
// EF Core only: a TPH subtype's capability `filter` must be expressible as a
// ROOT query filter.
//
// EF hosts every query filter in an inheritance hierarchy on the root entity
// type, so a predicate reading a column that exists on ONE subtype cannot be
// registered at all — `nonRootFilterFields` carries the two workarounds and the
// EF Core 10.0.10 errors that rule each of them out.  Without this gate the
// emitter either dropped the filter whole (the old `tph ? [] :` short-circuit,
// a declared read restriction absent from every emitted query with no error at
// all) or emitted a root-typed lambda naming a member the root does not have.
//
// Scoped to the EF adapter, NOT to `platform: dotnet`.  The Dapper adapter
// splices its capability predicates into raw SQL against the shared table, where
// a subtype column is simply a column — so the same model is fine there, and a
// platform-wide gate would reject a shape that works.  Every other backend
// filters per-read, so none of them is affected either.
// ---------------------------------------------------------------------------

export function validateTphFilterExpressibility(sys: SystemIR, diags: LoomDiagnostic[]): void {
  const ctxByName = new Map<string, BoundedContextIR>();
  for (const m of sys.subdomains) for (const c of m.contexts) ctxByName.set(c.name, c);
  const seen = new Set<string>();
  for (const dep of sys.deployables) {
    if (dep.platform !== "dotnet" || dep.persistence === "dapper") continue;
    for (const ctxName of dep.contextNames) {
      const ctx = ctxByName.get(ctxName);
      if (!ctx) continue;
      for (const agg of ctx.aggregates) {
        const stray = nonRootFilterFields(agg, ctx.aggregates);
        if (stray.length === 0) continue;
        // One diagnostic per aggregate, however many .NET deployables host it.
        const key = `${ctx.name}/${agg.name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        diags.push({
          severity: "error",
          code: "loom.tph-filter-unsupported",
          message: diagMessage("loom.tph-filter-unsupported", {
            name: agg.name,
            fields: stray.map((f) => `'${f}'`).join(", "),
            root: rootBaseOf(agg, ctx.aggregates).name,
          }),
          source: key,
        });
      }
    }
  }
}

// Event-sourced storage emission (`persistedAs: eventLog`, appliers A2) is
// implemented on every backend: the `<agg>_events` stream table + fold-on-load
// repository (Phoenix via the per-aggregate stream data layer,
// D-VANILLA-ES-HOME). So an event-sourced aggregate is an error only when no
// backend deployable hosts its context — there is no emission target for the
// event log.  Mirrors the TPH storage gate.

export function validateEventSourcedStorage(
  ctx: BoundedContextIR,
  diags: LoomDiagnostic[],
  backendPlatforms: Set<string>,
): void {
  if (backendPlatforms.size > 0) return;
  for (const agg of ctx.aggregates) {
    if (agg.persistedAs !== "eventLog") continue;
    diags.push({
      severity: "error",
      code: "loom.event-sourcing-backend-unsupported",
      message: diagMessage("loom.event-sourcing-backend-unsupported", { name: agg.name }),
      source: `${ctx.name}/${agg.name}`,
    });
  }
}

// Provenanced storage (`provenanced` fields) is emitted by every backend — the
// lineage SDK + co-located `<field>_provenance` column + the
// `provenance_records` flush.  A context no backend deployable hosts has no
// such runtime, so a `provenanced` field there would silently behave like a
// plain field, dropping the audit trail it promises — an error, not a silent
// no-op.  Mirrors the event-sourcing storage gate.

export function validateProvenancedStorage(
  ctx: BoundedContextIR,
  diags: LoomDiagnostic[],
  backendPlatforms: Set<string>,
): void {
  if (backendPlatforms.size > 0) return;
  for (const agg of ctx.aggregates) {
    const provFields = agg.fields.filter((f) => f.provenanced);
    if (provFields.length === 0) continue;
    const names = provFields.map((f) => f.name).join(", ");
    diags.push({
      severity: "error",
      code: "loom.provenanced-backend-unsupported",
      message: diagMessage("loom.provenanced-backend-unsupported", {
        name: agg.name,
        names,
      }),
      source: `${ctx.name}/${agg.name}`,
    });
  }
}

// `mask unless <expr>` read mask (authorization.md §5) — the aggregate-field
// baseline that redacts a field on the wire unless a `currentUser`-only
// predicate holds.  Two gates:
//   - loom.field-mask-not-current-user — the predicate references something
//     other than `currentUser` (+ constants): the mask is evaluated at DTO
//     projection as a param-free CALLER predicate, so a row/param reference is
//     illegal (mirrors the find gate's currentUser-only rule).
//   - loom.field-mask-unsupported — no backend deployable hosts the context, so
//     no DTO projection emits the redaction.  A parsed-but-unredacted mask is a
//     SECURITY footgun (the sensitive value ships in the clear), so it fails
//     fast rather than silently no-op'ing.  Every backend emits the redaction:
//     `node` emits response-boundary read redaction (`toWireMasked`) across its
//     read routes + explicit handlers; `dotnet` redacts
//     each masked field's DTO-projection arg via the ambient principal; `python`
//     routes response boundaries through `to_wire_masked` (reads the ambient
//     `current_user()` and redacts fail-closed); `java` adds a `<Agg>Response
//     .fromMasked` mapper (static `CurrentUserAccessor.currentOrNull()` guard) the
//     read services + explicit handlers project through (audit keeps `from`);
//     `elixir` (vanilla Phoenix) makes `serialize/1` redact (reading the principal
//     from the process dictionary the Auth plug stashes), moving the raw map to
//     `serialize_unmasked/1` for audit snapshots.
// ---------------------------------------------------------------------------
// `mask unless` LAUNDERING through `emit` (M-T3.15 B0).
//
// The query-time bound below refuses a projection that READS a masked
// aggregate.  A FOLDED projection reaches the same value by a different road:
// the aggregate emits an event carrying the masked field's value, and the
// projection folds that payload into its own row — which every backend serves
// unredacted (a projection row carries no mask marker and no principal is in
// scope on its read routes).  A fold is the ordinary way to build a read model,
// so it is the cheapest of the three bypasses, not the most exotic.
//
// The taint is computed per masked aggregate: an `emit`ted event field whose
// value expression reads a `mask unless` field — directly (`salary`,
// `this.salary`), through a `derived` that reads one, or through a `let` bound
// to either — marks the EVENT as carrying masked data.  A projection folding
// such an event is refused with the same code as the read bypass.
// ---------------------------------------------------------------------------

/** The masked field a single expression reads, or null.  `masked` holds the
 *  aggregate's `mask unless` field names plus every `derived` that reads one;
 *  `taintedLets` maps a body-local `let` name to the masked field it carries. */

function firstMaskedRead(
  e: ExprIR,
  masked: ReadonlySet<string>,
  taintedLets: ReadonlyMap<string, string>,
): string | null {
  let hit: string | null = null;
  walkExprDeep(e, (n) => {
    if (hit !== null) return;
    if (n.kind === "ref") {
      const selfProp =
        n.refKind === "this-prop" || n.refKind === "this-vo-prop" || n.refKind === "this-derived";
      if (selfProp && masked.has(n.name)) {
        hit = n.name;
        return;
      }
      if (n.refKind === "let") {
        const via = taintedLets.get(n.name);
        if (via !== undefined) hit = via;
      }
      return;
    }
    if (n.kind === "member" && n.receiver.kind === "this" && masked.has(n.member)) hit = n.member;
  });
  return hit;
}

/** Map every event whose emitted payload carries a `mask unless` value to the
 *  `<Aggregate>.<field>` that laundered into it. */

export function maskLaunderingEvents(ctx: BoundedContextIR): Map<string, string> {
  const out = new Map<string, string>();
  for (const agg of ctx.aggregates) {
    const maskedFields = agg.fields.filter((f) => f.maskUnless).map((f) => f.name);
    if (maskedFields.length === 0) continue;
    const masked = new Set(maskedFields);
    // A `derived` whose expression reads a masked field carries the same value.
    for (const d of agg.derived) {
      if (firstMaskedRead(d.expr, masked, new Map())) masked.add(d.name);
    }
    for (const op of [...agg.operations, ...(agg.creates ?? []), ...(agg.destroys ?? [])]) {
      const stmts: StmtIR[] = [];
      for (const s of op.statements) walkStmtsDeep(s, (n) => stmts.push(n));
      // Fixpoint over `let` bindings so declaration order (or nesting inside a
      // lambda block) can't hide a chain `let a = salary` / `let b = a`.
      const taintedLets = new Map<string, string>();
      for (let changed = true; changed; ) {
        changed = false;
        for (const s of stmts) {
          if (s.kind !== "let" || taintedLets.has(s.name)) continue;
          const via = firstMaskedRead(s.expr, masked, taintedLets);
          if (via !== null) {
            taintedLets.set(s.name, via);
            changed = true;
          }
        }
      }
      for (const s of stmts) {
        if (s.kind !== "emit" || out.has(s.eventName)) continue;
        for (const f of s.fields) {
          const via = firstMaskedRead(f.value, masked, taintedLets);
          if (via !== null) {
            out.set(s.eventName, `${agg.name}.${via}`);
            break;
          }
        }
      }
    }
  }
  return out;
}

export function validateFieldMask(
  ctx: BoundedContextIR,
  diags: LoomDiagnostic[],
  backendPlatforms: Set<string>,
): void {
  const anyBackend = backendPlatforms.size > 0;
  for (const agg of ctx.aggregates) {
    const masked = agg.fields.filter((f) => f.maskUnless);
    if (masked.length === 0) continue;
    for (const f of masked) {
      const offending = firstNonGateRef(f.maskUnless!, GATE_ALLOWED_REFS);
      if (offending !== null) {
        diags.push({
          severity: "error",
          code: "loom.field-mask-not-current-user",
          message: diagMessage("loom.field-mask-not-current-user", {
            name: agg.name,
            fName: f.name,
            offending,
          }),
          source: `${ctx.name}/${agg.name}.${f.name}`,
        });
      }
    }
    if (anyBackend) continue;
    const names = masked.map((f) => f.name).join(", ");
    diags.push({
      severity: "error",
      code: "loom.field-mask-unsupported",
      message: diagMessage("loom.field-mask-unsupported", { name: agg.name, names }),
      source: `${ctx.name}/${agg.name}`,
    });
  }
  // Query-time projection responses are NOT yet mask-redacted — the shorthand
  // (no `select`) serialises the source aggregate's full wire, and a `select`
  // may read any field — so a masked aggregate can't be a query-time projection
  // source (it would leak the field past the mask).  An honest bound until
  // projection read-masking lands; the field surface itself stays supported.
  const maskedAggNames = new Set(
    ctx.aggregates.filter((a) => a.fields.some((f) => f.maskUnless)).map((a) => a.name),
  );
  if (maskedAggNames.size > 0) {
    const launderingEvents = maskLaunderingEvents(ctx);
    for (const proj of ctx.projections) {
      // `maskedAggNames` holds only aggregate names, so a `source` match is an
      // aggregate source (a workflow / projection source can't collide).
      const src = proj.query?.source;
      if (src && maskedAggNames.has(src)) {
        diags.push({
          severity: "error",
          code: "loom.field-mask-projection-source",
          message: diagMessage("loom.field-mask-projection-source", { name: proj.name, src }),
          source: `${ctx.name}/projection/${proj.name}`,
        });
        continue;
      }
      // A `join` reaches the masked aggregate just as directly as `from` does —
      // `select leaked = c.ssn` off a join alias emitted the raw column on all
      // five backends while the identical read through `from` was rejected.
      // Checking only the source made the bound bypassable by adding a join,
      // which is the opposite of a bound.  Same rule, same diagnostic.
      const joined = (proj.query?.joins ?? []).find((j) => maskedAggNames.has(j.aggregate));
      if (joined) {
        diags.push({
          severity: "error",
          code: "loom.field-mask-projection-source",
          message: diagMessage("loom.field-mask-projection-source", {
            name: proj.name,
            src: joined.aggregate,
            via: "join",
          }),
          source: `${ctx.name}/projection/${proj.name}`,
        });
        continue;
      }
      // A FOLD launders the same value through the event bus: `emit Raised {
      // newSalary: salary }` carries the masked column into a projection row
      // that every backend serves in the clear.  Same rule, same code.
      const laundered = proj.handlers.find((h) => launderingEvents.has(h.event));
      if (laundered) {
        diags.push({
          severity: "error",
          code: "loom.field-mask-projection-source",
          message: diagMessage("loom.field-mask-projection-source#fold", {
            name: proj.name,
            event: laundered.event,
            field: launderingEvents.get(laundered.event),
          }),
          source: `${ctx.name}/projection/${proj.name}`,
        });
      }
    }
  }
}

// Per-operation audit-record emission (`operation … audited`) and audited
// LIFECYCLE actions (`audited create` / `destroy`) ship on every backend — an
// audited public route / command handler / service method appends a
// who/what/when + before/after snapshot to the audit sink in the operation's
// save transaction (the create/destroy handlers stage before:null/after=wire
// and before=wire/after:null).  A context no backend deployable hosts has no
// audit runtime, so an `audited` action there would silently record nothing —
// an error, not a silent no-op.  (This gates the per-operation `audited` flag
// only; the `with audit` capability macro emits stamping rules via
// `contextStamps`, a separate concern.)

export function validateAuditedOperationSupport(
  ctx: BoundedContextIR,
  diags: LoomDiagnostic[],
  backendPlatforms: Set<string>,
): void {
  if (backendPlatforms.size > 0) return;
  const push = (
    agg: BoundedContextIR["aggregates"][number],
    kind: "operation" | "lifecycle action",
    names: string[],
  ): void => {
    diags.push({
      severity: "error",
      code: "loom.audited-backend-unsupported",
      message: diagMessage("loom.audited-backend-unsupported", {
        name: agg.name,
        kind,
        names: names.join(", "),
      }),
      source: `${ctx.name}/${agg.name}`,
    });
  };
  for (const agg of ctx.aggregates) {
    const auditedOps = agg.operations.filter((o) => o.audited);
    if (auditedOps.length > 0) {
      push(
        agg,
        "operation",
        auditedOps.map((o) => o.name),
      );
    }
    const auditedLifecycle = [...(agg.creates ?? []), ...(agg.destroys ?? [])].filter(
      (o) => o.audited,
    );
    if (auditedLifecycle.length > 0) {
      push(
        agg,
        "lifecycle action",
        auditedLifecycle.map((o) => o.name || "<create>"),
      );
    }
  }
}
