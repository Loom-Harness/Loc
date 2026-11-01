// ---------------------------------------------------------------------------
// The per-target CAPABILITY TABLE — what each target renders, as data.
//
// A model that passes validation must never be degraded, misgenerated or crash
// a generator.  That only holds if the validator knows, before emission, what
// every target can render — so the knowledge lives HERE, once, rather than in
// each emitter's `default:` arm, a `loom:unrendered` give-up, or a membership
// Set private to one validator check.
//
// SHAPE.  Every target (a `Platform`) carries a `TargetCapabilityTable`: for
// each construct × position it lists, a verdict.  There is no third state:
//
//   supported — the target renders it.  `test/system/target-capability-table
//               .test.ts` proves it on a witness model: it validates clean and
//               generates with no give-up marker and no throw.
//   refused   — the target cannot render it.  The ONE phase-⑦ check
//               (`src/ir/validate/checks/target-capability-checks.ts`) raises
//               `loom.target-unsupported` with the message
//               `loom.target-unsupported#<slug>` wherever the model uses it.
//   owned     — refused, but by an older check that still carries its own code
//               (named here so the table test can prove it fires).  A
//               migration in flight: the row moves to `refused` when that
//               check is folded into the one above.
//
// The construct keys are closed unions, and each table is a `Record` over
// them, so adding a construct is a type error on every target until each one
// states its verdict.
//
// UI constructs are keyed by the ui FRAMEWORK that renders them, not by the
// deployable's platform: a `platform: dotnet` host serving a `framework: vue`
// bundle renders it with the Vue generator.  `ui.frameworks` names the
// frameworks a target's generator renders; the four static-bundle backends
// (node, dotnet, python, java) render none, so they carry no `ui` section.
//
// Lives in `src/util/` because both halves read it: the validator (phase ⑦)
// refuses what a target can't render, and an emitter that must still choose a
// path (`_walker/history-read.ts`) derives its membership set from the same
// row — so the two cannot disagree.  Each `PlatformSurface` re-exports its
// table as `capabilities` (`descriptor-consistency.test.ts` pins it).
// ---------------------------------------------------------------------------

import type { Platform } from "../ir/types/loom-ir.js";

/** The stable refusal reasons.  Each one is a message
 *  `loom.target-unsupported#<slug>` in `src/diagnostics/messages.ts`. */
export type TargetRefusalSlug =
  | "datagrid"
  | "chart"
  | "entity-history-read"
  | "match-await-standard-op";

/** A target's verdict on one construct × position. */
export type CapabilityVerdict =
  | { readonly verdict: "supported" }
  | { readonly verdict: "refused"; readonly slug: TargetRefusalSlug }
  | { readonly verdict: "owned"; readonly code: string };

/** UI constructs the phase-⑦ check refuses itself (a `refused` verdict is
 *  possible), each at its position.  A page or component body is the position
 *  every row here names: components render into pages, so a construct moved
 *  into one is exactly as (un)renderable. */
export type RefusableUiConstruct =
  /** `DataGrid { … }` in a page or component body. */
  | "primitive:DataGrid@body"
  /** `Chart { … }` in a page or component body. */
  | "primitive:Chart@body"
  /** `QueryView { of: <api>.<Agg>.history(id) }` — the derived entity-history
   *  read — in a page or component body. */
  | "read:entity-history@body"
  /** `match await <Agg>.<standard op>()` in a page or component action body — an
   *  awaited `all`/`byId`/`create`/`update`/`delete` rather than a declared
   *  operation. */
  | "stmt:match-await-standard-op@action";

/** UI constructs whose unsupported cells are refused by an OLDER check that
 *  keeps its own code, so a cell here is `supported` or `owned`, never
 *  `refused`.  The owning check derives its framework membership from the row
 *  (`frameworksSupporting` / `frameworksOwned`) rather than a private Set, so
 *  the table and the check cannot disagree. */
export type OwnedUiConstruct =
  /** A query-time projection read through an api handle. */
  | "read:projection@body"
  /** `Table { filter: <state> }`. */
  | "primitive:Table-filter@body"
  /** `Modal { open: <state>, OperationForm { … } }`. */
  | "primitive:Modal-open-op-form@body"
  /** A component declared `extern from "…"` (the hand-written-shim hatch). */
  | "decl:extern-component@ui"
  /** A page `requires <expr>` gate beyond the closed `currentUser`/constant
   *  subset. */
  | "gate:page-requires-full-expr@page"
  /** `return` / `precondition` / `requires` statements in a ui action or body. */
  | "stmt:backend-body@ui-body"
  /** `on <channel>.<Event>` live-event handlers on a ui. */
  | "handler:live-event@ui"
  /** `auth: ui` — the generated session guard around the ui. */
  | "auth:ui-guard@deployable";

/** Every UI construct. */
export type UiConstruct = RefusableUiConstruct | OwnedUiConstruct;

/** Backend constructs, each at its position. */
export type BackendConstruct =
  /** A `requires` gate inside an event-sourced aggregate's `create` body. */
  "stmt:requires@event-sourced-create";

/** Every refusable UI construct, in a stable order (the table test iterates it). */
export const UI_CONSTRUCTS: readonly RefusableUiConstruct[] = [
  "primitive:DataGrid@body",
  "primitive:Chart@body",
  "read:entity-history@body",
  "stmt:match-await-standard-op@action",
];

/** Every owned-only UI construct, in a stable order. */
export const OWNED_UI_CONSTRUCTS: readonly OwnedUiConstruct[] = [
  "read:projection@body",
  "primitive:Table-filter@body",
  "primitive:Modal-open-op-form@body",
  "decl:extern-component@ui",
  "gate:page-requires-full-expr@page",
  "stmt:backend-body@ui-body",
  "handler:live-event@ui",
  "auth:ui-guard@deployable",
];

/** Every UI construct, refusable then owned. */
export const ALL_UI_CONSTRUCTS: readonly UiConstruct[] = [...UI_CONSTRUCTS, ...OWNED_UI_CONSTRUCTS];

/** Every backend construct, in a stable order. */
export const BACKEND_CONSTRUCTS: readonly BackendConstruct[] = [
  "stmt:requires@event-sourced-create",
];

/** The refusal a UI construct gets on a framework NO target renders (an
 *  unresolved or unknown `framework:`) — fail-closed, so an unrecognised
 *  framework never reaches an emitter with a construct nobody rendered. */
export const UI_CONSTRUCT_REFUSAL: Readonly<Record<RefusableUiConstruct, TargetRefusalSlug>> = {
  "primitive:DataGrid@body": "datagrid",
  "primitive:Chart@body": "chart",
  "read:entity-history@body": "entity-history-read",
  "stmt:match-await-standard-op@action": "match-await-standard-op",
};

/** The verdict an owned-only construct gets on a framework NO target renders.
 *  Fail-closed where the owning check refuses an unrecognised framework; the
 *  two rows whose check is scoped to the frameworks it knows stay `supported`
 *  there (no check ran before, none runs now). */
const OWNED_FALLBACK: Readonly<Record<OwnedUiConstruct, CapabilityVerdict>> = {
  "read:projection@body": { verdict: "owned", code: "loom.ui-projection-read-unsupported" },
  "primitive:Table-filter@body": { verdict: "owned", code: "loom.table-filter-unsupported" },
  "primitive:Modal-open-op-form@body": {
    verdict: "owned",
    code: "loom.modal-controlled-op-form-unsupported",
  },
  "decl:extern-component@ui": { verdict: "owned", code: "loom.user-component-deferred-target" },
  "gate:page-requires-full-expr@page": { verdict: "supported" },
  "stmt:backend-body@ui-body": { verdict: "owned", code: "loom.ui-body-statement-kind" },
  "handler:live-event@ui": { verdict: "owned", code: "loom.ui-realtime-unsupported" },
  "auth:ui-guard@deployable": { verdict: "owned", code: "loom.auth-ui-unsupported-framework" },
};

/** Applicability facts about a framework's generator that are not a
 *  support/refuse choice: a rule scoped to the frameworks it describes.  The
 *  non-members are not "refused" — the rule is simply about something they do
 *  not do. */
export type UiScope =
  /** Component props / extern-function signatures are emitted as TypeScript
   *  through the shared `_frontend/` mapping (Feliz and Flutter spell their
   *  own; HEEx has no props file). */
  | "props:typescript"
  /** Page forms share one local-name scope per page (react/vue/svelte), so two
   *  forms can collide. */
  | "forms:shared-local-scope"
  /** The component emitter FILTERS its emitted set (feliz/angular/flutter), so
   *  a component shape it defers must be reported. */
  | "components:deferral-filtered";

/** One target's table. */
export interface TargetCapabilityTable {
  /** The ui frameworks this target's generator renders, and its verdict per
   *  UI construct.  Absent on a target that renders no ui framework itself. */
  readonly ui?: {
    readonly frameworks: readonly string[];
    readonly constructs: Readonly<Record<UiConstruct, CapabilityVerdict>>;
    /** Applicability facts (see {@link UiScope}). */
    readonly scopes?: readonly UiScope[];
    /** Pack primitive-template ids with no renderer on this framework —
     *  validator-gated, so a page using one is refused rather than dropped. */
    readonly unrenderedPrimitives?: readonly string[];
    /** Page-body primitives whose rendering needs the host view to supply an
     *  assign / upload / handler, so a component using one is inlined. */
    readonly hostStatePrimitives?: readonly string[];
  };
  /** Its verdict per backend construct.  Absent on a frontend. */
  readonly backend?: Readonly<Record<BackendConstruct, CapabilityVerdict>>;
}

const SUPPORTED: CapabilityVerdict = { verdict: "supported" };
const refused = (slug: TargetRefusalSlug): CapabilityVerdict => ({ verdict: "refused", slug });

const owned = (code: string): CapabilityVerdict => ({ verdict: "owned", code });

/** The owned-only rows a framework shares unless it says otherwise.  Every
 *  frontend renders these; the per-framework overrides below name the
 *  exceptions, each with the older check that refuses them. */
const COMMON_OWNED: Readonly<Record<OwnedUiConstruct, CapabilityVerdict>> = {
  "read:projection@body": SUPPORTED,
  "primitive:Table-filter@body": SUPPORTED,
  // react/vue/svelte/flutter collapse the whole modal to a comment.
  "primitive:Modal-open-op-form@body": owned("loom.modal-controlled-op-form-unsupported"),
  "decl:extern-component@ui": SUPPORTED,
  // The page-gate renderer is a closed `currentUser`/constant table.
  "gate:page-requires-full-expr@page": owned("loom.ui-gate-expr-unsupported"),
  // An action-body renderer with no arm for `return`/`precondition`/`requires`.
  "stmt:backend-body@ui-body": owned("loom.ui-body-statement-kind"),
  "handler:live-event@ui": SUPPORTED,
  "auth:ui-guard@deployable": SUPPORTED,
};

/** The UI row every JS frontend shares: TanStack runs, so `DataGrid` ships. */
const JS_FRONTEND_UI: Readonly<Record<UiConstruct, CapabilityVerdict>> = {
  "primitive:DataGrid@body": SUPPORTED,
  "primitive:Chart@body": SUPPORTED,
  "read:entity-history@body": SUPPORTED,
  "stmt:match-await-standard-op@action": SUPPORTED,
  ...COMMON_OWNED,
};

/** An event-sourced create renders into the domain `_init`, which has no
 *  principal in scope on these four — `currentUser` there does not deny, it
 *  does not compile.  Phoenix hoists the gate to the context function, which
 *  binds one.  Refused by the older `loom.lifecycle-guard-event-sourced`. */
const ES_CREATE_REQUIRES_OWNED: CapabilityVerdict = {
  verdict: "owned",
  code: "loom.lifecycle-guard-event-sourced",
};

/** The table for a static-bundle backend: it renders no ui framework. */
const STATIC_HOST_BACKEND: TargetCapabilityTable = {
  backend: { "stmt:requires@event-sourced-create": ES_CREATE_REQUIRES_OWNED },
};

const REACT_CAPABILITIES: TargetCapabilityTable = {
  ui: {
    frameworks: ["react"],
    constructs: JS_FRONTEND_UI,
    scopes: ["props:typescript", "forms:shared-local-scope"],
  },
};

/** Every target's table.  The `static` PLATFORM is React's UI-only alias and
 *  shares its table; a ui whose resolved FRAMEWORK is spelled `static` is not
 *  in any `frameworks` list, so its UI constructs are refused fail-closed. */
export const TARGET_CAPABILITIES: Readonly<Record<Platform, TargetCapabilityTable>> = {
  node: STATIC_HOST_BACKEND,
  dotnet: STATIC_HOST_BACKEND,
  python: STATIC_HOST_BACKEND,
  java: STATIC_HOST_BACKEND,
  elixir: {
    ui: {
      frameworks: ["phoenixLiveView"],
      constructs: {
        // A TanStack row model; LiveView could only fork it (D-DATAGRID-TARGETS).
        "primitive:DataGrid@body": refused("datagrid"),
        // Inline SVG over rows already in a server assign.
        "primitive:Chart@body": SUPPORTED,
        // An in-process `load_<agg>_history/2` in the same OTP app.
        "read:entity-history@body": SUPPORTED,
        "stmt:match-await-standard-op@action": SUPPORTED,
        ...COMMON_OWNED,
        // `renderModal` handles the controlled op-form shape.
        "primitive:Modal-open-op-form@body": SUPPORTED,
        // The page gate renders through the general HEEx expression renderer.
        "gate:page-requires-full-expr@page": SUPPORTED,
        // `heex-walker-core.ts` `renderStmt` has arms for all three kinds.
        "stmt:backend-body@ui-body": SUPPORTED,
        // A LiveView deployable is fullstack: its session guard is `LiveAuth`,
        // not a generated `auth: ui` wrapper.
        "auth:ui-guard@deployable": owned("loom.auth-ui-unsupported-framework"),
      },
      // Page-body primitives whose HEEx rendering needs the host LiveView to
      // supply an assign, an upload or a `handle_event` clause.  A name scan
      // (`src/ir/` cannot import the generator); pinned by
      // `heex-component-host-state.test.ts`, which generates each member.
      hostStatePrimitives: [
        "CreateForm",
        "OperationForm",
        "WorkflowForm",
        "DestroyForm",
        "QueryView",
        "Table",
        "FileUpload",
        "Chart",
      ],
    },
    backend: { "stmt:requires@event-sourced-create": SUPPORTED },
  },
  react: REACT_CAPABILITIES,
  static: REACT_CAPABILITIES,
  vue: {
    ui: {
      frameworks: ["vue"],
      constructs: JS_FRONTEND_UI,
      scopes: ["props:typescript", "forms:shared-local-scope"],
    },
  },
  svelte: {
    ui: {
      frameworks: ["svelte"],
      constructs: JS_FRONTEND_UI,
      scopes: ["props:typescript", "forms:shared-local-scope"],
    },
  },
  angular: {
    ui: {
      frameworks: ["angular"],
      // Angular forks the modal primitive and renders the form beside `open:`.
      constructs: {
        ...JS_FRONTEND_UI,
        "primitive:Modal-open-op-form@body": SUPPORTED,
      },
      scopes: ["props:typescript", "components:deferral-filtered"],
    },
  },
  // Fable compiles F# to JavaScript, so Feliz binds `@tanstack/table-core`.
  feliz: {
    ui: {
      frameworks: ["feliz"],
      constructs: {
        ...JS_FRONTEND_UI,
        // Feliz forks the modal primitive and renders the operation form.
        "primitive:Modal-open-op-form@body": SUPPORTED,
        // The Elmish update renderer projects a `match await` only for a
        // DECLARED instance operation; a standard op reaches its per-statement
        // arm, which throws.
        "stmt:match-await-standard-op@action": refused("match-await-standard-op"),
      },
      scopes: ["components:deferral-filtered"],
    },
  },
  flutter: {
    ui: {
      frameworks: ["flutter"],
      constructs: {
        // The shipping target is a native build with no JS runtime, so no
        // TanStack (D-DATAGRID-TARGETS).
        "primitive:DataGrid@body": refused("datagrid"),
        // A `CustomPainter` over rows the client has already decoded.
        "primitive:Chart@body": SUPPORTED,
        "read:entity-history@body": SUPPORTED,
        ...COMMON_OWNED,
        // Flutter has no extern-component hatch.
        "decl:extern-component@ui": owned("loom.user-component-deferred-target"),
        // A Riverpod `Notifier` resolves an awaited op through declared
        // operations only.
        "stmt:match-await-standard-op@action": owned("loom.flutter-action-body-unsupported"),
      },
      scopes: ["components:deferral-filtered"],
      // Every page primitive renders; the gate stays armed for the day one is
      // added back.
      unrenderedPrimitives: [],
    },
  },
};

/** The verdict for a UI construct on a framework.  A framework no target
 *  renders is REFUSED (fail-closed) with the construct's own reason, or takes
 *  the owned row's fallback. */
export function uiCapability(framework: string, construct: UiConstruct): CapabilityVerdict {
  for (const table of Object.values(TARGET_CAPABILITIES)) {
    if (table.ui?.frameworks.includes(framework)) return table.ui.constructs[construct];
  }
  if (construct in UI_CONSTRUCT_REFUSAL) {
    return refused(UI_CONSTRUCT_REFUSAL[construct as RefusableUiConstruct]);
  }
  return OWNED_FALLBACK[construct as OwnedUiConstruct];
}

/** Like {@link uiCapability}, but a name that is a PLATFORM (`static`,
 *  `elixir`) rather than a framework resolves through that platform's table —
 *  for the callers that fall back to `d.platform` when a ui states no
 *  framework. */
export function uiCapabilityOfFrameworkOrPlatform(
  frameworkOrPlatform: string,
  construct: UiConstruct,
): CapabilityVerdict {
  for (const table of Object.values(TARGET_CAPABILITIES)) {
    if (table.ui?.frameworks.includes(frameworkOrPlatform)) return table.ui.constructs[construct];
  }
  const viaPlatform = (TARGET_CAPABILITIES as Record<string, TargetCapabilityTable | undefined>)[
    frameworkOrPlatform
  ]?.ui;
  if (viaPlatform) return viaPlatform.constructs[construct];
  return uiCapability(frameworkOrPlatform, construct);
}

/** The ui frameworks whose verdict on `construct` is `owned`. */
export function frameworksOwned(construct: UiConstruct): ReadonlySet<string> {
  const out = new Set<string>();
  for (const table of Object.values(TARGET_CAPABILITIES)) {
    const ui = table.ui;
    if (ui?.constructs[construct].verdict !== "owned") continue;
    for (const fw of ui.frameworks) out.add(fw);
  }
  return out;
}

/** The ui frameworks that carry applicability fact `scope`. */
export function frameworksWithScope(scope: UiScope): ReadonlySet<string> {
  const out = new Set<string>();
  for (const table of Object.values(TARGET_CAPABILITIES)) {
    const ui = table.ui;
    if (!ui?.scopes?.includes(scope)) continue;
    for (const fw of ui.frameworks) out.add(fw);
  }
  return out;
}

/** The verdict for a backend construct on a backend platform, or `undefined`
 *  for a platform that hosts no backend. */
export function backendCapability(
  platform: Platform,
  construct: BackendConstruct,
): CapabilityVerdict | undefined {
  return TARGET_CAPABILITIES[platform]?.backend?.[construct];
}

/** The ui frameworks that render `construct` — for an emitter that must pick a
 *  path per framework (and keep it in step with the validator). */
export function frameworksSupporting(construct: UiConstruct): ReadonlySet<string> {
  const out = new Set<string>();
  for (const table of Object.values(TARGET_CAPABILITIES)) {
    const ui = table.ui;
    if (ui?.constructs[construct].verdict !== "supported") continue;
    for (const fw of ui.frameworks) out.add(fw);
  }
  return out;
}

/** The backend platforms that render `construct`. */
export function backendsSupporting(construct: BackendConstruct): ReadonlySet<string> {
  const out = new Set<string>();
  for (const [platform, table] of Object.entries(TARGET_CAPABILITIES)) {
    if (table.backend?.[construct].verdict === "supported") out.add(platform);
  }
  return out;
}
