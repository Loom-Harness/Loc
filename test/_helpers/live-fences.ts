// The open issues and PRs a census waiver or a register row may lean on.
//
// A waiver that says "blocked by #NNNN" or a register row that says
// "mission: #NNNN" is a claim that #NNNN is still open work.  A test cannot ask
// GitHub (the merge-queue verdict must not depend on the network), so the
// claim is checked against this committed list instead: a reference to a
// number not listed here fails the census that holds it.
//
// DELETE a row the day its issue closes or its PR merges.  Every waiver and
// row still citing it then fails, which is the point: the work it deferred is
// due.  A row nothing cites fails `test/system/live-fences.test.ts`, and that
// file's nightly leg (`LOOM_CENSUS_ONLINE=1`, test.yml `census-online`) asks
// GitHub that every row here is still open, so a fence closed without its row
// being deleted is reported the next night.
//
// Readers: src/diagnostics/unsupported-register.ts `mission` (via
// unsupported-register.test.ts), the `unobserved` of a conformance rule
// (test/conformance/semantics-rules.ts, via semantics-observers.test.ts), the
// `none, tracked by #N` line of a decision
// record (docs/decisions, via decision-gates.test.ts), and the `blockedBy` of
// the waivers in symbol-plan-census, openapi-native-census,
// e2e-fixed-port-census, channel-plan-census and ir-walk-census.

export const LIVE_FENCES: Readonly<Record<string, string>> = {
  "#3317": "Server-driven Table filter",
  "#3319": "Dashboards: keyed projection reads in pages",
  "#3328": "Frontend per-target refusals (money folds, first/firstOrNull, distinct/contains, ...)",
  "#3332": "Flutter action body: `match await` on a standard aggregate op",
  "#3333": "A ui bound to several backends",
  "#3350": "Sensitivity: wire masking strategies + field-level sink classification",
  "#3367": "Effect-form variant `match` in domain/workflow bodies",
  "#3370": "Criterion tails",
  "#3372": "Polymorphic `<Base> id` refs to TPC bases",
  "#3375": "Domain services: reads in member-receiver position, `audited` on service ops",
  "#3376": "`for` over a declared array find",
  "#3378": "Workflow unit-test anchor",
  "#3388": "Elixir shape: document residue",
  "#3592": "One target-capability table read by the validator",
  "#3840": "Elixir stamp parity",
  "#4087": "Frontend body vocabulary gaps",
  "#4572": "Workflow/handler entry-point results",
  "#4595": "Per-row query-time projection over another context's aggregate",
  "#4804": "Service-to-service principal for typed `kind: api` calls",
  "#4956": "Registry copy on non-host deployables",
  "#5074": "Policy row rules on inheritance-hierarchy aggregates",
  "#5163": "`exists` positions still refused",
  "#5179": "Assigning a member of a let-bound entity part",
  "#5289": "Workflow / handler emitters onto the symbol plan",
  "#5321": "OpenAPI .NET: one shared wire record per value object",
  "#5923": "e2e suites still publishing fixed host ports",
  "#5927": "Outbox capture and per-context subscriptions still re-derive the channel plan",
  "#5933": "Re-own unsupported-register gaps whose owning issue closed",
  "#5994": "Shared ledgers become per-fixture sidecars (train B moves the authz ladders)",
  "#6013": "Decision records with no enforcing gate yet",
  "#6018": "Reference-doc every-backend claims with no gate yet",
  "#6069": "Conformance rules assert facts no gate observes yet",
};

/** `""` when `ref` is a live fence, else the reason it is not. */
export function fenceProblem(ref: string): string {
  if (!/^#\d+$/.test(ref)) return `"${ref}" is not an issue or PR reference (#NNNN)`;
  if (!Object.hasOwn(LIVE_FENCES, ref))
    return (
      `${ref} is not in LIVE_FENCES (test/_helpers/live-fences.ts): it closed, so the ` +
      "work it fenced is due — or it is open and was never registered (add its row)"
    );
  return "";
}
