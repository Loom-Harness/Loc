// ---------------------------------------------------------------------------
// HEEx `WalkerTarget` — the Phoenix LiveView implementation of the
// cross-framework walker contract (`src/generator/_walker/target.ts`).
//
// A HEEx body runs through the shared walker core.  The primitives in
// `HEEX_SHARED_PRIMITIVES` render through their shared `emit*` functions and
// the procedural `heex-pack.ts`; every other node goes to the HEEx engine
// (`heex-walker-core.ts`) through `renderNodeOverride`, and the expression and
// text overrides send the shared emitters' arguments to that engine too, so
// both halves render a value the same way.
//
// `framework: "phoenixLiveView"` matches the IR enum.
// ---------------------------------------------------------------------------

import type { TypeIR } from "../../ir/types/loom-ir.js";
import { requireFrontendAxes } from "../../util/frontend-axes.js";
import { snake } from "../../util/naming.js";
import { unreachableExprLeaves } from "../_walker/js-expr-leaves.js";
import type { ApiCallSite, RenderPosition, StateRef, WalkerTarget } from "../_walker/target.js";
import type { WalkContext as SharedWalkContext, WalkContext } from "../_walker/walker-core.js";
import { dedentTail, HEEX_SHARED_PRIMITIVES, indentTail } from "./heex-pack.js";
import {
  bindHeexQueryView,
  bindStateInput,
  heexEnumBadgeText,
  queryViewDataContext,
  testIdAttr,
  withRowType,
} from "./heex-primitives.js";
import {
  escapeHeexAttr,
  escapeHeexText,
  type WalkContext as HeexWalkContext,
  type HeexWalkSink,
  heexContextOf,
  hoistLambdaToHandler,
  matchArmContext,
  renderChild,
  renderExpr,
  renderInTemplate,
  rendersMarkupBlock,
  storeActionEvent,
} from "./heex-walker-core.js";
import { pgettextCall } from "./i18n.js";
import { renderLocaleSelect } from "./locale.js";
import { ELIXIR_CTX_FREE_LEAVES } from "./render-expr.js";

export const heexTarget: WalkerTarget = {
  /** A translated rich sentence: `loom_rich/2` formats the holes, escapes the
   *  text and turns the `<b>`/`<i>`/`<code>` tags into elements, so a locale
   *  can reorder the parts. */
  renderRichText({ key, message, values }) {
    const bindings = (values ?? []).map((v) => `${v.name}: ${v.expr}`).join(", ");
    return `<%= loom_rich(${pgettextCall(key, message)}, [${bindings}]) %>`;
  },
  framework: "phoenixLiveView",
  axes: requireFrontendAxes("phoenixLiveView"),

  // --- Bridge seam ----------------------------------------------------------

  /** A node of a HEEx body renders through the HEEx engine
   *  (`heex-walker-core.ts`) under the HEEx walk context the sink carries,
   *  unless it is a call to a primitive the shared core renders
   *  (`HEEX_SHARED_PRIMITIVES`).  The engine recurses into the node's subtree
   *  itself.  Below the body root it renders the node as a child and the
   *  result is re-indented to the shared core's absolute convention.  A walk
   *  with no HEEx context in its sink falls through to the shared path. */
  renderNodeOverride(expr, ctx, depth) {
    const heex = heexContextOf(ctx.sink);
    if (!heex) return undefined;
    // A value object sharing a primitive's name (`Money`) is a construction,
    // which the engine renders.
    if (
      expr.kind === "call" &&
      HEEX_SHARED_PRIMITIVES.has(expr.name) &&
      !heex.valueObjectsByName.has(expr.name)
    ) {
      if (expr.name === "Tabs" && expr.args.some((_, i) => !expr.argNames?.[i])) {
        // Number the group on entry, before its panels walk, so a nested
        // group gets a later id than its parent (see `tabSeq`).
        heex.tabSeq.value += 1;
        heex.tabSeq.reserved = [...(heex.tabSeq.reserved ?? []), heex.tabSeq.value];
      }
      return undefined;
    }
    const engine = engineContext(heex, ctx);
    // A `match` or ternary whose branches are markup is control flow the
    // shared core renders; one whose branches are terms is an Elixir value.
    if (rendersMarkupBlock(expr, engine)) return undefined;
    return depth === 0 ? renderExpr(expr, engine) : indentTail(renderChild(expr, engine), depth);
  },

  /** A `For` item, a block `match` arm and a `QueryView` `data:` body render
   *  under their own HEEx walk context: the item's row aggregate, the arm's
   *  load gate, the data param's assign. */
  scopeSink(sink, scope): HeexWalkSink | undefined {
    const heex = heexContextOf(sink);
    if (!heex) return undefined;
    switch (scope.kind) {
      case "row":
        return { heex: withRowType(heex, scope.collection, scope.param) };
      case "match-arm":
        return { heex: matchArmContext(scope.match, scope.index, heex) };
      case "query-data":
        return { heex: queryViewDataContext(scope.query, scope.param, heex) };
    }
  },

  /** A `QueryView` reads an assign its LiveView loads in `handle_params`; the
   *  load is registered here, after the view's branches registered theirs. */
  bindQueryView(spec, ctx) {
    const heex = heexContextOf(ctx.sink);
    return heex ? bindHeexQueryView(spec.call, engineContext(heex, ctx)) : undefined;
  },

  /** A LiveView handler body lives in a `handle_event/3` clause, apart from
   *  the markup: an inline lambda is hoisted into one, a named page action or
   *  a store action already has its own, a bound input writes its field back
   *  through one, and the use site names the event. */
  bindEventHandler(source, ctx) {
    const heex = heexContextOf(ctx.sink);
    if (!heex) return undefined;
    switch (source.kind) {
      case "lambda":
        return hoistLambdaToHandler(source.lambda, engineContext(heex, ctx));
      case "action":
        return snake(source.actionName);
      case "store-action":
        return storeActionEvent(source.storeName, source.actionName);
      case "input":
        return bindStateInput(source.stateName, source.control, engineContext(heex, ctx));
    }
  },

  /** A handler the core would render at the use site.  Every LiveView
   *  handler is bound through `bindEventHandler`, so what reaches here is a
   *  button's `to:` navigation — which the pack renders as a link — and the
   *  click binds nothing. */
  renderEventHandler: () => "",

  /** An absent `QueryView` branch: the pack fills in its default markup. */
  emptyChild: "",

  /** Every expression a shared emitter renders goes through the HEEx engine,
   *  in template position — a ported primitive's `testid:` binding, `style:`
   *  value or ICU hole reads exactly as the engine reads it. */
  renderExprOverride(expr, ctx) {
    const heex = heexContextOf(ctx.sink);
    if (!heex) return undefined;
    return renderExpr(expr, { ...engineContext(heex, ctx), position: "template" });
  },

  /** A non-literal primitive TEXT (a caption, a label) renders as the engine
   *  renders a template slot: `<%= expr %>`, a `label(…)` as its gettext call
   *  or escaped English, a nested primitive as its markup.  A string literal
   *  takes the shared path, which escapes it with `escapeText`. */
  renderTextContentOverride(expr, ctx) {
    const heex = heexContextOf(ctx.sink);
    if (!heex || (expr.kind === "literal" && expr.lit === "string")) return undefined;
    return renderInTemplate(expr, engineContext(heex, ctx));
  },

  /** An `EnumBadge`'s text, through the engine's enum-label lookup (which
   *  also resolves a table row's field type). */
  renderEnumBadgeText(value, ctx) {
    const heex = heexContextOf(ctx.sink);
    return heex ? heexEnumBadgeText(value, engineContext(heex, ctx)) : undefined;
  },

  /** A call into the Gettext runtime: `pgettext(<key>, <English>)`, wrapped in
   *  `loom_icu/2` with a keyword list of the holes for an interpolated message.
   *  The context is Loom's catalog key, so the `.po` entry and the other
   *  frontends' catalogs stay the same message. */
  renderTranslate({ key, message, values }) {
    const call = pgettextCall(key, message);
    if (!values || values.length === 0) return call;
    return `loom_icu(${call}, [${values.map((v) => `${v.name}: ${v.expr}`).join(", ")}])`;
  },

  // Expression-syntax leaves.  Every expression a shared emitter renders goes
  // through `renderExprOverride` to the HEEx engine, so the JS-shaped leaves
  // stay unreachable and throw if that ever regresses — except the literal,
  // which the shared emitters also spell directly (a nav destination).
  ...unreachableExprLeaves,
  exprLiteral: (lit, value) => ELIXIR_CTX_FREE_LEAVES.literal(lit, value),

  // --- State seam ---------------------------------------------------------

  /** HEEx differentiates template (`@field`) from handler
   *  (`socket.assigns.field`).  Mirrors heex-walker.ts:253-259 and
   *  the ref-case branch at :366. */
  renderStateRead(ref: StateRef, position: RenderPosition): string {
    const snakeName = snakeLocal(ref.name);
    return position === "template" ? `@${snakeName}` : `socket.assigns.${snakeName}`;
  },

  /** Pipe step: `|> assign(:field, value)`.  The caller pipes the
   *  socket through these as part of handler-body composition.
   *  Mirrors `case "assign"` at heex-walker.ts:1566-1572. */
  renderStateWrite(ref: StateRef, value: string): string {
    return `|> assign(:${snakeLocal(ref.name)}, ${value})`;
  },

  /** Unreachable: the HEEx walker (heex-walker-core.ts) renders state
   *  mutation through its own engine, never the shared `stateWrite`. */
  renderNestedStateWrite(): never {
    throw new Error(
      "heexTarget.renderNestedStateWrite: HEEx renders state through its own engine; this should never be called.",
    );
  },

  // --- Data-access seam ----------------------------------------------------

  /** LiveView keeps page state in the session process, so a body's data
   *  access is an in-process call to the aggregate's Phoenix context module:
   *  `<App>.<Context>.<op>_<aggregate_snake>!(args)`.  The binding IS that
   *  call — there is no client handle to declare — and its arguments render
   *  through the HEEx engine under the walk context in `ctx.sink`, since the
   *  shared expression renderer does not speak Elixir. */
  bindDataAccess(access, _renderArg, ctx) {
    const heex = heexContextOf(ctx?.sink);
    if (!heex) {
      throw new Error("heexTarget.bindDataAccess: no HEEx walk context in the sink");
    }
    const contextModule = heex.contextModuleByAggName.get(access.aggregateName) ?? heex.appModule;
    const fn = codeInterfaceFnName(access.aggregateName, access.operation);
    const argsRendered = access.args.map((a) => renderExpr(a, heex));
    return {
      varName: `${contextModule}.${fn}(${argsRendered.join(", ")})`,
      hookName: fn,
      importFrom: contextModule,
      argsRendered,
    };
  },

  /** The in-process context call, written at the site.  A site the shared
   *  core binds carries the whole call as `varName`; the HEEx engine passes
   *  the bare operation and prepends the context module itself. */
  renderApiCall(call: ApiCallSite, renderedArgs: string, ctx?: WalkContext): string {
    if (ctx !== undefined && call.varName !== undefined) return call.varName;
    const fn = codeInterfaceFnName(call.aggregateName, call.operation);
    return renderedArgs.length === 0 ? `${fn}()` : `${fn}(${renderedArgs})`;
  },

  /** Empty — LiveView reads in `mount/3` / `handle_params/3` and writes from
   *  `handle_event/3`; a page declares no per-page binding. */
  renderDataBindings(_uses: ApiCallSite[]): string[] {
    return [];
  },

  // --- Match expression seam ----------------------------------------------

  /** Elixir `cond do … true -> fallback end`.  Caller wraps in
   *  `<%= … %>` when in template position — this method emits the
   *  bare cond.  Mirrors `renderMatch` at heex-walker.ts:543-552
   *  (without the position-dependent wrap). */
  renderMatch(
    arms: ReadonlyArray<{ predicate: string; value: string }>,
    elseArm: string | undefined,
  ): string {
    const armLines = arms.map((a) => `      ${a.predicate} -> ${a.value}`).join("\n");
    const fallback = elseArm !== undefined ? `\n      true -> ${elseArm}` : "";
    return `cond do\n${armLines}${fallback}\n    end`;
  },

  /** A `match` whose arms are markup: the `cond` BLOCK form, each arm's
   *  markup under its `<% p -> %>` clause.  `cond` raises `CondClauseError`
   *  when no arm matches, so a match without an authored `else` renders
   *  nothing (`<%= nil %>`) rather than crashing at request time. */
  renderMatchChild(
    arms: ReadonlyArray<{ predicate: string; value: string }>,
    elseArm: string | undefined,
    depth: number,
  ): string {
    const lines = ["<%= cond do %>"];
    for (const a of arms) {
      lines.push(`  <% ${a.predicate} -> %>`, `    ${dedentTail(a.value, depth + 1)}`);
    }
    lines.push(
      "  <% true -> %>",
      elseArm !== undefined ? `    ${dedentTail(elseArm, depth + 1)}` : "    <%= nil %>",
      "<% end %>",
    );
    return indentTail(lines.join("\n"), depth);
  },

  // --- Navigation seam ----------------------------------------------------

  /** `push_navigate(socket, to: ~p"/route?k=v")`.  Mirrors
   *  `renderNavigate` at heex-walker.ts:690-715.  Query-string
   *  composition is the contract's `args` set; the WalkerTarget
   *  expects them rendered already by the caller. */
  renderNavigate(
    routeTemplate: string,
    args: ReadonlyArray<{ name: string; value: string }>,
    _stateExpr?: string,
  ): string {
    // HEEx cannot embed an arbitrary expression into a `~p` sigil's
    // query string — the sigil is compile-time interpolated against
    // a known route template.  When the contract supplies
    // `stateExpr` (TSX escape hatch), Phoenix falls back to the
    // args-empty `push_navigate`; the source's pre-built state
    // object is opaque to the route.  Callers needing a richer
    // shape route through `handle_event` instead.
    if (args.length === 0) {
      return `push_navigate(socket, to: ~p"${routeTemplate}")`;
    }
    const queryPairs = args.map((a) => `${snakeLocal(a.name)}=#{${a.value}}`).join("&");
    return `push_navigate(socket, to: ~p"${routeTemplate}?${queryPairs}")`;
  },

  // --- Type-default seam --------------------------------------------------

  defaultInitFor(type: TypeIR): string {
    return defaultInitForHeex(type);
  },

  // --- Markup seams ---------------------------------------------------------
  //
  // The shared emitters of the ported primitives (`HEEX_SHARED_PRIMITIVES`)
  // render through these.

  /** HEEx template comment. */
  renderComment(text: string): string {
    return `<%!-- ${text} --%>`;
  },

  /** An Elixir expression in HEEx text position: `<%= expr %>`. */
  renderInterpolation(expr: string): string {
    return `<%= ${expr} %>`;
  },

  /** HEEx dynamic attribute: ` attr={expr}`. */
  renderAttrBinding(name: string, jsExpr: string): string {
    return ` ${name}={${jsExpr}}`;
  },

  /** A ternary whose branches are markup: the `if` BLOCK form, `<%= if c do
   *  %> … <% else %> … <% end %>`.  The expression form `if c, do: a, else: b`
   *  takes Elixir terms, and markup there is not valid HEEx. */
  renderConditionalChild(cond: string, thenS: string, elseS: string, depth: number): string {
    const fragment = [
      `<%= if ${cond} do %>`,
      indentLines(dedentTail(thenS, depth + 1), 1),
      "<% else %>",
      indentLines(dedentTail(elseS, depth + 1), 1),
      "<% end %>",
    ].join("\n");
    return indentTail(fragment, depth);
  },

  /** `LocaleSwitcher {}` → a `<select>` over the shipped locales, each under
   *  its own generate-time name (`Deutsch`, `Français`).  Choosing one writes
   *  the `loom_locale` cookie and reloads under `?lang=<tag>`, the two inputs
   *  the server-side negotiation reads first (the URL, then the cookie). */
  renderLocaleSwitcher(call, ctx, depth) {
    const heex = heexContextOf(ctx.sink);
    if (!heex || call.kind !== "call") {
      throw new Error("heexTarget.renderLocaleSwitcher: no HEEx walk context in the sink");
    }
    const engine = engineContext(heex, ctx);
    const testid = testIdAttr(call, engine) || ' data-testid="locale-switcher"';
    return indentTail(renderLocaleSelect(engine.appModule, engine.locales ?? [], testid), depth);
  },

  /** `For` → LiveView's for-comprehension block, `<%= for x <- coll do %> …
   *  <% end %>`.  No keyed wrapper: LiveView tracks a comprehension's items
   *  itself.  `for` has no else clause, so an `empty:` arm wraps the loop in
   *  an `Enum.empty?/1` guard, reading the collection twice. */
  renderForEach(
    coll: string,
    itemVar: string,
    _indexVar: string,
    _keyExpr: string,
    body: string,
    depth: number,
    emptyBody?: string,
  ): string {
    const loop = [
      `<%= for ${snake(itemVar)} <- ${coll} do %>`,
      indentLines(dedentTail(body, depth + 1), 1),
      "<% end %>",
    ].join("\n");
    const fragment =
      emptyBody === undefined
        ? loop
        : [
            `<%= if Enum.empty?(${coll}) do %>`,
            indentLines(dedentTail(emptyBody, depth + 1), 1),
            "<% else %>",
            indentLines(loop, 1),
            "<% end %>",
          ].join("\n");
    return indentTail(fragment, depth);
  },

  /** Flat quoted CSS string — the HEEx spelling of the `style: {…}`
   *  escape hatch: string-literal values verbatim, other values via their
   *  rendered expression, `"` entity-escaped so the attribute stays
   *  well-formed. */
  renderStyleAttr(
    entries: ReadonlyArray<{ key: string; rendered: string; literal?: string }>,
  ): string {
    if (entries.length === 0) return "";
    const css = entries
      .map(({ key, rendered, literal }) => `${key}: ${literal ?? rendered}`)
      .join("; ")
      .replace(/"/g, "&quot;");
    return ` style="${css}"`;
  },

  /** HEEx text escaping.  Delegates to the LIVE funnel the parallel
   *  heex-walker uses (`escapeHeexText`) so the contract-tested seam and
   *  the code path that actually renders can never disagree on escaping
   *  — the exact divergence audit finding 13 flagged (a standalone copy
   *  here would silently drift from `renderChild`/`renderInTemplate`). */
  escapeText(text: string): string {
    return escapeHeexText(text);
  },

  /** HEEx attribute escaping.  Delegates to the LIVE funnel
   *  (`escapeHeexAttr`) every real `attr="…"` emit site already shares
   *  (`heex-primitives.ts` / `heex-walker-core.ts`), same discipline as
   *  `escapeText` above (Wave 2 packet 2.2, F2-ELX-ESCAPE-FUNNEL). */
  escapeAttr(text: string): string {
    return escapeHeexAttr(text);
  },
};

// ---------------------------------------------------------------------------
// Store seam (Stage 5) — HEEx-specific.
//
// The cross-framework `WalkerTarget.renderStoreFieldRead`/`…ActionCall`
// signatures are shaped for the SHARED `walkBody` engine (`{ storeName,
// field }` / a shell-bound `local`), which the JSX/markup frontends drive.
// Phoenix LiveView runs the PARALLEL heex-walker engine and needs a
// position-aware read + an `update/3` call form, so the store seams live as
// standalone helpers the heex walker calls directly (the same way HEEx owns
// its parallel match / For rendering).  Keeping them off the `WalkerTarget`
// object keeps `heexTarget` byte-conformant to the shared contract.
//
// A `store Cart { … }` mounted on a LiveView page is seeded as one per-page
// assign — `assign(:cart, %Cart{})` — and rendered as a dedicated
// `<App>Web.Stores.Cart` module (defstruct + pure action fns).  The seams:
//
//   - read,  template position: `@cart.count`
//   - read,  handler  position: `socket.assigns.cart.count`
//   - call,  0 args: `update(socket, :cart, &Cart.clear/1)`
//   - call,  N args: `update(socket, :cart, fn c -> Cart.add(c, sku) end)`
//
// Namespaced through the `:<store_snake>` assign so a page `state { count }`
// and a `Cart.count` read never collide — there is no flat `@count`.

/** `Cart.count` read → `@cart.count` (template) / `socket.assigns.cart.count`
 *  (handler).  `store` is the PascalCase store name; the assign key is its
 *  snake form. */
export function renderHeexStoreFieldRead(
  store: string,
  field: string,
  position: RenderPosition,
): string {
  const assign = snakeLocal(store);
  const f = snakeLocal(field);
  return position === "template" ? `@${assign}.${f}` : `socket.assigns.${assign}.${f}`;
}

/** `Cart.clear()` / `Cart.add(sku)` call → an `update/3` over the store's
 *  per-page assign applying the store module's pure fn.  0 args → a captured
 *  `&Cart.clear/1`; N args → a `fn c -> … end` so the draft struct flows in
 *  as the first argument.  Emits handler-position Elixir (a `handle_event`
 *  body) — it pipes/returns a new socket. */
export function renderHeexStoreActionCall(
  store: string,
  action: string,
  renderedArgs: string,
): string {
  const assign = snakeLocal(store);
  const module = upperFirstLocal(store);
  const fn = snakeLocal(action);
  if (renderedArgs.length === 0) {
    return `update(socket, :${assign}, &${module}.${fn}/1)`;
  }
  return `update(socket, :${assign}, fn c -> ${module}.${fn}(c, ${renderedArgs}) end)`;
}

// ---------------------------------------------------------------------------
// Internals.
// ---------------------------------------------------------------------------

/** The HEEx walk context for a node the shared core hands to the engine: the
 *  sink's state, entered from `shared`, at the shared walk's heading depth. */
function engineContext(heex: HeexWalkContext, shared: SharedWalkContext): HeexWalkContext {
  return { ...heex, sharedWalk: shared, headingDepth: shared.headingDepth };
}

/** Indent every non-empty line by `depth` levels. */
function indentLines(fragment: string, depth: number): string {
  const pad = "  ".repeat(depth);
  return fragment
    .split("\n")
    .map((line) => (line.length > 0 ? pad + line : line))
    .join("\n");
}

/** Elixir literal-zero per type.  HEEx walker doesn't have a
 *  centralized version of this today (state inits in Phoenix are
 *  rare — `state {}` blocks lower into `mount/3` assigns).  Values
 *  match the spec §6 zero-value table in Elixir flavour. */
function defaultInitForHeex(type: TypeIR): string {
  if (type.kind === "primitive") {
    switch (type.name) {
      case "int":
      case "long":
        return "0";
      case "decimal":
      case "money":
        // Both are Decimal structs — zero is `Decimal.new("0")`, not `0`.
        return 'Decimal.new("0")';
      case "bool":
        return "false";
      case "string":
      case "date":
      case "datetime":
      case "guid":
        return '""';
    }
  }
  if (type.kind === "id" || type.kind === "enum") return '""';
  if (type.kind === "optional") return "nil";
  if (type.kind === "array") return "[]";
  return "nil";
}

/** Context module function name: `<op>_<aggregate_snake>!` (plural for
 *  list ops, singular otherwise).  Matches `renderApiCall` at
 *  `heex-walker.ts:693-712` byte-for-byte — same crude `<single>s`
 *  pluralisation, same `delete`/`destroy` aliasing, same `!` suffix
 *  on every non-list op. */
function codeInterfaceFnName(aggregate: string, op: string): string {
  const single = snakeLocal(aggregate);
  if (op === "create") return `create_${single}!`;
  if (op === "update") return `update_${single}!`;
  if (op === "delete" || op === "destroy") return `destroy_${single}!`;
  if (op === "all") return `list_${single}s!`; // crude plural — matches walker
  if (op === "byId") return `get_${single}!`;
  return `${snakeLocal(op)}_${single}!`;
}

// Self-contained naming helpers — same behaviour as util/naming.ts
// for the inputs the walker produces; keeps the target file
// independent of the wider toolchain.
function snakeLocal(s: string): string {
  return s
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toLowerCase();
}

/** PascalCase the first character — the Elixir module-name spelling of a
 *  store (`cart` / `Cart` → `Cart`).  Store names are already PascalCase in
 *  source, so this is just a defensive upper-first. */
function upperFirstLocal(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}
