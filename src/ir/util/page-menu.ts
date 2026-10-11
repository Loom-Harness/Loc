// Page `menu { … }` metadata readers, shared by the sidebar derivation
// (`_frontend/menu-emitter.ts`) and the catalog extraction
// (`_walker/i18n-extract.ts`).  The two must agree on which page metadata a
// sidebar actually renders: the extraction catalogues a page's `menu` label /
// section only where some sidebar reads it, so a key the sidebar never reads
// is never minted.

import type { MenuLinkIR, PageIR, UiIR } from "../types/loom-ir.js";

/** A page's string-literal `menu { <key>: "…" }` entry (`section` / `label`). */
export function menuMetaString(page: PageIR, key: string): string | undefined {
  const entry = page.menuMeta?.entries.find((e) => e.name === key);
  if (!entry) return undefined;
  if (entry.value.kind !== "literal" || entry.value.lit !== "string") return undefined;
  return entry.value.value;
}

/** The page a `link Page { … }` menu entry targets.  Matches on the resolved
 *  route first: role-named scaffold pages share a name (`List`) across
 *  aggregates, so only the route is unique.  Falls back to the name for a link
 *  whose reference carried no route. */
export function menuLinkPage(link: MenuLinkIR & { kind: "page" }, ui: UiIR): PageIR | undefined {
  return (
    (link.route !== undefined && ui.pages.find((p) => p.route === link.route)) ||
    ui.pages.find((p) => p.name === link.pageName)
  );
}

/** Whether a page's own `menu { label: … }` metadata names a sidebar entry
 *  under an explicit ui `menu { … }` block.  The block replaces every
 *  page-derived section, so a page's `section` metadata is never read there,
 *  and its `label` only by a `link Page` that writes no `label:` of its own. */
export function explicitMenuReadsPageLabel(page: PageIR, ui: UiIR): boolean {
  return (ui.menu?.sections ?? []).some((section) =>
    section.links.some(
      (link) =>
        link.kind === "page" &&
        !link.props.some(
          (p) => p.name === "label" && p.value.kind === "literal" && p.value.lit === "string",
        ) &&
        menuLinkPage(link, ui) === page,
    ),
  );
}
