// The `ui` family of the diagnostic-message catalog: the `ui` block, components, slots, markup and layouts.
//
// A code lives in the family that owns its first segment (`loom.<segment>-…`),
// listed in `segments` below; `../messages.ts` merges every family into
// `DIAGNOSTIC_MESSAGES`, and `test/system/diagnostic-catalog.test.ts` fails on a
// key filed under the wrong family.  A code with a brand-new first segment adds
// that segment to the family it belongs with.

import type { MessageEntry } from "./_shared.js";

/** The code first-segments this family owns. */
export const segments = [
  "ui",
  "slot",
  "component",
  "markup",
  "bindable",
  "a11y",
  "layout",
  "menu",
  "button",
  "sub",
] as const;

export const messages = {
  // ----------------------------------------------------------------------
  // src/language/validators/a11y.ts
  // ----------------------------------------------------------------------
  "loom.a11y-missing-alt": (p: { type: unknown }) =>
    `'${p.type}' renders an image but has no text alternative. Add 'alt: "…"' describing it, or 'decorative: true' if it conveys nothing (renders alt=""). Alt text is human content Loom can't derive — a missing alt fails WCAG 1.1.1.`,
  "loom.a11y-icon-only-no-name": `Icon-only 'Button' has no accessible name — a screen reader announces the meaningless default "Button". Add visible text ('Button { "Delete", icon: "trash" }') or an accessible name ('label: "Delete"', emitted as aria-label). A control without a name fails WCAG 4.1.2.`,
  // M-T5.42, V8 — the button emitter renders NO glyph on a registry miss.
  "loom.button-icon-unknown": (p: { name: unknown; known: unknown }) =>
    `'Button { icon: "${p.name}" }' names no builtin icon, so the button renders with no glyph at all. The builtin names are: ${p.known}. Pick one of those, or pass your own SVG with 'iconSvg: "<svg …/>"'.`,
  "loom.a11y-theme-contrast": (p: {
    name: unknown;
    hex: unknown;
    ratio: unknown;
    aaNormal: unknown;
  }) =>
    `theme '${p.name}' colour '${p.hex}' has no readable text on it (best contrast ${p.ratio}:1, WCAG-AA needs ${p.aaNormal}:1). A control filled with it can't carry legible white or dark text — pick a colour a text colour clears AA on.`,

  // ----------------------------------------------------------------------
  // src/language/validators/builder-call.ts
  // ----------------------------------------------------------------------
  "loom.bindable-input-value-arg": (p: { type: unknown }) =>
    `'${p.type}' binds to page state via 'bind:', not 'value:'. Did you mean 'bind: …'? With 'value:' the input renders uncontrolled and the state never wires up.`,

  // ----------------------------------------------------------------------
  // src/language/validators/deployable.ts
  // ----------------------------------------------------------------------
  "loom.ui-framework-unhostable": (p: {
    name: unknown;
    platform: unknown;
    uiName: unknown;
    uiFramework: unknown;
    menu: unknown;
  }) =>
    `Deployable '${p.name}' (platform '${p.platform}') cannot host ui '${p.uiName}' framework '${p.uiFramework}'. This platform hosts: ${p.menu}. A runtime-coupled framework (e.g. 'phoenixLiveView'/LiveView) can only run on its own runtime; a static-bundle framework (e.g. 'react') runs on any static-asset host.`,
  // Rule 3 — `ui:`/`hosts:` on a platform whose descriptor says `mountsUi:
  // false` (today: `node`).  The platform menu is DERIVED from the descriptor
  // table, never hand-listed, so it can't drift the way the inline literal did
  // (it omitted angular, feliz and python for as long as they had existed).
  "loom.ui-binding-unmountable-platform": (p: { platform: unknown; menu: unknown }) =>
    `'ui:'/'hosts:' binding is only valid on platforms that mount a UI (${p.menu}); got '${p.platform}'.`,
  // One condition, two call sites: the ui declares NO api params at all, and
  // the ui declares some but not this one.  Both are "you bound a parameter
  // that does not exist", so they share a code.
  "loom.ui-binding-unknown-param": (p: { name: unknown; param: unknown; uiName: unknown }) =>
    `Deployable '${p.name}' binds parameter '${p.param}' on ui '${p.uiName}' but the ui declares no 'api ${p.param}: <Api>' parameter.`,
  "loom.ui-binding-duplicate": (p: { name: unknown; param: unknown }) =>
    `Deployable '${p.name}' binds ui parameter '${p.param}' more than once.`,
  "loom.ui-binding-unknown-source": (p: {
    name: unknown;
    uiName: unknown;
    param: unknown;
    sourceName: unknown;
  }) =>
    `Deployable '${p.name}' references undeclared source deployable '${p.sourceName}' in 'ui: ${p.uiName} { ${p.param}: ${p.sourceName} }'.`,
  "loom.ui-binding-source-not-serving": (p: {
    sourceName: unknown;
    requiredApi: unknown;
    param: unknown;
    uiName: unknown;
  }) =>
    `Deployable '${p.sourceName}' does not 'serves: ${p.requiredApi}' — required to fill ui parameter '${p.param}: ${p.requiredApi}' on '${p.uiName}'.`,
  // Two slugs, one code: the whole compose block is absent, or it is present
  // and one parameter is unbound.  Same rule ("every `api X: <Api>` param needs
  // a binding"), different remedy text.
  "loom.ui-binding-missing#no-compose": (p: {
    name: unknown;
    uiName: unknown;
    paramList: unknown;
  }) =>
    `Deployable '${p.name}' deploys ui '${p.uiName}' which declares api parameters; supply bindings via 'ui: ${p.uiName} { ${p.paramList} }'.`,
  "loom.ui-binding-missing#param": (p: {
    name: unknown;
    param: unknown;
    apiName: unknown;
    uiName: unknown;
  }) =>
    `Deployable '${p.name}' is missing a binding for ui parameter '${p.param}: ${p.apiName}' on ui '${p.uiName}'.`,

  // ----------------------------------------------------------------------
  // src/language/validators/statements.ts
  // ----------------------------------------------------------------------
  "loom.component-prop-type": (p: {
    name: unknown;
    label: unknown;
    expected: unknown;
    actual: unknown;
  }) => `Prop '${p.name}' of ${p.label} expects '${p.expected}' but got '${p.actual}'.`,

  // ----------------------------------------------------------------------
  // src/language/validators/structural.ts
  // ----------------------------------------------------------------------
  // --- the M-T9.56 drain of `structural.ts` -------------------------------
  "loom.slot-out-of-position": (p: { where: unknown }) =>
    `'slot' is only valid on a component's parameter list; found on ${p.where}.`,

  // ----------------------------------------------------------------------
  // src/language/validators/types.ts
  // ----------------------------------------------------------------------
  // --- the M-T9.56 drain of `types.ts` ------------------------------------
  "loom.slot-member-access": (p: { member: unknown }) =>
    `'${p.member}' is not accessible on a slot value — slots are opaque JSX and have no addressable members.  Use a primitive- or aggregate-typed param if the body needs to read fields off this value.`,

  // --- the M-T9.56 drain of `ui.ts` ---------------------------------------
  "loom.ui-page-duplicate": (p: { name: unknown; scope: unknown }) =>
    `Duplicate page '${p.name}' in ${p.scope}. Pages within a scope (the ui top level or one area) must have unique names; an explicit override-by-name displaces a single scaffolded page, not another explicit one.`,
  "loom.ui-menu-duplicate": (p: { name: unknown }) =>
    `ui '${p.name}' declares more than one 'menu { ... }' block; keep just the first.`,
  "loom.ui-api-param-duplicate": (p: { name: unknown; param: unknown }) =>
    `ui '${p.name}' declares api parameter '${p.param}' more than once.`,
  "loom.ui-api-unknown": (p: { name: unknown; apiName: unknown }) =>
    `ui '${p.name}' references undeclared api '${p.apiName}'. Declare it at system scope as 'api ${p.apiName} from <Module>'.`,
  // The ui's api and channel parameters share ONE namespace, so this fires for
  // a channel param colliding with either kind — hence "parameter", not
  // "channel parameter".
  "loom.ui-param-duplicate": (p: { name: unknown; param: unknown }) =>
    `ui '${p.name}' declares parameter '${p.param}' more than once.`,
  "loom.ui-function-duplicate": (p: { name: unknown; fnName: unknown }) =>
    `ui '${p.name}' declares function '${p.fnName}' more than once.`,
  "loom.menu-link-property-unknown": (p: { prop: unknown; known: unknown }) =>
    `Unknown menu link property '${p.prop}'. Recognised: ${p.known}.`,
  "loom.ui-api-aggregate-unknown": (p: {
    aggName: unknown;
    apiName: unknown;
    moduleName: unknown;
  }) => `Aggregate '${p.aggName}' not found in api '${p.apiName}' (subdomain '${p.moduleName}').`,
  "loom.ui-api-operation-unknown": (p: { op: unknown; aggName: unknown; allowed: unknown }) =>
    `Operation '${p.op}' is not declared on aggregate '${p.aggName}'. Available: ${p.allowed}.`,
  "loom.layout-name-reserved": (p: { name: unknown }) =>
    `Layout name '${p.name}' shadows a reserved layout preset. Pick a different name.`,
  "loom.layout-main-slot-missing": (p: { name: unknown }) =>
    `Layout '${p.name}' must declare a 'main' slot (the page-body Outlet position).`,
  // Two slugs, one code: the `main` slot is a distinct grammar node, so the
  // repeat check counts it separately — but the rule ("a layout declares each
  // slot once") is the same one.
  "loom.layout-slot-duplicate#main": (p: { name: unknown }) =>
    `Layout '${p.name}' declares more than one 'main' slot; keep just the first.`,
  "loom.layout-slot-duplicate": (p: { name: unknown; slot: unknown }) =>
    `Layout '${p.name}' declares more than one '${p.slot}' slot; keep just the first.`,
  "loom.component-missing-body": (p: { name: unknown }) =>
    `Component '${p.name}' requires a 'body:' (or mark it 'extern from "<path>"' to hand rendering to a hand-written module).`,
  "loom.ui-channel-not-broadcast": (p: { name: unknown; chName: unknown; delivery: unknown }) =>
    `ui '${p.name}' subscribes to channel '${p.chName}', but its delivery is '${p.delivery}'.  Only 'delivery: broadcast' channels are UI-observable; 'queue' is work distribution.`,
  "loom.menu-link-unresolved": (p: { name: unknown; uiName: unknown; linkable: unknown }) =>
    `menu link '${p.name}' does not name a page of ui '${p.uiName}'.  Linkable pages: ${p.linkable}.  Scaffolded pages are named by ROLE inside a per-aggregate area, so link them area-qualified (e.g. 'link Orders.List'); a workflow's form page is '<Workflow>Workflow'.`,
  "loom.component-shadows-stdlib": (p: { name: unknown }) =>
    `component '${p.name}' shadows a walker-stdlib primitive — the page-body dispatcher ` +
    `resolves '${p.name}(...)' to the primitive, so this component is emitted and never ` +
    `rendered.  Pick a different name.`,
  "loom.ui-handler-refetch-target#refetch-in-needs-at-least": (p: { where: unknown }) =>
    `'refetch(…)' in ${p.where} needs at least one aggregate to refetch, e.g. 'refetch(Order)'.`,
  "loom.ui-handler-refetch-target#refetch-arguments-in-must": (p: { where: unknown }) =>
    `'refetch(…)' arguments in ${p.where} must each name an aggregate (e.g. 'refetch(Order)').`,
  "loom.ui-handler-refetch-target#unknown-refetch-target": (p: { name: unknown; where: unknown }) =>
    `Unknown refetch target '${p.name}' in ${p.where} — it must name an aggregate declared in this system.`,
  "loom.ui-handler-statement-unknown": (p: { where: unknown }) =>
    `Unsupported statement in ${p.where}.  A handler body supports 'toast(<message expression>)' (one argument) and 'refetch(<Aggregate>[, …])'.`,

  // ----------------------------------------------------------------------
  // src/ir/validate/checks/store-checks.ts
  // ----------------------------------------------------------------------
  // Three more backend-body statement forms in a ui body, gated on exactly the
  // reasoning above.  Measured before the gate: each crashed the JS walker with
  // a bare `throw` (raw stack trace, no code) and emitted a silent
  // `// TODO(flutter full-parity)` no-op on Flutter — one shape, a crash on
  // four frontends and a silent drop on a fifth.
  "loom.ui-body-statement-kind": (p: {
    where: unknown;
    uiName: unknown;
    keyword: unknown;
    fw: unknown;
    dName: unknown;
  }) =>
    `A \`${p.keyword}\` statement is used in ${p.where} on ui '${p.uiName}', which the ` +
    `${p.fw} frontend cannot render (deployable '${p.dName}'). \`${p.keyword}\` is a ` +
    `backend-body form (aggregate / domain-service / workflow operations); a ui \`action\` ` +
    `is a void event handler whose only outputs are state writes, sibling-action calls, ` +
    `\`navigate\` / \`toast\`, and \`match await\` on a remote op. Guard with a ` +
    `conditional VALUE (a ternary, or \`match { cond => …, else => … }\`) and let the ` +
    `backend operation own the \`precondition\` / \`requires\` / \`return\` — or host this ` +
    `ui on Phoenix LiveView, whose handler renderer is the one that has arms for all three.`,

  // ----------------------------------------------------------------------
  // src/ir/validate/checks/ui-body-vocabulary-checks.ts — the frontend body
  // vocabulary.  The first three are modelling errors no frontend can render;
  // the fourth is the per-target table (`UI_BODY_FEATURE_RENDERERS`).
  // ----------------------------------------------------------------------
  "loom.ui-assign-not-state": (p: {
    where: unknown;
    uiName: unknown;
    op: unknown;
    target: unknown;
    root: unknown;
    host: unknown;
    known: unknown;
  }) =>
    `\`${p.target} ${p.op} …\` in ${p.where} on ui '${p.uiName}' writes '${p.root}', which is ` +
    `not a \`state\` field of this ${p.host}${p.known}.  An action mutates only its own ` +
    `${p.host}'s declared state — a \`let\`, a param, a \`derived\` and another host's ` +
    `fields are read-only here, and every frontend renders the write as a state setter.  ` +
    `Declare '${p.root}' in \`state { … }\`, or call the owning store's action ` +
    `(\`Cart.set(…)\`) to change a store field.`,
  "loom.ui-find-call-arity": (p: {
    where: unknown;
    uiName: unknown;
    read: unknown;
    got: unknown;
    expected: unknown;
    params: unknown;
  }) =>
    `${p.where} on ui '${p.uiName}' reads \`${p.read}\` with ${p.got} argument(s), but the ` +
    `find declares ${p.expected} parameter(s)${p.params}.  Every frontend generates the read's ` +
    `request from the declaration, so a missing or extra argument has nowhere to go — the ` +
    `JS clients fail their own typecheck and Feliz cannot build the query.  Pass one ` +
    `argument per declared parameter, in order.`,
  "loom.ui-body-feature-unsupported": (p: {
    where: unknown;
    uiName: unknown;
    feature: unknown;
    fw: unknown;
    dName: unknown;
    why: unknown;
    renderedBy: unknown;
    hint: unknown;
  }) =>
    `${p.where} on ui '${p.uiName}' uses ${p.feature}, which the ${p.fw} frontend does not ` +
    `render (deployable '${p.dName}') — ${p.why}.  ${p.renderedBy}${p.hint}`,
  "loom.ui-body-statement-kind#liveview-store": (p: {
    where: unknown;
    uiName: unknown;
    keyword: unknown;
    dName: unknown;
  }) =>
    `A \`${p.keyword}\` statement is used in ${p.where} on ui '${p.uiName}', which the ` +
    `phoenixLiveView frontend cannot render in a store (deployable '${p.dName}'). On ` +
    `LiveView a store is a pure per-process module: each action takes the store struct ` +
    `and returns the next one, with no socket to flash or halt on, no value sink and no ` +
    `remote-call seam. Keep the store action to state writes, \`let\`s and sibling-action ` +
    `calls, and move the \`${p.keyword}\` into the page or component action that calls it.`,
  "loom.ui-this-unbound": (p: { where: unknown; uiName: unknown; fw: unknown; dName: unknown }) =>
    `\`this\` is used in ${p.where} on ui '${p.uiName}', which the ${p.fw} frontend cannot ` +
    `render (deployable '${p.dName}'): a page, component or store has no aggregate ` +
    `instance in scope. Bind the record through a page param, \`state\`, or a QueryView ` +
    `\`data:\` lambda, and read its fields off that name.`,
  "loom.ui-gate-expr-unsupported": (p: {
    where: unknown;
    kind: unknown;
    detail: unknown;
    fw: unknown;
  }) =>
    `${p.where} ${p.detail}. Every closed-table gate renderer implements the SAME ` +
    `client-evaluable subset — \`currentUser\` and its claim chain, enum members, ` +
    `string/bool/int/long/decimal literals, \`.contains(…)\` membership, comparisons, ` +
    `boolean operators, \`!\`, parentheses and a ternary — and THROWS on anything else ` +
    `(\`expression kind '${p.kind}' is not supported in a UI gate\`): ` +
    `src/generator/_frontend/gate-expr.ts (React/Vue/Svelte/Angular), ` +
    `src/generator/feliz/auth-gate.ts (Feliz), src/generator/flutter/auth-gate.ts (Flutter). ` +
    `So on '${p.fw}' this \`.ddd\` validates and then CRASHES \`ddd generate system\` with a ` +
    `raw stack trace. Rewrite the gate over the claims themselves ` +
    `(\`requires currentUser.role == "admin"\`), put the computation on the backend gate ` +
    `(\`operation … requires\`, which is the enforcing half anyway), or host this ui on ` +
    `Phoenix LiveView, whose page gate goes through the general HEEx expression renderer.`,

  // ----------------------------------------------------------------------
  // src/ir/validate/checks/ui-framework-checks.ts — the two LiveView
  // component-HOISTING collisions (§18 emitter sentinels).  Both used to be a
  // bare `throw new Error` in `liveview-emit.ts`, raised mid-generate on a
  // `.ddd` that had just validated `0 error(s), 0 warning(s)`.
  // ----------------------------------------------------------------------
  "loom.component-children-unsupported": (p: {
    what: unknown;
    component: unknown;
    dName: unknown;
  }) =>
    `${p.what} invokes EXTERN component '${p.component}' with CHILDREN, which deployable ` +
    `'${p.dName}' (frontend 'angular') drops. An extern component's class is hand-written, so ` +
    `Loom does not know its element selector and has to invoke it through '<ng-container ` +
    `[ngComponentOutlet]=…>' — and 'ngComponentOutlet' cannot project content from a template, ` +
    `so the extra positional argument has nowhere to go and the children vanish from the ` +
    `emitted project (an '<!-- … projected child dropped -->' comment marks the spot). Every ` +
    `other frontend renders them into the component's 'Slot { }'. Drop the 'extern from' clause ` +
    `so Loom emits the component itself — a WALKED component is invoked by its own tag ` +
    `('<app-x …>children</app-x>') and projects children into '<ng-content>' — or pass the ` +
    `content as a declared parameter, or host this page on another frontend.`,
  "loom.ui-projection-read-unsupported#frontend-has-no-client": (p: {
    what: unknown;
    name: unknown;
    dName: unknown;
    fw: unknown;
    frameworks: unknown;
  }) =>
    `${p.what} reads projection '${p.name}', which deployable '${p.dName}' can't render ` +
    `(frontend '${p.fw}' generates no projection read). Projection reads ` +
    `ship on ${p.frameworks}; host this ui on one of those, or read the source ` +
    `aggregate directly.`,
  "loom.ui-multi-backend-unsupported": (p: {
    dName: unknown;
    uiName: unknown;
    pairs: unknown;
    targetName: unknown;
    count: unknown;
  }) =>
    `Frontend deployable '${p.dName}' binds ui '${p.uiName}' to ${p.count} different backends ` +
    `(${p.pairs}), which is not supported yet. A frontend is generated against the ONE backend ` +
    `named in 'targets:' ('${p.targetName}'): only that backend's aggregates reach the page ` +
    `emitter, and the emitted client reads a single API_BASE_URL. A page reading any other ` +
    `handle therefore imports an api module that is never written (the generated frontend fails ` +
    `to typecheck), and every request it does make goes to '${p.targetName}', which does not ` +
    `serve that contract. Point every handle at one backend, or split the ui — one frontend ` +
    `deployable per backend — until per-handle clients land.`,
  "loom.ui-aggregate-unserved": (p: {
    uiName: unknown;
    dName: unknown;
    targetName: unknown;
    subdomain: unknown;
    ctx: unknown;
    aggregates: unknown;
    sites: unknown;
    served: unknown;
  }) =>
    `ui '${p.uiName}' reads ${p.aggregates} from subdomain '${p.subdomain}' (context ` +
    `'${p.ctx}') in ${p.sites}, but frontend deployable '${p.dName}' is generated against ` +
    `'${p.targetName}' (its 'targets:'), which serves only [${p.served}]. Those pages have no api ` +
    `client to read through: generate either fails on the generated page or emits an import of ` +
    `an api module that is never written. Fix one of: add '${p.ctx}' to '${p.targetName}' ` +
    `(its 'contexts:' and a served api); drop '${p.subdomain}' from the ui's ` +
    `'scaffold(subdomains: …)' or remove the pages reading it; or host those pages in a ` +
    `separate ui on a frontend deployable whose 'targets:' serves '${p.ctx}'. One frontend ` +
    `reading several backends is not supported yet (M-T1.35).`,
  "loom.ui-aggregate-unserved#self-hosted": (p: {
    uiName: unknown;
    dName: unknown;
    subdomain: unknown;
    ctx: unknown;
    aggregates: unknown;
    sites: unknown;
    served: unknown;
  }) =>
    `ui '${p.uiName}' reads ${p.aggregates} from subdomain '${p.subdomain}' (context ` +
    `'${p.ctx}') in ${p.sites}, but deployable '${p.dName}' mounts that ui itself and hosts ` +
    `only [${p.served}], so those pages have no context function or api client to call. ` +
    `Fix one of: add '${p.ctx}' to '${p.dName}' (its 'contexts:' and a served api); remove ` +
    `the pages reading it; or host those pages in a separate ui on a deployable that serves ` +
    `'${p.ctx}'.`,
  "loom.ui-realtime-unsupported": (p: { name: unknown; uiName: unknown; framework: unknown }) =>
    `Deployable '${p.name}': ui '${p.uiName}' declares 'on <channel>.<Event>' live-event handler(s), but its frontend framework '${p.framework}' has no realtime consumption, so the handlers are silently dropped.`,
  "loom.ui-duplicate-area": (p: { name: unknown; scope: unknown }) =>
    `Duplicate area '${p.name}' in ${p.scope}. Areas within a scope must have unique names — the area path is what places every page inside it on disk, so two same-named blocks compute the same directory and one block's pages silently overwrite the other's. Merge them into a single 'area ${p.name} { … }'.`,
  "loom.ui-page-path-collision": (p: {
    ui: unknown;
    first: unknown;
    second: unknown;
    path: unknown;
  }) =>
    `ui '${p.ui}': ${p.first} and ${p.second} both emit to '${p.path}'. A page's identity is its area path plus its name, so two pages that resolve to one path are indistinguishable to every frontend — the file map keeps whichever is written last and the other page's body vanishes from the build. Rename one page, or merge/rename the duplicate 'area' block they share.`,
  "loom.ui-page-route-collision": (p: {
    ui: unknown;
    first: unknown;
    second: unknown;
    route: unknown;
  }) =>
    `ui '${p.ui}': ${p.first} and ${p.second} both declare route '${p.route}'. A route is the page's address, so only one of them is reachable: React / Vue / Angular match the first declared path and the other page can never be opened, and SvelteKit — whose route IS a directory — cannot emit them at all. Give one of the two pages a distinct 'route:'.`,
  // The SvelteKit emitter's internal floor for the same condition — the
  // file-routing layer cannot even represent two pages at one route directory.
  // On a validated model `loom.ui-page-route-collision` has already refused it.
  "loom.ui-page-route-collision#svelte-emit-invariant": (p: {
    first: unknown;
    second: unknown;
    path: unknown;
  }) =>
    `internal: svelte pages '${p.first}' and '${p.second}' both emit to ${p.path}. The IR validator's page-route collision gate should have rejected this model before codegen — a generator reached here only because it was handed an unvalidated model.`,
  "loom.ui-page-slot-collision": (p: {
    ui: unknown;
    first: unknown;
    second: unknown;
    slot: unknown;
  }) =>
    `ui '${p.ui}': ${p.first} and ${p.second} both claim ${p.slot}. Exactly one page can fill a scaffold archetype slot — the router imports one of them and the other becomes an unreachable file. To replace a scaffolded page, declare yours in the SAME scope as the scaffold's area (override-by-name displaces it); to add a second page, give it its own name and route.`,
  "loom.ui-id-ref-unknown-aggregate": (p: {
    deployableName: unknown;
    source: unknown;
    target: unknown;
  }) =>
    `UI-mounting deployable '${p.deployableName}': '${p.source}' references ${p.target} id, but no aggregate '${p.target}' is declared in the system.`,
  "loom.ui-id-ref-unmounted": (p: { deployableName: unknown; source: unknown; target: unknown }) =>
    `UI-mounting deployable '${p.deployableName}': '${p.source}' references ${p.target} id, but '${p.target}' is not mounted on this deployable's modules.  ` +
    `Mount the module containing '${p.target}' on the deployable's targeted backend, or remove the reference.`,
  "loom.ui-id-ref-no-display": (p: { deployableName: unknown; source: unknown; target: unknown }) =>
    `UI-mounting deployable '${p.deployableName}': '${p.source}' references ${p.target} id, but '${p.target}' has no 'derived display' clause.  ` +
    `Add 'derived display: string = <field>' to '${p.target}' so the form's <Select> picker can label options.`,

  // ----------------------------------------------------------------------
  // src/ir/validate/checks/ui-render-slot-checks.ts
  // ----------------------------------------------------------------------
  "loom.markup-primitive-in-collection-lambda": (p: {
    op: unknown;
    primitive: unknown;
    param: unknown;
  }) =>
    `\`${p.primitive} { … }\` is built inside a \`.${p.op}(…)\` lambda, where it is not markup.  ` +
    `A collection op is an EXPRESSION: every frontend renders its lambda body through the ` +
    `expression renderer, not the body walker, so the primitive comes out as a bare function ` +
    `call (\`${p.primitive}(…)\`) against a name no import provides — the generated frontend ` +
    `fails to compile (\`Cannot find name '${p.primitive}'\`), it does not merely render wrong.  ` +
    `Rendering a list of markup is what \`For\` is for: ` +
    `\`For { each: <collection>, ${p.param} => ${p.primitive} { … } }\` emits properly keyed ` +
    `elements.  A collection op is still fine in a VALUE position ` +
    `(\`Text { rows.map(r => r.name).join(", ") }\`) — it is only the markup case that has ` +
    `nowhere to go.`,

  // ----------------------------------------------------------------------
  // src/ir/validate/checks/ui-checks.ts
  // ----------------------------------------------------------------------
  "loom.ui-projection-read-unsupported#not-ui-consumable": (p: {
    where: unknown;
    member: unknown;
    name: unknown;
  }) =>
    `reads projection '${p.member}' (\`${p.name}.${p.member}\`), which a ui ` +
    `cannot consume. Only an UNKEYED QUERY-TIME projection (no 'keyed by', a 'from … select' ` +
    `comprehension — whole-table singleton or 'group by' list) is readable from a page today. ` +
    `A keyed projection returns rows parameterised by key and a folded one is read by key off ` +
    `its materialized table; neither has a frontend client yet, so this would emit an ` +
    `unresolved receiver.`,

  // --------------------------------------------------------------------
  // The BODY-WALKER GIVE-UP codes (M-T9.55).
  //
  // These four name the conditions under which the frontend body walker
  // declines to render a construct.  They are unusual in this catalog:
  // today they are attached at the EMISSION site (`giveUp()` in
  // `src/generator/_walker/give-up.ts` renders the code into the
  // `loom:unrendered [<code>] …` comment) rather than raised as a
  // diagnostic, because codegen has no diagnostic channel.  The wording
  // still lives here, for the one reason the catalog exists: the text a
  // user reads about a `loom.*` code must have exactly one home, whichever
  // phase puts it in front of them.  When `generate system` grows a
  // give-up-reporting pass these become ordinary reported diagnostics with
  // no change to the emitters.
  // --------------------------------------------------------------------
  "loom.ui-read-unresolved": (p: { aggregate: unknown; operation: unknown; known: unknown }) =>
    `reads \`${p.aggregate}.${p.operation}\`, which '${p.aggregate}' does not expose.  A page ` +
    `read names one of: \`all\` (the auto-\`findAll\`), \`byId\`, \`history\` on an audited ` +
    `aggregate, or a paged read a \`queryHandler\` runs.  ${p.known}  Left to codegen this ` +
    `does not fail loudly — it fails DIFFERENTLY on each frontend: the JSX and Feliz/Flutter ` +
    `clients import a hook that was never emitted (a build error), while Phoenix LiveView ` +
    `substitutes the UNFILTERED \`list_<agg>s()\` and renders every row of the table with no ` +
    `error at all.  Name a read that exists.`,
  "loom.ui-read-unresolved#unrouted": (p: {
    aggregate: unknown;
    operation: unknown;
    framework: unknown;
    deployable: unknown;
  }) =>
    `reads \`${p.aggregate}.${p.operation}\`, the paged find a paged \`queryHandler\` runs — ` +
    `but deployable '${p.deployable}' renders this page with ${p.framework}, which reaches the ` +
    `read over HTTP, and its backend serves no \`GET\` route for that handler.  The find has ` +
    `no route of its own, so the client would call a path that ` +
    `404s.  Expose it: add \`scaffoldPagedApi(of: <read>)\` (or a \`route GET … -> <handler>\` ` +
    `with no path tokens) to an api the backend \`serves:\`.  (Feliz and Flutter do not ` +
    `reach these reads yet; read the aggregate's \`all\` there.)`,
  "loom.ui-read-unresolved#unbound": (p: {
    primitive: unknown;
    spelling: unknown;
    known: unknown;
  }) =>
    `\`${p.primitive} { of: ${p.spelling} }\` reads a name that binds to NOTHING — not an ` +
    `aggregate, not a query-time projection, not a workflow's instance list, and not a local ` +
    `in scope on this page.  ${p.known}  Left to codegen this fails SILENTLY: the page ` +
    `emitter writes the name into a comment and \`undefined\` into the page itself, and ` +
    `\`ddd generate system\` still reports success.  Downstream that is a frontend build ` +
    `error (\`TS18050\`) on a typed client, a \`TypeError\` at runtime on Feliz/Flutter, or — ` +
    `where inference is weaker — a region that renders blank forever with nothing, anywhere, ` +
    `reporting a problem.  Check the spelling, or bind the read through an ` +
    `\`api <Handle>: <Api>\` param on the ui.`,
  "loom.slot-outside-component": (_p: { where: unknown }) =>
    `\`Slot { }\` renders the children a CALLER passed in, so it only means ` +
    `something inside a \`component\` body.  A page has no caller and no children ` +
    `parameter, so this emits an unbound children reference on every frontend — a ` +
    `compile error on React and Feliz, and nothing at all on Vue / Svelte / Angular / ` +
    `Flutter.  Move the shared markup into a \`component … { body: … Slot { } }\` and ` +
    `have the page call it with the content as extra positional arguments.`,
  "loom.sub-primitive-misplaced": (p: { where: unknown; name: unknown; parents: unknown }) =>
    `\`${p.name}\` is a sub-element of ${p.parents} and has no renderer of its ` +
    `own — its parent consumes it inline.  Spelled anywhere else it degrades to a comment on ` +
    `every frontend (\`{/* ${p.name}: not supported … */}\` on React/Vue/Svelte/Angular/Feliz/` +
    `Flutter, \`<%!-- ${p.name}: … --%>\` on Phoenix LiveView), so the element and everything ` +
    `nested inside it silently disappear from the page.  Make it a direct child of ${p.parents}.`,
} satisfies Record<string, MessageEntry>;
