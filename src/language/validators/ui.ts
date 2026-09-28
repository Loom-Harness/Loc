// UI / page / menu / theme / helper-import / api-body-ref checks.

import { type AstNode, AstUtils, type ValidationAcceptor } from "langium";
import { diagMessage } from "../../diagnostics/messages.js";
import type {
  ActionDecl,
  Api,
  Area,
  Component,
  Layout,
  MenuBlock,
  Model,
  NameRef,
  Page,
  Store,
  System,
  ThemeBlock,
  Ui,
  UiApiParam,
  UiChannelParam,
  UiMember,
  UiNotification,
} from "../generated/ast.js";
import {
  isActionDecl,
  isAggregate,
  isArea,
  isComponent,
  isMemberSuffix,
  isNameRef,
  isPage,
  isPostfixChain,
} from "../generated/ast.js";
import { isWalkerPrimitive } from "../walker-stdlib.js";
import {
  findAggregateInModule,
  isValidApiOperation,
  listValidApiOperations,
  pagePropDisplayName,
} from "./_shared.js";

/** `component` declarations — enforce the `extern` ↔ `body`
 *  exclusivity that the grammar admits but cannot constrain:
 *
 *   - An `extern` component hands rendering to a hand-written file, so
 *     it must declare **no** `body:` (mirror of "extern op bodies are
 *     preconditions-only").
 *   - A non-extern component is a walked region tree, so it **must**
 *     declare a `body:`.
 *
 *  Covers both ui-scope and top-level components (one stream over the
 *  whole model). */
export function checkComponent(model: Model, accept: ValidationAcceptor): void {
  for (const c of AstUtils.streamAllContents(model)) {
    if (!isComponent(c)) continue;
    const comp = c as Component;
    if (comp.extern) {
      if (comp.body) {
        accept(
          "error",
          diagMessage("loom.extern-component-has-body", {
            name: comp.name,
            externPath: comp.externPath ?? "?",
          }),
          { node: comp, property: "body", code: "loom.extern-component-has-body" },
        );
      }
    } else if (!comp.body) {
      accept("error", diagMessage("loom.component-missing-body", { name: comp.name }), {
        node: comp,
        property: "name",
        code: "loom.component-missing-body",
      });
    }
    // A component whose NAME is a walker primitive is emitted and never
    // rendered.  The page-body dispatcher resolves a call by name, primitives
    // first, so `component Alert(msg: string) { body: Heading { msg, level: 3 } }`
    // + `body: Stack { Alert("hi") }` writes `src/components/Alert.tsx` AND
    // emits the PACK's alert at the call site — measured on this tree at
    // `0 error(s), 0 warning(s)`, with the author's body appearing nowhere.
    //
    // Exactly the defect `loom.extern-function-shadows-stdlib` (below, in
    // `checkUi`) already refuses for an `extern function`; the component arm
    // was simply missing.  Deliberately components ONLY — a `valueobject Money`
    // does NOT shadow the `Money` primitive (re-probed: the primitive still
    // wins and its own arity gate still fires), and refusing it would reject
    // the shipped examples, which is why this is the narrow ruling rather than
    // the blanket "no user declaration may share a primitive name".  See
    // D-PAGE-PRIMITIVE-SHADOW.
    if (isWalkerPrimitive(comp.name)) {
      accept("error", diagMessage("loom.component-shadows-stdlib", { name: comp.name }), {
        node: comp,
        property: "name",
        code: "loom.component-shadows-stdlib",
      });
    }
    // Duplicate named action on one component — lowering's `indexActions` Map
    // would silently overwrite the earlier body (named-actions-and-stores.md,
    // Proposal A Stage 1).
    checkDuplicateActions(comp.decls.filter(isActionDecl), `component '${comp.name}'`, accept);
  }
}

/** Flag a second `action` member that re-declares a name already used on the
 *  same page/component surface (`loom.duplicate-action`).  AST-level: the IR's
 *  `indexActions` keys by name and would silently overwrite the first body, so
 *  the duplicate must be rejected before lowering. */
function checkDuplicateActions(
  actions: readonly ActionDecl[],
  surface: string,
  accept: ValidationAcceptor,
): void {
  const seen = new Set<string>();
  for (const a of actions) {
    if (seen.has(a.name)) {
      accept("error", diagMessage("loom.duplicate-action", { name: a.name, surface }), {
        node: a,
        property: "name",
        code: "loom.duplicate-action",
      });
      continue;
    }
    seen.add(a.name);
  }
}

export function checkTheme(block: ThemeBlock, accept: ValidationAcceptor): void {
  // Colour tokens (validated as hex) — palette + semantic slots.
  const colorNames = new Set([
    "primary",
    "secondary",
    "accent",
    "success",
    "warning",
    "error",
    "neutral",
  ]);
  // Non-colour tokens — each has its own per-property validator
  // below (radius enum, fontFamily/fontFamilyMono free-form,
  // colorScheme enum).
  const knownNames = new Set([
    ...colorNames,
    "radius",
    "fontFamily",
    "fontFamilyMono",
    "colorScheme",
  ]);
  const knownRadius = new Set(["none", "sm", "md", "lg", "xl"]);
  const knownColorSchemes = new Set(["light", "dark", "auto"]);
  // Hex colors: #RGB, #RRGGBB, or #RRGGBBAA.  Named colors,
  // `rgb(...)`, and CSS vars are rejected to keep the surface tight
  // and the Mantine shade-ramp generator simple.
  const hexColor = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
  const seen = new Set<string>();
  for (const p of block.props) {
    // (1) Unknown property name.
    if (!knownNames.has(p.name)) {
      accept(
        "error",
        diagMessage("loom.theme-property-unknown", {
          name: p.name,
          known: [...knownNames].join(", "),
        }),
        { node: p, property: "name", code: "loom.theme-property-unknown" },
      );
      continue;
    }
    // (2) Duplicate property name.
    if (seen.has(p.name)) {
      accept("error", diagMessage("loom.theme-property-duplicate", { name: p.name }), {
        node: p,
        property: "name",
        code: "loom.theme-property-duplicate",
      });
      continue;
    }
    seen.add(p.name);
    // (3) Per-property value validation.
    if (colorNames.has(p.name)) {
      if (!hexColor.test(p.value)) {
        accept("error", diagMessage("loom.theme-color-invalid", { name: p.name, value: p.value }), {
          node: p,
          property: "value",
          code: "loom.theme-color-invalid",
        });
      }
    } else if (p.name === "radius") {
      if (!knownRadius.has(p.value)) {
        accept(
          "error",
          diagMessage("loom.theme-radius-invalid", {
            known: [...knownRadius].join(" | "),
            value: p.value,
          }),
          { node: p, property: "value", code: "loom.theme-radius-invalid" },
        );
      }
    } else if (p.name === "colorScheme") {
      if (!knownColorSchemes.has(p.value)) {
        accept(
          "error",
          diagMessage("loom.theme-color-scheme-invalid", {
            known: [...knownColorSchemes].join(" | "),
            value: p.value,
          }),
          { node: p, property: "value", code: "loom.theme-color-scheme-invalid" },
        );
      }
    }
    // fontFamily / fontFamilyMono are free-form strings —
    // pass-through to the Mantine theme.  No validation beyond
    // "non-empty"; a typo'd family name silently falls through
    // to the OS fallback at runtime, which is acceptable.
  }
}

// ---------------------------------------------------------------------------
// Page metamodel validator obligations.
//
// Walks each `ui` SystemMember and emits diagnostics for malformed
// pages, scaffold directives, menus, and the references between
// them.  Cross-cutting rules (uniqueness across uis, deployable.ui
// → ui resolution) are handled in the dispatcher and
// `checkDeployable()` respectively.
//
// These checks are intentionally syntactic / cross-reference; deeper
// type analysis on body expressions and component-stdlib parameter
// shape lives in the page emitter (closed-stdlib spec table).
// ---------------------------------------------------------------------------

export function checkUi(ui: Ui, sys: System, accept: ValidationAcceptor): void {
  // Page name uniqueness is *per scope* (Rule 7): the ui's top level and each
  // `area { … }` block form their own page namespace, so role-named pages
  // (`page List` repeated across per-aggregate areas) don't collide, while a
  // genuine duplicate within one scope is still an error.  Override-by-name is
  // the SAME mechanism — an explicit page displaces exactly one scaffolded page
  // in its scope; two explicit pages with the same name in one scope are an
  // error.  Recurses into nested areas.
  const checkPageScope = (members: readonly UiMember[], scopeLabel: string): void => {
    const seen = new Map<string, Page>();
    // Area names are scoped the same way pages are, and for the same reason:
    // the area path is what lowering turns into `page.emitPath`, so two
    // same-named `area` blocks in one scope compute the SAME directory and
    // their pages silently overwrite each other (`checkPageScope` used to scope
    // page uniqueness per area NODE, so two `area Ops { page Dashboard … }`
    // blocks parsed clean and one Dashboard vanished from the build).  The
    // macro expander MERGES a synthesised area into a same-named explicit one —
    // that is the override path, and it leaves exactly one node; two EXPLICIT
    // same-named areas are the unintended case this rejects.
    const seenAreas = new Map<string, Area>();
    for (const m of members) {
      if (m.$type === "Area") {
        if (seenAreas.has(m.name)) {
          accept(
            "error",
            diagMessage("loom.ui-duplicate-area", { name: m.name, scope: scopeLabel }),
            {
              node: m,
              property: "name",
              code: "loom.ui-duplicate-area",
            },
          );
        } else {
          seenAreas.set(m.name, m);
        }
        checkPageScope(m.members, `area '${m.name}'`);
        continue;
      }
      if (m.$type !== "Page") continue;
      if (seen.has(m.name)) {
        accept(
          "error",
          diagMessage("loom.ui-page-duplicate", { name: m.name, scope: scopeLabel }),
          { node: m, property: "name", code: "loom.ui-page-duplicate" },
        );
      } else {
        seen.set(m.name, m);
      }
    }
  };
  checkPageScope(ui.members, `ui '${ui.name}'`);

  // At most one ui-level menu block (Rule 8 part).
  const menuBlocks = ui.members.filter((m) => m.$type === "MenuBlock");
  if (menuBlocks.length > 1) {
    for (const extra of menuBlocks.slice(1)) {
      accept("error", diagMessage("loom.ui-menu-duplicate", { name: ui.name }), {
        node: extra,
        code: "loom.ui-menu-duplicate",
      });
    }
  }

  // UI api parameter checks.
  //   - Param names unique within the ui (`api Sales: …` declared twice).
  //   - apiRef cross-ref must resolve (handled by Langium linker; the
  //     refRoot returns undefined when the target isn't found, so the
  //     check below catches it explicitly with a clearer message).
  const apiParamSeen = new Map<string, UiApiParam>();
  for (const m of ui.members) {
    if (m.$type !== "UiApiParam") continue;
    const prior = apiParamSeen.get(m.name);
    if (prior) {
      accept(
        "error",
        diagMessage("loom.ui-api-param-duplicate", { name: ui.name, param: m.name }),
        {
          node: m,
          property: "name",
          code: "loom.ui-api-param-duplicate",
        },
      );
    } else {
      apiParamSeen.set(m.name, m);
    }
    if (!m.apiRef?.ref) {
      accept(
        "error",
        diagMessage("loom.ui-api-unknown", {
          name: ui.name,
          apiName: m.apiRef?.$refText ?? "<missing>",
        }),
        { node: m, property: "apiRef", code: "loom.ui-api-unknown" },
      );
    }
  }

  // UI channel parameter checks (channels.md Part I, ui surface).
  //   - Param names unique within the ui (shared namespace with api
  //     params — `channel Sales: …` next to `api Sales: …` would make
  //     `on Sales.X` ambiguous to a reader even though the cross-ref
  //     type disambiguates).
  //   - The subscribed channel must be `delivery: broadcast` — `queue`
  //     is competing-consumer work distribution, never UI-observable.
  const channelParamSeen = new Map<string, UiChannelParam>();
  for (const m of ui.members) {
    if (m.$type !== "UiChannelParam") continue;
    const prior = channelParamSeen.get(m.name) ?? apiParamSeen.get(m.name);
    if (prior) {
      accept("error", diagMessage("loom.ui-param-duplicate", { name: ui.name, param: m.name }), {
        node: m,
        property: "name",
        code: "loom.ui-param-duplicate",
      });
    } else {
      channelParamSeen.set(m.name, m);
    }
    const ch = m.channel?.ref;
    if (ch && (ch.delivery ?? "broadcast") !== "broadcast") {
      accept(
        "error",
        diagMessage("loom.ui-channel-not-broadcast", {
          name: ui.name,
          chName: ch.name,
          delivery: ch.delivery,
        }),
        { node: m, property: "channel", code: "loom.ui-channel-not-broadcast" },
      );
    }
  }

  // Extern frontend functions (extern-function-hook-escape-hatch.md §3):
  //   - a name may not shadow a walker-stdlib primitive (the body
  //     dispatcher would route the call to the primitive, silently
  //     ignoring the user's module);
  //   - names unique within the ui.
  const fnSeen = new Set<string>();
  for (const m of ui.members) {
    if (m.$type !== "UiFunction") continue;
    if (isWalkerPrimitive(m.name)) {
      accept("error", diagMessage("loom.extern-function-shadows-stdlib", { name: m.name }), {
        node: m,
        property: "name",
        code: "loom.extern-function-shadows-stdlib",
      });
    }
    if (fnSeen.has(m.name)) {
      accept(
        "error",
        diagMessage("loom.ui-function-duplicate", { name: ui.name, fnName: m.name }),
        {
          node: m,
          property: "name",
          code: "loom.ui-function-duplicate",
        },
      );
    }
    fnSeen.add(m.name);
  }

  // Per-member walks.  `Scaffold` is gone — its arg-resolution
  // diagnostics now live in the macro expander, which surfaces
  // them through the same accept() pipeline.
  for (const m of ui.members) {
    if (m.$type === "Page") checkPage(m, ui, accept);
    else if (m.$type === "MenuBlock") checkMenuBlock(m, ui, accept);
    else if (m.$type === "UiNotification") checkUiNotification(m, ui, accept);
    else if (m.$type === "Store") checkStore(m, accept);
  }
  void sys;
}

/** Valid `persist: <value>` identifiers for the store lifetime ladder
 *  (frontend-state-management.md §3.1).  The value is a plain `ID` in the
 *  grammar (so `url`/`local`/`session` stay usable as field names), so its
 *  membership is enforced here rather than by the parser. */
const STORE_LIFETIMES = new Set(["memory", "local", "session", "url"]);

export function checkStore(store: Store, accept: ValidationAcceptor): void {
  if (store.lifetime != null && !STORE_LIFETIMES.has(store.lifetime)) {
    accept(
      "error",
      diagMessage("loom.store-lifetime-invalid", {
        name: store.name,
        lifetime: store.lifetime,
        storeLifetimes: [...STORE_LIFETIMES].join(" | "),
      }),
      { node: store, property: "lifetime", code: "loom.store-lifetime-invalid" },
    );
  }
}

/** `on <param>.<Event>(e) { … }` live-event handler (channels.md Part I).
 *  A handler body admits two actions:
 *
 *   - `toast(<one message expression>)` — a message notification.
 *   - `refetch(<Aggregate>[, <Aggregate>…])` — invalidate that
 *     aggregate's query cache, the realtime twin of a mutation's
 *     `onSuccess` invalidation.  Each target must name an aggregate
 *     declared in the enclosing system (the frontend registers its
 *     queries under `["<snake-plural>"]`).
 *
 *  Anything else (an assignment, `navigate(…)`, an unknown call) has
 *  nowhere to lower and is rejected with `loom.ui-handler-statement-unknown`.
 *  An unresolvable refetch target gets the distinct, more specific
 *  `loom.ui-handler-refetch-target` code. */
export function checkUiNotification(n: UiNotification, ui: Ui, accept: ValidationAcceptor): void {
  // Aggregate names declared anywhere in the enclosing model — the
  // frontend api modules the ui mounts register their queries under
  // `["<snake-plural-of-aggregate>"]`, so a refetch target must name a
  // real aggregate for the invalidation to hit anything.
  const aggregateNames = new Set<string>();
  for (const node of AstUtils.streamAllContents(AstUtils.findRootNode(ui))) {
    if (isAggregate(node)) aggregateNames.add(node.name);
  }
  const where = `'on ${n.param?.$refText}.${n.event?.$refText}' handler`;
  for (const stmt of n.body) {
    const isBareCall = !stmt.op && stmt.target.call === true && stmt.target.tail.length === 0;
    const head = stmt.target.head;
    if (isBareCall && head === "toast" && stmt.target.args.length === 1) {
      // toast(<message>).  This gate bounds the handler's STATEMENT vocabulary
      // only — the message EXPRESSION is checked one layer down, by
      // `loom.toast-message-unsupported` in `src/ir/validate/checks/ui-checks.ts`.
      // Deliberately there and not here: the four realtime renderers
      // (`_frontend/realtime.ts`, `feliz/realtime.ts`,
      // `elixir/realtime-liveview.ts`, `flutter/realtime.ts`) switch on the
      // LOWERED `ExprIR.kind` and throw on anything outside their shared
      // subset, so the check that mirrors them has to see the same node kinds
      // they do.  Accepting any expression here without that check is what
      // turned `toast(string(e.at))` into a codegen crash with no `loom.*` code.
      continue;
    }
    if (isBareCall && head === "refetch") {
      if (stmt.target.args.length === 0) {
        accept(
          "error",
          diagMessage("loom.ui-handler-refetch-target#refetch-in-needs-at-least", { where }),
          { node: stmt, code: "loom.ui-handler-refetch-target" },
        );
        continue;
      }
      for (const arg of stmt.target.args) {
        if (!isNameRef(arg)) {
          accept(
            "error",
            diagMessage("loom.ui-handler-refetch-target#refetch-arguments-in-must", { where }),
            { node: arg, code: "loom.ui-handler-refetch-target" },
          );
        } else if (!aggregateNames.has(arg.name)) {
          accept(
            "error",
            diagMessage("loom.ui-handler-refetch-target#unknown-refetch-target", {
              name: arg.name,
              where,
            }),
            { node: arg, code: "loom.ui-handler-refetch-target" },
          );
        }
      }
      continue;
    }
    accept("error", diagMessage("loom.ui-handler-statement-unknown", { where }), {
      node: stmt,
      code: "loom.ui-handler-statement-unknown",
    });
  }
}

export function checkPage(p: Page, ui: Ui, accept: ValidationAcceptor): void {
  void ui;
  // Validate api body refs first so each chain ref
  // gets a precise diagnostic with source-location ranges.
  checkApiBodyRefs(p, ui, accept);
  // Property uniqueness (Rule 9 part) — at most one each of route,
  // title, requires, body, menu metadata.  Multiple `state {}`
  // blocks merge (per spec §6 — same posture as `permissions`).
  const seen = new Map<string, number>();
  for (const prop of p.props) {
    const key = prop.$type;
    if (key === "StateBlock") continue; // multiple allowed
    // Multiple named `action`s per page are the norm (`action next()` +
    // `action submit()`) — they're declarations, not single-valued props
    // (named-actions-and-stores.md, Proposal A Stage 1).
    if (key === "ActionDecl") continue;
    // Same for `derived name: T = expr`: the feature is SEQUENTIAL by design —
    // "a derived may reference an earlier derived" (docs/page-metamodel.md;
    // page-derived-bindings.md) — and all six frontends emit a chain of them.
    // It was swept in here as a single-valued prop, so the second binding on a
    // page was an error while every emitter happily rendered it; the four
    // `page-derived` suites had asserted that emission from a REJECTED model
    // for as long as they existed.  Found by making `generateSystemFiles`
    // assert phase ④ (M-T9.34).
    if (key === "DerivedProp") continue;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  for (const [key, count] of seen) {
    if (count > 1) {
      accept(
        "error",
        diagMessage("loom.page-property-duplicate", {
          name: p.name,
          prop: pagePropDisplayName(key),
        }),
        { node: p, property: "name", code: "loom.page-property-duplicate" },
      );
    }
  }

  // Duplicate named action on one page — `ActionDecl` is excluded from the
  // single-valued-prop uniqueness loop above (multiple actions are the norm),
  // so it gets its own name-uniqueness check (named-actions-and-stores.md,
  // Proposal A Stage 1, Fix 2).
  checkDuplicateActions(p.props.filter(isActionDecl), `page '${p.name}'`, accept);

  // PageMenuMeta key names — only `section` / `label` / `order` /
  // `hidden` are recognised (parser accepts any LooseName via the
  // soft-keyword rule).
  const allowedMenuMetaKeys = new Set(["section", "label", "order", "hidden"]);
  for (const prop of p.props) {
    if (prop.$type !== "PageMenuMeta") continue;
    for (const entry of prop.entries) {
      if (!allowedMenuMetaKeys.has(entry.name)) {
        accept(
          "error",
          diagMessage("loom.page-menu-key-unknown", {
            key: entry.name,
            name: p.name,
            known: [...allowedMenuMetaKeys].join(", "),
          }),
          { node: entry, property: "name", code: "loom.page-menu-key-unknown" },
        );
      }
    }
  }

  // LayoutProp admits two preset values (`default` /
  // `none`) plus the name of any `layout <Name> { … }` SystemMember
  // declared in the same system.  Resolution is system-scope: walk
  // up the AST to the enclosing System and look for a matching
  // Layout declaration.
  //
  // The v1 restriction "no `layout:` on scaffold-synthesised pages"
  // is intentionally dropped — named layouts make
  // `Home: layout AdminFrame` meaningful (a scaffold Home page can
  // now opt into a custom chrome).
  const system = ui.$container;
  const declaredLayouts = new Set<string>();
  if (system?.$type === "System") {
    for (const m of system.members) {
      if (m.$type === "Layout") declaredLayouts.add(m.name);
    }
  }
  for (const prop of p.props) {
    if (prop.$type !== "LayoutProp") continue;
    const v = prop.value;
    const isPreset = v === "default" || v === "none";
    if (!isPreset && !declaredLayouts.has(v)) {
      const known = ["default", "none", ...declaredLayouts].join(", ");
      accept("error", diagMessage("loom.page-layout-unknown", { layout: v, name: p.name, known }), {
        node: prop,
        property: "value",
        code: "loom.page-layout-unknown",
      });
    }
  }
}

/** Every page name a `menu { … }` link may spell, in the order the scope
 *  provider offers them: a page's bare name, plus its area-qualified dotted
 *  name when it lives inside one (`Orders.List`).  Mirrors the `MenuLink.page`
 *  branch of `DddScopeProvider.getScope` — the two must agree, or the error
 *  lists names that do not link. */
function linkablePageNames(ui: Ui): string[] {
  const names: string[] = [];
  const collect = (members: readonly AstNode[], areaPath: readonly string[]): void => {
    for (const m of members) {
      if (isPage(m)) {
        names.push(m.name);
        if (areaPath.length > 0) names.push(`${areaPath.join(".")}.${m.name}`);
      } else if (isArea(m)) {
        collect(m.members, [...areaPath, m.name]);
      }
    }
  };
  collect(ui.members, []);
  return names;
}

export function checkMenuBlock(block: MenuBlock, ui: Ui, accept: ValidationAcceptor): void {
  // Rule 8 — every page-link in a menu block must reference a page.
  // The linker already reports an unresolved cross-reference, but its message
  // ("Could not resolve reference to Page named 'CloseProject'") does not say
  // what IS linkable — and the scaffolded pages a menu most wants to link are
  // named by ROLE inside a per-aggregate area (`Orders.List`), so the name the
  // author reaches for is almost never the one that resolves (finding C2).
  // This check names the alternatives.
  const linkable = linkablePageNames(ui);
  for (const section of block.sections) {
    for (const link of section.links) {
      if (link.page && !link.page.ref) {
        accept(
          "error",
          diagMessage("loom.menu-link-unresolved", {
            name: link.page.$refText,
            uiName: ui.name,
            linkable: linkable.length > 0 ? linkable.map((n) => `'${n}'`).join(", ") : "none",
          }),
          { node: link, property: "page", code: "loom.menu-link-unresolved" },
        );
      }
      // MenuLinkProp key names — only `label` / `order` recognised.
      const allowedLinkKeys = new Set(["label", "order"]);
      for (const prop of link.props ?? []) {
        if (!allowedLinkKeys.has(prop.name)) {
          accept(
            "error",
            diagMessage("loom.menu-link-property-unknown", {
              prop: prop.name,
              known: [...allowedLinkKeys].join(", "),
            }),
            { node: prop, property: "name", code: "loom.menu-link-property-unknown" },
          );
        }
      }
    }
  }
}

/** Validate `<paramName>.<aggregate>.<op>` body
 *  ref chains in a page.  Each chain must:
 *    - root at a declared UiApiParam in the page's UI
 *    - reference a real aggregate in the api's source module
 *    - reference a real operation on that aggregate (CRUD or
 *      repository find)
 *  Diagnostics emit at the source-level node so the editor
 *  underlines the exact wrong segment. */
export function checkApiBodyRefs(p: Page, ui: Ui, accept: ValidationAcceptor): void {
  // Build the param-name → resolved Api map for this UI.
  const apiByParam = new Map<string, Api>();
  for (const m of ui.members) {
    if (m.$type !== "UiApiParam") continue;
    const apiNode = m.apiRef?.ref;
    if (apiNode) apiByParam.set(m.name, apiNode);
  }
  if (apiByParam.size === 0) return; // no api params → nothing to validate

  // Walk every Expression in the page (body, title, requires,
  // state inits — anything that can mention a body-ref chain).
  // Post-flatten: a 3-segment chain `<paramName>.<aggregate>.<op>` is
  // a single PostfixChain with head=NameRef(paramName) and two
  // MemberSuffix suffixes.
  for (const node of AstUtils.streamAllContents(p)) {
    if (!isPostfixChain(node)) continue;
    if (node.suffixes.length < 2) continue;
    const head = node.head;
    if (head.$type !== "NameRef") continue;
    const rootName = (head as NameRef).name as string;
    if (!apiByParam.has(rootName)) continue;
    const aggSuffix = node.suffixes[0];
    const opSuffix = node.suffixes[1];
    if (!aggSuffix || !isMemberSuffix(aggSuffix)) continue;
    if (!opSuffix || !isMemberSuffix(opSuffix)) continue;

    const apiNode = apiByParam.get(rootName)!;
    const moduleName = apiNode.source?.$refText ?? "";
    const aggregateName = aggSuffix.member as string;
    const op = opSuffix.member as string;

    const moduleNode = apiNode.source?.ref;
    const aggregate = moduleNode ? findAggregateInModule(moduleNode, aggregateName) : undefined;
    if (!aggregate) {
      accept(
        "error",
        diagMessage("loom.ui-api-aggregate-unknown", {
          aggName: aggregateName,
          apiName: apiNode.name,
          moduleName,
        }),
        { node: aggSuffix, property: "member", code: "loom.ui-api-aggregate-unknown" },
      );
      continue;
    }

    if (!isValidApiOperation(aggregate, op)) {
      const allowed = listValidApiOperations(aggregate);
      accept(
        "error",
        diagMessage("loom.ui-api-operation-unknown", {
          op,
          aggName: aggregateName,
          allowed: allowed.join(", "),
        }),
        { node: opSuffix, property: "member", code: "loom.ui-api-operation-unknown" },
      );
    }
  }
}

/** Validate a named `layout <Name> { … }` SystemMember. */
export function checkLayout(layout: Layout, accept: ValidationAcceptor): void {
  if (layout.name === "default" || layout.name === "none") {
    accept("error", diagMessage("loom.layout-name-reserved", { name: layout.name }), {
      node: layout,
      property: "name",
      code: "loom.layout-name-reserved",
    });
  }
  let mainCount = 0;
  const slotCounts = new Map<string, number>();
  for (const slot of layout.slots) {
    if (slot.$type === "LayoutMainSlot") {
      mainCount++;
      continue;
    }
    const slotName = (slot as { name?: string }).name ?? "";
    slotCounts.set(slotName, (slotCounts.get(slotName) ?? 0) + 1);
  }
  if (mainCount === 0) {
    accept("error", diagMessage("loom.layout-main-slot-missing", { name: layout.name }), {
      node: layout,
      property: "name",
      code: "loom.layout-main-slot-missing",
    });
  } else if (mainCount > 1) {
    accept("error", diagMessage("loom.layout-slot-duplicate#main", { name: layout.name }), {
      node: layout,
      property: "name",
      code: "loom.layout-slot-duplicate",
    });
  }
  for (const [slotName, count] of slotCounts) {
    if (count > 1) {
      accept(
        "error",
        diagMessage("loom.layout-slot-duplicate", { name: layout.name, slot: slotName }),
        { node: layout, property: "name", code: "loom.layout-slot-duplicate" },
      );
    }
  }
}
