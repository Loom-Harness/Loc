// The `page` family of the diagnostic-message catalog: page bodies and their primitives: actions, forms, modals, toasts, tables, charts, stores and design packs.
//
// A code lives in the family that owns its first segment (`loom.<segment>-…`),
// listed in `segments` below; `../messages.ts` merges every family into
// `DIAGNOSTIC_MESSAGES`, and `test/system/diagnostic-catalog.test.ts` fails on a
// key filed under the wrong family.  A code with a brand-new first segment adds
// that segment to the family it belongs with.

import { didYouMean, type MessageEntry } from "./_shared.js";

/** The code first-segments this family owns. */
export const segments = [
  "page",
  "action",
  "modal",
  "toast",
  "datagrid",
  "chart",
  "table",
  "file",
  "design",
  "theme",
  "store",
  "op",
  "destroy",
  "model",
] as const;

export const messages = {
  // ----------------------------------------------------------------------
  // src/language/validators/builder-call.ts
  // ----------------------------------------------------------------------
  "loom.file-upload-not-file-field": (p: { name: unknown; t: unknown }) =>
    `'FileUpload' must bind a 'File'-typed state field, but '${p.name}' is ${p.t}. ` +
    `Declare 'state { ${p.name}: File }' (a FileRef the upload writes back).`,

  // ----------------------------------------------------------------------
  // src/language/validators/deployable.ts
  // ----------------------------------------------------------------------
  "loom.design-pack-ignored": (p: { design: unknown; name: unknown; platform: unknown }) =>
    `Design pack '${p.design}' set on deployable '${p.name}' (platform '${p.platform}' has no UI mount) — value is ignored at generation.`,
  // Same code, different reason.  The bare entry above is the no-UI-mount case;
  // Flutter DOES mount a UI, so that wording would be false for it — but the
  // outcome is the same one the user needs to hear (the value is dropped), so
  // it stays one code and splits only the message.
  "loom.design-pack-ignored#flutter": (p: { design: unknown; name: unknown }) =>
    `Design '${p.design}' on Flutter deployable '${p.name}' has no effect. ` +
    `Flutter has no design-pack menu — it renders Material 3 widgets ` +
    `procedurally, so 'design:' is dropped at lowering and the generated ` +
    `project is identical without it. Remove the 'design:' line.`,
  // The theme must be QUOTED.  `DesignPack` is a closed keyword set of pack
  // families plus `STRING`, so a bare `design: light` is a PARSE error — this
  // message used to list the themes bare, which meant pasting its own
  // suggestion did not compile (the `dataSource`/`resource` mistake in another
  // shape).  Show the spelling that works.
  "loom.design-theme-unknown": (p: {
    design: unknown;
    name: unknown;
    example: unknown;
    themes: unknown;
  }) =>
    `Design '${p.design}' on Feliz deployable '${p.name}' is not a daisyUI theme. ` +
    `Feliz's 'design:' selects a daisyUI theme, written as a QUOTED string ` +
    `(\`design: "${p.example}"\`) — a bare theme name does not parse, ` +
    `because the unquoted form is reserved for the component-library pack ` +
    `families. Use one of: ${p.themes}.`,
  "loom.design-pack-custom-unchecked": (p: {
    design: unknown;
    name: unknown;
    framework: unknown;
    expectedFormat: unknown;
  }) =>
    `Custom design pack '${p.design}' on deployable '${p.name}' — the language validator cannot read it, so its format (framework '${p.framework}' needs '${p.expectedFormat}') and contents are checked only when the CLI loads the pack (\`ddd parse\` / \`ddd generate\`).`,
  "loom.design-pack-invalid": (p: { design: unknown; name: unknown; defects: unknown }) =>
    `Custom design pack '${p.design}' on deployable '${p.name}' cannot be rendered: ${p.defects}. ` +
    `See docs/design-packs.md for the pack.json manifest and the required templates.`,
  "loom.design-pack-invalid#load": (p: { pack: unknown; defects: unknown }) =>
    `Design pack '${p.pack}' cannot be rendered: ${p.defects}. ` +
    `See docs/design-packs.md for the pack.json manifest and the required templates.`,
  "loom.design-pack-retired": (p: { design: unknown; name: unknown; successor: unknown }) =>
    `Design pack '${p.design}' on deployable '${p.name}' (React 18, stack v1) was retired; use '${p.successor}' (or the bareword family name, which resolves to it).`,
  "loom.design-pack-version-unknown": (p: {
    design: unknown;
    name: unknown;
    version: unknown;
    family: unknown;
    available: unknown;
  }) =>
    `Design pack '${p.design}' on deployable '${p.name}' — no version '${p.version}' of pack family '${p.family}'. Available: ${p.available}.`,
  "loom.design-pack-format-mismatch": (p: {
    design: unknown;
    actualFormat: unknown;
    framework: unknown;
    expectedFormat: unknown;
    menu: unknown;
  }) =>
    `Design pack '${p.design}' is a ${p.actualFormat} pack but framework '${p.framework}' renders ${p.expectedFormat}. Use one of: ${p.menu}.`,

  // ----------------------------------------------------------------------
  // src/language/validators/model-text.ts
  // ----------------------------------------------------------------------
  "loom.model-text-unresolved": (p: { call: unknown; path: unknown }) =>
    `'${p.call}(${p.path})' does not name a model element. ` +
    "Write `[Context.]Type[.member]`, where Type is an aggregate, entity part, value object, enum, workflow or declared error, " +
    "and member is one of its fields, operations, inputs or enum values.",
  "loom.model-text-unresolved#ambiguous": (p: { call: unknown; path: unknown }) =>
    `'${p.call}(${p.path})' is ambiguous: the type is declared in more than one context. ` +
    "Qualify it with the context name, e.g. `label(Sales.Customer)`.",
  "loom.model-text-implicit-ambiguous": (p: { type: unknown; ctxName: unknown; owners: unknown }) =>
    `Context '${p.ctxName}' uses '${p.type}' without declaring it, and ${p.owners} each declare one, ` +
    "so the label of its form fields, options and buttons has no single owner. " +
    "Declare the type in this context, or move it to the system level to share one.",
  "loom.model-text-plural-member": (p: { path: unknown }) =>
    `'plural(${p.path})' has no plural form: only an aggregate, entity part, value object or workflow has one. ` +
    "Use `label(…)` for a field, operation, enum value or error.",
  "loom.model-text-outside-ui": (p: { call: unknown }) =>
    `'${p.call}(…)' returns translated text for a user to read, so it is allowed only in a page or component body. ` +
    "Domain code, filters and criteria work with values, not display text.",
  "loom.model-text-in-template": (p: { call: unknown }) =>
    `'${p.call}(…)' cannot be spliced into a template or a '+' concatenation: a placeholder carries data, never words, ` +
    "because a translated noun cannot be dropped into a fixed sentence frame. " +
    'Write the whole sentence as one literal instead (e.g. "Delete this task?").',

  // ----------------------------------------------------------------------
  // src/language/validators/structural.ts
  // ----------------------------------------------------------------------
  // --- the M-T9.56 drain of `structural.ts` -------------------------------
  "loom.action-out-of-position": (p: { where: unknown }) =>
    `'action' is only valid on a component's parameter list; found on ${p.where}.`,
  "loom.action-nested-marker": (p: { argBase: unknown }) =>
    `'action(${p.argBase})' is not allowed — the callback argument must be a data type (primitive, aggregate, value object, …), not another UI marker.`,

  // --- the M-T9.56 drain of `ui.ts` ---------------------------------------
  // The `theme { … }` block: an unknown key, a repeated key, and the three
  // per-value menus (hex colour / radius / colorScheme).  Each menu is DERIVED
  // from the same set the check tests against, never re-typed here.
  "loom.theme-property-unknown": (p: { name: unknown; known: unknown }) =>
    `unknown theme property '${p.name}'. Known properties: ${p.known}.`,
  "loom.theme-property-duplicate": (p: { name: unknown }) =>
    `theme property '${p.name}' declared more than once.`,
  "loom.theme-color-invalid": (p: { name: unknown; value: unknown }) =>
    `theme '${p.name}' must be a CSS hex color (#RGB, #RRGGBB, or #RRGGBBAA); got '${p.value}'.`,
  "loom.theme-radius-invalid": (p: { known: unknown; value: unknown }) =>
    `theme 'radius' must be one of ${p.known}; got '${p.value}'.`,
  "loom.theme-color-scheme-invalid": (p: { known: unknown; value: unknown }) =>
    `theme 'colorScheme' must be one of ${p.known}; got '${p.value}'.`,
  "loom.page-property-duplicate": (p: { name: unknown; prop: unknown }) =>
    `Page '${p.name}' declares more than one '${p.prop}' property; keep just the first.`,
  "loom.page-menu-key-unknown": (p: { key: unknown; name: unknown; known: unknown }) =>
    `Unknown menu metadata key '${p.key}' on page '${p.name}'. Recognised keys: ${p.known}.`,
  "loom.page-layout-unknown": (p: { layout: unknown; name: unknown; known: unknown }) =>
    `Unknown layout '${p.layout}' on page '${p.name}'. Recognised: ${p.known}.`,
  "loom.store-lifetime-invalid": (p: {
    name: unknown;
    lifetime: unknown;
    storeLifetimes: unknown;
  }) =>
    `store '${p.name}': unknown lifetime '${p.lifetime}' — ` +
    `\`persist:\` accepts ${p.storeLifetimes}.`,

  // ----------------------------------------------------------------------
  // src/ir/validate/checks/store-checks.ts
  // ----------------------------------------------------------------------
  "loom.store-url-field-invalid": (p: { where: unknown; name: unknown; k: unknown }) =>
    `field '${p.name}' (${p.k}) cannot be URL-synced — ` +
    `\`persist: url\` fields must be scalar (string/number/bool/enum/id). ` +
    `Use \`persist: local\` for structural state.`,
  "loom.store-init-not-constant": (p: { name: unknown; kind: unknown }) =>
    `field '${p.name}': its initializer is not a constant (a \`${p.kind}\` expression).  ` +
    `A store field is initialised once, when the store is created, so its default ` +
    `may use only literals, lists, operators, \`? :\`, enum values and \`string(…)\` — ` +
    `set anything else from a store action instead.`,
  "loom.store-action-view-effect": (p: { where: unknown; name: unknown; sName: unknown }) =>
    `action '${p.name}': \`${p.sName}(…)\` is a view-scoped effect — ` +
    `a store has no router/socket to ${p.sName} on.  Move it to the calling page's ` +
    `action (the page owns navigation; the store action only mutates state).`,
  "loom.store-action-cycle": (p: { node: unknown; path: unknown }) =>
    `store action '${p.node}' is part of a call cycle (${p.path}) — ` +
    `store actions must compose acyclically so each store's update reduction terminates.`,
  "loom.store-state-inline-write": (p: {
    surfaceWhere: unknown;
    name: unknown;
    storeSeg: unknown;
    fieldSeg: unknown;
  }) =>
    `${p.surfaceWhere} action '${p.name}': cannot write store state inline ` +
    `(\`${p.storeSeg}.${p.fieldSeg} := …\`).  Store state changes only inside a store ` +
    `action — add an \`action\` to \`store ${p.storeSeg}\` and call it (\`${p.storeSeg}.<action>()\`).`,
  "loom.store-lifetime-liveview-invalid": (p: { where: unknown; lifetime: unknown }) =>
    `\`persist: ${p.lifetime}\` is not supported on the ` +
    `phoenixLiveView frontend — a LiveView store is a server-side per-process struct ` +
    `with no browser storage, and URL state is owned by the page's \`handle_params\`. ` +
    `Use \`persist: memory\` here; the persistence tiers ship on the SPA frontends.`,
  // `loom.store-lifetime-target-unsupported` is FIELD-SCOPED ONLY now.  The
  // platform-wide arm (a frontend whose store emitter ignored `persist:` and
  // built an in-memory store regardless) is gone with its last entry: the
  // ladder ships on every frontend — the four JS store builders, feliz
  // (`generator/feliz/store-persist.ts`) and flutter
  // (`generator/flutter/store-persist.ts`).  What survives on those last two is
  // narrower: persistence there crosses an UNTYPED boundary per FIELD, so a
  // field type with no total conversion in that language's codec still can't
  // ride it, and would be silently dropped from the stored state.
  "loom.store-lifetime-target-unsupported#field": (p: {
    where: unknown;
    name: unknown;
    lifetime: unknown;
  }) =>
    `field '${p.name}' cannot be persisted on the feliz frontend — ` +
    `\`persist: ${p.lifetime}\` crosses the JS boundary per field, and the F# codec covers ` +
    `string / id / enum / int / long / bool / decimal / money / datetime / guid fields, ` +
    `arrays of those, and an OPTIONAL of any of them (at every tier, \`persist: url\` ` +
    `included).  A File, entity or value-object field would need a RECORD codec the store ` +
    `path does not emit, and would be silently dropped from the stored blob.  Give the ` +
    `field one of the covered types, or use \`persist: memory\` for this store.`,
  "loom.store-lifetime-target-unsupported#flutter-field": (p: {
    where: unknown;
    name: unknown;
    lifetime: unknown;
  }) =>
    `field '${p.name}' cannot be persisted on the flutter frontend — ` +
    `\`persist: ${p.lifetime}\` crosses an untyped boundary per field, and the Dart codec ` +
    `covers string / guid / id / enum / int / long / decimal / money / bool / datetime ` +
    `fields, arrays of those, a \`json\` cell, and an OPTIONAL of any scalar (except under ` +
    `\`persist: url\`, where a null cell cannot be restored: the back/forward re-seed goes ` +
    `through \`copyWith\`, whose \`x ?? this.x\` cannot set a cell to null, so an absent ` +
    `param would silently KEEP the old value).  A File, entity or value-object field has no ` +
    `total Dart conversion at all (\`fromJson\` throws on junk) and would be silently ` +
    `dropped from the stored state.  Give the field one of the covered types, or use ` +
    `\`persist: memory\` for this store.`,
  "loom.store-cross-store-on-liveview-invalid": (p: {
    where: unknown;
    store: unknown;
    name: unknown;
    storeName: unknown;
    actionName: unknown;
  }) =>
    `calls \`${p.store}.${p.name}(…)\`, a DIFFERENT store's action, ` +
    `on the phoenixLiveView frontend.  A LiveView store action is a pure struct ` +
    `transform over its OWN store's per-page assign and can't reach store ` +
    `'${p.store}'.  Move the cross-store coordination to the calling page's action ` +
    `(call \`${p.storeName}.${p.actionName}()\` then \`${p.store}.${p.name}()\` from the page).`,

  // ----------------------------------------------------------------------
  // src/ir/validate/checks/ui-framework-checks.ts — the two LiveView
  // component-HOISTING collisions (§18 emitter sentinels).  Both used to be a
  // bare `throw new Error` in `liveview-emit.ts`, raised mid-generate on a
  // `.ddd` that had just validated `0 error(s), 0 warning(s)`.
  // ----------------------------------------------------------------------
  "loom.page-form-locals-unsupported": (p: {
    what: unknown;
    dName: unknown;
    fw: unknown;
    labels: unknown;
    hint: unknown;
  }) =>
    `${p.what} declares two forms that would emit the SAME page-local bindings on ` +
    `deployable '${p.dName}' (frontend '${p.fw}'): ${p.labels}. Every JS frontend splices a ` +
    `form's mutation hook and form handle in as page-scope consts ('const create = …', ` +
    `'const { register, handleSubmit, … } = useForm(…)'), and those names come from the design ` +
    `pack's form templates, so a second form redeclares them. ${p.hint} Split the forms across ` +
    `two pages, or move one into its own 'component'. (Angular emits this shape correctly — its ` +
    `locals are aggregate-scoped and a second same-aggregate form takes an ordinal suffix — so ` +
    `the fix here is that same per-form ordinal, threaded through the ~68 pack templates that ` +
    `hardcode 'create'/'register'/'handleSubmit'.)`,
  "loom.file-field-needs-object-storage": (p: {
    name: unknown;
    ctxName: unknown;
    aggName: unknown;
    fileField: unknown;
  }) =>
    `Deployable '${p.name}' hosts aggregate '${p.ctxName}.${p.aggName}' ` +
    `which has a \`File\` field ('${p.fileField}'), but binds no object-store ` +
    `dataSource.  A \`File\` stores its bytes in an object store — declare a ` +
    `\`storage <s> { type: localDisk }\` (or \`s3\`), a ` +
    // `resource`, not `dataSource` — the same slip this file's
    // `loom.datasource-binding-missing` carried.  `dataSource` names the
    // deployable's `dataSources:` CLAUSE, never the declaration, so pasting the
    // suggested line was a parse error.
    `\`resource <ds> { for: ${p.ctxName}, kind: objectStore, use: <s> }\`, and ` +
    `add '<ds>' to '${p.name}'\`s 'dataSources:' list.`,

  // ----------------------------------------------------------------------
  // src/ir/validate/checks/ui-gate-checks.ts
  // ----------------------------------------------------------------------
  "loom.page-gate-not-client-evaluable": (p: {
    uiName: unknown;
    pageName: unknown;
    offending: unknown;
    why: unknown;
    origin: unknown;
  }) =>
    `page '${p.pageName}' on ui '${p.uiName}': a page \`requires\` gate is re-evaluated ` +
    `IN THE BROWSER against the verified session claims (it is what renders \`<Forbidden/>\` ` +
    `instead of the body), so it may only touch \`currentUser\`, enum members, constants, ` +
    `\`.contains(…)\`, comparison / boolean operators and a ternary — \`${p.offending}\` is ` +
    `outside that set.${p.origin} ${p.why}.  Every frontend refuses to emit a gate it cannot ` +
    `evaluate rather than degrade it to "always allowed", so this stops generation for all six.`,

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
  "loom.page-primitive-arg-missing": (p: { name: unknown; arg: unknown }) =>
    `\`${p.name}\` was written without ${p.arg}, and every frontend reads that ` +
    `argument to decide what to render — so the body walker cannot emit the primitive at ` +
    `all and leaves a \`loom:unrendered\` comment in its place.  The page still compiles; ` +
    `the region is simply empty on React, Vue, Svelte, Angular, Feliz, Flutter and Phoenix ` +
    `alike.  Supply the argument.`,
  "loom.page-primitive-arg-invalid": (p: { name: unknown; expected: unknown }) =>
    `\`${p.name}\` has an argument the body walker cannot read: it expects ${p.expected}.  ` +
    `Any other shape is unreadable by every frontend emitter, so the primitive is replaced ` +
    `by a \`loom:unrendered\` comment and the region comes out empty on every target.`,
  "loom.page-ref-unreachable": (p: { name: unknown; what: unknown }) =>
    `\`${p.name}\` names ${p.what}, so the body walker has no wire contract to generate ` +
    `against and the primitive degrades to a \`loom:unrendered\` comment on every frontend.  ` +
    `A page binds only aggregates, workflows and PUBLIC operations served by the backend its ` +
    `deployable \`targets:\` (or, for a self-hosting frontend, the contexts it owns).  Add ` +
    `the owning context to that backend deployable, declare the member the primitive needs, ` +
    `or bind something the ui already reaches.`,
  "loom.page-expr-unrenderable": (p: { kind: unknown }) =>
    `a \`${p.kind}\` expression appears in a MARKUP position (a primitive's child slot), ` +
    `and the body walker renders markup children from a closed set of expression kinds — ` +
    `everything else has no child-position lowering on any frontend and degrades to a ` +
    `\`loom:unrendered\` comment.  Bind the value to a \`derived\` (or page \`state\`) and ` +
    `render that, or wrap it in a text primitive.`,
  "loom.page-primitive-target-gap": (p: { name: unknown; framework: unknown }) =>
    `\`${p.name}\` has no renderer on '${p.framework}' yet, so this frontend emits a ` +
    `\`loom:unrendered\` comment where the other targets emit the primitive.  Unlike a ` +
    `refusal this is a PORTING gap, not a modelling error: the same \`.ddd\` renders it ` +
    `elsewhere.  Host this ui on a frontend that implements the primitive, or render the ` +
    `same information with one that is portable.`,
  "loom.page-primitive-extra-children": (p: {
    where: unknown;
    name: unknown;
    max: unknown;
    slots: unknown;
  }) =>
    p.max === 0
      ? `\`${p.name}\` renders NO positional arguments — it is configured entirely through its ` +
        `named arguments, so a positional child has no slot in any design pack and is silently ` +
        `DROPPED from the page (while still landing in the message catalog).  Move the content ` +
        `to a sibling inside the enclosing container.`
      : `\`${p.name}\` takes ${p.max} positional arguments (${p.slots}) — it is a fixed ` +
        `SLOT primitive, not a children container like \`Stack\` or \`Card\`, so every design pack ` +
        `renders exactly those ${p.max} and the extra ones are silently DROPPED from the page ` +
        `(while still landing in the message catalog).  Wrap the extra content in a \`Stack { … }\` ` +
        `and pass that as the last slot.` +
        (p.name === "Text"
          ? `  A sentence with inline emphasis is the exception: a \`Text\` whose children are all ` +
            `strings, \`{hole}\` templates and \`Bold\` / \`Italic\` / \`InlineCode\` spans renders as ` +
            `ONE translatable message.`
          : ""),
  "loom.table-filter-unsupported": (p: {
    where: unknown;
    filter: unknown;
    framework: unknown;
    deployable: unknown;
  }) =>
    `\`Table { filter: ${p.filter} }\` binds a client-side search box, and the '${p.framework}' ` +
    `walker has no filter seam — deployable '${p.deployable}' renders the table with the ` +
    `argument silently DROPPED: no search box, no narrowing, and the bound state field left ` +
    `unread.  Remove the \`filter:\` on this frontend, or render the ui through one of the ` +
    `frameworks that supports it (react / vue / svelte / angular / feliz / flutter).`,
  "loom.table-filter-server-paged": (p: { where: unknown; filter: unknown }) =>
    `\`Table { filter: ${p.filter} }\` is a CLIENT-side filter, but this table is server-paged ` +
    `(\`serverPaged: true\`) — its rows are one page the server already chose, so filtering them ` +
    `in the browser would narrow that page rather than the result set.  The walker drops the ` +
    `argument rather than lie about it.  Note that the simplest hand-written paged table becomes ` +
    `server-paged automatically (the auto-paged rewrite), so \`filter:\` needs an explicitly ` +
    `client-paged table — or a find parameter the read passes to the server.`,
  "loom.modal-controlled-op-form-unsupported": (p: {
    where: unknown;
    framework: unknown;
    deployable: unknown;
  }) =>
    `a \`Modal\` cannot combine the state-controlled shape (\`open: <stateBool>\`) with an ` +
    `\`OperationForm\` child on '${p.framework}' — deployable '${p.deployable}' renders the ` +
    `WHOLE modal, operation form included, as a comment, so the enclosing section comes out ` +
    `empty.  Use the trigger shape (\`Modal { trigger: Button { … }, OperationForm { … } }\`), ` +
    `which drives the dialog itself, or drop the \`OperationForm\` and put plain markup in the ` +
    `controlled modal.`,
  "loom.page-primitive-extra-children#modal-op-form": (_p: { where: unknown }) =>
    `a \`Modal\` with an \`OperationForm\` child renders the TRIGGER button and the ` +
    `operation's generated field set — nothing else.  The other positional children have no ` +
    `slot in any design pack and are silently DROPPED.  Use the state-controlled shape ` +
    `(\`Modal { …children, open: <stateBool> }\`), which IS a children container, or move the ` +
    `extra markup out of the modal.`,
  "loom.page-primitive-unknown-arg": (p: {
    where: unknown;
    name: unknown;
    arg: unknown;
    known: unknown;
    suggestion?: unknown;
  }) =>
    `\`${p.name}\` has no \`${p.arg}:\` argument.${didYouMean(p.suggestion)}  Every emitter reads a ` +
    `primitive's named arguments BY NAME, so an unrecognised one — and whatever content it ` +
    `carries — is silently DROPPED from every frontend (and never reaches the message ` +
    `catalog either, so translators cannot even see it went missing).  On a fixed-slot ` +
    `primitive it also DISPLACES the positional the content was meant to fill ` +
    `(\`Tab { title: "One", … }\` renders as "Tab 1").  ${p.known}`,
  "loom.page-primitive-unknown-arg-value": (p: {
    name: unknown;
    arg: unknown;
    value: unknown;
    known: unknown;
    fallback: unknown;
  }) =>
    `\`${p.name}\`'s \`${p.arg}: ${JSON.stringify(p.value)}\` is not one of the values that ` +
    `argument accepts (${p.known}).  This is a CLOSED vocabulary, and an unrecognised value is ` +
    `not dropped — every design pack renders its \`${p.fallback}\` default instead, on every ` +
    `frontend, with nothing to say so.  A primary action written this way ships looking like ` +
    `plain text.  On Phoenix the same value is a COMPILE error, because the pack's function ` +
    `component declares the identical list as an \`attr … values:\` constraint — so the value ` +
    `is wrong on every target; only the JSX packs kept quiet about it.`,
  "loom.page-primitive-unknown-arg#style-not-object": (p: { where: unknown; name: unknown }) =>
    `\`${p.name}\`'s \`style:\` takes an OBJECT LITERAL of CSS declarations ` +
    `(\`style: { padding: "1rem" }\`).  Any other expression is dropped during lowering, so ` +
    `the styling silently never reaches the rendered element on any frontend.`,
  "loom.op-form-needs-route-id": (p: {
    name: unknown;
    route: unknown;
    agg: unknown;
    op: unknown;
  }) =>
    `\`OperationForm { of: ${p.agg}, op: ${p.op} }\` names the operation but no ` +
    `RECORD, so every frontend targets the record identified by the page's route \`:id\` — and ` +
    `this page (route "${p.route}") declares none.  The form still renders, and submitting it ` +
    `posts the operation against an EMPTY id on all six frontends: a request whose path has an ` +
    `empty segment (\`/…//${p.op}\`), which no backend route matches.  Host the form on a ` +
    `detail route (\`route: "/…/:id"\`), or bind an in-scope record and use the instance ` +
    `spelling (\`QueryView { of: …byId(id), single: true, data: row => OperationForm ` +
    `{ row.${p.op} } }\`).`,
  // `DestroyForm { of: … }` whose `of:` names no aggregate with a canonical
  // destroy.  Three arms, one code — the author's mistake is the same in each
  // (`of:` takes the aggregate TYPE), only the evidence differs.
  "loom.destroy-form-of-unresolved#not-a-ref": (p: { shape: unknown }) =>
    `\`DestroyForm\` takes \`of: <Aggregate>\` — the aggregate TYPE, not a record instance, a ` +
    `lambda binding (\`row\`), or a positional argument; it deletes the record the page's ` +
    `\`:id\` route param names, so no record is passed in.  Found ${p.shape}.  Spell it ` +
    `\`DestroyForm { of: <Aggregate> }\` over an aggregate that carries a canonical destroy — ` +
    `one declared \`with crudish\`, or one with an explicit \`destroy { }\` member.`,
  "loom.destroy-form-of-unresolved#unresolved": (p: { name: unknown }) =>
    `\`DestroyForm { of: ${p.name} }\` names no declared aggregate.  \`of:\` takes the aggregate ` +
    `TYPE, not a record instance or a lambda binding — a \`QueryView\`/\`Table\` row binding ` +
    `spelled here resolves to nothing the frontends can delete, and every one of them drops ` +
    `the form for a comment.  Name a declared aggregate that carries a canonical destroy — ` +
    `one declared \`with crudish\`, or one with an explicit \`destroy { }\` member.`,
  "loom.destroy-form-of-unresolved#no-canonical-destroy": (p: { name: unknown }) =>
    `\`DestroyForm { of: ${p.name} }\` submits the aggregate's CANONICAL destroy, and ` +
    `\`${p.name}\` declares none — so the form has nothing to call.  Two spellings give it ` +
    `one: \`aggregate ${p.name} with crudish { … }\`, or an explicit \`destroy { }\` member on ` +
    `\`${p.name}\`.  (\`of:\` names the aggregate TYPE, never a record instance or a lambda ` +
    `binding — the record comes from the page's \`:id\` route param.)`,
  "loom.datagrid-selection-not-state": (p: { where: unknown; where2: unknown; label: unknown }) =>
    `DataGrid 'selection:' must name a \`String[]\` field declared in this ` +
    `${p.where2}'s \`state { }\` block, but ${p.label} ` +
    `isn't one. Declare \`state { selectedIds: String[] }\` and bind \`selection: selectedIds\`.`,
  "loom.datagrid-selection-not-array": (p: { where: unknown; name: unknown; t: unknown }) =>
    `DataGrid 'selection: ${p.name}' needs a \`String[]\` state field — ` +
    `the grid reports the selected rows' ids — but '${p.name}' is declared ` +
    `\`${p.t}\`. Change it to \`${p.name}: String[]\`.`,
  "loom.chart-kind-invalid": (p: { where: unknown; kind: unknown }) =>
    `Chart 'kind:' must be the string literal "line" or "bar"` +
    `${p.kind}. v1 ships exactly those two kinds; ` +
    `anything richer (pie, area, scatter) is an \`extern component\`.`,
  "loom.chart-of-not-grouped": (p: { where: unknown; why: unknown }) => `Chart 'of:' — ${p.why}.`,
  "loom.chart-accessor-not-field#not-a-simple-accessor": (p: {
    where: unknown;
    slot: unknown;
    slot2: unknown;
  }) =>
    `Chart '${p.slot}:' must be a simple accessor lambda naming one row field ` +
    `(\`r => r.<field>\`) — the chart keys its ${p.slot2} ` +
    `on the field NAME, so a computed expression has nothing to key on.`,
  "loom.chart-accessor-not-field#not-a-row-field": (p: {
    where: unknown;
    slot: unknown;
    field: unknown;
    projName: unknown;
    wireShape: unknown;
  }) =>
    `Chart '${p.slot}: r => r.${p.field}' — '${p.field}' is not a declared row field ` +
    `of projection '${p.projName}' (declared: ${p.wireShape}).`,
  "loom.action-op-has-params": (p: {
    where: unknown;
    name: unknown;
    opName: unknown;
    aggName: unknown;
    length: unknown;
    params: unknown;
  }) =>
    `\`Action(${p.name}.${p.opName})\` targets operation '${p.aggName}.${p.opName}', ` +
    `which takes ${p.length} parameter(s) (${p.params}). ` +
    `\`Action\` renders a one-shot button that submits no parameters, so they would be silently dropped. ` +
    `Use \`OperationForm(of: ${p.aggName}, op: ${p.opName})\` — it renders the parameter inputs.`,
  "loom.action-payload-mismatch#supplies-a-payload-value": (p: {
    where: unknown;
    name: unknown;
    handlerSlot: unknown;
    actionName: unknown;
  }) =>
    `\`${p.name} { ${p.handlerSlot}: ${p.actionName} }\` supplies a payload value, ` +
    `but action '${p.actionName}' is nullary — declare a single payload parameter to receive it.`,
  "loom.action-payload-mismatch#into-binding-arity": (p: {
    where: unknown;
    name: unknown;
    handlerSlot: unknown;
    actionName: unknown;
    arity: unknown;
    params: unknown;
  }) =>
    `\`${p.name} { ${p.handlerSlot}: ${p.actionName} }\` supplies no payload ` +
    `(two-way \`into:\` binding), but action '${p.actionName}' declares ${p.arity} parameter(s) ` +
    `(${p.params}) — make it nullary.`,
  "loom.action-payload-mismatch#action-referenced-by-declares": (p: {
    where: unknown;
    name: unknown;
    callName: unknown;
    handlerSlot: unknown;
    arity: unknown;
  }) =>
    `action '${p.name}' referenced by \`${p.callName} { ${p.handlerSlot}: … }\` ` +
    `declares ${p.arity} parameters; a handler action takes at most one payload parameter.`,
  "loom.toast-message-unsupported": (p: { where: unknown; kind: unknown; detail: unknown }) =>
    `the \`toast(…)\` message ${p.detail}.  Every realtime renderer implements the ` +
    `same message subset — a literal, the handler's event binding, a member access CHAIN of ` +
    `any depth off that binding, parentheses, and binary operators between those — and THROWS ` +
    `on anything else (\`unsupported expression kind '${p.kind}'\`): ` +
    `src/generator/_frontend/realtime.ts (React/Vue/Svelte/Angular), ` +
    `src/generator/feliz/realtime.ts (Feliz), src/generator/elixir/realtime-liveview.ts ` +
    `(Phoenix LiveView), src/generator/flutter/realtime.ts (Flutter).  So this \`.ddd\` ` +
    `validates and then CRASHES codegen.  Build the message from a literal and ` +
    `\`<bind>.<field>…\` parts (\`toast("Order " + e.order.id + " placed")\`); compute anything ` +
    `richer — a conversion, a method call, a conditional — server-side and carry it on the ` +
    `event.`,
} satisfies Record<string, MessageEntry>;
