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
  "Heading",
  "Text",
  "Bold",
  "Italic",
  "InlineCode",
  "Anchor",
  "Badge",
  "EnumBadge",
  "Stat",
  "Avatar",
  "Loader",
  "Image",
  "Icon",
  "Money",
  "DateDisplay",
  "Alert",
  "For",
  "QueryView",
  "Button",
  "Field",
  "NumberField",
  "PasswordField",
  "MultilineField",
  "SelectField",
  "Toggle",
  "LocaleSwitcher",
  "Action",
  "CreateForm",
  "OperationForm",
  "WorkflowForm",
  "DestroyForm",
  "Modal",
  "FileLink",
  "ProvenanceInfo",
  "Timeline",
  "Table",
  "FileUpload",
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

/** Indent every non-empty line after the first by `pad` — a fragment the HEEx
 *  engine rendered relative to its own first column, placed at `pad`. */
function padTail(fragment: string, pad: string): string {
  return fragment
    .split("\n")
    .map((line, i) => (i === 0 || line.length === 0 ? line : pad + line))
    .join("\n");
}

/** An inline text element (`<p>`, `<strong>`, `<em>`, `<code>`): each child on
 *  its own line, the author's `style:` then the `testid:` on the tag, and the
 *  self-closing tag when there is no content. */
function textElement(tag: string, vm: VM, rest: readonly string[] = []): string {
  const indent = str(vm.indent);
  const text = str(vm.text);
  const children = [...(text.length > 0 ? [padTail(text, indent)] : []), ...rest];
  const attrs = `${str(vm.styleAttr)}${str(vm.testidAttr)}`;
  if (children.length === 0) return `<${tag}${attrs} />`;
  return `<${tag}${attrs}>\n${indent}${children.join(`\n${indent}`)}\n${str(vm.closeIndent)}</${tag}>`;
}

/** `Text` — its first positional is the text (or the whole translated rich
 *  sentence); the positionals after it are further children. */
function renderText(vm: VM): string {
  const rest = typeof vm.restChildren === "function" ? (vm.restChildren as () => string[])() : [];
  return textElement("p", vm, rest);
}

/** `Heading` → a raw `<h{n}>` whose rank the shared emitter derives (explicit
 *  `level:`, else from the enclosing `Section`/`Card` nesting).  The design
 *  pack's `.header` component always renders an `<h1>`, so it is not used; the
 *  class mirrors its typography. */
function renderHeading(vm: VM): string {
  const level = String(vm.level);
  return `<h${level} class="text-lg font-semibold leading-8 text-zinc-800"${str(vm.testidAttr)}>${str(vm.text)}</h${level}>`;
}

/** `Anchor(label, to:)` — a literal internal route rides the verified-route
 *  `~p` sigil on `<.link navigate>`, a literal external URL a plain `<a href>`,
 *  a dynamic destination a `navigate={…}` expression attribute.  With no `to:`
 *  the label renders as a `<span>`: an empty `navigate={}` would not parse. */
function renderAnchor(vm: VM): string {
  const testid = str(vm.testidAttr);
  const label = str(vm.label);
  const literal = vm.toLiteral;
  if (typeof literal === "string") {
    return literal.startsWith("/")
      ? `<.link navigate={~p"${literal}"}${testid}>${label}</.link>`
      : `<a href="${literal}"${testid}>${label}</a>`;
  }
  if (!vm.hasTo) return `<span${testid}>${label}</span>`;
  return `<.link navigate={${str(vm.to)}}${testid}>${label}</.link>`;
}

const thunk = (v: unknown): string => (typeof v === "function" ? String(v()) : "");

/** `Badge(label)` → the design pack's `<.badge>` with the label as its block. */
function renderBadge(vm: VM): string {
  return textElement(".badge", { ...vm, text: vm.hasLabel ? vm.label : "" });
}

/** `EnumBadge(value)` → a badge span showing the value's display label. */
function renderEnumBadge(vm: VM): string {
  return `<span class="badge badge-enum"${str(vm.testidAttr)}>${str(vm.valueText)}</span>`;
}

/** `Stat(label, value)` → a headline stat: dimmed label over a bold value.  A
 *  primitive value was walked one level deeper than it lands (inline in its
 *  `<div>`), so its later lines move back to this element's own indent. */
function renderStat(vm: VM): string {
  const indent = str(vm.indent);
  const close = str(vm.closeIndent);
  const value = str(vm.value)
    .split("\n")
    .map((line, i) => (i > 0 && line.startsWith(indent) ? close + line.slice(indent.length) : line))
    .join("\n");
  return (
    `<div class="stat"${str(vm.testidAttr)}>\n` +
    `${indent}<div class="stat-label text-sm text-gray-500">${str(vm.label)}</div>\n` +
    `${indent}<div class="stat-value text-2xl font-semibold">${value}</div>\n` +
    `${close}</div>`
  );
}

const AVATAR_CLASS = "inline-block h-8 w-8 rounded-full";

/** `Avatar(src?, alt?)` → a circle-cropped `<img>`, or a neutral circle when
 *  there is no `src:` — then the placeholder itself is the named image. */
function renderAvatar(vm: VM): string {
  const testid = str(vm.testidAttr);
  const alt = thunk(vm.altAttr);
  if (vm.hasSrc) {
    return `<img class="${AVATAR_CLASS} object-cover"${thunk(vm.srcAttr)}${alt || ' alt=""'}${testid} />`;
  }
  const named = alt ? alt.replace(/^ alt=/, ' role="img" aria-label=') : "";
  return `<span class="${AVATAR_CLASS} bg-gray-200"${named}${testid}></span>`;
}

/** `Loader(size?)` → an animated spinner with a `status` role and the
 *  translated "Loading" name.  One spinner size. */
function renderLoader(vm: VM): string {
  return `<div class="animate-spin h-6 w-6 rounded-full border-2 border-gray-300 border-t-transparent" role="status"${str(vm.loadingAria)}${str(vm.testidAttr)}></div>`;
}

/** `Image(src, alt)` → `<img />`; `decorative: true` gives an explicit empty
 *  `alt`. */
function renderImage(vm: VM): string {
  return `<img${thunk(vm.srcAttr)}${thunk(vm.altAttr)}${str(vm.testidAttr)} />`;
}

/** `Icon(name:|svg:, size?, label?)` → the glyph in a `loom-icon` span:
 *  decorative (`aria-hidden`) unless a `label:` names it a `role="img"`. */
function renderIcon(vm: VM): string {
  const size = vm.hasSize ? ` loom-icon-${str(vm.size)}` : "";
  return `<span class="loom-icon${size}"${str(vm.testidAttr)}${str(vm.a11yAttr)}>${str(vm.svg)}</span>`;
}

/** `Money(value, currency?)` → a money span.  The amount renders through
 *  `to_string/1`: an aggregate field is a `%Decimal{}`, a projection field is
 *  already a string and a literal is a float, and `String.Chars` handles all
 *  three where `Decimal.to_string/1` raises on two. */
function renderMoney(vm: VM): string {
  const prefix = vm.hasCurrency ? `${JSON.parse(str(vm.currency)) as string} ` : "";
  return `<span class="money"${str(vm.testidAttr)}>${prefix}<%= to_string(${str(vm.valueExpr)}) %></span>`;
}

/** `DateDisplay(value)` → a `<time>` carrying the ISO value, showing the date. */
function renderDateDisplay(vm: VM): string {
  const testid = str(vm.testidAttr);
  if (!vm.hasValue) return `<time${testid}></time>`;
  const v = str(vm.valueExpr);
  return `<time datetime={to_string(${v})}${testid}><%= Calendar.strftime(${v}, "%Y-%m-%d") %></time>`;
}

/** `Alert(color:)` → the daisyUI alert modifier.  A raw colour (`alert-red`)
 *  matches no class in either HEEx pack's CSS, so it is mapped, as the JSX
 *  packs map it; anything unknown is an error alert. */
function alertVariant(color: string): string {
  switch (color) {
    case "yellow":
      return "alert-warning";
    case "green":
      return "alert-success";
    case "blue":
      return "alert-info";
    default:
      return "alert-error";
  }
}

/** `Alert(message, title?, color?)` → an `alert`-role box; the title (a
 *  user-visible slot) leads as a bold line. */
function renderAlert(vm: VM): string {
  const title = vm.hasTitle ? str(vm.title) : "";
  const titleEl = title ? `<p class="font-medium">${title}</p>` : "";
  return `<div class="alert ${alertVariant(str(vm.color))}" role="alert"${str(vm.testidAttr)}>${titleEl}${str(vm.message)}</div>`;
}

function escapeAttr(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** `primitive-*` template name → its HEEx renderer. */
/** `Button` → the design pack's `<.button>`.  A click binds the hoisted
 *  `handle_event` the target registered (`phx-click="<event>"`); a `to:`
 *  destination makes the pack's button a navigation link (`to=`).  `icon:`
 *  becomes an inline, `aria-hidden` glyph in the inner block — `<.button>`
 *  declares no icon attribute, and an undeclared attribute on a function
 *  component fails `mix compile --warnings-as-errors` — and `loading:` becomes
 *  `aria-busy`, a global ARIA attribute the component's `:global` rest
 *  accepts. */
function renderButton(vm: VM): string {
  const attrs = [
    str(vm.styleAttr),
    str(vm.onClick) !== "" ? ` phx-click="${str(vm.onClick)}"` : "",
    str(vm.toAttr),
    vm.hasDisabled ? ` disabled={${str(vm.disabled)}}` : "",
    vm.hasVariant ? ` variant="${str(vm.variant)}"` : "",
    str(vm.a11yAttr),
    str(vm.testidAttr),
    vm.hasLoading ? ` aria-busy={${str(vm.loading)}}` : "",
  ].join("");
  const icon = vm.hasIcon
    ? `<span class="loom-icon" aria-hidden="true">${str(vm.iconSvg)}</span>`
    : undefined;
  const label = vm.hasText ? str(vm.label) : undefined;
  const inner = (vm.iconPosition === "left" ? [icon, label] : [label, icon]).filter(
    (c): c is string => c !== undefined,
  );
  if (inner.length === 0) return `<.button${attrs} />`;
  const indent = str(vm.indent);
  return `<.button${attrs}>\n${inner.map((c) => indent + c).join("\n")}\n${str(vm.closeIndent)}</.button>`;
}

/** A `bind:` input → the design pack's `<.input>`, named after the state
 *  assign it writes back and bound to the `handle_event` clause the target
 *  hoisted for it (`update_<field>` / `toggle_<field>`).  An input with no
 *  state field to bind renders a disabled stub. */
function renderInput(type: string, vm: VM): string {
  const label = str(vm.labelAttr);
  const testid = str(vm.testidAttr);
  if (!vm.hasOnChange) {
    const opts = type === "select" ? " options={[]}" : "";
    return `<.input type="${type}" name="_unbound"${label}${opts} value="" disabled${testid} />`;
  }
  const event = str(vm.onChange);
  const field = event.replace(/^(update|toggle)_/, "");
  const opts = type === "select" ? ` options={${str(vm.optionsExpr)}}` : "";
  return `<.input type="${type}" name="${field}" value={@${field}}${opts}${label} phx-change="${event}"${testid} />`;
}

/** `QueryView` → LiveView's loading / error / empty / data ladder over the
 *  assign its load fills in `handle_params` (`queryExpr`, bound by
 *  `heexTarget.bindQueryView`):
 *
 *    nil        → still loading → `loading:`
 *    :error     → load error    → `error:`
 *    :not_found / empty         → `empty:` (`:not_found` for one record,
 *                                  `Enum.empty?/1` of the list — of the
 *                                  envelope's `.items` when the read is paged)
 *    otherwise  → loaded        → `data:`
 *
 *  An absent branch arrives empty (`heexTarget.emptyChild`) and takes its
 *  default markup; an absent `data:` renders nothing. */
function renderQueryView(vm: VM): string {
  const depth = str(vm.closeIndent).length / 2;
  const assign = `@${str(vm.queryExpr)}`;
  const branch = (b: unknown, dflt: string): string =>
    str(b) === "" ? dflt : dedentTail(str(b), depth + 2);
  const emptyTest = vm.single
    ? `${assign} == :not_found`
    : `Enum.empty?(${vm.paged ? `${assign}.items` : assign})`;
  const lines = [
    "<%= cond do %>",
    `  <% is_nil(${assign}) -> %>`,
    `    ${branch(vm.loadingJsx, '<div class="animate-pulse">Loading...</div>')}`,
    `  <% ${assign} == :error -> %>`,
    `    ${branch(vm.errorJsx, '<div class="alert alert-error">Error loading data.</div>')}`,
    `  <% ${emptyTest} -> %>`,
    `    ${branch(vm.emptyJsx, '<div class="empty">No items.</div>')}`,
    "  <% true -> %>",
    `    ${branch(vm.dataJsx, "")}`,
    "<% end %>",
  ];
  return indentTail(lines.join("\n"), depth);
}

/** Indent every non-empty line after the first by `depth` levels — a fragment
 *  rendered relative to its own first column, placed at the shared core's
 *  absolute indent. */
export function indentTail(fragment: string, depth: number): string {
  return padTail(fragment, "  ".repeat(depth));
}

/** The inverse of `indentTail`: strip `depth` levels from every line after
 *  the first — a child the shared core walked at `depth`, back to the
 *  first-column-relative form a HEEx block nests. */
export function dedentTail(fragment: string, depth: number): string {
  const pad = "  ".repeat(depth);
  return fragment
    .split("\n")
    .map((line, i) => (i > 0 && line.startsWith(pad) ? line.slice(pad.length) : line))
    .join("\n");
}

const RENDERERS: Record<string, Renderer> = {
  "primitive-stack": (vm) => layoutDiv(LAYOUT_CLASSES.Stack, vm),
  "primitive-group": (vm) => layoutDiv(LAYOUT_CLASSES.Group, vm),
  "primitive-grid": renderGrid,
  "primitive-container": renderContainer,
  "primitive-card": renderCard,
  "primitive-divider": renderDivider,
  "primitive-tabs": renderTabs,
  "primitive-heading": renderHeading,
  "primitive-text": renderText,
  "primitive-bold": (vm) => textElement("strong", vm),
  "primitive-italic": (vm) => textElement("em", vm),
  "primitive-inline-code": (vm) => textElement("code", vm),
  "primitive-anchor": renderAnchor,
  "primitive-badge": renderBadge,
  "primitive-enum-badge": renderEnumBadge,
  "primitive-stat": renderStat,
  "primitive-avatar": renderAvatar,
  "primitive-loader": renderLoader,
  "primitive-image": renderImage,
  "primitive-icon": renderIcon,
  "primitive-money": renderMoney,
  "primitive-date-display": renderDateDisplay,
  "primitive-alert": renderAlert,
  "primitive-query-view": renderQueryView,
  "primitive-button": renderButton,
  "primitive-field": (vm) => renderInput("text", vm),
  "primitive-number-field": (vm) => renderInput("number", vm),
  "primitive-password-field": (vm) => renderInput("password", vm),
  "primitive-multiline-field": (vm) => renderInput("textarea", vm),
  "primitive-select-field": (vm) => renderInput("select", vm),
  "primitive-toggle": (vm) => renderInput("checkbox", vm),
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
