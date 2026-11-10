// The procedural HEEx pack the shared walker core renders Phoenix LiveView
// primitives through.
//
// A `LoadedPack` keyed by the shared `primitive-*` template names, rendered by
// TypeScript functions rather than `.hbs` templates (the Feliz pack's shape).
// HEEx has one component convention, so the markup a primitive renders is
// fixed here; the HEEx DESIGN packs (`designs/coreComponents`,
// `designs/daisyui`) own the shell those components come from.
//
// The primitives in `HEEX_SHARED_PRIMITIVES` render through the shared `emit*`
// functions and this pack.  Every other node of a HEEx body goes back to the
// HEEx engine through `heexTarget.renderNodeOverride`.  A name the pack has no
// renderer for answers with a visible give-up comment, never silent markup.
//
// Indentation follows the shared core's convention: a fragment's first line is
// bare (the caller places it), its later lines carry their absolute indent,
// which the view-model hands over as `indent` / `closeIndent`.

import type { LoadedPack } from "../_packs/loader.js";
import { giveUpText } from "../_walker/give-up.js";
import type { HeexWalkSink } from "./heex-walker-core.js";

/** The primitives the shared walker core renders for HEEx.  The HEEx engine
 *  hands a call to one of these back to the shared core, and
 *  `heexTarget.renderNodeOverride` lets them through. */
export const HEEX_SHARED_PRIMITIVES: ReadonlySet<string> = new Set([
  "Stack",
  "Group",
  "Grid",
  "Container",
  "Card",
  "Divider",
  "Tabs",
]);

type VM = Record<string, unknown>;
type Renderer = (vm: VM, sink: HeexWalkSink | undefined) => string;

/** The flex/grid geometry the layout containers carry.  It is design-neutral
 *  (daisyUI adds a component vocabulary, not a layout one), so both HEEx design
 *  packs share it; the strings mirror the shadcn (Tailwind) templates, so a page
 *  laid out on React and on Phoenix reads the same.  Both packs build Tailwind
 *  over `lib/<app>_web/**`, so these literal classes survive the purge. */
const LAYOUT_CLASSES = {
  Stack: "flex flex-col gap-4",
  Group: "flex flex-row items-center gap-4",
  Grid: "grid gap-4",
  Container: "container mx-auto px-4",
} as const;

/** `Container(size:)` → its max-width utility, on the vuetify pack's pixel
 *  ladder at the nearest Tailwind step.  An absent or unknown size keeps the
 *  default centred `container`. */
const CONTAINER_MAX_W: Record<string, string> = {
  xs: "max-w-xl",
  sm: "max-w-3xl",
  md: "max-w-5xl",
  lg: "max-w-6xl",
  xl: "max-w-7xl",
};

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** `<tag attrs>children</tag>`, or the self-closing tag with no children. */
function element(tag: string, attrs: string, vm: VM, body = str(vm.childrenBlock)): string {
  if (!vm.hasChildren || body.length === 0) return `<${tag}${attrs} />`;
  return `<${tag}${attrs}>\n${str(vm.indent)}${body}\n${str(vm.closeIndent)}</${tag}>`;
}

/** A layout `<div>`: its class leads, then the author's `style:`, then the
 *  `testid:`. */
function layoutDiv(cls: string, vm: VM): string {
  return element("div", ` class="${cls}"${str(vm.styleAttr)}${str(vm.testidAttr)}`, vm);
}

/** A grid column: each child rides its own `<div>`, so a multi-root child (a
 *  `Table` and its pager) occupies one cell. */
function renderGrid(vm: VM): string {
  const cols = vm.hasResponsiveCols
    ? `grid-cols-${vm.colsMobile} md:grid-cols-${vm.colsTablet} lg:grid-cols-${vm.colsDesktop}`
    : "grid-cols-3";
  const children = (vm.children as readonly string[] | undefined) ?? [];
  const colIndent = str(vm.colIndent);
  const cells = children
    .map((c) => `${colIndent}<div>\n${str(vm.childIndent)}${c}\n${colIndent}</div>`)
    .join("\n");
  const attrs = ` class="${LAYOUT_CLASSES.Grid} ${cols}"${str(vm.styleAttr)}${str(vm.testidAttr)}`;
  if (children.length === 0) return `<div${attrs} />`;
  return `<div${attrs}>\n${cells}\n${str(vm.closeIndent)}</div>`;
}

/** `Container(size:)` folds the size into a max-width utility; a `size="md"`
 *  attribute would mean nothing on a `<div>`. */
function renderContainer(vm: VM): string {
  const maxW = typeof vm.size === "string" ? CONTAINER_MAX_W[vm.size] : undefined;
  return layoutDiv(maxW ? `mx-auto w-full px-4 ${maxW}` : LAYOUT_CLASSES.Container, vm);
}

/** `Card` renders through the design pack's `<.card>` function component — the
 *  card surface is design vocabulary.  `card/1` declares `title`, `variant`,
 *  `shadow` and `testid` and no `:global` rest, so the testid goes in as
 *  `testid=` (a `data-testid=` would be an undefined attribute, a compile
 *  warning under `--warnings-as-errors`) and `style:` is not forwarded. */
function renderCard(vm: VM): string {
  const attrs = [
    vm.hasTitle ? str(vm.titleAttr) : "",
    vm.hasVariant ? ` variant="${escapeAttr(str(vm.variant))}"` : "",
    vm.hasShadow ? ` shadow="${escapeAttr(str(vm.shadow))}"` : "",
    str(vm.testidAttr).replace(/^ data-testid=/, " testid="),
  ].join("");
  return element(".card", attrs, { ...vm, hasChildren: vm.hasContent }, str(vm.contentJsx));
}

/** `Divider(label?)` → `<hr />`, or rule-text-rule when labelled.  LiveView has
 *  no labelled-divider component, but the label is user-visible text, so it is
 *  composed the way the JSX packs compose it rather than dropped. */
function renderDivider(vm: VM): string {
  const testid = str(vm.testidAttr);
  const label = str(vm.label);
  if (!vm.hasLabel || label.length === 0) return `<hr${testid} />`;
  return (
    `<div class="flex items-center gap-3 my-4"${testid}>` +
    `<hr class="flex-1" />` +
    `<span class="text-sm opacity-70">${label}</span>` +
    `<hr class="flex-1" />` +
    `</div>`
  );
}

interface TabVM {
  value: string;
  label: string;
  /** The caption when it is a dynamic expression rather than a literal. */
  dynamicLabel?: () => string;
  bodyJsx: string;
}

/** `Tabs` → a tab bar of buttons and one panel per tab, switched on the client
 *  with `Phoenix.LiveView.JS` (no server round-trip).  The group id is numbered
 *  per page in document order from the HEEx walk's tab counter (reserved when
 *  the walk entered this group); each tab's anchor is its slug. */
function renderTabs(vm: VM, sink: HeexWalkSink | undefined): string {
  const tabs = (vm.tabs as readonly TabVM[] | undefined) ?? [];
  if (tabs.length === 0) {
    return `<!-- ${giveUpText("loom.page-primitive-arg-missing", "Tabs: no tabs")} -->`;
  }
  const seq = sink?.heex.tabSeq ?? { value: 0 };
  const reserved = seq.reserved?.pop();
  if (reserved === undefined) seq.value += 1;
  const id = `tabs-${reserved ?? seq.value}`;
  const indent = str(vm.indent);
  const innerIndent = str(vm.innerIndent);
  const triggers = tabs
    .map((t, i) => {
      const active = i === 0 ? " tab-active" : "";
      const js =
        `JS.hide(to: "[data-tabs='${id}']")` +
        ` |> JS.show(to: "#${id}-panel-${t.value}")` +
        ` |> JS.remove_class("tab-active", to: "[data-tabs-tab='${id}']")` +
        ` |> JS.add_class("tab-active", to: "#${id}-tab-${t.value}")`;
      return `${innerIndent}<button type="button" role="tab" id="${id}-tab-${t.value}" data-tabs-tab="${id}" class="tab${active}" phx-click={${js}}>${t.dynamicLabel?.() ?? t.label}</button>`;
    })
    .join("\n");
  const panels = tabs
    .map((t, i) => {
      const hidden = i === 0 ? "" : " hidden";
      return `${indent}<div role="tabpanel" id="${id}-panel-${t.value}" data-tabs="${id}" class="tab-panel${hidden}">\n${innerIndent}${t.bodyJsx}\n${indent}</div>`;
    })
    .join("\n");
  const close = str(vm.closeIndent);
  return `<div class="tabs"${str(vm.testidAttr)}>\n${indent}<div role="tablist" class="tab-bar">\n${triggers}\n${indent}</div>\n${panels}\n${close}</div>`;
}

function escapeAttr(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** `primitive-*` template name → its HEEx renderer. */
const RENDERERS: Record<string, Renderer> = {
  "primitive-stack": (vm) => layoutDiv(LAYOUT_CLASSES.Stack, vm),
  "primitive-group": (vm) => layoutDiv(LAYOUT_CLASSES.Group, vm),
  "primitive-grid": renderGrid,
  "primitive-container": renderContainer,
  "primitive-card": renderCard,
  "primitive-divider": renderDivider,
  "primitive-tabs": renderTabs,
};

/** The pack for one HEEx walk.  `sink` is that walk's HEEx state, for the
 *  renderers that number per-page markup (the tab-group ids). */
export function heexPack(sink?: HeexWalkSink): LoadedPack {
  return {
    manifest: { name: "heexProcedural", version: "v1", format: "tsx", emits: {}, imports: {} },
    rootDir: "<heex-procedural>",
    templates: new Map(),
    // Pack chrome is translated by the HEEx engine itself (`pgettext`), so the
    // shared pack-chrome switch has nothing to bind here.
    setChromeI18n() {},
    render(name: string, context: unknown): string {
      const fn = RENDERERS[name];
      if (!fn) {
        return `<%!-- ${giveUpText("loom.page-primitive-target-gap", `heex pack: no renderer for "${name}"`)} --%>`;
      }
      return fn((context ?? {}) as VM, sink);
    },
  };
}
