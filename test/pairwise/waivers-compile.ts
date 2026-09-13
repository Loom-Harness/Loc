// ---------------------------------------------------------------------------
// M-T9.29 — COMPILE-tier waivers for the pairwise corpus (ALL FIVE backends).
//
// Same ratchet as `waivers.ts`: an entry here means "this crossing GENERATES
// but the emitted project does not compile, and that is a recorded finding".
// The gate fails when an unwaived case fails to compile AND when a waived case
// starts compiling (fix landed → the entry goes, in the same PR).
//
// (The header used to say "Hono/node, strict tsc" — that was slice 1's scope.
// #2690 gave every backend a compile leg, and all five share this register via
// the `platform` field.)
//
// Diagnoses live in `docs/audits/pairwise-corpus-findings-2026-08.md`.
// ---------------------------------------------------------------------------

import type { Waiver } from "./waivers.js";

// F11 (node × `shape: embedded` × TPH) lived at the head of this list and is
// GONE — drained by wave C2 packet 2c, not by a compile fix.  The crossing it
// waived cannot be written any more: `loom.es-tph-forced-own-table` now covers
// `shape: embedded` alongside `document` / `eventLog` (D-EMBEDDED-TPH), so the
// composer writes the forced `inheritanceUsing: ownTable` and the case the cover
// generates is `embedded × ownTable`, which compiles on both node adapters.
// That also removes the python twin's source (F13), whose own entry is 2e's.
export const COMPILE_WAIVERS: readonly Waiver[] = [
  {
    // ---- F12 (W3) ------------------------------------------------------
    // `paged` × a NON-RELATIONAL saving shape.  The CALLER honours the carrier
    // (five query params in, `.items` / `.page` / `.page_size` / `.total` /
    // `.total_pages` out); the document and event-sourced repository builders
    // DROP it.  Two backends, one defect, two ways of showing it:
    //
    //   python  `async def by_label(self, l: str) -> Thing` — not even a list.
    //           mypy `Too many arguments for "by_label"` + 5 × `attr-defined`.
    //   dotnet  the repository PORT declares the paged signature and the
    //           implementation emits the plain one:
    //           CS0535 'ThingRepository' does not implement interface member
    //           'IThingRepository.ByLabel(string, int, int, string, string,
    //           CancellationToken)'.  ALL FIVE of the .NET cover's
    //           document/eventLog × paged rows, both adapters (efcore + dapper).
    //
    // MEASURED across the shapes, because "python's paging is broken" would
    // have been the wrong summary: relational × paged is CORRECT (imports
    // `PagedResult`, returns the envelope), embedded × paged emitted the
    // envelope but forgot the import (F13, since fixed), document / eventLog
    // dropped the carrier entirely.  One construct, three behaviours, one
    // backend — the pairwise thesis stated as a bug.
    //
    // PYTHON IS DRAINED (wave C2 packet 2e, re-measured on fresh `main`).
    // `F2-CB-C1: page the non-relational carriers on .NET and python` fixed the
    // python half; all FIVE python cells this entry covered
    // (`none-document-requires-tph-paged`, `none-eventLog-mask-paged`,
    // `softDeletable-document-policyAllow-paged`,
    // `tenantOwned-document-none-tph-paged`, `none-document-deny-tph-paged`) now
    // pass `uv sync` + `ruff check` + `mypy --strict` + `pytest`, so the
    // platform narrows to `dotnet` rather than the entry being deleted.
    //
    // The .NET half is left for packet 2b, which owns that tree, but it looks
    // drained too: on `none-document-requires-tph-paged` the port
    // (`Domain/Things/IThingRepository.cs:15`) and the implementation
    // (`Infrastructure/Repositories/ThingRepository.cs:89`) now declare the SAME
    // `Task<Paged<Thing>> ByLabel(string, int, int, string, string,
    // CancellationToken)`, which is the signature pair CS0535 was about.  Read
    // off the emitted source, NOT compiled — 2b compiles it and deletes this
    // entry.
    //
    // Node and Java both get every shape right; Phoenix got it wrong a THIRD
    // way (F14: the document-shape repository defined `by_label/3` while the
    // context delegate declared arity 5, and the event-sourced one dropped the
    // carrier entirely) — recorded from source here because the elixir leg was
    // not run, confirmed red on `main` by the first scheduled run (#2797), and
    // FIXED rather than waived.  `test/generator/elixir/paged-find-arity.test.ts`
    // is the per-PR oracle that now stands in for the 78-minute leg.
    platform: "dotnet",
    persistence: "*",
    capability: "*",
    shape: "document|eventLog",
    authz: "*",
    inheritance: "*",
    read: "paged",
    reason:
      "F12 — paged × document/eventLog on dotnet: the caller expects the " +
      "envelope, the non-relational repository builders drop the carrier " +
      "(CS0535).  The python half is drained (wave C2 packet 2e)",
  },
  // F13 and F15 were the register's other two python entries and are DELETED
  // here — both fixed in wave C2 packet 2e, both re-measured over every cell of
  // the python cover they covered (`uv sync` + `ruff check` + `mypy --strict` +
  // `pytest`, all green):
  //
  //   F13 — `shape: embedded` × TPH.  Recorded as two missing imports
  //         (`ThingBaseRow`, `PagedResult`; ruff F821), which was the SYMPTOM.
  //         The defect was that python's schema emitter tested the saving shape
  //         BEFORE the TPH arms, so it emitted a second table with a jsonb
  //         containment column that the phase-⑨ DDL never creates while the
  //         shared base table already carried the same columns — and the
  //         repository straddled both.  Fixed by ordering the TPH arms first
  //         (matching the migration builder and the drizzle emitter) and
  //         routing a TPH concrete to the relational repository builder.
  //         The crossing itself was then refused at phase ④ by D-EMBEDDED-TPH
  //         (2c), so the ordering is a floor and its python gate was retired.
  //
  //   F15 — `softDeletable` × TPH.  A TPH-nullable bool column in boolean
  //         position now renders `.is_(True)` / `.is_(False)` instead of a bare
  //         column / `not_(col)` — same SQL truth in a WHERE, and a
  //         `ColumnElement[bool]`.  Gate:
  //         `test/generator/python/tph-nullable-bool-filter.test.ts`; the shape
  //         also entered the curated corpus as `tph-crossings.ddd`.
  //
  // Above is the register's surviving W3 entry.  Empty remains the target state —
  // same rule as the wire-differential register: a new divergence is a BUG to
  // fix on the emitter first, and a waiver only when fixing it is a mission of
  // its own with a named exit.
  //
  // Both original entries were closed by #2528 and are deleted here:
  //
  //   F2 — `mask unless` × a NON-RELATIONAL saving shape (drizzle): the route
  //        builder called `repo.toWireMasked(...)` for any masked aggregate,
  //        but only the RELATIONAL repository builder emitted the method
  //        (TS2339).  The document / embedded / event-sourced builders now
  //        emit it too.
  //   F5 — a principal-referencing capability filter × `shape: document` ×
  //        `persistence: mikroorm`: the in-app document predicate read
  //        `currentUser` with no `requireCurrentUser()` bind (TS2304).  The
  //        MikroORM document repository now binds it, as drizzle's already did.
  //
  // Both outlived their fix because this leg had no CI workflow to run the
  // stale-waiver ratchet (see the note in `waivers.ts`).  `pairwise.yml` runs
  // it now.
];
