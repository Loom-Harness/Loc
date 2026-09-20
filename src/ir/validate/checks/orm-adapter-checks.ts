// -------------------------------------------------------------------------
// Per-backend ORM/adapter support gates: Dapper and MikroORM.  Split out of
// system-checks.ts by packet 2.6 (wave-2) — mechanical move, no logic change.
// The third resident, the per-adapter find-predicate gate, was deleted in wave
// C2 packet 2n; see the note at the foot of this file.
// -------------------------------------------------------------------------

import { diagMessage } from "../../../diagnostics/messages.js";
import type {
  BoundedContextIR,
  EnrichedAggregateIR,
  SystemIR,
} from "../../types/loom-ir.js";
import { effectiveSavingShape, resolveDataSourceConfig } from "../../util/resolve-datasource.js";
import type { LoomDiagnostic } from "./diagnostic.js";

// ---------------------------------------------------------------------------
// `persistence: dapper` capability gate (D-REALIZATION-AXES).
//
// The .NET Dapper adapter is at full parity with EF Core: every
// relational/document/embedded/ES/inheritance shape, containment (incl.
// recursive part-in-part), associations, audit/provenance, managed fields,
// retrievals, seeds, and the workflow outbox all emit.  This check fires ONLY
// for a genuinely-impossible shape (an un-owned by-value entity-array part
// field — no relational storage form on any adapter), a fail-fast guard like
// the category-A stamp guard.
// ---------------------------------------------------------------------------
// Element kinds a Dapper part collection field can round-trip as one `jsonb`
// column (System.Text.Json list serialisation) — kept in lockstep with
// `arrayElemCs` in `src/generator/dotnet/emit/dapper.ts` (ir/validate may not
// import generator/, so the two lists are mirrored, not shared).

export function validateDapperSupport(sys: SystemIR, diags: LoomDiagnostic[]): void {
  const ctxByName = new Map<string, BoundedContextIR>();
  for (const m of sys.subdomains) for (const c of m.contexts) ctxByName.set(c.name, c);

  for (const dep of sys.deployables) {
    if (dep.persistence !== "dapper") continue;
    const reject = (subject: string, reason: string): void => {
      diags.push({
        severity: "error",
        message: diagMessage("loom.dapper-unsupported", { name: dep.name, subject, reason }),
        source: `${sys.name}/${dep.name}`,
        code: "loom.dapper-unsupported",
      });
    };
    for (const ctxName of dep.contextNames) {
      const ctx = ctxByName.get(ctxName);
      if (!ctx) continue;
      // Not gated here, and why:
      //
      // QUERY-TIME PROJECTIONS emit — the four direct-table arms render as raw
      // Npgsql (the same `NpgsqlDataSource` + private row DTO + `Map` shape the
      // FOLDED read controller uses).  A direct-table arm over a COLUMN-LESS
      // source is refused UNIVERSALLY in
      // `validateColumnlessProjectionSources`, not per-adapter: every backend
      // names the same missing column (a document aggregate maps to a
      // hand-rolled `<Agg>Document` row type, so `o.Total` is CS1061 on EF
      // Core too).
      // `retrieval` bundles emit — `Run<Name>Async` renders as parameterised
      // SQL (where + sort + offset/limit paging); a predicate outside the
      // Dapper subset stubs (NotImplementedException), mirroring the find path.
      // `seed` data emits — the Dapper seeder (Seed.cs) frames the marker table
      // / raw inserts on Npgsql+Dapper while reusing the persistence-agnostic
      // domain-`Create` path (I<Agg>Repository.SaveAsync).
      // Workflow event subscriptions (and therefore channels/outbox) are wired
      // on the Dapper adapter: the saga handlers depend on the
      // persistence-neutral Domain.Common ports, whose raw-Npgsql adapters
      // (DapperPersistencePorts.cs) replace the EF AppDbContext ones; the outbox
      // dispatcher/relay + workflow-instances read controller + saga / outbox /
      // event tables are all emitted through NpgsqlDataSource + DbSchema.
      for (const agg of ctx.aggregates) {
        const a = agg as EnrichedAggregateIR;
        const where = `aggregate '${ctxName}.${agg.name}'`;
        // Event sourcing IS supported on this adapter (appliers): the
        // `<agg>_events` stream + fold reuse the persistence-agnostic
        // domain/CQRS layer.  An event-sourced aggregate has no state table,
        // so the `shape: ...` axis is moot — skip that check for it.
        const shape = effectiveSavingShape(a, resolveDataSourceConfig(a, ctx, sys));
        // shape: document IS supported (D-DOCUMENT-AXIS, Dapper edition): the
        // whole aggregate persists as one JSONB `data` blob (a `(id, data,
        // version)` table), reusing the persistence-agnostic ToSnapshot/
        // FromSnapshot round-trip.  Contained parts + `X id[]` references fold
        // INTO the blob, so the relational-only containment/association gates
        // below are moot for it — skip them.  shape: embedded is still gated.
        // shape: embedded IS supported too (Dapper edition): flat root columns
        // PLUS one JSONB column per containment (the part sub-graph folds into
        // it via the ToSnapshot/FromSnapshot round-trip), no child tables.  A
        // part-in-part folds through the same snapshot recursion (the nested
        // `<Part>Snapshot` records + FromSnapshot loop), so it is supported —
        // only a part-collection field whose element kind is outside the
        // jsonb-serialisable set stays gated by the shared containment block.
        const isDocShape = a.persistedAs !== "eventLog" && shape === "document";
        if (
          a.persistedAs !== "eventLog" &&
          shape !== "relational" &&
          shape !== "document" &&
          shape !== "embedded"
        )
          reject(where, `is persisted as shape(${shape})`);
        // Aggregate inheritance: TPC (`ownTable`) IS supported — each concrete
        // is a standalone table with the merged base fields (a normal Dapper
        // repository), and the polymorphic `find all <Base>` base reader is
        // persistence-agnostic (it delegates to each concrete's `All()`).  TPH
        // (`sharedTable`) IS supported too — one shared table named for the base
        // (id + `kind` discriminator + base columns + the nullable union of
        // every concrete's own columns), each concrete repo targeting that table
        // with a spliced `kind = '<Concrete>'` read filter + discriminator-literal
        // INSERT, threading the shared `<Base>Id`.  A TPH member carrying
        // `contains` (nested parts) or an `X id[]` reference collection NOW
        // composes with the containment child-table + association join-table
        // passes: those child / join tables FK the SHARED BASE row's id (EF's
        // TPT-via-contains under a TPH root), so no gate.
        if (isDocShape) continue;
        // Reference-collection associations (`X id[]`) are supported: one
        // ordinal-ordered join table each (DbSchema), bulk-loaded on every
        // read and full-list-replaced on save by the Dapper repository.
        //
        // Nested entity parts (`contains lineItems: LineItem[]`) are supported
        // for STATE aggregates whose parts are FLAT: one child table per
        // containment (`id` PK + `<agg>_id` FK + the part's scalar/enum/vo/id
        // columns), bulk-loaded on every read and hydrated through the root's
        // `_Create(State)` seam, full-list-replaced on save, and cascade-deleted.
        //
        // Event-sourced (`persistedAs: eventLog`) aggregates persist to the
        // `<ctx>_events` stream, NOT a state table — their contained parts fold
        // in-memory from the event stream (the `apply(...)` bodies), so the
        // relational containment emitters (child tables, HydrateAsync, the
        // array-throwing `fieldColumn`) never run for them.  The Dapper event
        // store reuses the persistence-agnostic domain fold unchanged, so
        // `contains` (in any shape) needs no gate on an event-sourced aggregate.
        //
        // Nested entity parts + reference-collection associations (`X id[]`)
        // COMPOSE: every read hydrates the child tables through `_Create(State)`
        // first, then `LoadRefsAsync` post-sets the writable ref-collection list
        // on the reconstructed roots — the two hydrate paths run in sequence,
        // not exclusively.
        //
        // Part-in-part (a contained part with its OWN `contains`) is supported
        // for BOTH shapes.  RELATIONAL child-table shape: `partChildrenOf` builds
        // the containment TREE, each grandchild a table FK'd to its DIRECT parent
        // part; hydration recurses bottom-up (children grouped by parent-part id,
        // slotted into the parent's `Map`), save recurses the object graph, and
        // delete relies on the FK cascade.  The `shape: embedded` fold (one JSONB
        // column per root containment) folds a part-in-part too — the containment
        // column serialises `part.ToSnapshot()`, whose `<Part>Snapshot` recurses
        // into the part's own `contains` (nested snapshot records + the
        // FromSnapshot rehydrate loop), so the whole subtree round-trips through
        // the one column.  No gate.
        //
        // A scalar / enum / value-object / id COLLECTION field on a part IS
        // supported — it stores as one `jsonb` column holding the serialised
        // list (System.Text.Json round-trip, the raw-Npgsql mirror of EF's
        // primitive-collection JSON mapping).  A part FIELD typed as an array of
        // a sibling ENTITY needs no gate: it lowers to a containment (its own
        // grandchild table, part-in-part above), never a by-value column, and a
        // cross-aggregate entity is a structural error — so no un-owned entity
        // collection can reach this check.
        // Lifecycle stamping is supported (onUpdate mutates the aggregate
        // pre-save; onCreate binds INSERT-only parameters excluded from the
        // upsert SET), INCLUDING principal-referencing stamp values — the
        // Dapper repository reaches the request principal through the ambient
        // `RequestContext.Current!.CurrentUser!` accessor (a bare `currentUser`
        // → the principal id, `currentUser.<claim>` → the claim), exactly as
        // the EF AuditableInterceptor.  A principal stamp on a no-auth
        // deployable stays rejected by the category-A loom.stamp-principal-without-auth.
        //
        // HIERARCHICAL TENANCY is supported (wave C2 packet 2b).  The
        // `deep`/`global` read level lowers to the materialized-path
        // `authz-filter` sentinel, which `authzFilterToSql` now renders as the
        // raw-Postgres descendant-or-self fragment (`data_key = @anchor OR
        // (data_key LIKE @pattern ESCAPE '!' AND strpos(data_key, @needle) =
        // 1)`, with the NULL-`data_key` flat-tenant fallback) — the twin of the
        // MikroORM `raw()` rendering.  The sentinel carries no child
        // `currentUser.<claim>` node, so `collectFilterPrincipalRefs`
        // contributes its four bindings BY KIND; that gap in a hand-rolled walk
        // was the whole of the old refusal, and the collector now rides
        // `walkExprDeep`.  The `deny` sentinel renders `1 = 0` as before.
        // Capability filters are supported too (spliced into every SELECT's
        // WHERE); a principal-referencing one lowers `currentUser.<claim>` to a
        // `@__cu_<claim>` Dapper param bound from the same ambient principal.
        // Access modifiers (`managed` / `token` / `internal` / `secret`) are
        // wire-projection concerns handled by the shared Domain/CQRS layers
        // (create-input shaping, `forApiRead` response stripping) — the Dapper
        // column round-trips like any other field, so no gate.  Provenanced
        // fields are supported too: the co-located `<field>_provenance` jsonb
        // column round-trips the ProvLineage (ProvJson.Options) and the Dapper
        // SaveAsync flushes the drained lineage into the `provenance_records`
        // history table (DbSchema owns its DDL) — the raw-Npgsql mirror of the
        // EF value-converter + ProvenanceRecord flush.
      }
    }
  }
}

// ---------------------------------------------------------------------------
// `persistence: mikroorm` capability (D-REALIZATION-AXES).
//
// The node/hono MikroORM adapter is the SECOND node persistence backend
// (alongside the default `drizzle`).  On the PERSISTENCE axis it is at full
// parity with drizzle: every shape / inheritance / containment / association /
// audit / provenance / managed-field / seed / event-sourcing intersection
// emits; persist-time audit stamping injects the audit columns into
// `em.upsert(...)` from the ambient principal; server-managed access
// (`managed` / `token` / `internal` / `secret`) stores as an ordinary column;
// hierarchical (`deep`/`global`) tenancy scope is expressible through a `raw()`
// FilterQuery key; and a root SCALAR/ENUM collection field (`tags: string[]`,
// `kinds: Status[]`) — the one shape this adapter was genuinely BEHIND drizzle
// on — now has a column arm too (`columnsForType`'s `"array"` case,
// `typescript/emit/mikroorm.ts`, mirroring drizzle's own native array column):
// `validateMikroOrmSupport` and its `#scalar-array` reject drained with it
// (M-T6.23).
//
// `loom.mikroorm-unsupported` is still raised, from `migration-checks.ts`
// (`#migrations`, `#schema-split`, `#schema-ignored`) — the two genuinely
// unmappable self-provisioning limits this adapter's `orm.schema.updateSchema()`
// boot-time schema owner cannot express: a declared migration STEP (no
// migration chain to apply it through) and Postgres schema PLACEMENT.  Before
// adding a further clause under that code, answer both questions this gate has
// always asked: is the shape really inexpressible on THIS adapter, and is it
// really specific to it?  A shape impossible on every backend belongs in a
// target-neutral AST rule instead — abstract-inheritance-base-with-`contains`
// lives in `loom.abstract-aggregate-contains`
// (`src/language/validators/inheritance.ts` Rule 3b) for exactly that reason.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// (The per-persistence-adapter find-predicate capability gate lived here.
//
// It existed because each relational adapter was believed to lower a different
// subset of the queryable sublanguage, so a predicate that passed the general
// `firstNonQueryableNode` check could still fall outside the SELECTED adapter's
// narrower one.  Two waves of measurement dissolved that premise: EF Core and
// Drizzle were always the full-subset baseline, `DAPPER_SUBSET = FULL_SUBSET`
// (wave C2 packet 2b), and MikroORM's narrowings turned out one by one to be
// either a defect one layer out (the missing `currentUser: User` parameter) or a
// TARGET-neutral refusal wearing an adapter's name (the `contains(<column>)`
// argument, packet 2f).
//
// The last five firings — a bare bool value-object sub-property, its negation, a
// bool PARAMETER, a `currentUser.<claim>`, and a literal, all standing alone as
// the whole predicate — were the same mistake once more.  Four of the five ALSO
// crashed drizzle codegen from source that validated `0 error(s)`
// (`QueryEmissionRefusal … the IR validator should have rejected this filter`),
// which is what an adapter-keyed gate can never catch: it keys on
// `dep.persistence`, which a deployable on the DEFAULT adapter does not carry.
// The real hole was that `firstNonQueryableNode` is position-BLIND, so
// `firstNonQueryablePredicate` (`checks/shared.ts`) now owns the PREDICATE
// position target-neutrally, and the two column-rooted shapes that were
// genuinely missing were built on both node adapters.
//
// `test/ir/find-predicate-position-census.test.ts` is the census that licenced
// the deletion: every shape gets the same verdict on all four adapters, and
// every admitted shape emits on all four.)
// ---------------------------------------------------------------------------
