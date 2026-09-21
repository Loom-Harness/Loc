// ---------------------------------------------------------------------------
// The ONE rule naming a Feliz form record — and the disambiguation that makes
// it collision-free.
//
// Feliz emits the WHOLE app as a single flat F# module (`src/App.fs`), so every
// form record, every `Msg` case and every encoder shares ONE namespace.  Three
// independent families mint names into it, each a separator-free concatenation
// of user-declared names:
//
//     create form      `<Agg>Form`             CreateForm(of: WorkOrder)
//     operation form   `<Op><Agg>Form`         OperationForm(of: WorkOrder, op: schedule)
//     workflow form    `<Wf>Form`              WorkflowForm(runs: scheduleWorkOrder)
//
// Because the concatenation carries no separator, the families ALIAS.  An
// aggregate `WorkOrder` with an operation `schedule`, in a model that also
// declares `workflow scheduleWorkOrder`, mints `ScheduleWorkOrderForm` TWICE —
// two different records, with different fields (`tech`/`at` vs
// `workOrder`/`technician`/`at`), from a `.ddd` that validates `0 error(s),
// 0 warning(s)`.  `dotnet build` answered with 31 errors: FS0037 duplicate type
// / field / union case, FS1129 + FS0039 on every site that READ the loser's
// fields through the winner's record, FS0019 on a `Submit…Form` that took an id
// at one definition and none at the other.  The aggregate-derived pair aliases
// too (`schedule` on `WorkOrder` vs an aggregate literally named
// `ScheduleWorkOrder`), and so does create-vs-workflow (`workflow workOrder`).
//
// No spelling rule fixes this, because the grammar's `ID` terminal is
// `/[_a-zA-Z][\w_]*/` — a user name may contain any separator a scheme could
// reserve.  So the rule is resolved against the MODEL instead: this module
// mints every form base name for a ui's whole universe at once, hands the
// preferred (historical) spelling to the first claimant in a fixed order, and
// gives a deterministic kind-qualified alternative to anyone it would alias.
//
// Two properties make that safe to consume from the two independent call sites
// (`index.ts`'s MVU assembly and `feliz-target.ts`'s view seam, which build
// their form objects separately and must agree byte-for-byte):
//
//   * it is a pure function of the ui's aggregate + workflow universe, which
//     BOTH sites build from the same `contexts` array — not of which pages host
//     which forms, so adding a page never renames a record; and
//   * with no collision, every name is EXACTLY what it was before, so a model
//     that compiled keeps its identical output.
//
// The `FelizFormNames` handle is threaded as a REQUIRED argument rather than
// defaulted, so a new call site cannot silently fall back to the colliding
// spelling.
// ---------------------------------------------------------------------------

import { upperFirst } from "../../util/naming.js";

/** The form families sharing the flat module's namespace, in the order they
 *  claim a name.  `create` and `op` are aggregate-derived and claim first — an
 *  aggregate's own vocabulary is the more stable half of the model — so a
 *  workflow is the one that yields. */
const KIND_ORDER = ["create", "op", "workflow"] as const;
export type FelizFormKind = (typeof KIND_ORDER)[number];

/** The declarations this module needs off an aggregate: its name and its
 *  operations' names.  Structurally typed so it accepts `AggregateIR` and
 *  `EnrichedAggregateIR` alike without importing either. */
export interface FormNameAggregate {
  readonly name: string;
  readonly operations?: readonly { readonly name: string }[];
}

/** Resolved form base names for one ui's universe.  Every emitted identifier a
 *  form contributes is built off its BASE (`<base>Form`, `Submit<base>Form`,
 *  `<base>Done`, `empty<base>Form`, …), so disambiguating the base
 *  disambiguates the Msg cases and bindings with it. */
export interface FelizFormNames {
  /** Base for `CreateForm(of: <agg>)` — `WorkOrder` → `WorkOrderForm`. */
  create(agg: string): string;
  /** Base for `OperationForm(of: <agg>, op: <op>)` — `ScheduleWorkOrder`. */
  op(agg: string, op: string): string;
  /** Base for `WorkflowForm(runs: <wf>)` — `ScheduleWorkOrder`, or its
   *  disambiguated alternative when an aggregate-derived form claimed that. */
  workflow(wf: string): string;
}

/** The spelling each family WANTS — the one the emitter has always used, kept
 *  so a collision-free model's output is byte-identical. */
function preferredBase(kind: FelizFormKind, a: string, b?: string): string {
  switch (kind) {
    case "create":
      return upperFirst(a);
    case "op":
      return `${upperFirst(b as string)}${upperFirst(a)}`;
    case "workflow":
      return upperFirst(a);
  }
}

/** The spelling a family falls back to when its preferred one is taken.  Each
 *  is a DIFFERENT shape from every preferred one (a kind word in front, or the
 *  aggregate/op order swapped), so it is unlikely — never guaranteed, see the
 *  numeric ladder below — to alias in turn. */
function alternateBase(kind: FelizFormKind, a: string, b?: string): string {
  switch (kind) {
    case "create":
      return `Aggregate${upperFirst(a)}`;
    case "op":
      return `${upperFirst(a)}${upperFirst(b as string)}`;
    case "workflow":
      return `Workflow${upperFirst(a)}`;
  }
}

function keyOf(kind: FelizFormKind, a: string, b?: string): string {
  return kind === "op" ? `op:${a}.${b}` : `${kind}:${a}`;
}

/** Mint every form base name for a ui's universe.
 *
 *  Deterministic and order-independent: the candidates are sorted by family
 *  (create, then op, then workflow) and then by key, so the same model always
 *  produces the same names regardless of declaration order in the `.ddd` or of
 *  the order the contexts were merged in.
 *
 *  A fallback must dodge both the names already ASSIGNED and every name still
 *  PREFERRED by a later candidate — otherwise a yielding workflow could steal
 *  the spelling an operation has not claimed yet, turning one collision into
 *  two.  When even the kind-qualified alternative is taken, a numeric ladder
 *  (`…Form2`, `…Form3`) terminates it. */
export function felizFormNames(
  aggregates: Iterable<FormNameAggregate>,
  workflows: Iterable<{ readonly name: string }>,
): FelizFormNames {
  const candidates: { kind: FelizFormKind; key: string; a: string; b?: string }[] = [];
  for (const agg of aggregates) {
    candidates.push({ kind: "create", key: keyOf("create", agg.name), a: agg.name });
    for (const o of agg.operations ?? []) {
      candidates.push({ kind: "op", key: keyOf("op", agg.name, o.name), a: agg.name, b: o.name });
    }
  }
  for (const wf of workflows) {
    candidates.push({ kind: "workflow", key: keyOf("workflow", wf.name), a: wf.name });
  }
  candidates.sort(
    (x, y) => KIND_ORDER.indexOf(x.kind) - KIND_ORDER.indexOf(y.kind) || x.key.localeCompare(y.key),
  );

  // Every name someone would rather have.  A fallback avoids these so it can
  // never displace a candidate that has not claimed its own yet.
  const preferredAll = new Set(candidates.map((c) => preferredBase(c.kind, c.a, c.b)));

  const assigned = new Map<string, string>();
  const taken = new Set<string>();
  for (const c of candidates) {
    const want = preferredBase(c.kind, c.a, c.b);
    if (!taken.has(want)) {
      taken.add(want);
      assigned.set(c.key, want);
      continue;
    }
    const alt = alternateBase(c.kind, c.a, c.b);
    let pick = !taken.has(alt) && !preferredAll.has(alt) ? alt : "";
    for (let n = 2; !pick; n++) {
      const numbered = `${alt}${n}`;
      if (!taken.has(numbered) && !preferredAll.has(numbered)) pick = numbered;
    }
    taken.add(pick);
    assigned.set(c.key, pick);
  }

  const lookup = (kind: FelizFormKind, a: string, b?: string): string =>
    assigned.get(keyOf(kind, a, b)) ?? preferredBase(kind, a, b);

  return {
    create: (agg) => lookup("create", agg),
    op: (agg, op) => lookup("op", agg, op),
    workflow: (wf) => lookup("workflow", wf),
  };
}

/** The identity naming — every family gets its preferred spelling.  For call
 *  sites that legitimately have no universe to resolve against (a unit test
 *  building one form in isolation); NOT a default on the emitters, which must
 *  pass the real universe or they reopen the collision. */
export const preferredFelizFormNames: FelizFormNames = {
  create: (agg) => preferredBase("create", agg),
  op: (agg, op) => preferredBase("op", agg, op),
  workflow: (wf) => preferredBase("workflow", wf),
};
