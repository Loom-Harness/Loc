// Where each page and component of a ui was declared, keyed by the construct
// id the `--sourcemap` file regions record it under.  The Frontend Contract
// carries no source origins (they name local files), so a frontend that
// generates from the contract takes them from the enriched-side entry.

import type { ComponentIR, UiIR } from "../../ir/types/loom-ir.js";
import type { OriginRef } from "../../ir/types/origin.js";
import { pageConstructId } from "../../ir/util/page-kind.js";

/** The source origin of every page and component of `ui` (and of each
 *  top-level component it may render), keyed by the construct id the
 *  sourcemap records it under. */
export function uiSourceOrigins(
  ui: UiIR,
  topLevelComponents: readonly ComponentIR[] = [],
): Map<string, OriginRef> {
  const out = new Map<string, OriginRef>();
  for (const c of [...topLevelComponents, ...ui.components]) {
    if (c.origin) out.set(`${ui.name}.${c.name}`, c.origin);
  }
  for (const page of ui.pages)
    if (page.origin) out.set(pageConstructId(ui.name, page), page.origin);
  return out;
}
