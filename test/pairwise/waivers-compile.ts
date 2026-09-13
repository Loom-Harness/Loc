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
  // ---- F12 (W3) — DELETED at the wave C2 fold --------------------------
  // `paged` × document/eventLog on dotnet + python (the caller expects the
  // envelope, the non-relational repository builders dropped the carrier:
  // CS0535 / mypy call-arg).  Both halves were fixed by wave C1 packet 1e
  // (ledger row `F2-CB-C1-paged-nonrelational`) and each was then MEASURED
  // drained by its own packet in wave C2 — 2e narrowed the entry to dotnet
  // after compiling all five python cover cells it covered; 2b dropped the
  // dotnet half after `LOOM_PAIRWISE=1 LOOM_DOTNET_BUILD=1` failed this
  // entry's REVERSE ratchet on all five matching dotnet cases.  The two
  // narrowings met at the fold as an empty entry, so the entry is gone.
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
