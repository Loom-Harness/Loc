// The claims register for `generator-throw-census.test.ts`. Read that file's
// header for what each claim shape means and how the ratchet works.
//
// KEYS are `<relFile>#<enclosingFunction>[$N]` (see
// `generator-throw-sites.ts`). `$N` numbers the Nth throw in the same
// function, so inserting a throw ABOVE an existing one in the same function
// renumbers the later ones. The census then names both, and the fix is to
// re-key them.

export type ThrowClassification =
  | { guardedBy: readonly string[]; note?: string }
  | { invariant: string }
  | { deferred: string; mission: string; reviewUntil: string };

export const CLASSIFICATIONS: Record<string, ThrowClassification> = {
  // src/generator/_auth/dev-stub-id.ts
  "src/generator/_auth/dev-stub-id.ts#devStubIdExpr": {
    invariant:
      "Exhaustive `never` default over the closed dev-stub language union; tsc proves no other value. (src/generator/_auth/dev-stub-id.ts:88)",
  },

  // src/generator/_channels/wire-codec.ts
  "src/generator/_channels/wire-codec.ts#decodeValue": {
    invariant:
      "Exhaustive `never` default: every TypeIR kind has an arm above it. (src/generator/_channels/wire-codec.ts:128)",
  },

  // src/generator/_expr/target.ts
  "src/generator/_expr/target.ts#renderExprWith": {
    invariant:
      "action-ref is lowered only when env.actions/env.stores are set (page/component/store lowering), and those bodies are rendered only by the frontend walkers (walker-core.ts:2200, heex-walker-core.ts:780), never by the backend renderExprWith callers (domain bodies, requires gates). (src/ir/lower/lower-expr.ts:2455, src/ir/lower/lower-expr.ts:744, src/ir/lower/lower-ui.ts:134/374)",
  },
  "src/generator/_expr/target.ts#renderExprWith$2": {
    invariant:
      "authz-filter is built only by enrichment (tenant-stance.ts:349/451, enrichments.ts:588/682) into contextFilters/writeScopeFilter, and every backend filter translator special-cases it (isDenyFilter/isDeepScopeFilter; in-app path _expr/authz-filter-inapp.ts). Empirically: the 90-fixture corpus with `deny on <every aggregate>` and `deny write` injected into every context, generated on node, node{mikroorm}, dotnet, dotnet{dapper}, python, java and elixir, never reached this throw. The document-shape crossing (policy-document.ddd) was the historical leak and is fixed. (src/ir/util/tenant-stance.ts:349,451; src/generator/_expr/authz-filter-inapp.ts)",
  },
  "src/generator/_expr/target.ts#renderExprWithMarks": {
    invariant:
      "Only caller is the TS aggregate op-body loop (domain statements); action-ref is lowered only in UI bodies (env.actions/env.stores). (src/generator/typescript/render-stmt.ts:161; src/ir/lower/lower-expr.ts:2455)",
  },
  "src/generator/_expr/target.ts#renderExprWithMarks$2": {
    invariant:
      "Only caller renders aggregate op-body statements, which never contain the enrichment-only authz-filter sentinel (built at tenant-stance.ts:349/451 into filters only). (src/generator/typescript/render-stmt.ts:161)",
  },

  // src/generator/_frontend/api-module.ts
  "src/generator/_frontend/api-module.ts#zodForRequest": {
    invariant:
      "The provenanced genericInstance has no grammar arm and is built only by wireTypeForField for RESPONSE wire fields; every zodForRequest caller (api-module.ts:177/192/216/238) passes a declared f.type/p.type. (src/ir/enrich/wire-projection.ts:435; src/ir/stdlib/generics.ts:86-95)",
  },

  // src/generator/_frontend/gate-expr.ts
  "src/generator/_frontend/gate-expr.ts#renderGateExpr": {
    guardedBy: ["loom.page-gate-not-client-evaluable"],
    note: "firstNonUiGateNode mirrors the renderer arm-for-arm and every renderGateExpr call site renders a page.requires, which validatePageGates checks for every page of every ui.",
  },
  "src/generator/_frontend/gate-expr.ts#renderGateExpr$2": {
    guardedBy: ["loom.page-gate-not-client-evaluable"],
    note: 'A non-.contains method in a page gate is rejected with kind "method".',
  },
  "src/generator/_frontend/gate-expr.ts#renderGateExpr$3": {
    guardedBy: ["loom.page-gate-not-client-evaluable"],
    note: 'Any other expression kind in a page gate is rejected with kind "kind".',
  },
  "src/generator/_frontend/gate-expr.ts#renderLiteral": {
    guardedBy: ["loom.page-gate-not-client-evaluable"],
    note: 'Literal kinds outside string/bool/int/long/decimal/null are rejected with kind "literal"; same set as renderLiteral.',
  },

  // src/generator/_frontend/realtime.ts
  "src/generator/_frontend/realtime.ts#renderMessageExpr": {
    guardedBy: ["loom.toast-message-unsupported"],
    note: "A toast ref other than the event binding is rejected by toastMessageProblem, which mirrors renderMessageExpr arm for arm.",
  },
  "src/generator/_frontend/realtime.ts#renderMessageExpr$2": {
    guardedBy: ["loom.toast-message-unsupported"],
    note: "A member chain not rooted at the event binding is rejected by toastMessageProblem, which mirrors renderMessageExpr arm for arm.",
  },
  "src/generator/_frontend/realtime.ts#renderMessageExpr$3": {
    guardedBy: ["loom.toast-message-unsupported"],
    note: "Every other expression kind (enumerated explicitly) is rejected by toastMessageProblem, which mirrors renderMessageExpr arm for arm.",
  },

  // src/generator/_frontend/shell-chrome.ts
  "src/generator/_frontend/shell-chrome.ts#entry": {
    invariant:
      "Chrome names are hard-coded string literals at every call site, all present in APP_SHELL_CHROME. (src/generator/svelte/index.ts:436-454; src/generator/elixir/vanilla/shell-emit.ts:233)",
  },

  // src/generator/_frontend/workflows-module.ts
  "src/generator/_frontend/workflows-module.ts#zodForRequest": {
    invariant:
      "`duration` is not in the PrimitiveType grammar, so it exists only as an expression type and never as a declared workflow param type. (src/language/ddd.langium:2162)",
  },
  "src/generator/_frontend/workflows-module.ts#zodForRequest$2": {
    guardedBy: ["loom.slot-out-of-position", "loom.action-out-of-position"],
    note: "`slot`/`action` are rejected on any Parameter not owned by a Component, so a workflow param cannot have them.",
  },
  "src/generator/_frontend/workflows-module.ts#zodForRequest$3": {
    guardedBy: ["loom.generic-position"],
    note: "A generic carrier is allowed only as a find/queryHandler return or a payload field, never as a workflow Parameter (Provenanced has no grammar arm).",
  },
  "src/generator/_frontend/workflows-module.ts#zodForRequest$4": {
    guardedBy: ["loom.union-position"],
    note: "An anonymous `A or B` union is rejected on Parameters; named payload unions lower to an entity marker, and `none` appears only as a union arm.",
  },

  // src/generator/_frontend/zod-schemas.ts
  "src/generator/_frontend/zod-schemas.ts#zodForRequest": {
    invariant:
      "Same as api-module: Provenanced<T> only exists on response wire shapes; request callers pass declared types. (src/ir/enrich/wire-projection.ts:435; src/generator/svelte/api-builder.ts:94/121/142)",
  },

  // src/generator/_packs/loader-fs.ts
  "src/generator/_packs/loader-fs.ts#loadPack": {
    deferred:
      'A custom design path with no pack.json. Relative paths resolve against the process CWD, not the .ddd directory (resolvePackDir is called without referenceDir at react/index.ts:168 and others). Reachable only with a user-supplied CUSTOM design pack (design: "<path>", which parse accepts with just the warning loom.design-pack-custom-unchecked, deployable.ts:498); the error message is descriptive. This is a config error, not a codegen logic bug, but no loom.* diagnostic covers it.',
    mission: "M-T9.83",
    reviewUntil: "2027-01-31",
  },
  "src/generator/_packs/loader-fs.ts#loadPack$2": {
    deferred:
      'A custom pack whose pack.json has no emits map. Reachable only with a user-supplied CUSTOM design pack (design: "<path>", which parse accepts with just the warning loom.design-pack-custom-unchecked, deployable.ts:498); the error message is descriptive. This is a config error, not a codegen logic bug, but no loom.* diagnostic covers it.',
    mission: "M-T9.83",
    reviewUntil: "2027-01-31",
  },
  "src/generator/_packs/loader-fs.ts#loadPack$3": {
    invariant:
      "Fires only for a path inside <repo>/designs/<family>/<ver>, which holds only the shipped packs (their versions match; tests pin this); custom paths outside designs/ are exempt. (src/generator/_packs/loader-fs.ts:155-161)",
  },
  "src/generator/_packs/loader-fs.ts#loadPack$4": {
    deferred:
      'A custom pack whose emits entry names a .hbs file that does not exist. Reachable only with a user-supplied CUSTOM design pack (design: "<path>", which parse accepts with just the warning loom.design-pack-custom-unchecked, deployable.ts:498); the error message is descriptive. This is a config error, not a codegen logic bug, but no loom.* diagnostic covers it.',
    mission: "M-T9.83",
    reviewUntil: "2027-01-31",
  },
  "src/generator/_packs/loader-fs.ts#loadPack$5": {
    deferred:
      'A custom pack that declares stack: "v999". Reachable only with a user-supplied CUSTOM design pack (design: "<path>", which parse accepts with just the warning loom.design-pack-custom-unchecked, deployable.ts:498); the error message is descriptive. This is a config error, not a codegen logic bug, but no loom.* diagnostic covers it.',
    mission: "M-T9.83",
    reviewUntil: "2027-01-31",
  },
  "src/generator/_packs/loader-fs.ts#loadPack$6": {
    invariant:
      "The shipped stack dirs contain only stack-package-*.hbs, and no shipped shared dir has a template with those names, so no clash is possible. (stacks/*/ (only stack-package-deps/devdeps.hbs))",
  },
  "src/generator/_packs/loader-fs.ts#readSharedSources": {
    invariant:
      "The shared dirs are fixed shipped directories chosen by format, and none of the five format combos has a duplicate .hbs name (checked: vite/api/docker, phoenix, sveltekit, vue/api/docker, angular/api). (src/generator/_packs/loader-fs.ts:29-50)",
  },
  "src/generator/_packs/loader-fs.ts#repoRoot": {
    invariant:
      "The shipped install always has designs/ next to out/; this is a broken-install failure, not model-driven. (src/generator/_packs/loader-fs.ts:55-66)",
  },

  // src/generator/_packs/loader.ts
  "src/generator/_packs/loader.ts#compilePack": {
    invariant:
      "The only caller, loadPack, already throws on a missing or non-object emits before calling compilePack. (src/generator/_packs/loader-fs.ts:146-150)",
  },
  "src/generator/_packs/loader.ts#compilePack$2": {
    invariant:
      "loadPack fills `sources` for every emits key (or throws first), so sources[logicalName] is never null. (src/generator/_packs/loader-fs.ts:170-178)",
  },
  "src/generator/_packs/loader.ts#compilePack$3": {
    deferred:
      'A custom pack missing a required primitive (validateRequired defaults to true). Reachable only with a user-supplied CUSTOM design pack (design: "<path>", which parse accepts with just the warning loom.design-pack-custom-unchecked, deployable.ts:498); the error message is descriptive. This is a config error, not a codegen logic bug, but no loom.* diagnostic covers it.',
    mission: "M-T9.83",
    reviewUntil: "2027-01-31",
  },
  "src/generator/_packs/loader.ts#render": {
    invariant:
      "Every template name the generators render is in REQUIRED_PRIMITIVES (checked: all literal render/primitive names in react/_walker/_frontend) and so is enforced at load; the optional ones (realtime-toast-setup, primitive-modal-controlled) are checked with templates.has first. (src/generator/_packs/loader.ts:466-475; src/generator/react/realtime-handlers-builder.ts:33; src/generator/_walker/primitives/forms.ts:978)",
  },

  // src/generator/_packs/pack-chrome.ts
  "src/generator/_packs/pack-chrome.ts#assertDeclaredChromeIsSane": {
    deferred:
      'A custom pack with an empty chrome message. Reachable only with a user-supplied CUSTOM design pack (design: "<path>", which parse accepts with just the warning loom.design-pack-custom-unchecked, deployable.ts:498); the error message is descriptive. This is a config error, not a codegen logic bug, but no loom.* diagnostic covers it.',
    mission: "M-T9.83",
    reviewUntil: "2027-01-31",
  },
  "src/generator/_packs/pack-chrome.ts#assertDeclaredChromeIsSane$2": {
    deferred:
      'A custom pack whose chrome message contains `<`. Reachable only with a user-supplied CUSTOM design pack (design: "<path>", which parse accepts with just the warning loom.design-pack-custom-unchecked, deployable.ts:498); the error message is descriptive. This is a config error, not a codegen logic bug, but no loom.* diagnostic covers it.',
    mission: "M-T9.83",
    reviewUntil: "2027-01-31",
  },
  "src/generator/_packs/pack-chrome.ts#assertDeclaredChromeIsSane$3": {
    deferred:
      'A custom pack whose chrome message has an unbalanced brace. Reachable only with a user-supplied CUSTOM design pack (design: "<path>", which parse accepts with just the warning loom.design-pack-custom-unchecked, deployable.ts:498); the error message is descriptive. This is a config error, not a codegen logic bug, but no loom.* diagnostic covers it.',
    mission: "M-T9.83",
    reviewUntil: "2027-01-31",
  },
  "src/generator/_packs/pack-chrome.ts#bind": {
    deferred:
      'A custom heex pack (elixir LiveView) whose template passes an ICU hole value ({{chrome "rowActions" who="x"}}); this fires when the ui is translatable (heexI18nEnabled). Reachable only with a user-supplied CUSTOM design pack (design: "<path>", which parse accepts with just the warning loom.design-pack-custom-unchecked, deployable.ts:498); the error message is descriptive. This is a config error, not a codegen logic bug, but no loom.* diagnostic covers it.',
    mission: "M-T9.83",
    reviewUntil: "2027-01-31",
  },
  "src/generator/_packs/pack-chrome.ts#declared": {
    deferred:
      'A custom pack whose template uses {{chrome "boolTrue"}} with no chrome entry for it. Reachable only with a user-supplied CUSTOM design pack (design: "<path>", which parse accepts with just the warning loom.design-pack-custom-unchecked, deployable.ts:498); the error message is descriptive. This is a config error, not a codegen logic bug, but no loom.* diagnostic covers it.',
    mission: "M-T9.83",
    reviewUntil: "2027-01-31",
  },

  // src/generator/_packs/shell-emits.ts
  "src/generator/_packs/shell-emits.ts#emitShellFiles": {
    deferred:
      'A custom pack declaring shellFiles with a key that is not in emits. Reachable only with a user-supplied CUSTOM design pack (design: "<path>", which parse accepts with just the warning loom.design-pack-custom-unchecked, deployable.ts:498); the error message is descriptive. This is a config error, not a codegen logic bug, but no loom.* diagnostic covers it.',
    mission: "M-T9.83",
    reviewUntil: "2027-01-31",
  },

  // src/generator/_stmt/target.ts
  "src/generator/_stmt/target.ts#renderStmt": {
    guardedBy: ["loom.variant-match-placement"],
    note: "A match statement outside a frontend zone (action/page/component/store/ui) is rejected, and backend statement renderers never see frontend bodies.",
  },
  "src/generator/_stmt/target.ts#renderStmt$2": {
    invariant: "Exhaustive `never` default over StmtIR kinds. (src/generator/_stmt/target.ts:221)",
  },

  // src/generator/_type/target.ts
  "src/generator/_type/target.ts#renderTypeWith": {
    guardedBy: ["loom.slot-out-of-position", "loom.action-out-of-position"],
    note: "`slot`/`action` types are legal only on component params, and those are rendered only by the frontends; renderTypeWith callers are the backend type renderers (java/dotnet/python/typescript render-expr), with no frontend importers.",
  },

  // src/generator/_walker/i18n-chrome.ts
  "src/generator/_walker/i18n-chrome.ts#chromeMessage": {
    invariant:
      "Every chromeMessage/localizedChrome* call passes a hard-coded name from our own emitters, all present in CHROME_MESSAGES. (src/generator/_walker/i18n-chrome.ts:~60-91 (CHROME_MESSAGES))",
  },

  // src/generator/_walker/i18n-emit.ts
  "src/generator/_walker/i18n-emit.ts#icuParts": {
    invariant:
      "The hole values are supplied by our own emitter call sites against fixed catalog messages; this is a programmer-error precondition, not model-driven. (src/generator/_walker/i18n-emit.ts:722-729)",
  },

  // src/generator/_walker/js-expr-leaves.ts
  "src/generator/_walker/js-expr-leaves.ts#unreachedExprLeaf": {
    invariant:
      "A shim for the HEEx target, which forks emitExpr into its own renderExpr and never calls the shared dispatcher leaves. (src/generator/elixir/heex-walker-core.ts:701)",
  },

  // src/generator/_walker/primitives/display.ts
  "src/generator/_walker/primitives/display.ts#emitSlot": {
    invariant:
      "Every shared-walker target implements renderChildrenSlot or is React; HEEx dispatches Slot through its own def.heex (heex-walker-core.ts:1188). (svelte-target.ts:411, vue-target.ts:420, angular-target.ts:602, feliz-target.ts:913, flutter-target.ts:973 (react is in JSX_CHILDREN_PROP_FRAMEWORKS))",
  },

  // src/generator/_walker/walker-core.ts
  "src/generator/_walker/walker-core.ts#emitExpr": {
    invariant:
      "Every target that runs the shared walker implements renderStoreFieldRead and renderStoreActionCall; HEEx forks its own walker (heex-target.ts:230). (tsx-target.ts:474/481, vue-target.ts:541/549, svelte-target.ts:455/462, angular-target.ts:636/645, feliz-target.ts:330/333, flutter-target.ts:287/292)",
  },
  "src/generator/_walker/walker-core.ts#emitExpr$2": {
    invariant:
      "Every target that runs the shared walker implements renderStoreFieldRead and renderStoreActionCall; HEEx forks its own walker (heex-target.ts:230). (tsx-target.ts:474/481, vue-target.ts:541/549, svelte-target.ts:455/462, angular-target.ts:636/645, feliz-target.ts:330/333, flutter-target.ts:287/292)",
  },
  "src/generator/_walker/walker-core.ts#emitExpr$3": {
    invariant:
      "Every shared-walker target implements renderRouteId. (tsx-target.ts:398, vue-target.ts:393, svelte-target.ts:325, angular-target.ts:330, feliz-target.ts:381, flutter-target.ts:315)",
  },
  "src/generator/_walker/walker-core.ts#emitExpr$4": {
    deferred:
      "No validator rejects `this` in a page/component body: `Text { this.name }` in a ui page parses with 0 errors and crashes react/vue/svelte/angular generation.",
    mission: "M-T9.81",
    reviewUntil: "2027-01-31",
  },
  "src/generator/_walker/walker-core.ts#emitExpr$5": {
    invariant:
      "authz-filter is built only by enrichment into aggregate contextFilters/writeScopeFilter, which page/component bodies never contain. (src/ir/util/tenant-stance.ts:349/451; src/ir/enrich/enrichments.ts:588/682)",
  },
  "src/generator/_walker/walker-core.ts#emitExpr$6": {
    invariant:
      "Exhaustive `never` default over ExprIR kinds. (src/generator/_walker/walker-core.ts:2240)",
  },
  "src/generator/_walker/walker-core.ts#emitStmt": {
    invariant:
      "Every target that runs the shared walker implements renderStoreFieldRead and renderStoreActionCall; HEEx forks its own walker (heex-target.ts:230). (tsx-target.ts:474/481, vue-target.ts:541/549, svelte-target.ts:455/462, angular-target.ts:636/645, feliz-target.ts:330/333, flutter-target.ts:287/292)",
  },
  "src/generator/_walker/walker-core.ts#renderTextContent": {
    invariant:
      "Every target that runs the shared walker implements renderStoreFieldRead and renderStoreActionCall; HEEx forks its own walker (heex-target.ts:230). (tsx-target.ts:474/481, vue-target.ts:541/549, svelte-target.ts:455/462, angular-target.ts:636/645, feliz-target.ts:330/333, flutter-target.ts:287/292)",
  },
  "src/generator/_walker/walker-core.ts#unsupportedPageStmt": {
    deferred:
      "A page action that assigns (`:=` or `+=`) to a name that is not a declared state field parses with 0 errors. Example: `action bump() { other := 1 }`. Only if/precondition/requires are gated (loom.if-stmt-page-body-unsupported / loom.ui-body-statement-kind).",
    mission: "M-T9.81",
    reviewUntil: "2027-01-31",
  },
  "src/generator/_walker/walker-core.ts#walk": {
    invariant:
      "Every target that runs the shared walker implements renderStoreFieldRead and renderStoreActionCall; HEEx forks its own walker (heex-target.ts:230). (tsx-target.ts:474/481, vue-target.ts:541/549, svelte-target.ts:455/462, angular-target.ts:636/645, feliz-target.ts:330/333, flutter-target.ts:287/292)",
  },

  // src/generator/dotnet/adapters/by-feature-layout.ts
  "src/generator/dotnet/adapters/by-feature-layout.ts#need": {
    invariant:
      "Every artifact routed through the dotnet layout adapters is built with aggregateName set (per-aggregate place() and the cqrs emitForAggregate wrapper), so the missing-aggregateName branch is an internal-caller precondition. (src/generator/dotnet/index.ts:1387 (place() always sets aggregateName: agg.name) and index.ts:1777 + adapters/cqrs-style.ts:236-243 (cqrs artifacts always carry aggregateName); these are the only pathFor callers)",
  },
  "src/generator/dotnet/adapters/by-feature-layout.ts#pathFor": {
    invariant:
      "All artifacts reaching the dotnet layout adapter are tagged with a category by our own emit sites; a missing category is a programmer error. (src/generator/dotnet/index.ts:1382-1388 (place() takes a required DotnetArtifactCategory) and adapters/cqrs-style.ts:234-241 (categoriseCqrsPath tags every CQRS artifact); no other caller reaches the dotnet layout adapters)",
  },

  // src/generator/dotnet/adapters/by-layer-layout.ts
  "src/generator/dotnet/adapters/by-layer-layout.ts#pathFor": {
    invariant:
      "All artifacts reaching byLayer.pathFor are tagged with a category by our own emit sites (byFeature delegates only already-checked artifacts). (src/generator/dotnet/index.ts:1382-1388 (place() takes a required DotnetArtifactCategory) and adapters/cqrs-style.ts:234-241 (categoriseCqrsPath tags every CQRS artifact); no other caller reaches the dotnet layout adapters)",
  },
  "src/generator/dotnet/adapters/by-layer-layout.ts#pathForCategory": {
    invariant:
      "'entity' artifacts come only from place() in index.ts, which always sets aggregateName. (src/generator/dotnet/index.ts:1387 (place() always sets aggregateName: agg.name) and index.ts:1777 + adapters/cqrs-style.ts:236-243 (cqrs artifacts always carry aggregateName); these are the only pathFor callers)",
  },
  "src/generator/dotnet/adapters/by-layer-layout.ts#pathForCategory$2": {
    invariant:
      "'repository-interface' artifacts come only from place() in index.ts, which always sets aggregateName. (src/generator/dotnet/index.ts:1387 (place() always sets aggregateName: agg.name) and index.ts:1777 + adapters/cqrs-style.ts:236-243 (cqrs artifacts always carry aggregateName); these are the only pathFor callers)",
  },
  "src/generator/dotnet/adapters/by-layer-layout.ts#pathForCategory$3": {
    invariant:
      "'request-dto' artifacts come only from cqrsStyleAdapter.emitForAggregate, which always sets aggregateName. (src/generator/dotnet/index.ts:1387 (place() always sets aggregateName: agg.name) and index.ts:1777 + adapters/cqrs-style.ts:236-243 (cqrs artifacts always carry aggregateName); these are the only pathFor callers)",
  },
  "src/generator/dotnet/adapters/by-layer-layout.ts#pathForCategory$4": {
    invariant:
      "'response-dto' artifacts come only from cqrsStyleAdapter.emitForAggregate, which always sets aggregateName. (src/generator/dotnet/index.ts:1387 (place() always sets aggregateName: agg.name) and index.ts:1777 + adapters/cqrs-style.ts:236-243 (cqrs artifacts always carry aggregateName); these are the only pathFor callers)",
  },
  "src/generator/dotnet/adapters/by-layer-layout.ts#pathForCategory$5": {
    invariant:
      "command/handler/validator artifacts come only from cqrsStyleAdapter (emitForAggregate / emitHandlerOrService), which always set aggregateName. (src/generator/dotnet/index.ts:1387 (place() always sets aggregateName: agg.name) and index.ts:1777 + adapters/cqrs-style.ts:236-243 (cqrs artifacts always carry aggregateName); these are the only pathFor callers)",
  },
  "src/generator/dotnet/adapters/by-layer-layout.ts#pathForCategory$6": {
    invariant:
      "query/query-handler artifacts come only from cqrsStyleAdapter, which always sets aggregateName. (src/generator/dotnet/index.ts:1387 (place() always sets aggregateName: agg.name) and index.ts:1777 + adapters/cqrs-style.ts:236-243 (cqrs artifacts always carry aggregateName); these are the only pathFor callers)",
  },
  "src/generator/dotnet/adapters/by-layer-layout.ts#pathForCategory$7": {
    invariant:
      "extern-handler artifacts would only come from cqrsStyleAdapter, which always sets aggregateName (emitCqrs in fact never writes a Handlers/ path, see cqrs/*.ts out.set paths). (src/generator/dotnet/index.ts:1387 (place() always sets aggregateName: agg.name) and index.ts:1777 + adapters/cqrs-style.ts:236-243 (cqrs artifacts always carry aggregateName); these are the only pathFor callers)",
  },
  "src/generator/dotnet/adapters/by-layer-layout.ts#pathForCategory$8": {
    invariant:
      "No emit site ever routes a 'test-csproj' category through the layout adapter; test projects are written at fixed paths. (src/generator/dotnet/index.ts:2124 (test csproj written directly via out.set, never through layout.pathFor))",
  },
  "src/generator/dotnet/adapters/by-layer-layout.ts#pathForCategory$9": {
    invariant:
      "No emit site ever routes a 'test-class' category through the layout adapter. (src/generator/dotnet/index.ts:480-491,1786 (test classes written directly via out.set, never through layout.pathFor))",
  },

  // src/generator/dotnet/adapters/cqrs-style.ts
  "src/generator/dotnet/adapters/cqrs-style.ts#categoriseCqrsPath": {
    invariant:
      "emitCqrs / emitOperationCommandAndHandler only ever write Application/*/{Commands,Queries,Requests,Responses}/ or Api/ paths, all of which classify. (src/generator/dotnet/cqrs/{commands,queries,dtos,controller}.ts out.set paths (all Application/<Agg>/{Commands,Queries,Requests,Responses}/... or Api/...))",
  },
  "src/generator/dotnet/adapters/cqrs-style.ts#emitEndpoint": {
    invariant:
      "emitEndpoint is a StyleAdapter shim method the dotnet engine never invokes. (grep: no caller of styleAdapter.emitEndpoint in src (index.ts:1775 only calls emitForAggregate))",
  },
  "src/generator/dotnet/adapters/cqrs-style.ts#hostOf": {
    invariant:
      "hostOf is only used by the per-operation adapter methods emitEndpoint/emitHandlerOrService, which the engine never calls. (grep: no caller of styleAdapter.emitEndpoint/emitHandlerOrService anywhere in src (only index.ts:1775 calls emitForAggregate))",
  },

  // src/generator/dotnet/dto-mapping.ts
  "src/generator/dotnet/dto-mapping.ts#domainToRequestExpr": {
    invariant:
      "Dead helper (no external callers), and even if called it would only receive declared domain types, which never carry the response-only provenanced carrier. (grep: domainToRequestExpr has no callers outside its own recursion in dto-mapping.ts)",
  },
  "src/generator/dotnet/dto-mapping.ts#wireToCommandArgument": {
    invariant:
      "A genericInstance 'provenanced' TypeIR is only synthesized on response-side wire fields and cannot be written by users, while wireToCommandArgument is only fed declared param/field types. (src/ir/enrich/wire-projection.ts:434 (the provenanced carrier is only built by wireTypeForField for response/read wire fields); src/ir/stdlib/generics.ts:86-90 (no grammar arm for Provenanced<T>); callers cqrs/controller.ts:81,267,348 + workflow-emit.ts:2215 pass declared param/field types)",
  },

  // src/generator/dotnet/emit/channels.ts
  "src/generator/dotnet/emit/channels.ts#renderDotnetChannels": {
    invariant:
      "renderDotnetChannels runs only with at least one binding and every binding's transport is one of the three wired drivers. (src/generator/dotnet/index.ts:370,604 (called only when channelBindings.length > 0) + src/generator/_channels/bindings.ts:22,74 (BrokerTransport is exactly redis|rabbitmq|kafka))",
  },

  // src/generator/dotnet/emit/dapper.ts
  "src/generator/dotnet/emit/dapper.ts#arrayElemCs": {
    invariant:
      "Array element types of stored fields are limited by grammar+linker to primitive/enum/valueobject/id (part arrays become containments), exactly the handled set. (src/language/ddd-linker.ts:90-113 + src/language/containment.ts:19-26 (part[] fields lower to containments); grammar TypeRef (ddd.langium:2146) has no nested array/optional element)",
  },
  "src/generator/dotnet/emit/dapper.ts#authzFilterToSql": {
    invariant:
      "Exhaustive switch over the closed authz-filter union (deny | scope); the default is a compile-time never. (src/generator/dotnet/emit/dapper.ts:901-903 (`const _exhaustive: never`))",
  },
  "src/generator/dotnet/emit/dapper.ts#fieldColumn": {
    invariant:
      "Stored field types can only be primitive/enum/valueobject/id/array after linking + lowering (entity-part types become containments, carriers/unions/cross-aggregate entities are rejected), all of which fieldColumn handles; probes with events, payloads, unions, carriers, aggregate and part types all failed parse or generated fine. (src/language/ddd-linker.ts:90-113 (field type scope: primitives/enum/valueobject/aggregate/part only); src/language/containment.ts:19-26 (part-typed fields become containments, never columns); loom.generic-position (language/validators/generics.ts:89), loom.union-position (validators/unions.ts:58), loom.cross-aggregate-entity-part (validators/structural.ts:191))",
  },
  "src/generator/dotnet/emit/dapper.ts#renderDapperRepository": {
    invariant:
      "A capability filter outside the Dapper SQL subset. Every shape the target-neutral predicate oracle admits renders here: test/system/predicate-position-census.test.ts measures each position × adapter × shape and fails on a crash.",
  },
  "src/generator/dotnet/emit/dapper.ts#renderDapperRepository$2": {
    invariant:
      "writeScopeFilter is only synthesized by enrichment as a scope/deny authz-filter sentinel or `this.tenantId == currentUser.<claim>`, all of which whereToSql renders. (src/ir/enrich/enrichments.ts:680-684,759 + src/ir/util/tenant-stance.ts:369-455 (writeScopeFilter is only ever buildDeepScopeFilter / buildTenantFloorFilter / buildDenyFilter))",
  },

  // src/generator/dotnet/emit/integration-tests.ts
  "src/generator/dotnet/emit/integration-tests.ts#renderStmt": {
    guardedBy: [
      "loom.expect-requires-matcher",
      "loom.locator-matcher-receiver",
      "loom.matcher-e2e-only",
      "loom.unit-absent-invalid",
    ],
    note: "Every non-e2e `expect` must end in an intrinsic matcher; the value matchers missing from the C# VERBS table (toBeSameInstant, toBeAbsent) and all locator matchers are refused outside `test e2e`, so renderExplicitMatcherToAwesome always returns a line here.",
  },
  "src/generator/dotnet/emit/integration-tests.ts#renderStmt$2": {
    guardedBy: ["loom.test-statement-invalid", "loom.aggregate-test-context"],
    note: "A context integration test statement outside let/expression/expect/expect-throws — refused since #3133 (the test-tier statement vocabulary).",
  },

  // src/generator/dotnet/emit/tests.ts
  "src/generator/dotnet/emit/tests.ts#renderTestStmt": {
    guardedBy: [
      "loom.expect-requires-matcher",
      "loom.locator-matcher-receiver",
      "loom.matcher-e2e-only",
      "loom.unit-absent-invalid",
    ],
    note: "Bare-boolean expects, locator matchers (no page-row local outside test e2e), toBeSameInstant and toBeAbsent are all refused in unit tests, leaving only matchers present in the C# VERBS table.",
  },
  "src/generator/dotnet/emit/tests.ts#renderTestStmt$2": {
    guardedBy: ["loom.test-statement-invalid", "loom.aggregate-test-context"],
    note: "A unit-test statement outside let/expression/call/expect/expect-throws — refused since #3133 (the test-tier statement vocabulary).",
  },

  // src/generator/dotnet/explicit-handlers-emit.ts
  "src/generator/dotnet/explicit-handlers-emit.ts#pagedRunStmt": {
    guardedBy: ["loom.paged-query-handler-shape"],
    note: "A paged queryHandler body other than `let r = Repo.run(<Criterion>(args)); return r` — refused in phase ⑦ since #3084; the emitter reads the same shared `pagedRunStmt` predicate the check enforces.",
  },

  // src/generator/dotnet/projection-emit.ts
  "src/generator/dotnet/projection-emit.ts#renderProjectionFoldStmt": {
    guardedBy: ["loom.projection-fold-impure"],
    note: "foldImpurity rejects every fold statement kind except assign/add/remove/let, which is exactly the set listed in the throw's case arms.",
  },

  // src/generator/dotnet/query-projection-emit.ts
  "src/generator/dotnet/query-projection-emit.ts#dapperAggregationWhere": {
    invariant:
      "An aggregation projection `where` outside the Dapper SQL subset. Every shape the target-neutral predicate oracle admits renders here: test/system/predicate-position-census.test.ts measures each position × adapter × shape and fails on a crash.",
  },
  "src/generator/dotnet/query-projection-emit.ts#groupCol": {
    guardedBy: [
      "loom.projection-groupby-key-not-columnar",
      "loom.projection-groupby-select-not-grouped",
    ],
    note: "groupCol runs on group-by keys and grouped key selects, both validated to satisfy groupKeyOf.",
  },
  "src/generator/dotnet/query-projection-emit.ts#groupCol$2": {
    invariant:
      "The only transform (startOfDay) has a C# intrinsic renderer. (src/ir/util/projection-aggregate.ts:111,135 + src/generator/dotnet/render-expr.ts:898 (datetime.startOfDay C# renderer))",
  },
  "src/generator/dotnet/query-projection-emit.ts#renderProjectionSourceHandler": {
    invariant:
      "sourceKind 'projection' is only set when the `from` reference resolved to a projection in the same context. (src/ir/lower/lower-projection.ts:150-217 + context-scoped ProjectionSource linking (verified: cross-context `from OrderBoard` is a linker error))",
  },
  "src/generator/dotnet/query-projection-emit.ts#renderWorkflowHandler": {
    invariant:
      "sourceKind 'workflow' is only set when the `from` reference resolved to a workflow in the same context, so ctx.workflows always contains it. (src/ir/lower/lower-projection.ts:150-217 (sourceKind set only when the `from` cross-reference resolves to a workflow); linker scopes ProjectionSource to the enclosing context (cross-context `from` fails with 'Could not resolve reference to ProjectionSource'))",
  },
  "src/generator/dotnet/query-projection-emit.ts#sqlGroupKeyAlias": {
    guardedBy: [
      "loom.projection-groupby-key-not-columnar",
      "loom.projection-groupby-select-not-grouped",
    ],
    note: "sqlGroupKeyAlias is called on grouped key selects / group-by exprs, all of which the validator pins to groupKeyOf != null.",
  },
  "src/generator/dotnet/query-projection-emit.ts#sqlGroupKeyExpr": {
    guardedBy: [
      "loom.projection-groupby-key-not-columnar",
      "loom.projection-groupby-select-not-grouped",
    ],
    note: "Every group-by expression and every per-row select of a grouped projection must satisfy groupKeyOf (the same function the emitter calls), else these errors fire.",
  },
  "src/generator/dotnet/query-projection-emit.ts#sqlGroupKeyExpr$2": {
    invariant:
      "The only grouping-key transform is startOfDay and PG_INTRINSIC_SQL has its snippet. (src/ir/util/projection-aggregate.ts:111,135 (GroupKeyTransform is the closed union 'startOfDay') + src/generator/_expr/pg-intrinsics.ts:55 (datetime.startOfDay snippet exists))",
  },

  // src/generator/dotnet/render-expr.ts
  "src/generator/dotnet/render-expr.ts#renderCall": {
    deferred:
      "A resource-op inside a workflow `function` body (`function peek(k: string): string = salesFiles.get(k)`) is admitted (it is inside a workflow) but the <Wf>Functions class is rendered without resourceClasses, so renderCall throws.",
    mission: "M-T9.80",
    reviewUntil: "2027-01-31",
  },
  "src/generator/dotnet/render-expr.ts#renderCsAuthzFilter": {
    invariant:
      "Exhaustive switch over the closed authz-filter union; the default is a compile-time never. (src/generator/dotnet/render-expr.ts:488-490 (`const _exhaustive: never`))",
  },

  // src/generator/dotnet/workflow-eventsourced-emit.ts
  "src/generator/dotnet/workflow-eventsourced-emit.ts#esCorrIdClass": {
    deferred:
      "An `eventSourced` workflow with only a command-triggered create (no `on`/event-create) and no id-typed state field has no correlation field and no diagnostic, yet the ES emitter unconditionally requires an id-typed correlation field.",
    mission: "M-T9.78",
    reviewUntil: "2027-01-31",
  },

  // src/generator/elixir/adapters/by-feature-layout.ts
  "src/generator/elixir/adapters/by-feature-layout.ts#pathFor": {
    invariant:
      "The elixir byFeature layout adapter's pathFor is never invoked: the platform's emitProject drops the layout axis ('the layout axis has no Phoenix consumer') and no elixir emitter calls layout.pathFor, so no artifact ever reaches pathForCategory. (src/platform/elixir.ts:63-74 (emitProject never forwards layoutAdapter to generateElixirProject); no src/generator/elixir code calls pathFor)",
  },
  "src/generator/elixir/adapters/by-feature-layout.ts#pathForCategory": {
    invariant:
      "The elixir byFeature layout adapter's pathFor is never invoked: the platform's emitProject drops the layout axis ('the layout axis has no Phoenix consumer') and no elixir emitter calls layout.pathFor, so no artifact ever reaches pathForCategory. (src/platform/elixir.ts:63-74 (emitProject never forwards layoutAdapter to generateElixirProject); no src/generator/elixir code calls pathFor)",
  },
  "src/generator/elixir/adapters/by-feature-layout.ts#pathForCategory$2": {
    invariant:
      "The elixir byFeature layout adapter's pathFor is never invoked: the platform's emitProject drops the layout axis ('the layout axis has no Phoenix consumer') and no elixir emitter calls layout.pathFor, so no artifact ever reaches pathForCategory. (src/platform/elixir.ts:63-74 (emitProject never forwards layoutAdapter to generateElixirProject); no src/generator/elixir code calls pathFor)",
  },
  "src/generator/elixir/adapters/by-feature-layout.ts#pathForCategory$3": {
    invariant:
      "The elixir byFeature layout adapter's pathFor is never invoked: the platform's emitProject drops the layout axis ('the layout axis has no Phoenix consumer') and no elixir emitter calls layout.pathFor, so no artifact ever reaches pathForCategory. (src/platform/elixir.ts:63-74 (emitProject never forwards layoutAdapter to generateElixirProject); no src/generator/elixir code calls pathFor)",
  },
  "src/generator/elixir/adapters/by-feature-layout.ts#pathForCategory$4": {
    invariant:
      "The elixir byFeature layout adapter's pathFor is never invoked: the platform's emitProject drops the layout axis ('the layout axis has no Phoenix consumer') and no elixir emitter calls layout.pathFor, so no artifact ever reaches pathForCategory. (src/platform/elixir.ts:63-74 (emitProject never forwards layoutAdapter to generateElixirProject); no src/generator/elixir code calls pathFor)",
  },
  "src/generator/elixir/adapters/by-feature-layout.ts#pathForCategory$5": {
    invariant:
      "The elixir byFeature layout adapter's pathFor is never invoked: the platform's emitProject drops the layout axis ('the layout axis has no Phoenix consumer') and no elixir emitter calls layout.pathFor, so no artifact ever reaches pathForCategory. (src/platform/elixir.ts:63-74 (emitProject never forwards layoutAdapter to generateElixirProject); no src/generator/elixir code calls pathFor)",
  },
  "src/generator/elixir/adapters/by-feature-layout.ts#pathForCategory$6": {
    invariant:
      "The elixir byFeature layout adapter's pathFor is never invoked: the platform's emitProject drops the layout axis ('the layout axis has no Phoenix consumer') and no elixir emitter calls layout.pathFor, so no artifact ever reaches pathForCategory. (src/platform/elixir.ts:63-74 (emitProject never forwards layoutAdapter to generateElixirProject); no src/generator/elixir code calls pathFor)",
  },

  // src/generator/elixir/dispatch-emit.ts
  "src/generator/elixir/dispatch-emit.ts#renderProjectionFoldStmt": {
    guardedBy: ["loom.projection-fold-impure"],
    note: "foldImpurity is a fail-closed allowlist of assign/add/remove/let applied to every projection on() statement, so every kind in this throw arm is an error at validation.",
  },
  "src/generator/elixir/dispatch-emit.ts#renderStmt": {
    deferred:
      "A workflow on(e) reactor body containing `Orders.delete(o)` lowers to a repo-delete WorkflowStmtIR, which the elixir reactor renderer has no arm for; no validator refuses it (likely also if-let/resource-call/domain-service-call in reactor bodies).",
    mission: "M-T9.79",
    reviewUntil: "2027-01-31",
  },

  // src/generator/elixir/domain-service-emit.ts
  "src/generator/elixir/domain-service-emit.ts#renderOperation": {
    invariant:
      "A read-port can only name a repository of the service's own context because lowerDomainService builds serviceRepos from its own context, so readingIsSingleContext is always true (cross-context reads lower to an unresolved ref refused by loom.domain-service-cross-context-read). (src/ir/lower/lower-domain-service.ts:29-33 (serviceRepos built from env.ctx.members only))",
  },
  "src/generator/elixir/domain-service-emit.ts#renderOperation$2": {
    guardedBy: ["loom.elixir-if-stmt-unsupported"],
    note: "The gate runs the identical elixirIfRefusal(op.body,'value') predicate on every domain-service operation of a context hosted by an elixir deployable.",
  },

  // src/generator/elixir/heex-target.ts
  "src/generator/elixir/heex-target.ts#buildHookUse": {
    invariant:
      "heexTarget is never handed to the shared _walker engine; the HEEx walker calls only a handful of its methods directly and never buildHookUse, so this shim is dead. (src/generator/elixir/heex-walker-core.ts:74 (heexTarget imported only here; only renderStateRead/renderStateWrite/renderMatch/renderApiCall/renderNavigate are invoked, at :873,:1466,:1620,:2178,:2222))",
  },
  "src/generator/elixir/heex-target.ts#renderConditionalChild": {
    invariant:
      "heexTarget is never handed to the shared _walker engine; the HEEx walker calls only a handful of its methods directly and never renderConditionalChild, so this shim is dead. (src/generator/elixir/heex-walker-core.ts:74 (heexTarget imported only here; only renderStateRead/renderStateWrite/renderMatch/renderApiCall/renderNavigate are invoked, at :873,:1466,:1620,:2178,:2222))",
  },
  "src/generator/elixir/heex-target.ts#renderForEach": {
    invariant:
      "heexTarget is never handed to the shared _walker engine; the HEEx walker calls only a handful of its methods directly and never renderForEach, so this shim is dead. (src/generator/elixir/heex-walker-core.ts:74 (heexTarget imported only here; only renderStateRead/renderStateWrite/renderMatch/renderApiCall/renderNavigate are invoked, at :873,:1466,:1620,:2178,:2222))",
  },
  "src/generator/elixir/heex-target.ts#renderNestedStateWrite": {
    invariant:
      "heexTarget is never handed to the shared _walker engine; the HEEx walker calls only a handful of its methods directly and never renderNestedStateWrite, so this shim is dead. (src/generator/elixir/heex-walker-core.ts:74 (heexTarget imported only here; only renderStateRead/renderStateWrite/renderMatch/renderApiCall/renderNavigate are invoked, at :873,:1466,:1620,:2178,:2222))",
  },

  // src/generator/elixir/heex-walker-core.ts
  "src/generator/elixir/heex-walker-core.ts#renderExpr": {
    invariant:
      "authz-filter sentinels are built only by tenancy/deny enrichment into aggregate query-filter positions, never into a UI page body expression. (src/ir/util/tenant-stance.ts:349,:451 (only producers of authz-filter, used for aggregate contextFilters/writeScopeFilter in enrichment))",
  },
  "src/generator/elixir/heex-walker-core.ts#renderStmt": {
    guardedBy: ["loom.if-stmt-page-body-unsupported"],
    note: "Any `if` statement in any ui page/component/store action or inline handler is an error on every frontend.",
  },
  "src/generator/elixir/heex-walker-core.ts#renderVariantMatchStmt": {
    guardedBy: ["loom.async-effect-subject-unsupported", "loom.effect-in-lambda"],
    note: "Every page/component action variant-match whose subject is not an aggregate-op method call is refused, and that accepted shape always satisfies detectAwaitedOp; inline-lambda placement is refused by loom.effect-in-lambda (verified).",
  },
  "src/generator/elixir/heex-walker-core.ts#renderVariantMatchStmt$2": {
    deferred:
      "A bare `match await Invoice.confirm()` on a LiveView page naming an aggregate from a context the elixir deployable does not host passes the system-wide async-effect check, but the HEEx emitter only knows served aggregates.",
    mission: "M-T9.82",
    reviewUntil: "2027-01-31",
  },

  // src/generator/elixir/liveview-emit.ts
  "src/generator/elixir/liveview-emit.ts#assertSingleInstancePerStatefulComponent": {
    guardedBy: ["loom.heex-stateful-component-reused"],
    note: "The validator computes the same transitive per-page instance count of state-declaring components on every phoenixLiveView-mounted ui.",
  },
  "src/generator/elixir/liveview-emit.ts#gatherComponentHandlers": {
    deferred:
      "A page using `onClick: Cart.clear` synthesizes a `clear` handle_event clause that collides with a stateful component's own `action clear()`; the validator never sees store-action-ref handlers.",
    mission: "M-T9.82",
    reviewUntil: "2027-01-31",
  },

  // src/generator/elixir/realtime-liveview.ts
  "src/generator/elixir/realtime-liveview.ts#go": {
    guardedBy: ["loom.toast-message-unsupported"],
    note: "A toast ref other than the event binding is refused by the target-agnostic toast-subset gate.",
  },
  "src/generator/elixir/realtime-liveview.ts#go$2": {
    guardedBy: ["loom.toast-message-unsupported"],
    note: "A member chain not rooted at the event binding is refused by the toast-subset gate (toastMemberPath accepts exactly the chains it admits).",
  },
  "src/generator/elixir/realtime-liveview.ts#go$3": {
    guardedBy: ["loom.toast-message-unsupported"],
    note: "Every ExprIR kind outside literal/ref/member/paren/binary is refused by name in the toast-subset gate.",
  },

  // src/generator/elixir/render-expr.ts
  "src/generator/elixir/render-expr.ts#renderCall": {
    deferred:
      'A raw verb (`orders.get("/orders")`) on a `kind: api` resource bound to an in-system api (no storage) lowers to a resource-op, but buildPhoenixResourceModules only maps storage-backed resources, and nothing rejects it.',
    mission: "M-T9.80",
    reviewUntil: "2027-01-31",
  },
  "src/generator/elixir/render-expr.ts#renderDecimalBinary": {
    guardedBy: ["loom.operator-non-bool-operands"],
    note: "Only &&/|| reach the throw, and the language type checker rejects them on non-bool (money/decimal) operands (verified: `x && y` on decimals -> error).",
  },
  "src/generator/elixir/render-expr.ts#renderExpr": {
    invariant:
      "Exhaustive-switch `never` default over the authz-filter decision kinds. (src/generator/elixir/render-expr.ts:319 (`never` default over the closed authz-filter `filter.kind` union in src/ir/types/loom-ir.ts:3853))",
  },
  "src/generator/elixir/render-expr.ts#renderTypespec": {
    guardedBy: ["loom.slot-out-of-position", "loom.action-out-of-position"],
    note: "`slot` and `action` types are only legal on a component's parameter list, so they never reach a backend typespec.",
  },

  // src/generator/elixir/vanilla/eventsourced-emit.ts
  "src/generator/elixir/vanilla/eventsourced-emit.ts#renderCommandRunner": {
    deferred:
      "An `if` inside an event-sourced aggregate's `create` body is never checked by the elixir if-gate, yet the create is rendered through the ES command runner.",
    mission: "M-T9.79",
    reviewUntil: "2027-01-31",
  },

  // src/generator/elixir/vanilla/explicit-handlers-emit.ts
  "src/generator/elixir/vanilla/explicit-handlers-emit.ts#pagedRunStmt": {
    guardedBy: ["loom.paged-query-handler-shape"],
    note: "A paged queryHandler body other than `let r = Repo.run(<Criterion>(args)); return r` — refused in phase ⑦ since #3084; the emitter reads the same shared `pagedRunStmt` predicate the check enforces.",
  },

  // src/generator/elixir/vanilla/fold-stmt-emit.ts
  "src/generator/elixir/vanilla/fold-stmt-emit.ts#renderFoldNewMap": {
    deferred:
      "An eventSourced workflow `apply` that constructs a contained entity part of an aggregate in the same context (`let l = Line { sku: a.sku }`) validates clean, but the workflow fold has no part resolver.",
    mission: "M-T9.79",
    reviewUntil: "2027-01-31",
  },
  "src/generator/elixir/vanilla/fold-stmt-emit.ts#renderFoldStatement": {
    deferred:
      "A `return` in an event-sourced aggregate `apply` body passes both applier-discipline validators but the elixir fold renderer has no `return` arm (an `if` in an eventSourced WORKFLOW apply is likely also unguarded).",
    mission: "M-T9.79",
    reviewUntil: "2027-01-31",
  },

  // src/generator/elixir/vanilla/function-emit.ts
  "src/generator/elixir/vanilla/function-emit.ts#renderFunctionBodyLines": {
    deferred:
      "A workflow `function` with a non-tail `return` inside an `if` is never checked by the elixir if-gate but is rendered through renderFunctionBodyLines.",
    mission: "M-T9.79",
    reviewUntil: "2027-01-31",
  },

  // src/generator/elixir/vanilla/integration-tests-emit.ts
  "src/generator/elixir/vanilla/integration-tests-emit.ts#renderStmt": {
    guardedBy: ["loom.test-statement-invalid", "loom.aggregate-test-context"],
    note: "A context integration test statement outside let/expression/expect/expect-throws — refused since #3133 (the test-tier statement vocabulary).",
  },

  // src/generator/elixir/vanilla/operation-returns-emit.ts
  "src/generator/elixir/vanilla/operation-returns-emit.ts#renderReturningStmt": {
    guardedBy: ["loom.variant-match-placement"],
    note: "The effect form of `match` is refused everywhere outside the frontend zone, so a variant-match never reaches a backend statement renderer.",
  },
  "src/generator/elixir/vanilla/operation-returns-emit.ts#renderReturningStmt$2": {
    guardedBy: ["loom.elixir-if-stmt-unsupported"],
    note: "The gate runs the identical elixirIfRefusal predicate (or the stricter event-sourced one) over every aggregate operation in an elixir-hosted context; relational create/destroy bodies are not rendered (loom.lifecycle-body-dropped).",
  },

  // src/generator/elixir/vanilla/projections-emit.ts
  "src/generator/elixir/vanilla/projections-emit.ts#renderProjectionRowSchema": {
    invariant:
      "Projection state-field types that resolve are always primitive/enum/VO/id (union/generic/entity are refused by type-position validators and events/payloads don't resolve), all of which mapTypeToEcto maps. (src/language/ddd-linker.ts:110 (projection field types resolve only to primitive/enum/valueobject/id); src/generator/elixir/vanilla/schema-emit.ts:470-550 maps all of those (+array/optional))",
  },

  // src/generator/elixir/vanilla/query-projections-emit.ts
  "src/generator/elixir/vanilla/query-projections-emit.ts#ectoAggregate": {
    guardedBy: ["loom.projection-aggregate-arg-not-columnar"],
    note: "Any non-count aggregate whose argument is not a `member` is rejected for every query projection select.",
  },
  "src/generator/elixir/vanilla/query-projections-emit.ts#keyExpr": {
    guardedBy: ["loom.projection-groupby-key-not-columnar"],
    note: "Every grouping key for which groupKeyOf returns null is rejected; per-row selects must match a key (projection-groupby-select-not-grouped).",
  },
  "src/generator/elixir/vanilla/query-projections-emit.ts#keyExpr$2": {
    invariant:
      "The only grouping-key transform maps to an intrinsic that the Ecto fragment table defines. (src/ir/util/projection-aggregate.ts:135-137 (GroupKeyTransform has the single member startOfDay) and src/generator/elixir/render-expr.ts:747 (ECTO_INTRINSIC_FRAGMENTS has datetime.startOfDay))",
  },

  // src/generator/elixir/vanilla/tests-emit.ts
  "src/generator/elixir/vanilla/tests-emit.ts#renderCreate": {
    invariant:
      "renderCreate is only called after isCreate(e), which requires kind 'method-call'. (src/generator/elixir/vanilla/tests-emit.ts:591-606 (isCreate/isAggOp) and call sites :230,:243,:343,:346,:446-447)",
  },
  "src/generator/elixir/vanilla/tests-emit.ts#renderOp": {
    invariant:
      "renderOp is only called after isAggOp(e), which requires kind 'method-call'. (src/generator/elixir/vanilla/tests-emit.ts:591-606 (isCreate/isAggOp) and call sites :230,:243,:343,:346,:446-447)",
  },
  "src/generator/elixir/vanilla/tests-emit.ts#renderOp$2": {
    invariant:
      "isAggOp requires findOp to resolve against env.agg, so an aggregate is in scope whenever renderOp runs. (src/generator/elixir/vanilla/tests-emit.ts:591-606 (isCreate/isAggOp) and call sites :230,:243,:343,:346,:446-447)",
  },
  "src/generator/elixir/vanilla/tests-emit.ts#renderOp$3": {
    invariant:
      "isAggOp requires findOp(e.member, env) !== undefined, the same lookup renderOp repeats. (src/generator/elixir/vanilla/tests-emit.ts:591-606 (isCreate/isAggOp) and call sites :230,:243,:343,:346,:446-447)",
  },

  // src/generator/elixir/vanilla/workflow-execution-emit.ts
  "src/generator/elixir/vanilla/workflow-execution-emit.ts#opCallParamFields": {
    guardedBy: ["loom.workflow-unknown-binding", "loom.workflow-unknown-operation"],
    note: "An op-call whose binding is not an own-context aggregate or whose op does not exist on it is an error (verified: an op-call on a foreign-context factory-let -> loom.workflow-unknown-binding).",
  },
  "src/generator/elixir/vanilla/workflow-execution-emit.ts#renderBranchStmt": {
    invariant:
      "The flat branch renderer is only used for branches containing none of the kinds this arm throws on. (src/generator/elixir/vanilla/workflow-execution-emit.ts:677-680 (needsWith routes any branch holding precondition/requires/NESTED_FLOW_KINDS to the with-chain path, which handles those kinds itself at :688-715); NESTED_FLOW_KINDS at :888)",
  },
  "src/generator/elixir/vanilla/workflow-execution-emit.ts#renderBranchStmt$2": {
    invariant:
      "Exhaustive-switch `never` default over WorkflowStmtIR. (src/generator/elixir/vanilla/workflow-execution-emit.ts:1236-1239)",
  },

  // src/generator/feliz/auth-gate.ts
  "src/generator/feliz/auth-gate.ts#renderFelizGate": {
    guardedBy: ["loom.ui-gate-expr-unsupported", "loom.page-gate-not-client-evaluable"],
    note: "renderFelizGate is only called on page.requires (feliz/index.ts:479,736; opActionGate catches); pageGateProblem refuses any ref other than current-user/enum-value for every mounted feliz ui.",
  },
  "src/generator/feliz/auth-gate.ts#renderFelizGate$2": {
    guardedBy: ["loom.ui-gate-expr-unsupported", "loom.page-gate-not-client-evaluable"],
    note: "pageGateProblem refuses any method-call other than collection contains with exactly one arg, mirroring the renderer arm.",
  },
  "src/generator/feliz/auth-gate.ts#renderFelizGate$3": {
    guardedBy: ["loom.ui-gate-expr-unsupported", "loom.page-gate-not-client-evaluable"],
    note: "pageGateProblem's default arm refuses every expression kind the renderer's switch lacks.",
  },
  "src/generator/feliz/auth-gate.ts#renderGateLiteral": {
    guardedBy: ["loom.ui-gate-expr-unsupported"],
    note: "Only string/bool/int/long/decimal literals pass the closed-framework page-gate check; exactly the literals the F# renderer spells.",
  },

  // src/generator/feliz/fs-expr.ts
  "src/generator/feliz/fs-expr.ts#renderFsExpr": {
    guardedBy: ["loom.match-non-union-subject"],
    note: "A subject-form match in an action needs a union-typed subject; no union type resolves in ui scope (payloads/inline unions are refused there) and member/let unions infer as string, so every attempt is refused by loom.match-non-union-subject (tried find-return union, payload union field, extern fn).",
  },
  "src/generator/feliz/fs-expr.ts#renderFsExpr$2": {
    guardedBy: ["loom.match-empty"],
    note: "AST validator rejects a match with zero arms and no else.",
  },
  "src/generator/feliz/fs-expr.ts#renderFsExpr$3": {
    deferred:
      "An effect-free block-body lambda (only let statements) in a page action passes loom.effect-in-lambda and every other gate, then crashes.",
    mission: "M-T9.81",
    reviewUntil: "2027-01-31",
  },
  "src/generator/feliz/fs-expr.ts#renderFsExpr$4": {
    deferred:
      "'b := this.b' (kind 'this') or 'let f = say' (kind 'action-ref') in a page action parse with 0 errors and hit the default arm.",
    mission: "M-T9.81",
    reviewUntil: "2027-01-31",
  },
  "src/generator/feliz/fs-expr.ts#renderFsMethodCall": {
    deferred:
      "A page action using a collection/string method outside the small F# set (reverse, indexOf, concat, none, find, append, toString, format...) parses clean and crashes; no frontend method-vocabulary gate covers the feliz update path.",
    mission: "M-T9.81",
    reviewUntil: "2027-01-31",
  },

  // src/generator/feliz/index.ts
  "src/generator/feliz/index.ts#generateFelizForContexts": {
    guardedBy: ["loom.feliz-deployable-missing-ui"],
    note: "A platform: feliz deployable with no ui:/hosts binding is rejected; embedding hosts (elixir/dotnet/java/python) only call it under deployable.uiName.",
  },
  "src/generator/feliz/index.ts#generateFelizForContexts$2": {
    invariant:
      "uiName is read off a resolved Langium cross-reference (ui: / hosts: ref=[Ui:ID]); an unresolved name is a linking error, so the named ui always exists in sys.uis. (src/ir/lower/lower-deployment.ts:34-35)",
  },

  // src/generator/feliz/realtime.ts
  "src/generator/feliz/realtime.ts#renderFsToastMessage": {
    guardedBy: ["loom.toast-message-unsupported"],
    note: "toastMessageProblem refuses any ref other than the handler's event binding, for every ui (ui-checks.ts:341).",
  },
  "src/generator/feliz/realtime.ts#renderFsToastMessage$2": {
    guardedBy: ["loom.toast-message-unsupported"],
    note: "Member chains not rooted at the event binding are refused, matching toastMemberPath's condition.",
  },
  "src/generator/feliz/realtime.ts#renderFsToastMessage$3": {
    guardedBy: ["loom.toast-message-unsupported"],
    note: "Every kind outside literal/ref/member/paren/binary is refused by name.",
  },

  // src/generator/feliz/update-emit.ts
  "src/generator/feliz/update-emit.ts#renderUpdateStmt": {
    deferred:
      "toast(...) in a page action lowers as a private-operation call; loom.unresolved-action-ref exempts it as a view-effect builtin but feliz has only a navigate arm. Also: an unresolved call foo() inside a STORE action is not checked by unresolved-action-ref.",
    mission: "M-T9.81",
    reviewUntil: "2027-01-31",
  },
  "src/generator/feliz/update-emit.ts#renderUpdateStmt$2": {
    deferred:
      "A match await nested inside another match-await arm on a :id page (or any match await in a store action) is never projected and no gate refuses it (feliz-async-effect-unsupported only flags component hosts; stores are not scanned).",
    mission: "M-T9.81",
    reviewUntil: "2027-01-31",
  },
  "src/generator/feliz/update-emit.ts#renderUpdateStmt$3": {
    guardedBy: ["loom.ui-body-statement-kind", "loom.if-stmt-page-body-unsupported"],
    note: "return/precondition/requires (deep, incl. stores) and if are refused for non-LiveView frameworks; emit cannot resolve an event from ui scope (linking error).",
  },

  // src/generator/feliz/wire.ts
  "src/generator/feliz/wire.ts#assertNotDurationWireField": {
    invariant:
      "PrimitiveType has no 'duration' spelling and wire/param/state types are all declared TypeRefs, so no wire field can be duration-typed. (src/language/ddd.langium:2162)",
  },
  "src/generator/feliz/wire.ts#collectBodyReads": {
    guardedBy: ["loom.ui-read-unresolved", "loom.ui-api-operation-unknown"],
    note: "A QueryView read naming anything other than all/byId/history/a declared find is refused (tried create/delete/undeclared names).",
  },
  "src/generator/feliz/wire.ts#felizFindRead": {
    deferred:
      "A find returning a non-aggregate shape (string[], int) read in a feliz QueryView parses clean and crashes.",
    mission: "M-T9.81",
    reviewUntil: "2027-01-31",
  },
  "src/generator/feliz/wire.ts#felizFindRead$2": {
    deferred:
      "Find call arity is not checked: QueryView { of: C.Thing.byName() } (or bare C.Thing.byName, or 2 args) against a 1-param find parses with 0 errors.",
    mission: "M-T9.81",
    reviewUntil: "2027-01-31",
  },
  "src/generator/feliz/wire.ts#findParamQueryValue": {
    deferred:
      "A repository find with a list (or other non-scalar) parameter read in a feliz QueryView parses clean and crashes; no feliz find-shape gate.",
    mission: "M-T9.81",
    reviewUntil: "2027-01-31",
  },
  "src/generator/feliz/wire.ts#walk": {
    deferred:
      "A find read nested in a For/data lambda passing the row binding (C.Thing.byName(r.name)) is valid but the argument isn't a state cell/store field.",
    mission: "M-T9.81",
    reviewUntil: "2027-01-31",
  },

  // src/generator/flutter/auth-gate.ts
  "src/generator/flutter/auth-gate.ts#renderFlutterGate": {
    guardedBy: ["loom.ui-gate-expr-unsupported", "loom.page-gate-not-client-evaluable"],
    note: "Only call site is page.requires (flutter/index.ts:1180; opActionGate catches); non-currentUser/enum refs refused.",
  },
  "src/generator/flutter/auth-gate.ts#renderFlutterGate$2": {
    guardedBy: ["loom.ui-gate-expr-unsupported", "loom.page-gate-not-client-evaluable"],
    note: "Any method other than one-arg collection contains is refused.",
  },
  "src/generator/flutter/auth-gate.ts#renderFlutterGate$3": {
    guardedBy: ["loom.ui-gate-expr-unsupported", "loom.page-gate-not-client-evaluable"],
    note: "Default arm of pageGateProblem refuses every kind the renderer lacks.",
  },
  "src/generator/flutter/auth-gate.ts#renderGateLiteral": {
    guardedBy: ["loom.ui-gate-expr-unsupported"],
    note: "GATE_LITERAL_KINDS (string/bool/int/long/decimal) equals the Dart renderer's literal arms; null/money/now refused for flutter.",
  },

  // src/generator/flutter/realtime.ts
  "src/generator/flutter/realtime.ts#renderDartToastMessage": {
    guardedBy: ["loom.toast-message-unsupported"],
    note: "Same target-agnostic toast subset check as Feliz.",
  },
  "src/generator/flutter/realtime.ts#renderDartToastMessage$2": {
    guardedBy: ["loom.toast-message-unsupported"],
    note: "Member chains not rooted at the event binding refused.",
  },
  "src/generator/flutter/realtime.ts#renderDartToastMessage$3": {
    guardedBy: ["loom.toast-message-unsupported"],
    note: "Kinds outside the five-arm subset refused.",
  },

  // src/generator/flutter/riverpod-emit.ts
  "src/generator/flutter/riverpod-emit.ts#renderNotifierStmt": {
    deferred:
      "loom.unresolved-action-ref does not scan STORE action bodies, so a typo'd/unknown call foo() in a store action parses clean and crashes the flutter store notifier.",
    mission: "M-T9.81",
    reviewUntil: "2027-01-31",
  },
  "src/generator/flutter/riverpod-emit.ts#renderNotifierStmt$2": {
    deferred:
      "A match await nested inside a page match-await arm (or any match await in a store action) reaches the default arm; the page interceptor only handles top-level ones and no gate covers nested/store cases.",
    mission: "M-T9.81",
    reviewUntil: "2027-01-31",
  },
  "src/generator/flutter/riverpod-emit.ts#renderVariantMatchNotifier": {
    guardedBy: [
      "loom.flutter-action-body-unsupported",
      "loom.async-effect-subject-unsupported",
      "loom.ui-api-operation-unknown",
    ],
    note: "Only called for top-level page match awaits: non-aggregate subjects, standard ops (#match-await-standard-op), and undeclared/private ops are all refused (tested delete and a private op).",
  },

  // src/generator/java/adapters/by-layer-layout.ts
  "src/generator/java/adapters/by-layer-layout.ts#agg": {
    invariant:
      "Programmer-error precondition of an internal helper: every per-aggregate category is placed by our own emitter via place()/pkgFor with the aggregate name; no user input controls the argument. (src/generator/java/index.ts:322-341)",
  },
  "src/generator/java/adapters/by-layer-layout.ts#pathFor": {
    invariant:
      "place() always builds the artifact as { name, content, category, aggregateName } with a required JavaArtifactCategory, so pathFor never sees a category-less artifact. (src/generator/java/index.ts:327)",
  },

  // src/generator/java/emit/channels.ts
  "src/generator/java/emit/channels.ts#transportPickLine": {
    invariant:
      "renderJavaChannelFiles is only called when channelBindings.length > 0, and every BrokerBinding.transport is one of redis|rabbitmq|kafka, so at least one driver is always wired. (src/generator/java/index.ts:389,1319; src/generator/_channels/bindings.ts:22)",
  },

  // src/generator/java/emit/dispatch.ts
  "src/generator/java/emit/dispatch.ts#renderProjectionFoldStmt": {
    guardedBy: ["loom.projection-fold-impure"],
    note: "foldImpurity fails closed: every statement kind except assign/add/remove/let in a projection on() handler is an error, which is exactly the set this arm throws on.",
  },

  // src/generator/java/emit/integration-tests.ts
  "src/generator/java/emit/integration-tests.ts#renderStmt": {
    guardedBy: ["loom.test-statement-invalid", "loom.aggregate-test-context"],
    note: "A context integration test statement outside let/expression/expect/expect-throws — refused since #3133 (the test-tier statement vocabulary).",
  },

  // src/generator/java/emit/jpa-annotations.ts
  "src/generator/java/emit/jpa-annotations.ts#jpaFieldAnnotations": {
    deferred:
      "An optional reference collection `tags: Tag id[]?` on an aggregate (or any `X id[]` on an entity part, or on a projection/workflow state) gets no AssociationIR, but jpaFieldAnnotations unwraps optional and demands one.",
    mission: "M-T9.82",
    reviewUntil: "2027-01-31",
  },
  "src/generator/java/emit/jpa-annotations.ts#jpaFieldAnnotations$2": {
    deferred:
      "For aggregates/parts/bases valueCollectionsFor derives one entry per VO-array field (unwrapping optional), so the throw is unreachable there; but a projection (or saga) state field `tags: Tag[]` reaches this lookup with the stub owner {name, associations: []} and crashes one line earlier with 'TypeError: owner.fields is not iterable' (valid model, 0 errors) — repro g5-java-proj-voarray.ddd; fixing that TypeError would make this throw fire.",
    mission: "M-T9.82",
    reviewUntil: "2027-01-31",
  },

  // src/generator/java/emit/projection-reads.ts
  "src/generator/java/emit/projection-reads.ts#corrValueType": {
    guardedBy: ["loom.projection-key-not-id"],
    note: "Whenever the id-source wire row exists it is the `keyed by` field, which validateKey requires to be type kind 'id' (enrichments.ts:1268-1279 builds the row from that field).",
  },
  "src/generator/java/emit/projection-reads.ts#corrWire": {
    deferred:
      "A folded projection with no `keyed by` whose handlers all use `on(e: E) by e.x` passes validation (0 errors) and has no id-source wire field; today generation crashes earlier in src/system/migrations-builder.ts projectionTableShape (TypeError: Cannot read properties of undefined (reading 'replace')) so this throw is masked — repro g5-java-singleton-fold-by.ddd.",
    mission: "M-T9.82",
    reviewUntil: "2027-01-31",
  },
  "src/generator/java/emit/projection-reads.ts#guardProjectionField": {
    invariant:
      "Entity-part types only resolve inside their own aggregate, so a projection field can never be entity-typed (file comment and test/generator/java/generator-java-readmodel-gates.test.ts pin this). (src/language/ddd-scope.ts:45-61)",
  },

  // src/generator/java/emit/projection-state.ts
  "src/generator/java/emit/projection-state.ts#correlationField": {
    deferred:
      "Same singleton-with-`by` gap as corrWire: a folded projection without `keyed by` but with `on(...) by ...` validates clean, has correlationField undefined, and would throw here; currently masked by the earlier migrations-builder TypeError (repro g5-java-singleton-fold-by.ddd). Keyed projections are guarded by loom.projection-key-unknown (:607).",
    mission: "M-T9.82",
    reviewUntil: "2027-01-31",
  },
  "src/generator/java/emit/projection-state.ts#projectionCorrIdClass": {
    guardedBy: ["loom.projection-key-not-id"],
    note: "correlationField() returns the keyed-by state field, which validateKey rejects unless its type kind is 'id' (stricter than the throw, which also unwraps optional).",
  },

  // src/generator/java/emit/query-projection-reads.ts
  "src/generator/java/emit/query-projection-reads.ts#groupKeyCoerce": {
    deferred:
      "Grouping by a bare `json` column (`group by o.meta; select k = o.meta`) is shape-valid, but groupKeyCoerce has no arm for primitive 'json' (or 'File') and throws.",
    mission: "M-T9.82",
    reviewUntil: "2027-01-31",
  },
  "src/generator/java/emit/query-projection-reads.ts#keyCol": {
    guardedBy: [
      "loom.projection-groupby-key-not-columnar",
      "loom.projection-groupby-select-not-grouped",
    ],
    note: "keyCol runs groupKeyOf over group-by exprs and non-aggregate selects; the validator calls the same groupKeyOf on both and errors when it returns null.",
  },
  "src/generator/java/emit/query-projection-reads.ts#keyCol$2": {
    invariant:
      "The only GroupKeyTransform is startOfDay → 'datetime.startOfDay', which JPQL_INTRINSIC_SQL defines. (src/ir/util/projection-aggregate.ts:126-137; src/generator/java/render-jpql.ts:190)",
  },
  "src/generator/java/emit/query-projection-reads.ts#renderJavaQueryProjections": {
    invariant:
      "`from <Workflow>` is a linker cross-reference scoped to the projection's own context (a cross-context name fails to resolve: 'Could not resolve reference to ProjectionSource'), so the workflow is always in ctx.workflows. (src/language/ddd.langium:1630; src/language/ddd-scope.ts)",
  },
  "src/generator/java/emit/query-projection-reads.ts#renderJavaQueryProjections$2": {
    invariant:
      "`from <Projection>` resolves only within the same context (verified: cross-context source gives a linker error), so the source projection is always in ctx.projections. (src/language/ddd.langium:1630; src/language/ddd-scope.ts)",
  },

  // src/generator/java/emit/tests.ts
  "src/generator/java/emit/tests.ts#renderTestStmt": {
    guardedBy: ["loom.test-statement-invalid", "loom.aggregate-test-context"],
    note: "A unit-test statement outside let/expression/call/expect/expect-throws — refused since #3133 (the test-tier statement vocabulary).",
  },

  // src/generator/java/emit/workflow-eventsourced.ts
  "src/generator/java/emit/workflow-eventsourced.ts#esWorkflowCorrIdClass": {
    deferred:
      "An eventSourced workflow with only a command-triggered create and no id-typed state field validates clean, has no correlationField, and renderEsWorkflowFoldClass is still emitted for it.",
    mission: "M-T9.78",
    reviewUntil: "2027-01-31",
  },

  // src/generator/java/emit/workflow-instances.ts
  "src/generator/java/emit/workflow-instances.ts#guardInstanceField": {
    invariant:
      "Entity-part types never resolve in workflow scope, so a saga-state field cannot be entity-typed. (src/language/ddd-scope.ts:45-61)",
  },
  "src/generator/java/emit/workflow-instances.ts#idTargetName": {
    invariant:
      "The id-source instance wire row exists only when correlationField is set, and lowering sets correlationField only to the single state field whose type kind is 'id'. (src/ir/enrich/enrichments.ts:1229-1231,1316-1327; src/ir/lower/lower-workflow.ts:151-152)",
  },

  // src/generator/java/emit/workflow-state.ts
  "src/generator/java/emit/workflow-state.ts#corrIdClass": {
    invariant:
      "correlationField is always the unique state field whose type kind is 'id'. (src/ir/lower/lower-workflow.ts:151-152)",
  },
  "src/generator/java/emit/workflow-state.ts#correlationField": {
    invariant:
      "Only correlationWorkflows (correlationField set) reach this, and lowering derives correlationField from a member of stateFields. (src/generator/java/emit/workflow-state.ts:37-39; src/ir/lower/lower-workflow.ts:151-152)",
  },

  // src/generator/java/emit/workflow.ts
  "src/generator/java/emit/workflow.ts#factoryLet": {
    guardedBy: ["loom.workflow-create-unknown-aggregate"],
    note: "Every workflow factory-let naming an aggregate outside the context's aggregates is rejected by the IR validator.",
  },

  // src/generator/java/explicit-handlers-emit.ts
  "src/generator/java/explicit-handlers-emit.ts#pagedRunStmt": {
    guardedBy: ["loom.paged-query-handler-shape"],
    note: "A paged queryHandler body other than `let r = Repo.run(<Criterion>(args)); return r` — refused in phase ⑦ since #3084; the emitter reads the same shared `pagedRunStmt` predicate the check enforces.",
  },

  // src/generator/java/render-expr.ts
  "src/generator/java/render-expr.ts#renderCall": {
    deferred:
      'A resource op in a projection fold assign value (`blob := salesFiles.get("x")`) passes loom.projection-fold-impure (assign is allowed) and the resource-op gate, then hits the Java renderer with no resourceClasses.',
    mission: "M-T9.80",
    reviewUntil: "2027-01-31",
  },
  "src/generator/java/render-expr.ts#renderMoneyBinary": {
    guardedBy: ["loom.operator-non-bool-operands"],
    note: "Only &&/|| fall to the default, and both are rejected unless both operands are bool, so they can't have a money/decimal operand.",
  },
  "src/generator/java/render-expr.ts#renderNew": {
    deferred:
      "A part builder-call `Line { qty: 1 }` inside an aggregate-nested unit test lowers to a `new` expr, but the Java test renderer's JavaRenderContext has no agg.",
    mission: "M-T9.82",
    reviewUntil: "2027-01-31",
  },

  // src/generator/python/channels-builder.ts
  "src/generator/python/channels-builder.ts#transportPickLines": {
    invariant:
      "buildPyChannelsFile is only called when channelBindings is non-empty, and every binding's transport is redis|rabbitmq|kafka. (src/generator/python/index.ts:211,622; src/generator/_channels/bindings.ts:22)",
  },

  // src/generator/python/dispatch-builder.ts
  "src/generator/python/dispatch-builder.ts#renderProjectionFoldStmt": {
    guardedBy: ["loom.projection-fold-impure"],
    note: "foldImpurity rejects every non-assign/add/remove/let statement in a projection fold, exactly the kinds this arm throws on.",
  },

  // src/generator/python/emit/integration-tests.ts
  "src/generator/python/emit/integration-tests.ts#renderStmt": {
    guardedBy: ["loom.test-statement-invalid", "loom.aggregate-test-context"],
    note: "A context integration test statement outside let/expression/expect/expect-throws — refused since #3133 (the test-tier statement vocabulary).",
  },

  // src/generator/python/emit/tests.ts
  "src/generator/python/emit/tests.ts#renderTestStmt": {
    guardedBy: ["loom.test-statement-invalid", "loom.aggregate-test-context"],
    note: "A unit-test statement outside let/expression/call/expect/expect-throws — refused since #3133 (the test-tier statement vocabulary).",
  },

  // src/generator/python/explicit-handlers-emit.ts
  "src/generator/python/explicit-handlers-emit.ts#pagedRunStmt": {
    guardedBy: ["loom.paged-query-handler-shape"],
    note: "A paged queryHandler body other than `let r = Repo.run(<Criterion>(args)); return r` — refused in phase ⑦ since #3084; the emitter reads the same shared `pagedRunStmt` predicate the check enforces.",
  },

  // src/generator/python/find-predicate.ts
  "src/generator/python/find-predicate.ts#lower": {
    invariant:
      "Exhaustive switch over the authz-filter kind union with a `never` default; TypeScript guarantees every variant has an arm. (src/generator/python/find-predicate.ts:313-315)",
  },

  // src/generator/python/py-columns.ts
  "src/generator/python/py-columns.ts#columnsFor": {
    guardedBy: [
      "loom.generic-position",
      "loom.union-position",
      "loom.slot-out-of-position",
      "loom.action-out-of-position",
    ],
    note: "The unhandled kinds (genericInstance, option/inline union, slot, action) are all rejected as stored-field types; named payload unions/payloads are not resolvable as field types (verified).",
  },

  // src/generator/python/query-projections-builder.ts
  "src/generator/python/query-projections-builder.ts#keyCol": {
    guardedBy: [
      "loom.projection-groupby-key-not-columnar",
      "loom.projection-groupby-select-not-grouped",
    ],
    note: "The validator runs the same groupKeyOf on every group-by expr and non-aggregate select and errors when it returns null.",
  },
  "src/generator/python/query-projections-builder.ts#keyCol$2": {
    invariant:
      "The only transform is startOfDay → 'datetime.startOfDay', which SQLALCHEMY_INTRINSIC_SQL defines. (src/ir/util/projection-aggregate.ts:126-137; src/generator/python/find-predicate.ts:121)",
  },

  // src/generator/python/workflow-eventsourced-emit.ts
  "src/generator/python/workflow-eventsourced-emit.ts#corrIdClass": {
    invariant:
      "esWorkflowFoldBlock is only emitted when wf.correlationField is set, and that field is always the unique id-typed state field (unlike Java, verified with g5-es-wf-nocorr-python.ddd which generates cleanly). (src/generator/python/dispatch-builder.ts:271-275; src/ir/lower/lower-workflow.ts:151-152)",
  },
  "src/generator/python/workflow-eventsourced-emit.ts#renderApplierStmt": {
    deferred:
      "A workflow applier containing a `let` binding (`apply(pr: PaymentRegistered) { let x = pr.amount  paid := paid + x }`) validates clean, but the Python ES-workflow applier renderer only handles assign/add/remove.",
    mission: "M-T9.79",
    reviewUntil: "2027-01-31",
  },

  // src/generator/react/index.ts
  "src/generator/react/index.ts#generateReactForContexts": {
    guardedBy: ["loom.react-deployable-missing-ui", "loom.static-deployable-missing-ui"],
    note: "A react deployable without ui:/hosts: is rejected (verified: parse reports the error).",
  },
  "src/generator/react/index.ts#generateReactForContexts$2": {
    invariant:
      "uiName comes from a resolved Langium cross-reference (an unresolved ui name is a linking error), and a project has exactly one system, so the ui is always in sys.uis. (src/ir/lower/lower-deployment.ts:34-35)",
  },

  // src/generator/sql-pg-expr.ts
  "src/generator/sql-pg-expr.ts#renderSqlScalarExpr": {
    invariant:
      "Backfill rendering is wrapped in try/catch (and reported by loom.migration-expr-unsupported), and the column-default path is gated by sqlLiteralColumnDefault, which admits no this-prop ref. (src/system/migrations-builder.ts:2266-2270, :3291-3295)",
  },

  // src/generator/sql-pg.ts
  "src/generator/sql-pg.ts#seedSqlLiteral": {
    guardedBy: ["loom.seed-raw-non-literal-column"],
    note: "isRawSeedLiteral admits exactly literal + enum-value refs, mirroring seedSqlLiteral (verified: `size: -4` on a raw row is rejected).",
  },

  // src/generator/svelte/index.ts
  "src/generator/svelte/index.ts#generateSvelteForContexts": {
    guardedBy: ["loom.svelte-deployable-missing-ui"],
    note: "A svelte deployable without ui:/hosts: is rejected (verified: parse reports the error).",
  },
  "src/generator/svelte/index.ts#generateSvelteForContexts$2": {
    invariant:
      "uiName comes from a resolved Langium cross-reference (an unresolved ui name is a linking error), and a project has exactly one system, so the ui is always in sys.uis. (src/ir/lower/lower-deployment.ts:34-35)",
  },

  // src/generator/typescript/emit/channels.ts
  "src/generator/typescript/emit/channels.ts#transportFactoryLine": {
    invariant:
      "renderChannelsModule is only called when brokerChannelBindings() is non-empty, and every binding's transport is typed BrokerTransport = redis|rabbitmq|kafka (bindings skip any other storage type), so at least one driver is always wired. (src/platform/hono/v4/emit.ts:1431-1434; src/generator/_channels/bindings.ts:22,73)",
  },

  // src/generator/typescript/emit/integration-tests.ts
  "src/generator/typescript/emit/integration-tests.ts#renderStmt": {
    guardedBy: ["loom.expect-requires-matcher"],
    note: "checkExpectMatcher rejects any `expect` whose trailing suffix is not an intrinsic matcher call; lowering (lower-expr.ts:1023) marks that suffix isIntrinsicMatcher, so renderExplicitMatcher never returns null for a validated expect.",
  },
  "src/generator/typescript/emit/integration-tests.ts#renderStmt$2": {
    guardedBy: ["loom.test-statement-invalid", "loom.aggregate-test-context"],
    note: "A context integration test statement outside let/expression/expect/expect-throws — refused since #3133 (the test-tier statement vocabulary).",
  },

  // src/generator/typescript/emit/mikroorm-entities.ts
  "src/generator/typescript/emit/mikroorm-entities.ts#columnsForType": {
    deferred:
      "A root value-object field whose VO contains a VO collection (`tags: Tag[]`) is flattened into sub-columns and recurses into columnsForType with a non-scalar array element; no validator rejects nested VO collections under persistence: mikroorm.",
    mission: "M-T9.82",
    reviewUntil: "2027-01-31",
  },
  "src/generator/typescript/emit/mikroorm-entities.ts#columnsForType$2": {
    invariant:
      "The remaining kinds cannot reach a stored field: genericInstance/union/none are refused in Property position (loom.generic-position, loom.union-position), slot/action by loom.slot-out-of-position/loom.action-out-of-position, a bare aggregate by loom.bare-aggregate-in-type, and the linker's field-type scope resolves no event/payload names (tried: 'Unknown type'), while a bare entity-part field lowers as containment. (src/language/validators/generics.ts:86; src/language/validators/unions.ts:58; src/language/validators/structural.ts:74-118; src/language/validators/structural.ts:171)",
  },

  // src/generator/typescript/emit/mikroorm-filter.ts
  "src/generator/typescript/emit/mikroorm-filter.ts#authzFilterEntry": {
    invariant:
      "Exhaustive `never` default over the authz-filter discriminated union; every variant has an arm, so tsc guarantees it is unreachable. (src/generator/typescript/emit/mikroorm-filter.ts:580-582)",
  },
  "src/generator/typescript/emit/mikroorm-filter.ts#comparisonEntry": {
    invariant:
      "A MikroORM comparison with no column operand. Every shape the target-neutral predicate oracle admits renders here: test/system/predicate-position-census.test.ts measures each position × adapter × shape and fails on a crash.",
  },
  "src/generator/typescript/emit/mikroorm-filter.ts#comparisonEntry$2": {
    invariant:
      "orientComparison only returns a `column` operand for which isColumnSide is true, i.e. thisFieldColumn!==null || mikroColumnSql!==null, so when thisFieldColumn is null mikroColumnSql is necessarily non-null (same pure function, same args). (src/generator/typescript/emit/mikroorm-filter.ts:305-317; src/ir/util/comparison-operands.ts:62-73)",
  },
  "src/generator/typescript/emit/mikroorm-filter.ts#comparisonEntry$3": {
    invariant:
      "comparisonEntry is only entered for `==` or a FILTER_OP key (<,>,<=,>=,!=), and MIRRORED_COMPARE_OP maps that set onto itself, so the oriented op always has a FILTER_OP entry. (src/generator/typescript/emit/mikroorm-filter.ts:461-463; src/ir/util/comparison-operands.ts:30-37)",
  },
  "src/generator/typescript/emit/mikroorm-filter.ts#comparisonEntry$4": {
    invariant:
      "Same as the raw-key arm: entry requires `==` or a FILTER_OP op and mirroring is closed over that set, so FILTER_OP[oriented.op] is always defined. (src/generator/typescript/emit/mikroorm-filter.ts:461-463; src/ir/util/comparison-operands.ts:30-37)",
  },
  "src/generator/typescript/emit/mikroorm-filter.ts#filterValue": {
    invariant:
      "A MikroORM filter value that is a non-param ref. Every shape the target-neutral predicate oracle admits renders here: test/system/predicate-position-census.test.ts measures each position × adapter × shape and fails on a crash.",
  },
  "src/generator/typescript/emit/mikroorm-filter.ts#filterValue$2": {
    invariant:
      "A MikroORM filter value that is a non-principal member (a column renders through the raw column-vs-column arm first). Every shape the target-neutral predicate oracle admits renders here: test/system/predicate-position-census.test.ts measures each position × adapter × shape and fails on a crash.",
  },
  "src/generator/typescript/emit/mikroorm-filter.ts#filterValue$3": {
    invariant:
      "A MikroORM method-call value on a non-primitive receiver. Every shape the target-neutral predicate oracle admits renders here: test/system/predicate-position-census.test.ts measures each position × adapter × shape and fails on a crash.",
  },
  "src/generator/typescript/emit/mikroorm-filter.ts#filterValue$4": {
    invariant:
      "A MikroORM method-call value that is not a queryable intrinsic (the oracle refuses it as non-queryable). Every shape the target-neutral predicate oracle admits renders here: test/system/predicate-position-census.test.ts measures each position × adapter × shape and fails on a crash.",
  },
  "src/generator/typescript/emit/mikroorm-filter.ts#filterValue$5": {
    invariant:
      "A MikroORM literal kind outside string/number/bool/null/now (none exists). Every shape the target-neutral predicate oracle admits renders here: test/system/predicate-position-census.test.ts measures each position × adapter × shape and fails on a crash.",
  },
  "src/generator/typescript/emit/mikroorm-filter.ts#filterValue$6": {
    invariant:
      "A MikroORM value of a kind the queryable oracle refuses (lambda, call, new, …). Every shape the target-neutral predicate oracle admits renders here: test/system/predicate-position-census.test.ts measures each position × adapter × shape and fails on a crash.",
  },
  "src/generator/typescript/emit/mikroorm-filter.ts#predicateEntry": {
    deferred:
      "A capability `filter this.owners.contains(<id>)` over an `X id[]` reference collection is admitted by firstNonQueryablePredicate, but mikroContextFilters calls whereToMikroFilter(pred) with no associations, so containsMembershipFragment returns null and predicateEntry falls through.",
    mission: "M-T9.82",
    reviewUntil: "2027-01-31",
  },

  // src/generator/typescript/emit/schema.ts
  "src/generator/typescript/emit/schema.ts#drizzleColumnLinesForName": {
    invariant:
      "`duration` is not a writable PrimitiveType in the grammar (only an inferred expression type), and every drizzle column comes from a declared Property TypeRef (aggregate/part/VO/workflow/folded-projection fields). (src/language/ddd.langium:2161-2162)",
  },
  "src/generator/typescript/emit/schema.ts#drizzleColumnLinesForName$2": {
    guardedBy: ["loom.slot-out-of-position", "loom.action-out-of-position"],
    note: "slot/action types are only legal on a Component parameter; any stored-field position is rejected.",
  },
  "src/generator/typescript/emit/schema.ts#drizzleColumnLinesForName$3": {
    guardedBy: ["loom.generic-position"],
    note: "Any TypeRef with generic ctors (paged/envelope) outside a find/queryHandler return or payload field is rejected, so no stored field can carry a genericInstance (the IR gate validateGenericInstancesUnimplemented is a no-op since all backends are 'supported').",
  },
  "src/generator/typescript/emit/schema.ts#drizzleColumnLinesForName$4": {
    guardedBy: ["loom.union-position", "loom.generic-position"],
    note: "Inline `A or B` unions are refused outside find/op returns and payload fields (loom.union-position), and `T option` (the only other source of union/none) is a GenericCtor refused by loom.generic-position.",
  },

  // src/generator/typescript/emit/tests.ts
  "src/generator/typescript/emit/tests.ts#renderTestStmt": {
    guardedBy: ["loom.expect-requires-matcher"],
    note: "Every `expect` must end in an intrinsic matcher call, which lowers to a method-call with isIntrinsicMatcher=true, so renderExplicitMatcher always succeeds.",
  },
  "src/generator/typescript/emit/tests.ts#renderTestStmt$2": {
    guardedBy: ["loom.test-statement-invalid", "loom.aggregate-test-context"],
    note: "A unit-test statement outside let/expression/call/expect/expect-throws — refused since #3133 (the test-tier statement vocabulary).",
  },

  // src/generator/typescript/render-expr.ts
  "src/generator/typescript/render-expr.ts#renderMoneyBinary": {
    guardedBy: ["loom.operator-non-bool-operands"],
    note: "The only BinOps without a MONEY_METHOD entry are && and ||, which the type validator rejects unless both operands are bool, so a money operand never reaches them.",
  },

  // src/generator/typescript/repository-find-predicate.ts
  "src/generator/typescript/repository-find-predicate.ts#lowerExpr": {
    invariant:
      "Exhaustive `never` default over the authz-filter discriminated union; tsc guarantees every variant is handled. (src/generator/typescript/repository-find-predicate.ts:222-225)",
  },

  // src/generator/vue/index.ts
  "src/generator/vue/index.ts#generateVueForContexts": {
    guardedBy: ["loom.vue-deployable-missing-ui"],
    note: "A vue deployable without ui:/hosts: is rejected (verified: parse reports the error).",
  },
  "src/generator/vue/index.ts#generateVueForContexts$2": {
    invariant:
      "uiName comes from a resolved Langium cross-reference (an unresolved ui name is a linking error), and a project has exactly one system, so the ui is always in sys.uis. (src/ir/lower/lower-deployment.ts:34-35)",
  },

  // src/generator/zod-refine.ts
  "src/generator/zod-refine.ts#unrenderable": {
    invariant:
      "refineClauseFor/takeSingleFieldChain screen with classifyForWire + refineRenderable before rendering; renderRefineExpr has no other production caller. (src/generator/zod-refine.ts:320, :338-339)",
  },

  // src/platform/hono/v4/adapters/by-feature-layout.ts
  "src/platform/hono/v4/adapters/by-feature-layout.ts#pathFor": {
    invariant:
      "Every hono artifact is placed via `place(category, aggregateName: string, ...)` (emit.ts:1082), which always tags a category and a non-empty aggregate name for per-aggregate categories like 'domain-aggregate'; a missing one is a programmer error in our own emit sites. (src/platform/hono/v4/emit.ts:1082-1095)",
  },
  "src/platform/hono/v4/adapters/by-feature-layout.ts#pathFor$2": {
    invariant:
      "Every hono artifact is placed via `place(category, aggregateName: string, ...)` (emit.ts:1082), which always tags a category and a non-empty aggregate name for per-aggregate categories like 'drizzle-repository'; a missing one is a programmer error in our own emit sites. (src/platform/hono/v4/emit.ts:1082-1095)",
  },

  // src/platform/hono/v4/adapters/by-layer-layout.ts
  "src/platform/hono/v4/adapters/by-layer-layout.ts#pathFor": {
    invariant:
      "Every hono artifact is placed via `place(category, aggregateName: string, ...)` (emit.ts:1082), which always tags a category and a non-empty aggregate name for per-aggregate categories like 'any'; a missing one is a programmer error in our own emit sites. (src/platform/hono/v4/emit.ts:1082-1095)",
  },
  "src/platform/hono/v4/adapters/by-layer-layout.ts#pathForCategory": {
    invariant:
      "Every hono artifact is placed via `place(category, aggregateName: string, ...)` (emit.ts:1082), which always tags a category and a non-empty aggregate name for per-aggregate categories like 'domain-aggregate'; a missing one is a programmer error in our own emit sites. (src/platform/hono/v4/emit.ts:1082-1095)",
  },
  "src/platform/hono/v4/adapters/by-layer-layout.ts#pathForCategory$2": {
    invariant:
      "Every hono artifact is placed via `place(category, aggregateName: string, ...)` (emit.ts:1082), which always tags a category and a non-empty aggregate name for per-aggregate categories like 'domain-aggregate-base'; a missing one is a programmer error in our own emit sites. (src/platform/hono/v4/emit.ts:1082-1095)",
  },
  "src/platform/hono/v4/adapters/by-layer-layout.ts#pathForCategory$3": {
    invariant:
      "Every hono artifact is placed via `place(category, aggregateName: string, ...)` (emit.ts:1082), which always tags a category and a non-empty aggregate name for per-aggregate categories like 'domain-test'; a missing one is a programmer error in our own emit sites. (src/platform/hono/v4/emit.ts:1082-1095)",
  },
  "src/platform/hono/v4/adapters/by-layer-layout.ts#pathForCategory$4": {
    invariant:
      "Every hono artifact is placed via `place(category, aggregateName: string, ...)` (emit.ts:1082), which always tags a category and a non-empty aggregate name for per-aggregate categories like 'drizzle-repository'; a missing one is a programmer error in our own emit sites. (src/platform/hono/v4/emit.ts:1082-1095)",
  },
  "src/platform/hono/v4/adapters/by-layer-layout.ts#pathForCategory$5": {
    invariant:
      "Every hono artifact is placed via `place(category, aggregateName: string, ...)` (emit.ts:1082), which always tags a category and a non-empty aggregate name for per-aggregate categories like 'http-routes'; a missing one is a programmer error in our own emit sites. (src/platform/hono/v4/emit.ts:1082-1095)",
  },

  // src/platform/hono/v4/emit.ts
  "src/platform/hono/v4/emit.ts#generateTypeScriptForContexts": {
    invariant:
      "ownsTimers and the ownedTimers filter apply the identical predicate (timer's context's subdomain migrationsOwner === deployable name) to the same system, so they cannot disagree. (src/platform/hono/v4/emit.ts:638-644; src/platform/hono/v4/emit.ts:1403-1416)",
  },

  // src/platform/hono/v4/explicit-handlers-builder.ts
  "src/platform/hono/v4/explicit-handlers-builder.ts#emitPagedRunHandler": {
    guardedBy: ["loom.paged-query-handler-shape"],
    note: "A paged queryHandler body other than `let r = Repo.run(<Criterion>(args)); return r` — refused in phase ⑦ since #3084; the emitter reads the same shared `pagedRunStmt` predicate the check enforces.",
  },

  // src/platform/hono/v4/projection-builder.ts
  "src/platform/hono/v4/projection-builder.ts#renderFoldStatement": {
    guardedBy: ["loom.projection-fold-impure"],
    note: "foldImpurity is a fail-closed allowlist (assign/add/remove/let) applied to every projection on() statement, so every kind in the throwing arm is rejected as an error.",
  },

  // src/platform/hono/v4/projection-query-routes-builder.ts
  "src/platform/hono/v4/projection-query-routes-builder.ts#buildQueryProjectionsFile": {
    invariant:
      "A projection row `where` Drizzle cannot lower. Every shape the target-neutral predicate oracle admits renders here: test/system/predicate-position-census.test.ts measures each position × adapter × shape and fails on a crash.",
  },
  "src/platform/hono/v4/projection-query-routes-builder.ts#buildQueryProjectionsFile$2": {
    invariant:
      "An aggregation projection `where` Drizzle cannot lower. Every shape the target-neutral predicate oracle admits renders here: test/system/predicate-position-census.test.ts measures each position × adapter × shape and fails on a crash.",
  },
  "src/platform/hono/v4/projection-query-routes-builder.ts#drizzleCapabilityPredicates": {
    invariant:
      "A capability filter Drizzle cannot lower on the aggregation path. Every shape the target-neutral predicate oracle admits renders here: test/system/predicate-position-census.test.ts measures each position × adapter × shape and fails on a crash.",
  },
  "src/platform/hono/v4/projection-query-routes-builder.ts#groupKeyExpr": {
    invariant:
      "GROUP_KEY_TRANSFORM_INTRINSIC maps the only transform to 'datetime.startOfDay', which DRIZZLE_INTRINSIC_SQL defines. (src/ir/util/projection-aggregate.ts:135-137; src/generator/typescript/repository-find-predicate.ts:88)",
  },
  "src/platform/hono/v4/projection-query-routes-builder.ts#groupKeyOrThrow": {
    guardedBy: [
      "loom.projection-groupby-key-not-columnar",
      "loom.projection-groupby-select-not-grouped",
    ],
    note: "Every group-by entry must satisfy groupKeyOf (else not-columnar) and every non-aggregate select must match a group key via groupKeyOf (else select-not-grouped); those are exactly the expressions groupKeyOrThrow is called on.",
  },
  "src/platform/hono/v4/projection-query-routes-builder.ts#mikroGroupKeySql": {
    invariant:
      "GroupKeyTransform is the single literal 'startOfDay', and MIKRO_GROUP_KEY_TRANSFORM_SQL is a Record keyed by that type with a startOfDay entry, so the lookup cannot miss. (src/ir/util/projection-aggregate.ts:111,126; src/platform/hono/v4/projection-query-routes-builder.ts:984-989)",
  },
  "src/platform/hono/v4/projection-query-routes-builder.ts#zodForRow": {
    deferred:
      "A select-only query-time projection derives its row fields from the select expressions' resolved types (selectDerivedFields), so `select span = o.closedAt - o.openedAt` (datetime - datetime = duration) puts a duration into wireShape and zodForRow throws.",
    mission: "M-T9.82",
    reviewUntil: "2027-01-31",
  },
  "src/platform/hono/v4/projection-query-routes-builder.ts#zodForRow$2": {
    guardedBy: ["loom.slot-out-of-position", "loom.action-out-of-position"],
    note: "slot/action types only exist on Component params; a declared projection field is refused, and select expressions are candidate-rooted reads that cannot reference a component parameter.",
  },
  "src/platform/hono/v4/projection-query-routes-builder.ts#zodForRow$3": {
    invariant:
      "Declared row fields cannot be generic (loom.generic-position) and select-derived row types come from candidate-rooted column/aggregation expressions, which cannot call a find/queryHandler (the only producers of paged/envelope types). (src/language/validators/generics.ts:86; src/language/ddd.langium:1648-1649)",
  },
  "src/platform/hono/v4/projection-query-routes-builder.ts#zodForRow$4": {
    invariant:
      "Declared row fields cannot be unions/option (loom.union-position, loom.generic-position), and select expressions are column/aggregate reads over the source whose types are declared field types (ternary joins of incompatible types are rejected by the type checker). (src/language/validators/unions.ts:58; src/language/validators/generics.ts:86)",
  },

  // src/platform/hono/v4/routes-builder.ts
  "src/platform/hono/v4/routes-builder.ts#wireToDomainExpr": {
    invariant:
      "Same as zodFor: wireToDomainExpr converts request bodies, whose TypeIRs never contain the response-only synthesized provenanced carrier. (src/language/ddd.langium:2155-2156; src/platform/hono/v4/routes-builder.ts:2466-2469)",
  },
  "src/platform/hono/v4/routes-builder.ts#zodFor": {
    invariant:
      "`provenanced` is not a user-spellable GenericCtor; the carrier is synthesized only on the response side (routes-builder.ts:2468), and zodFor is only fed request-side TypeIRs. (src/language/ddd.langium:2155-2156; src/platform/hono/v4/routes-builder.ts:2466-2469)",
  },

  // src/platform/hono/v4/workflow-eventsourced-builder.ts
  "src/platform/hono/v4/workflow-eventsourced-builder.ts#renderApplierStmt": {
    deferred:
      "The applier purity rules (loom.applier-emits/-impure-call/-guard) cover aggregate appliers and explicitly allow let/if/expression/return; an eventSourced workflow `apply(r) { let a = r.at  firedAt := a }` (or an `if`) validates clean and the hono ES-workflow applier refuses it.",
    mission: "M-T9.79",
    reviewUntil: "2027-01-31",
  },

  // src/platform/metadata.ts
  "src/platform/metadata.ts#descriptorFor": {
    guardedBy: ["loom.platform-unknown"],
    note: "checkDeployablePlatform rejects any non-backend platform not in FRONTEND_KEYWORDS; every backend family and frontend keyword resolves in PLATFORM_DESCRIPTORS (checked all 12).",
  },

  // src/platform/registry.ts
  "src/platform/registry.ts#resolvePlatformRef": {
    guardedBy: ["loom.platform-version-unknown"],
    note: "A pinned `family@version` must be a registered backend surface (isRegisteredBackendRef), and barewords resolve through BUILTIN_PLATFORM_LATEST to a discovered surface.",
  },
  "src/platform/registry.ts#resolvePlatformRef$2": {
    guardedBy: ["loom.platform-unknown"],
    note: "A non-backend bareword not in FRONTEND_KEYWORDS is rejected, so the `platforms` lookup always hits.",
  },
};
