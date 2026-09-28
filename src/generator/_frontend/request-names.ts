// ---------------------------------------------------------------------------
// The ONE rule naming a workflow's frontend surface — and the disambiguation
// that makes it collision-free against the aggregate-derived surface.
//
// The TS frontends (React / Vue / Svelte / Angular) mint request identifiers
// from THREE families, each a separator-free concatenation of user-declared
// names, and a page body may import from two of the modules at once:
//
//     create      `Create<Agg>Request`     src/api/<agg>.ts
//     operation   `<Op><Agg>Request`       src/api/<agg>.ts
//     workflow    `<Wf>Request`            src/api/workflows.ts
//
// Because the concatenation carries no separator, the workflow family ALIASES
// the operation one.  `aggregate WorkOrder { operation schedule(…) }` beside
// `workflow scheduleWorkOrder(…)` mints `ScheduleWorkOrderRequest` TWICE, with
// different fields, from a model that validates `0 error(s), 0 warning(s)`.  A
// page hosting both forms then emits
//
//     import { ScheduleWorkOrderRequest, useScheduleWorkOrderWorkflow } from "../api/workflows";
//     import { ScheduleWorkOrderRequest, useScheduleWorkOrder } from "../api/workOrder";
//
// which is `TS2300: Duplicate identifier` on React, Vue and Svelte.  (Angular
// escapes only by accident: its op-form emitter builds a `FormGroup` directly
// and never imports the operation's request interface, so no single file holds
// both names — the two colliding exports are emitted all the same.)
//
// No spelling rule closes this, because the grammar's `ID` terminal is
// `/[_a-zA-Z][\w_]*/` — a user name may contain any separator a scheme could
// reserve, so a fixed `Workflow` infix just moves the collision onto an
// aggregate literally named `…Workflow`.  The rule is therefore resolved
// against the MODEL: this module mints every workflow's base name for a
// deployable's whole universe at once.  The aggregate-derived families claim
// first — an aggregate's own vocabulary is the stabler half of the model — so
// the workflow is the one that yields, and every aggregate-side identifier
// stays exactly what it was.
//
// Two properties make it safe to consume from the independent call sites that
// must agree byte-for-byte (the api-module emitter, the page walker, the page
// shells, the Playwright page object):
//
//   * it is a pure function of the deployable's aggregate + workflow universe,
//     which every site builds from the SAME `contexts` array — not of which
//     page hosts which form, so adding a page never renames a symbol; and
//   * with no collision, every name is EXACTLY what it was before, so a model
//     that compiled keeps its identical output.
//
// Every identifier a workflow contributes hangs off its BASE — `<base>Request`,
// `<base>FormState`, `<base>Payload`, `use<base>Workflow` — so disambiguating
// the base disambiguates the hook and the form-state aliases with it, and the
// design packs' `use{{workflowPascal}}Workflow` / `{{workflowPascal}}Request`
// templates keep working unchanged.
// ---------------------------------------------------------------------------

import { upperFirst } from "../../util/naming.js";

/** The declarations this module needs off an aggregate: its name and its
 *  operations' names.  Structurally typed so it accepts `AggregateIR` and
 *  `EnrichedAggregateIR` alike without importing either. */
export interface RequestNameAggregate {
  readonly name: string;
  readonly operations?: readonly { readonly name: string }[];
}

/** Resolved identifier bases for one deployable's universe. */
export interface FrontendRequestNames {
  /** Base for `WorkflowForm(runs: <wf>)` — `scheduleWorkOrder` →
   *  `ScheduleWorkOrder`, or its disambiguated alternative when an
   *  aggregate-derived request already spells that. */
  workflow(wf: string): string;
}

/** The spelling a workflow WANTS — the one the emitters have always used, kept
 *  so a collision-free model's output is byte-identical. */
function preferredBase(wf: string): string {
  return upperFirst(wf);
}

/** The spelling a workflow falls back to when its preferred one is taken.  A
 *  different SHAPE from every aggregate-derived preferred name (a kind word in
 *  front), so it is unlikely — never guaranteed, hence the numeric ladder — to
 *  alias in turn. */
function alternateBase(wf: string): string {
  return `Workflow${upperFirst(wf)}`;
}

/** Mint every workflow's identifier base for a deployable's universe.
 *
 *  Deterministic and order-independent: the workflows are sorted by name, so
 *  the same model always produces the same names regardless of declaration
 *  order in the `.ddd` or of the order the contexts were merged in.
 *
 *  A fallback dodges the names CLAIMED by the aggregate-derived families, the
 *  bases already ASSIGNED, and every base still PREFERRED by a later workflow —
 *  otherwise a yielding workflow could steal a spelling another has not claimed
 *  yet, turning one collision into two.  When even the kind-qualified
 *  alternative is taken, a numeric ladder (`Workflow<Wf>2`, `…3`) terminates
 *  it. */
export function frontendRequestNames(
  aggregates: Iterable<RequestNameAggregate>,
  workflows: Iterable<{ readonly name: string }>,
): FrontendRequestNames {
  // Everything the aggregate modules already export under `<base>Request`.
  const claimed = new Set<string>();
  for (const agg of aggregates) {
    claimed.add(`Create${upperFirst(agg.name)}`);
    for (const op of agg.operations ?? []) {
      claimed.add(`${upperFirst(op.name)}${upperFirst(agg.name)}`);
    }
  }

  const names = [...workflows].map((w) => w.name).sort((a, b) => a.localeCompare(b));
  // Every base a workflow would rather have.  A fallback avoids these so it can
  // never displace a workflow that has not claimed its own yet.
  const preferredAll = new Set(names.map(preferredBase));

  const assigned = new Map<string, string>();
  const taken = new Set<string>();
  for (const wf of names) {
    const want = preferredBase(wf);
    if (!claimed.has(want) && !taken.has(want)) {
      taken.add(want);
      assigned.set(wf, want);
      continue;
    }
    const alt = alternateBase(wf);
    const free = (c: string): boolean => !claimed.has(c) && !taken.has(c) && !preferredAll.has(c);
    let pick = free(alt) ? alt : "";
    for (let n = 2; !pick; n++) {
      const numbered = `${alt}${n}`;
      if (free(numbered)) pick = numbered;
    }
    taken.add(pick);
    assigned.set(wf, pick);
  }

  return { workflow: (wf) => assigned.get(wf) ?? preferredBase(wf) };
}

/** Mint from a deployable's bounded contexts — the shape every emitter that
 *  holds `contexts` uses, so all of them resolve against one universe. */
export function requestNamesForContexts(
  contexts: Iterable<{
    readonly aggregates: readonly RequestNameAggregate[];
    readonly workflows: readonly { readonly name: string }[];
  }>,
): FrontendRequestNames {
  const aggregates: RequestNameAggregate[] = [];
  const workflows: { readonly name: string }[] = [];
  for (const ctx of contexts) {
    aggregates.push(...ctx.aggregates);
    workflows.push(...ctx.workflows);
  }
  return frontendRequestNames(aggregates, workflows);
}
