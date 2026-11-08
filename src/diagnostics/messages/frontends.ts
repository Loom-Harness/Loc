// The `frontends` family of the diagnostic-message catalog: frontend deployables and the per-framework refusals (Flutter, Feliz, HEEx, the SPA hosts).
//
// A code lives in the family that owns its first segment (`loom.<segment>-…`),
// listed in `segments` below; `../messages.ts` merges every family into
// `DIAGNOSTIC_MESSAGES`, and `test/system/diagnostic-catalog.test.ts` fails on a
// key filed under the wrong family.  A code with a brand-new first segment adds
// that segment to the family it belongs with.

import { type MessageEntry, spaDeployableMissingUi } from "./_shared.js";

/** The code first-segments this family owns. */
export const segments = [
  "frontend",
  "flutter",
  "feliz",
  "heex",
  "react",
  "svelte",
  "vue",
  "angular",
  "static",
] as const;

export const messages = {
  // ----------------------------------------------------------------------
  // src/language/validators/deployable.ts
  // ----------------------------------------------------------------------
  "loom.react-deployable-missing-ui": spaDeployableMissingUi("React"),
  "loom.svelte-deployable-missing-ui": spaDeployableMissingUi("Svelte"),
  "loom.vue-deployable-missing-ui": spaDeployableMissingUi("Vue"),
  "loom.angular-deployable-missing-ui": spaDeployableMissingUi("Angular"),
  // Feliz and Flutter are self-hosting frontends (own toolchain, own bundle);
  // without a `ui:` the Feliz generator THREW a raw `Error: Feliz deployable
  // 'web' has no ui binding` and the Flutter one emitted a placeholder app with
  // exit 0 — both after `ddd parse` reported zero errors.
  "loom.feliz-deployable-missing-ui": spaDeployableMissingUi("Feliz"),
  "loom.flutter-deployable-missing-ui": spaDeployableMissingUi("Flutter"),
  // `static` is the sixth member of the `*-deployable-missing-ui` family but
  // keeps its OWN wording: it is not a framework SPA, it is a bare asset host,
  // so "every page flows through the page metamodel" would name machinery it
  // does not have.  Same rule, different reason — hence a sibling code rather
  // than a seventh `spaDeployableMissingUi` label.
  "loom.static-deployable-missing-ui": (p: { name: unknown }) =>
    `Static deployable '${p.name}' must declare a 'ui:' binding — there is nothing to serve without one.`,
  "loom.frontend-targets-missing": (p: { name: unknown }) =>
    `Frontend deployable '${p.name}' must declare 'targets: <backend-deployable>'.`,
  // NAMING, for the next author here: a code may not END in `-backend` and may
  // not CONTAIN `unsupported` unless it is a real
  // "this backend does not implement this feature yet" row.
  // `unsupported-register.test.ts` scans `src/` for those two shapes by NAME
  // and demands a classified row in `src/diagnostics/unsupported-register.ts`
  // for each — so `loom.frontend-targets-not-backend` / `loom.targets-on-backend`
  // / `loom.convert-unsupported` (the first drafts of the three below) failed
  // that gate for saying something about themselves that is not true.  These
  // three are structural refusals about the `targets:` clause and the
  // conversion vocabulary, not platform gaps.
  "loom.frontend-targets-invalid": (p: { name: unknown; targetName: unknown; backends: unknown }) =>
    `Frontend deployable '${p.name}' cannot target another frontend ('${p.targetName}'). Pick a backend deployable (${p.backends}).`,
  "loom.frontend-contexts-ignored": (p: { name: unknown; targetName: unknown }) =>
    `Frontend deployable '${p.name}' inherits contexts from its target '${p.targetName}'; the explicit 'contexts:' list is ignored.`,

  // ----------------------------------------------------------------------
  // src/ir/validate/checks/ui-framework-checks.ts — the Flutter action-body
  // gap (§18 sentinels: the `TODO(flutter full-parity)` arms in
  // `riverpod-emit.ts`).  It leaves the effect out of the built app with no
  // diagnostic anywhere, and names its successor mission.
  //
  // There were TWO.  The `#view-effect` arm (a `toast(…)` from a Notifier) is
  // gone with its cause: wave C2 packet 2l gave `toast` the same out-of-tree
  // bridge `navigate` already had (`lib/toast.dart`, a
  // `GlobalKey<ScaffoldMessengerState>` on `MaterialApp`), so the effect ships
  // rather than being refused.  What is left is the `match await` on a
  // STANDARD aggregate op.
  // ----------------------------------------------------------------------
  "loom.flutter-action-body-unsupported#match-await-standard-op": (p: {
    where: unknown;
    uiName: unknown;
    dName: unknown;
    detail: unknown;
  }) =>
    `${p.where} on ui '${p.uiName}' awaits \`${p.detail}\`, a STANDARD aggregate operation, in ` +
    `a \`match await\` — which the Flutter frontend cannot lower (deployable '${p.dName}'). ` +
    `Its async-effect emitter resolves the awaited op through the aggregate's DECLARED ` +
    `\`operation\`s, and the five standard ops (all / byId / create / update / delete) are not ` +
    `among them, so the whole effect — the request, the error reification and every arm body — ` +
    `would be replaced by a comment. Await a declared \`operation\` that returns a union, or ` +
    `host this ui on another frontend.`,
  // The Riverpod emitter's internal floor — it replaces the three
  // `// TODO(flutter full-parity)` comments that used to be emitted INTO the
  // Dart, where they compiled fine and left the action doing nothing.
  "loom.flutter-action-body-unsupported#emit-invariant": (p: { what: unknown }) =>
    `internal: the Flutter Riverpod Notifier emitter cannot render ${p.what}. The IR validator's flutter action-body gates (plus the ui statement-kind and unresolved-action-ref gates) should have rejected this model before codegen reached it.`,
  "loom.feliz-async-effect-unsupported": (p: {
    where: unknown;
    uiName: unknown;
    name: unknown;
    reason: unknown;
  }) =>
    `\`match await …\` (an async effect) is used on ui '${p.uiName}', hosted by ` +
    `the Feliz (F#/Fable) deployable '${p.name}', but this shape is not rendered on the ` +
    `Feliz frontend yet — ${p.reason}.  Supported in a PAGE action: \`match await ` +
    `<api>.<Agg>.<op>(args?) { <Variant> b => … … else? => … }\` — an aggregate instance op ` +
    `(with or without params), one or more named success/error arms, and an optional ` +
    `\`else\`.  (The awaited SUBJECT is no longer checked here: it is the same on every ` +
    `frontend, so it is the target-agnostic \`loom.async-effect-subject-unsupported\`.)`,
  "loom.flutter-async-effect-unsupported": (p: {
    where: unknown;
    uiName: unknown;
    name: unknown;
  }) =>
    `\`match await …\` (an async effect) is used in a COMPONENT action on ui ` +
    `'${p.uiName}', hosted by the Flutter deployable '${p.name}', but the Flutter component ` +
    `emitter does not render one — an async effect needs the page shell's notifier and route ` +
    `id.  A component carrying one is DROPPED: no widget is emitted for it and every call ` +
    `site renders an empty \`SizedBox.shrink()\`.  Move the \`match await\` into a PAGE ` +
    `action (Flutter renders it there), or drive the op through a form primitive ` +
    `(CreateForm/OperationForm).`,

  // ----------------------------------------------------------------------
  // src/generator/flutter/riverpod-emit.ts
  //
  // Phase ⑧ give-ups, not phase ④/⑦ checks: they are worded here (and route
  // through `giveUp`, so they carry the shared degradation sentinel) because
  // the emitter is the only layer that knows a Riverpod Notifier method cannot
  // express the statement.  Before this they were bare `TODO(flutter
  // full-parity)` comments with no code and no sentinel.
  // ----------------------------------------------------------------------
  "loom.flutter-action-statement-unsupported#navigate-route-param": (p: { page: unknown }) =>
    `\`navigate(${p.page})\` in a Flutter action body targets a page whose route carries a ` +
    `':param' segment, and the call supplies no value for it — a Riverpod Notifier method has ` +
    `no route arguments in scope, so the navigation is DROPPED rather than emitted as Dart ` +
    `that will not compile. Spell the destination as a path instead ` +
    `(\`navigate("/products/" + id)\`), or navigate from a body slot that binds the id.`,

  // ----------------------------------------------------------------------
  // src/ir/validate/checks/ui-framework-checks.ts — a declared component
  // param / extern-function signature type the shared TypeScript prop layer
  // has no spelling for (§18 emitter sentinels: the `default: throw` arms in
  // `_frontend/component-prop-type.ts` and `_frontend/extern-functions.ts`).
  // ----------------------------------------------------------------------
  "loom.frontend-prop-type-unsupported": (p: {
    where: unknown;
    what: unknown;
    uiName: unknown;
    dName: unknown;
    fw: unknown;
  }) =>
    `${p.where} on ui '${p.uiName}' declares a ${p.what}, which the ${p.fw} prop layer has no ` +
    `TypeScript spelling for (deployable '${p.dName}'). Loom refuses rather than typing it ` +
    `\`any\`: the whole point of the generated props interface / extern signature is that a ` +
    `domain change breaks a stale hand-written implementation, and one untyped prop voids that ` +
    `contract silently. \`money\` (a decimal string re-parsed to a Decimal), \`File\` (a fixed ` +
    `FileRef object) and a \`valueobject\` all have wire shapes and are portable work, not ` +
    `impossibilities — until then, pass the value as one of the spellable types ` +
    `(string / int / long / decimal / bool / datetime / guid / json, an enum, an \`X id\`, an ` +
    `aggregate, or an array / optional of those).`,
  // The two emitters' internal floor for the same condition.  Kept (rather than
  // widened to `any`) because a prop the frontend cannot type voids the
  // contract the generated props interface / extern signature exists to
  // enforce; the gate above is what makes it unreachable on a validated model.
  "loom.frontend-prop-type-unsupported#emit-invariant": (p: { what: unknown }) =>
    `internal: the frontend prop layer has no TypeScript spelling for ${p.what}. The IR validator's frontend-prop-type gate should have rejected this declaration before codegen reached it.`,

  // ----------------------------------------------------------------------
  // src/ir/validate/checks/ui-framework-checks.ts — the two LiveView
  // component-HOISTING collisions (§18 emitter sentinels).  Both used to be a
  // bare `throw new Error` in `liveview-emit.ts`, raised mid-generate on a
  // `.ddd` that had just validated `0 error(s), 0 warning(s)`.
  // ----------------------------------------------------------------------
  "loom.heex-handler-name-collision": (p: {
    page: unknown;
    handler: unknown;
    first: unknown;
    second: unknown;
    dName: unknown;
  }) =>
    `page '${p.page}' would hoist two different \`${p.handler}\` handlers into one LiveView ` +
    `on deployable '${p.dName}' (Phoenix LiveView): ${p.first} and ${p.second} each declare it. ` +
    `A HEEx function component owns no process, so a component's named \`action\`s are lifted ` +
    `into the host page's \`handle_event/3\` clauses — and a LiveView dispatches every ` +
    `\`phx-click\` BY NAME, so only the first clause could ever run and the other button would ` +
    `silently do the winner's work. Rename one of the two \`action\`s.`,
  "loom.heex-stateful-component-reused": (p: {
    page: unknown;
    component: unknown;
    count: unknown;
    dName: unknown;
  }) =>
    `page '${p.page}' renders component '${p.component}' ${p.count} times on deployable ` +
    `'${p.dName}' (Phoenix LiveView), but '${p.component}' declares \`state { … }\`. A HEEx ` +
    `function component holds no state of its own, so Loom lifts its state into the host ` +
    `LiveView's assigns — ONE cell per component name, which ${p.count} instances would share ` +
    `(React gives each instance its own \`useState\`). Render it once, or move the state into a ` +
    `page \`state { … }\` field passed down as a param.`,
  // The emitters' internal floors for the same two conditions, re-derived from
  // the RENDERED clause bodies / instance counts rather than from the
  // validator's verdict.
  "loom.heex-handler-name-collision#emit-invariant": (p: {
    page: unknown;
    handler: unknown;
    component: unknown;
  }) =>
    `internal: page '${p.page}' hoists two different \`${p.handler}\` handlers into one LiveView ` +
    `(component '${p.component}' collides with another handler of that name). The IR validator's ` +
    `handler-name collision gate should have rejected this model before codegen reached it.`,
  "loom.heex-stateful-component-reused#emit-invariant": (p: {
    page: unknown;
    component: unknown;
    count: unknown;
  }) =>
    `internal: page '${p.page}' renders the \`state\`-declaring component '${p.component}' ` +
    `${p.count} times. The IR validator's stateful-component reuse gate should have rejected ` +
    `this model before codegen reached it.`,
  "loom.flutter-primitive-unsupported": (p: { where: unknown; name: unknown; dName: unknown }) =>
    `uses the '${p.name}' primitive, but the Flutter frontend has no renderer ` +
    `for it yet — so hosting deployable '${p.dName}' ` +
    `(platform 'flutter') would emit a \`// flutter pack: no renderer\` comment where the ` +
    `widget should be and the element would silently vanish.  Host this page on an SPA ` +
    `frontend (react / vue / svelte / angular) or a Feliz/Phoenix deployable, or use the ` +
    `supported primitives (display / layout, the Field/MultilineField/PasswordField/` +
    `NumberField/Toggle/SelectField inputs, Tabs, forms, and Modal) until '${p.name}' ` +
    `gains a Flutter renderer.`,

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
  "loom.frontend-collection-op-unsupported": (p: { where: unknown; op: unknown }) =>
    `uses the collection op \`.${p.op}\` on a collection in a page/component ` +
    `expression.  The frontends render the ops that RESHAPE a collection — \`count\`, ` +
    `\`where\`, \`any\`, \`all\`, \`map\`, \`sortBy\`, \`take\`, \`skip\`, \`join\` — but not ` +
    `\`.${p.op}\`, because the six frontends disagree on how its result is REPRESENTED: ` +
    `\`sum\`/\`min\`/\`max\`/\`avg\` fold arithmetic, and \`money\` is a \`Decimal\` object ` +
    `on React/Vue/Svelte/Angular and Phoenix but a native scalar on Feliz and Flutter; ` +
    `\`first\`/\`firstOrNull\` differ on emptiness (\`undefined\` on the JS frontends, a ` +
    `raised exception on F#/Dart) and on the optional type; \`distinct\`/\`contains\` need ` +
    `value equality, which Flutter's generated models do not define.  Emitting anyway would ` +
    `mean a project that fails to compile, or worse, one that compiles and answers wrong.  ` +
    `Compute this one server-side instead — a repository \`find\`, an aggregate ` +
    `\`derived\`, or a \`projection\` read model — and bind the result in the page.`,
} satisfies Record<string, MessageEntry>;
