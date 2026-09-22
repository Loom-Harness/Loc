// -------------------------------------------------------------------------
// `loom.page-gate-not-client-evaluable` — a page `requires` gate the browser
// cannot evaluate (audit D2).
//
// A page gate is the READ-SIDE MIRROR of the backend's 403: every frontend
// re-evaluates it client-side against the verified session claims so a
// forbidden page renders `<Forbidden/>` instead of its body.  That is only
// possible for the closed subset `src/ir/util/ui-gate.ts` describes —
// `currentUser`, enum members, constants, boolean/comparison operators and
// `.contains`.  Outside it, all six frontend gate renderers THROW.
//
// Before this check they threw as the FIRST thing the author heard: a `.ddd`
// that reported `0 error(s), 0 warning(s)` and then died with a bare
//
//   Error: UI gate: reference 'permissions' (unknown) is not evaluable
//   client-side — a gate may only touch currentUser and constants.
//
// carrying no `loom.*` code, no page name and no source position, having
// written nothing.  The shape that produced it in the audit was not even
// hand-written: a `workflow X requires currentUser.permissions.contains(
// permissions.manage) { … }` header gate, which the scaffold COPIES onto the
// synthesised `<W>InstancesList` / `<W>InstanceDetail` pages.  The gate is
// legal on the workflow — `permissions.<name>` resolves to its runtime string
// inside the subdomain that declares the catalogue — and unresolvable on the
// page, because a `ui` sits outside that subdomain and `permissions` is a
// module-scoped name there.  So the diagnostic names BOTH ends: the page the
// gate lands on, and (for a scaffolded instance page) the workflow whose header
// gate put it there.
// -------------------------------------------------------------------------

import { diagMessage } from "../../../diagnostics/messages.js";
import type { EnrichedLoomModel, PermissionDeclIR } from "../../types/loom-ir.js";
import { allContexts } from "../../types/loom-ir.js";
import { classifyPage } from "../../util/page-kind.js";
import { firstNonUiGateNode, type UiGateReject } from "../../util/ui-gate.js";
import type { LoomDiagnostic } from "./diagnostic.js";

export function validatePageGates(loom: EnrichedLoomModel, diags: LoomDiagnostic[]): void {
  // Permission NAME → its declaration, across every subdomain.  Used only to
  // enrich the steer: when the offending reference is `permissions.<name>` and
  // the model does declare that name, the diagnostic can quote the runtime
  // string the author can write instead of the catalogue reference.  Ambiguous
  // names (declared in two subdomains with different runtime strings) are
  // dropped rather than guessed.
  const permByName = new Map<string, PermissionDeclIR | null>();
  for (const sys of loom.systems) {
    for (const sub of sys.subdomains) {
      for (const p of sub.permissions) {
        const seen = permByName.get(p.name);
        if (seen === undefined) permByName.set(p.name, p);
        else if (seen !== null && seen.runtimeString !== p.runtimeString) {
          permByName.set(p.name, null);
        }
      }
    }
  }
  const aggregateNames = allContexts(loom).flatMap((c) => c.aggregates.map((a) => a.name));
  const workflowNames = allContexts(loom).flatMap((c) => c.workflows.map((w) => w.name));

  for (const sys of loom.systems) {
    for (const ui of sys.uis) {
      for (const page of ui.pages) {
        if (!page.requires) continue;
        const bad = firstNonUiGateNode(page.requires);
        if (bad === null) continue;
        const kind = classifyPage(page, { aggregateNames, workflowNames });
        // The gate on a scaffolded workflow-instance page is a COPY of the
        // workflow's header gate — say so, or the author goes looking for a
        // `requires` on a page they never wrote.
        const origin =
          kind.kind === "workflow-instances-list" || kind.kind === "workflow-instance-detail"
            ? ` The gate is a COPY of the header \`requires\` on workflow '${kind.workflowName}' — the scaffold propagates it onto the workflow's instance pages so the nav entry matches the gate on the route those pages read; the fix belongs on the workflow's header gate, not on a page you never wrote.`
            : "";
        diags.push({
          severity: "error",
          code: "loom.page-gate-not-client-evaluable",
          message: diagMessage("loom.page-gate-not-client-evaluable", {
            uiName: ui.name,
            pageName: page.name,
            offending: bad.text,
            why: whyClause(bad, permByName),
            origin,
          }),
          source: `ui ${ui.name}`,
        });
      }
    }
  }
}

/** The half of the message that explains THIS offender and what to write
 *  instead.  Kept out of the catalog entry because it is a per-offender steer,
 *  not per-code wording — the catalog entry interpolates it as `why`. */
function whyClause(
  bad: UiGateReject,
  permByName: ReadonlyMap<string, PermissionDeclIR | null>,
): string {
  if (bad.kind === "ref") {
    // `permissions.<name>` is the case the audit hit, and the only one with a
    // mechanical rewrite: the catalogue reference is module-scoped, but the
    // string it lowers to is a plain constant the browser can compare against.
    const perm = bad.text.startsWith("permissions.")
      ? permByName.get(bad.text.slice("permissions.".length))
      : undefined;
    if (bad.text === "permissions" || bad.text.startsWith("permissions.")) {
      const runtime = perm
        ? ` — that catalogue entry's runtime string is "${perm.runtimeString}"`
        : "";
      return (
        "`permissions.<name>` is a subdomain-scoped catalogue reference; a `ui` is declared outside " +
        "the subdomain that owns the catalogue, so the name does not resolve there and the browser " +
        "has nothing to bind it to" +
        runtime +
        '. Compare a claim instead (`currentUser.role == "staff"`), or test membership against the ' +
        "runtime string directly (`currentUser.permissions.contains(" +
        (perm ? JSON.stringify(perm.runtimeString) : '"<subdomain>.<name>"') +
        ")`) — note the string form does NOT expand the `implies` closure, so list every permission " +
        "that should satisfy the gate"
      );
    }
    return (
      `\`${bad.text}\` is not bound in the browser — a page gate is evaluated before the page's data ` +
      "is read, so page params, `this.<field>` and repository reads are all out of scope. Move that " +
      "condition into the read itself (`where`) or into the operation's own `requires`"
    );
  }
  if (bad.kind === "method") {
    return (
      `\`${bad.text}\` is not in the gate vocabulary — collection membership (\`.contains(…)\`) is the ` +
      "only method a gate may call"
    );
  }
  if (bad.kind === "literal") {
    return `\`${bad.text}\` has no client-side literal form — a gate may only use string, bool, int, long, decimal and null constants`;
  }
  return `\`${bad.text}\` is not one of the forms a gate may take (references, constants, \`.contains(…)\`, comparison and boolean operators, and a ternary)`;
}
