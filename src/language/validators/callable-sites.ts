// ---------------------------------------------------------------------------
// The callable legality gate (`loom.callable-modifier-not-allowed-here`).
//
// M-T5.21 Phase 1: the grammar's three callable fragments
// (`CallableLeadModifiers` / `CallableSigModifiers` / `CallableGates` in
// `ddd.langium`) accept the WHOLE modifier + clause surface at every callable
// site, and this ONE validator reads the declared legality table
// (`CALLABLE_SITES`, `src/language/callable-sites.ts`) to reject what a site
// does not carry — WITH THE REASON.
//
// Before this, each rule hard-coded its own subset, so `audited` on a
// `domainService` operation was a bare parse error ("expecting '{' but found
// 'audited'") the author had to reverse-engineer from the grammar.  The
// capability surface is unchanged: every combination newly accepted by the
// parser is refused here, which is why emission stays byte-identical across
// all eleven targets.
//
// One node kind is deliberately NOT a site: `UiFunction` (ui-level `function`)
// is extern BY CONSTRUCTION — the `extern from "<path>"` clause IS its body —
// so it has no modifier surface to police.  `Criterion` and `Component` are
// callable-SHAPED but not callable-KIND (design §"What this explicitly does NOT
// change") and stay out of the table.
//
// SHAPE.  The wording is one catalog entry per DENY REASON, and this file has
// one spelled-out `diagMessage("…#<slug>")` call per reason rather than a
// computed key: `test/system/diagnostic-catalog.test.ts` reads string-literal
// keys and string-literal `code:`s only, and a site it cannot read is a site
// whose wording can drift back out of the catalog unnoticed.  `deny` is the
// forwarding helper the scanner follows through (see `forwardedMessages`
// there), so the `code:` is stated once.
// ---------------------------------------------------------------------------

import { type AstNode, AstUtils, type ValidationAcceptor } from "langium";
import { diagMessage } from "../../diagnostics/messages.js";
import {
  CALLABLE_FEATURE_PROPERTY,
  CALLABLE_FEATURES,
  type CallableFeature,
  callableSiteOf,
} from "../callable-sites.js";
import type { Model } from "../generated/ast.js";

/** True when the node actually carries the feature: a modifier is a boolean
 *  flag, a clause is a parsed expression.  Both read the same way — the
 *  property is absent / false when the author did not write it. */
function carries(node: AstNode, feature: CallableFeature): boolean {
  const value = (node as unknown as Record<string, unknown>)[CALLABLE_FEATURE_PROPERTY[feature]];
  return value !== undefined && value !== false && value !== null;
}

/** The one accept site.  Every arm below hands it the catalogued wording; the
 *  code is attached here, once. */
function deny(accept: ValidationAcceptor, node: AstNode, property: string, message: string): void {
  accept("error", message, {
    node,
    property,
    code: "loom.callable-modifier-not-allowed-here",
  });
}

export function checkCallableSites(model: Model, accept: ValidationAcceptor): void {
  for (const node of AstUtils.streamAllContents(model)) {
    const site = callableSiteOf(node.$type);
    if (!site) continue;
    for (const feature of CALLABLE_FEATURES) {
      const allowed =
        feature === "requires" || feature === "when"
          ? (site.clauses as readonly string[]).includes(feature)
          : (site.modifiers as readonly string[]).includes(feature);
      if (allowed) continue;
      if (!carries(node, feature)) continue;

      const property = CALLABLE_FEATURE_PROPERTY[feature];
      const label = site.label;
      // One arm per deny reason — see SHAPE above for why these are spelled
      // out rather than indexed by `site.why`.
      switch (site.why) {
        case "lifecycle":
          deny(
            accept,
            node,
            property,
            diagMessage("loom.callable-modifier-not-allowed-here#lifecycle", { feature, label }),
          );
          break;
        case "applier":
          deny(
            accept,
            node,
            property,
            diagMessage("loom.callable-modifier-not-allowed-here#applier", { feature, label }),
          );
          break;
        case "function":
          deny(
            accept,
            node,
            property,
            diagMessage("loom.callable-modifier-not-allowed-here#function", { feature, label }),
          );
          break;
        case "handler":
          deny(
            accept,
            node,
            property,
            diagMessage("loom.callable-modifier-not-allowed-here#handler", { feature, label }),
          );
          break;
        case "domain-service":
          deny(
            accept,
            node,
            property,
            diagMessage("loom.callable-modifier-not-allowed-here#domain-service", {
              feature,
              label,
            }),
          );
          break;
        case "workflow":
          deny(
            accept,
            node,
            property,
            diagMessage("loom.callable-modifier-not-allowed-here#workflow", { feature, label }),
          );
          break;
        case "page-action":
          deny(
            accept,
            node,
            property,
            diagMessage("loom.callable-modifier-not-allowed-here#page-action", { feature, label }),
          );
          break;
        default: {
          // Exhaustive: a new `CallableDenyReason` without an arm fails `tsc`
          // rather than silently reporting nothing.
          const _never: never = site.why;
          void _never;
        }
      }
    }
  }
}
