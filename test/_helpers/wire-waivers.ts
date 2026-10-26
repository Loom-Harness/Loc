// ---------------------------------------------------------------------------
// The wire-differential waiver registry (M-T9.11 slice c).
//
// Every entry is a KNOWN, REVIEWED divergence between a backend and the
// canonical wire golden — the exact shape of the corpus `COMPILE_SKIP` maps and
// the M-T9.8 allowlist ratchet: a gap is a line of code someone signed, with a
// reason and a named exit, never a silent filter.
//
// Rules for adding one:
//   1. First decide WHO IS RIGHT — the golden is an oracle, not a vote.  If the
//      GOLDEN is wrong, fix the golden (rebaseline with LOOM_WIRE_UPDATE=1) and
//      open a bug on the backend that was accidentally the reference.
//   2. `reason` MUST name the RS-rule (`RS-n`, docs/conformance-semantics.md)
//      or the mission/PR that closes it.  `wire-record.test.ts` enforces this.
//   3. Scope as narrowly as the divergence: list the exact backends, add
//      `cases`/`request`/`kinds` when you know them, and prefer an exact `path`
//      over `**.` or `**`.
//
// The registry RATCHETS DOWN: a waiver that stops matching fails the gate as
// stale (see `staleWaivers`), so a fixed backend must delete its waiver in the
// same PR.  The list is meant to shrink to nothing.
//
// HISTORY — and the current state.  The list was empty from the RS-13/RS-14
// fixes until 2026-07-30, when the M-T9.11 coverage expansion (5 shared systems
// -> the corpus feature cases) found three java divergences no gate had reached.
// The RS-20 pair (java's `version` counting Hibernate ROW DIRTINESS instead of
// persisted commands) held five waivers here until the java repository save was
// made to drive the counter explicitly with a guarded `where version =
// :expected` bump; all five were deleted with that fix.  The last four — one
// RS-18 (elixir's crudish update ran a changeset, so a provenanced field kept
// the PREVIOUS write's lineage) and three M-T6.20 (elixir's messaged
// `precondition` answered the domain-floor 422 instead of the wire-validation
// `errors[]` shape) — went the same way: the elixir repository update now
// re-captures each provenanced write site off the applied changeset, and a
// wire-translatable messaged precondition denies with `{:validation_failed,
// errors}` rendered through the shared `errors[]` 422 sender.
//
// That drain took the registry back to empty on 2026-08-16, except for one
// entry that landed the same day — #2563, .NET backing a wire `decimal` with
// `System.Decimal` and so truncating a projection `avg` to ~15 significant
// digits.  That is now fixed too (the RESPONSE field is a `double`, the
// float64 the other four backends send), so the registry is EMPTY again.
//
// Empty is the target state, not a milestone: a new divergence is a BUG to fix
// on the diverging backend first, and a waiver only when fixing it is a mission
// of its own with a named exit.
// ---------------------------------------------------------------------------

import type { WireWaiver } from "./wire-record.js";

// 2026-10-11 — #3224 armed `transactional-workflow-event-rollback` on the
// Dapper and python legs, the first golden to record an optimistic-concurrency
// 409 off a non-node backend.  Status, `title` and `type` agree; only the `detail`
// sentence differs (node names the aggregate + id, the other four answer one
// fixed sentence).  M-T6.91 rules the canonical sentence and deletes this.
// `elixir` joined with M-T6.92, which turned its 500 into the same 409.
export const WIRE_WAIVERS: readonly WireWaiver[] = [
  // elixir's workflow / explicit-route dispatcher receives the bare
  // `{:error, :conflict}` (no aggregate, no row), so its 409 `detail` is the
  // generic sentence.  Status, `title` and `type` agree; every other backend
  // names `<Aggregate> <id>` (RS-40).  #3838 carries both through the term.
  {
    backends: ["elixir"],
    cases: ["transactional-workflow-event-rollback"],
    request: "POST /api/workflows/debit_twice",
    path: "$.detail",
    kinds: ["value"],
    reason:
      "#3838 — the elixir workflow dispatcher's conflict 409 names no aggregate/id (its {:error, :conflict} term carries neither); the other four serve `<Aggregate> <id> was modified by another request`",
  },
  // 2026-10-25 — #3595's #3954 fixture: java's `softDelete` does not bump
  // `version`, visible through the `ignoring softDeletable` read-back (RS-20).
  ...(["GET /api/cars/by_plate_all?*", "GET /api/drivers/by_name_all?*"] as const).map(
    (request): WireWaiver => ({
      backends: ["java"],
      cases: ["inheritance-read-restrictions"],
      request,
      path: "$.version",
      kinds: ["value"],
      reason: "#4035 — RS-20: a soft delete leaves java's version counter where the create put it",
    }),
  ),
  // The same java gap on `find-bypass`: the soft-deleted row read back through
  // `ignoring *` carries the version the update left.
  {
    backends: ["java"],
    cases: ["find-bypass"],
    request: "GET /api/orders/unfiltered?*",
    path: "$.version",
    kinds: ["value"],
    reason: "#4035 — RS-20: a soft delete leaves java's version counter where the update put it",
  },
  // 2026-10-25 — #3595 booted `projection-valueobject-row` on elixir for the
  // first time: the read model round-trips, but a nested value object's keys
  // reach the wire in their column spelling (`at_time`), not camelCase (RS-1).
  ...(["**.atTime", "**.at_time"] as const).map(
    (path): WireWaiver => ({
      backends: ["elixir"],
      cases: ["projection-valueobject-row"],
      request: "GET /api/projections/order_board/*",
      path,
      kinds: ["key-set"],
      reason:
        "#4023 — RS-1: a value object nested in a folded projection's read model keeps its snake_case leaf keys on elixir",
    }),
  ),
  // MikroORM's folded projection hands its `money` column to the wire without
  // the scale-4 formatting its aggregate fields get (RS-12).
  {
    backends: ["mikroorm"],
    cases: ["projection-fold-statements"],
    request: "GET /api/projections/account_board/*",
    path: "$.charged",
    kinds: ["value"],
    reason:
      "#4214 — RS-12: a folded projection's money column reaches the wire unscaled on mikroorm",
  },
  // The .NET and java request validators apply a value object's invariant one
  // level deep, so a breach inside a VO nested in a VO reaches the domain constructor
  // and answers its domain-error 422 (no `errors[]` pointer) instead of the
  // field-validation one.  Status agrees.
  ...(["$.title", "$.detail", "$.errors[*].pointer"] as const).map(
    (path): WireWaiver => ({
      backends: ["dotnet", "dapper", "java"],
      cases: ["vo-root-kernel"],
      request: "POST /api/shipments",
      path,
      kinds: ["value"],
      reason:
        "#4215 — a nested value object's invariant is not checked by the .NET / java request validator; the 422 comes from the domain",
    }),
  ),
  // node/drizzle orders every read with no declared order by `id` (the
  // read-scope order).  The other legs still answer Postgres's physical order,
  // which moves a row an `update` rewrote to the end, so the three reads below
  // that list a row after updating it come back in a different order.  Each
  // entry goes when that backend's reads take the `id` order.
  ...(
    [
      ["projection-join", "GET /api/projections/order_with_customer"],
      ["prefix-filter", "GET /api/docs/under/root"],
      ["datetime-wire", "GET /api/projections/slot_board"],
    ] as const
  ).map(
    ([c, request]): WireWaiver => ({
      backends: ["dotnet", "dapper", "java", "python", "elixir", "mikroorm"],
      cases: [c],
      request,
      path: "$",
      kinds: ["ordering"],
      reason:
        "#3438 — only node/drizzle orders an unordered read by `id` yet; the other legs answer physical (heap) order",
    }),
  ),
  // node answers an absent required field with the `wirePolicy` sentence
  // `"<field> is required"` (`missingFieldMessage`); the other legs still send
  // the one word `"Required"`.  Status, pointer and the rest of the body agree.
  // Each backend deletes its name here when it renders the fact's sentence.
  ...(
    [
      "absent-optional",
      "acronym-names",
      "audit-history-guarded",
      "audit-history",
      "audited",
      "collection-op-shapes",
      "concurrency-conflict",
      "contained-part-rebuild",
      "contained-part-removal",
      "date-scalar",
      "datetime-wire",
      "decimal-exact",
      "domain-floor-messages",
      "domain-services",
      "embedded-optional",
      "embedded",
      "enum-collection",
      "event-sourcing",
      "field-mask",
      "file-download",
      "find-bypass",
      "inheritance-base-reads",
      "inheritance",
      "inheritance-read-restrictions",
      "java-reserved-words",
      "ledger",
      "lifecycle-guard",
      "numeric-operands",
      "optional-reference",
      "payments",
      "policy-deny",
      "projection-groupby",
      "projection-tph-source",
      "projection-valueobject-row",
      "provenance",
      "python-reserved-words",
      "scaffold-macros",
      "shapes",
      "single-containment",
      "stamps-principal",
      "stamps",
      "storefront-system",
      "tph-crossings",
      "tph",
      "transactional-workflow-event-rollback",
      "transactional-workflow-post-commit-dispatch",
      "union-find-absence",
      "validation-messages",
      "vo-cross-context",
      "vo-id-reference",
      "vo-invariant-in-body",
      "wire-contract",
      "wire-ingress",
      "workflow-command-payload",
      "workflow-create-result",
      "workflow-enum-state",
      "workflow-two-handles-containment",
      "workflow-two-handles-document-eventlog",
    ] as const
  ).map(
    (c): WireWaiver => ({
      backends: ["dotnet", "dapper", "java", "elixir"],
      cases: [c],
      path: "$.errors[*].message",
      kinds: ["value"],
      reason:
        '#3881 — only node renders the wirePolicy missing-field sentence `"<field> is required"` yet; the other legs send `"Required"`',
    }),
  ),
];
