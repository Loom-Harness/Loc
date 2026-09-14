// ---------------------------------------------------------------------------
// WHICH read does a page's `of:` call actually name?  One answer, two consumers.
//
// A `QueryView { of: <Agg>.<operation>(…) }` names one of a CLOSED set of reads:
// the auto-`findAll` (`all`), the by-id fetch (`byId`), the derived entity
// history (`history`), or a declared/synthesized repository FIND.  Anything else
// names nothing at all.
//
// Before this module the Phoenix LiveView emitter never asked: every list-shaped
// read emitted `list_<agg>s(<args>)` — the UNFILTERED list — no matter what the
// page said.  A page reading `Product.findAllBySellable()` (in-stock, published)
// rendered drafts and discontinued rows on Phoenix and the right rows on every
// other frontend, with no diagnostic anywhere.  With a parameterised find it was
// not merely wrong: `of: Item.byState(Live)` emitted
// `list_items(:Live)` against `list_items(page \\ 1, page_size \\ 20, …)`, so the
// FILTER VALUE arrived as the page number.  The single-record path had the twin
// defect — a find returning `T?` became `get_<agg>(socket.assigns.id)`, an
// assign a page with no `:id` route param does not even carry.
//
// The fix is not "look the name up in the Phoenix emitter": it is to ask the
// same question in the validator, so a read that resolves to NOTHING is refused
// (`loom.ui-read-unresolved`) instead of being silently substituted on one
// target and emitted as a dangling client import on the others.  Both consumers
// therefore route through this one function, and a read the emitter cannot
// resolve is one the validator has already rejected.
//
// Home is `ir/util/` because both consumers are downstream of it: phase ⑦
// (`ir/validate/checks/ui-checks.ts`) raises the diagnostic and phase ⑧
// (`generator/elixir/heex-primitives.ts`) picks the context-module function.
// ---------------------------------------------------------------------------

import { AUDIT_HISTORY_FIND } from "../../util/audit-names.js";
import type { BoundedContextIR, FindIR } from "../types/loom-ir.js";

/** The read a page-body `of:` operation resolves to.
 *
 *  `find-all` / `by-id` are the two STANDARD ops every aggregate exposes and
 *  which carry no `FindIR` to hand back (`all` is the enrich pass's auto-
 *  `findAll`; `byId` is not a find at all).  `history` is the derived
 *  entity-history read, which deliberately sits BESIDE `finds` — see
 *  `src/util/audit-names.ts`.  `find` carries the resolved declaration so a
 *  consumer can read its params / return shape without repeating the lookup. */
export type PageReadTarget =
  | { kind: "find-all" }
  | { kind: "by-id" }
  | { kind: "history" }
  | { kind: "find"; find: FindIR }
  | { kind: "unresolved" };

/** Resolve the operation an aggregate-rooted page read names against that
 *  aggregate's repository finds.  `finds` absent (no repository, or an index the
 *  caller could not build) leaves every non-standard operation `unresolved` —
 *  the honest answer, since there is then no declaration to call. */
export function resolveAggregateRead(
  operation: string,
  finds: ReadonlyMap<string, FindIR> | undefined,
): PageReadTarget {
  if (operation === "all") return { kind: "find-all" };
  if (operation === "byId") return { kind: "by-id" };
  if (operation === AUDIT_HISTORY_FIND) return { kind: "history" };
  const find = finds?.get(operation);
  return find ? { kind: "find", find } : { kind: "unresolved" };
}

/** Index one aggregate's repository finds by name, out of its owning bounded
 *  context — the input `resolveAggregateRead` wants, for the consumer (the
 *  Phoenix walker) that holds contexts rather than a prebuilt find index. */
export function findsOfAggregate(
  aggregateName: string,
  bc: BoundedContextIR | undefined,
): ReadonlyMap<string, FindIR> | undefined {
  const repo = bc?.repositories.find((r) => r.aggregateName === aggregateName);
  if (!repo) return undefined;
  return new Map(repo.finds.map((f) => [f.name, f]));
}

/** The operations a page read may legally name on this aggregate, in the order
 *  the diagnostic lists them — the two standard ops plus every declared find.
 *  (`history` is left out: it is only a read on an AUDITED aggregate, and
 *  offering it everywhere would send authors down a path most models cannot
 *  take.) */
export function readableOperations(finds: ReadonlyMap<string, FindIR> | undefined): string[] {
  const declared = [...(finds?.keys() ?? [])].filter((n) => n !== "all").sort();
  return ["all", "byId", ...declared];
}
