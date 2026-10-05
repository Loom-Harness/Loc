// Pinned findings for the EMITTED-SOURCE authorization census
// (`authz-emitted-census.test.ts`, M-T9.41).
//
// Every entry is a defect the census FOUND in emitted code and this packet —
// test-only by charter (wave C3) — handed off rather than fixed.  The register
// RATCHETS both ways, like `authz-gate-census-pins.ts`: a new finding fails
// until it is fixed or pinned here, and a pin whose finding no longer
// reproduces fails as STALE, so the fix deletes its pin in the same change.
//
// Keys are `<case> <variant>` → `{ <finding key>: <reason> }`, the finding key
// exactly as the census prints it (`findingKey` in `authz-emitted-census.ts`),
// so a failure message can be pasted here verbatim.

/** Reason classes — one per distinct defect, shared by every cell it shows up in. */
export const R = {
  /** HANDED OFF (src/generator/dotnet — wave C3 packet 3c note).  The
   *  `shape: document` read path hoists ONE `_CapabilityVisible` predicate
   *  (tenant AND not-deleted) and applies it to every document read — the
   *  `ignoring tenantOwned` / `ignoring *` finds included — on BOTH .NET
   *  adapters.  The bypass is silently not honoured: fail-CLOSED (a cross-tenant
   *  admin read returns only the caller's tenant), never a leak, and
   *  `FILTER_BYPASS_FAMILIES` (`src/ir/validate/checks/context-filter-checks.ts`)
   *  lists `dotnet` as honouring the clause, so no diagnostic fires.  The .NET
   *  twin of the elixir `G2667-A11` row that #2667 recorded and drained.
   *  Relational finds on the same aggregate family honour it (EF
   *  `IgnoreQueryFilters([...])`, Dapper's omitted conjunct), so the defect is
   *  in the document repository emitters only: EF
   *  `src/generator/dotnet/emit/repository.ts:785` (the document find's
   *  `loadAll` appends `.Where(_CapabilityVisible)` without consulting
   *  `f.bypassAll` / `f.bypassCaps`) and its Dapper twin
   *  `src/generator/dotnet/emit/dapper.ts:2124`.  A fix must keep the
   *  `policy { deny }` conjunct under `ignoring *` (F2-ADP-1): split the
   *  predicate into bypassable and non-bypassable parts, as the relational
   *  Dapper arm already does (`keptFilterParts`, `emit/dapper.ts:1349`). */
  dotnetDocumentBypassNotHonoured:
    "HANDED OFF: .NET (EF + Dapper) document finds apply the shared `_CapabilityVisible` predicate " +
    "to `ignoring` finds too — the bypass is silently not honoured (fail-closed), while " +
    "`FILTER_BYPASS_FAMILIES` certifies dotnet as honouring it",
} as const;

export const EMITTED_FINDING_PINS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  "corpus/find-bypass dotnet": {
    "dotnet retained:principal Note@AnyTenantNote (Repositories/NoteRepository.cs)":
      R.dotnetDocumentBypassNotHonoured,
    "dotnet retained:principal Note@UnfilteredNote (Repositories/NoteRepository.cs)":
      R.dotnetDocumentBypassNotHonoured,
  },
  "corpus/find-bypass dapper": {
    "dapper retained:principal Note@AnyTenantNote (Repositories/NoteRepository.cs)":
      R.dotnetDocumentBypassNotHonoured,
    "dapper retained:principal Note@UnfilteredNote (Repositories/NoteRepository.cs)":
      R.dotnetDocumentBypassNotHonoured,
  },
};

/** How many pins each reason carries — recomputed from the pins by the gate and
 *  compared both ways (a prose tally is a cache with no invalidation). */
export const PIN_CLASS_CENSUS: Readonly<Record<string, number>> = {
  dotnetDocumentBypassNotHonoured: 4,
};
