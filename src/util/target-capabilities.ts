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
export type TargetRefusalSlug = "datagrid" | "chart" | "entity-history-read";

/** A target's verdict on one construct × position. */
export type CapabilityVerdict =
  | { readonly verdict: "supported" }
  | { readonly verdict: "refused"; readonly slug: TargetRefusalSlug }
  | { readonly verdict: "owned"; readonly code: string };

/** UI constructs, each at its position.  A page or component body is the
 *  position every row here names: components render into pages, so a
 *  construct moved into one is exactly as (un)renderable. */
export type UiConstruct =
  /** `DataGrid { … }` in a page or component body. */
  | "primitive:DataGrid@body"
  /** `Chart { … }` in a page or component body. */
  | "primitive:Chart@body"
  /** `QueryView { of: <api>.<Agg>.history(id) }` — the derived entity-history
   *  read — in a page or component body. */
  | "read:entity-history@body";

/** Backend constructs, each at its position. */
export type BackendConstruct =
  /** A `requires` gate inside an event-sourced aggregate's `create` body. */
  "stmt:requires@event-sourced-create";

/** Every UI construct, in a stable order (the table test iterates it). */
export const UI_CONSTRUCTS: readonly UiConstruct[] = [
  "primitive:DataGrid@body",
  "primitive:Chart@body",
  "read:entity-history@body",
];

/** Every backend construct, in a stable order. */
export const BACKEND_CONSTRUCTS: readonly BackendConstruct[] = [
  "stmt:requires@event-sourced-create",
];

/** The refusal a UI construct gets on a framework NO target renders (an
 *  unresolved or unknown `framework:`) — fail-closed, so an unrecognised
 *  framework never reaches an emitter with a construct nobody rendered. */
export const UI_CONSTRUCT_REFUSAL: Readonly<Record<UiConstruct, TargetRefusalSlug>> = {
  "primitive:DataGrid@body": "datagrid",
  "primitive:Chart@body": "chart",
  "read:entity-history@body": "entity-history-read",
};

/** One target's table. */
export interface TargetCapabilityTable {
  /** The ui frameworks this target's generator renders, and its verdict per
   *  UI construct.  Absent on a target that renders no ui framework itself. */
  readonly ui?: {
    readonly frameworks: readonly string[];
    readonly constructs: Readonly<Record<UiConstruct, CapabilityVerdict>>;
  };
  /** Its verdict per backend construct.  Absent on a frontend. */
  readonly backend?: Readonly<Record<BackendConstruct, CapabilityVerdict>>;
}

const SUPPORTED: CapabilityVerdict = { verdict: "supported" };
const refused = (slug: TargetRefusalSlug): CapabilityVerdict => ({ verdict: "refused", slug });

/** The UI row every JS frontend shares: TanStack runs, so `DataGrid` ships. */
const JS_FRONTEND_UI: Readonly<Record<UiConstruct, CapabilityVerdict>> = {
  "primitive:DataGrid@body": SUPPORTED,
  "primitive:Chart@body": SUPPORTED,
  "read:entity-history@body": SUPPORTED,
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
  ui: { frameworks: ["react"], constructs: JS_FRONTEND_UI },
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
      },
    },
    backend: { "stmt:requires@event-sourced-create": SUPPORTED },
  },
  react: REACT_CAPABILITIES,
  static: REACT_CAPABILITIES,
  vue: { ui: { frameworks: ["vue"], constructs: JS_FRONTEND_UI } },
  svelte: { ui: { frameworks: ["svelte"], constructs: JS_FRONTEND_UI } },
  angular: { ui: { frameworks: ["angular"], constructs: JS_FRONTEND_UI } },
  // Fable compiles F# to JavaScript, so Feliz binds `@tanstack/table-core`.
  feliz: { ui: { frameworks: ["feliz"], constructs: JS_FRONTEND_UI } },
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
      },
    },
  },
};

/** The verdict for a UI construct on a framework.  A framework no target
 *  renders is REFUSED (fail-closed) with the construct's own reason. */
export function uiCapability(framework: string, construct: UiConstruct): CapabilityVerdict {
  for (const table of Object.values(TARGET_CAPABILITIES)) {
    if (table.ui?.frameworks.includes(framework)) return table.ui.constructs[construct];
  }
  return refused(UI_CONSTRUCT_REFUSAL[construct]);
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
