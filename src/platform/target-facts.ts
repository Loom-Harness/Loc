// ---------------------------------------------------------------------------
// Per-target FACTS — what each platform and ui framework IS, as data.
//
// The capability table (`src/util/target-capabilities.ts`) says what a target
// can render.  This table holds the other per-target facts the front half of
// the pipeline needs: which ui framework a platform renders by default, which
// design pack it falls back to, whether it serves the realtime stream, and so
// on.  Lowering, the validators and system composition read these fields
// (through `descriptorFor(platform).facts` / `frameworkFacts(framework)`)
// instead of comparing a platform or framework name against a literal, so a
// new target states its facts here and needs no edit under `src/ir/`,
// `src/language/` or `src/system/`.  A Biome plugin
// (`biome-plugins/no-target-name-literal.grit`) refuses such a comparison in
// those directories.
//
// Pure data with no surface import, so the client bundle can read it.  Each
// `PlatformSurface` carries its row as `facts` (`descriptor-consistency.test.ts`
// pins the identity).
// ---------------------------------------------------------------------------

import type { Platform } from "../ir/types/loom-ir.js";
import type { BuiltinPackFamily, PackFormat } from "../util/builtin-formats.js";
import { type FrontendAxes, requireFrontendAxes } from "../util/frontend-axes.js";

/** The credential a frontend's realtime subscription carries once its gate
 *  says it carries one. */
export type RealtimeCredentialShape = "session-cookie" | "cookie-web-bearer-native";

/** One platform's facts. */
export interface TargetFacts {
  /** The ui framework a deployable on this platform renders a bound ui in when
   *  the ui states no `framework:`.  Absent on a platform that renders no ui. */
  readonly defaultUiFramework?: string;
  /** True on a backend that renders a ui only when the deployable binds one
   *  (it embeds an SPA beside its api); false where the platform always renders
   *  its ui (a frontend, or a fullstack server-render runtime). */
  readonly rendersUiOnlyWhenBound: boolean;
  /** The design pack a deployable falls back to when its ui framework names no
   *  static-bundle pack of its own (`FrameworkFacts.staticBundlePack`).  Absent
   *  on a platform that carries no `design:` at all. */
  readonly defaultDesignPack?: BuiltinPackFamily;
  /** Hosts both a server api and a server-rendered ui in one deployable, so an
   *  e2e block against it follows the block's own call root (`api` or `ui`). */
  readonly fullstack: boolean;
  /** Emits the realtime SSE wire (`GET /realtime/events`). */
  readonly servesRealtime: boolean;
  /** The credential a realtime subscription from this frontend carries. */
  readonly realtimeCredential?: RealtimeCredentialShape;
  /** Implements the shared-table (TPH) inheritance layout. */
  readonly sharedTableInheritance: boolean;
  /** Seconds of compose healthcheck start grace the service needs under OIDC
   *  (the app warms the issuer's keys before it serves `/health`). */
  readonly oidcStartGraceSeconds?: number;
  /** The format of a frontend that renders its ui procedurally rather than
   *  through a `.hbs` design pack — it names the frontend's implicit
   *  model-text format, and its `design:` names no pack chrome. */
  readonly selfRenderedUiFormat?: string;
}

/** One ui framework's facts. */
export interface FrameworkFacts {
  /** The format a `design:` pack on this framework must declare.  Absent on a
   *  framework with no `.hbs` pack pipeline. */
  readonly packFormat?: PackFormat;
  /** The design pack a static bundle of this framework defaults to. */
  readonly staticBundlePack?: BuiltinPackFamily;
  /** What a `design:` value selects: a pack, a daisyUI theme, or nothing. */
  readonly designSlot: "pack" | "daisyui-theme" | "inert";
  /** The framework's forms build their dynamic-row and submit sentences by
   *  hand (`HAND_BUILT_FORM_SENTENCES`) instead of reading a pack's
   *  `sentenceChrome`. */
  readonly handBuiltFormSentences?: boolean;
  /** Where the framework keeps page state, where its handlers sit, and the
   *  data access that follows (`src/util/frontend-axes.ts`). */
  readonly axes: FrontendAxes;
}

const NO_UI_BACKEND: TargetFacts = {
  rendersUiOnlyWhenBound: false,
  fullstack: false,
  servesRealtime: true,
  sharedTableInheritance: true,
};

/** A backend that embeds a React SPA when the deployable binds a ui. */
const SPA_HOST_BACKEND: TargetFacts = {
  defaultUiFramework: "react",
  rendersUiOnlyWhenBound: true,
  defaultDesignPack: "mantine",
  fullstack: false,
  servesRealtime: true,
  sharedTableInheritance: true,
};

const frontend = (defaultUiFramework: string, rest: Partial<TargetFacts> = {}): TargetFacts => ({
  defaultUiFramework,
  rendersUiOnlyWhenBound: false,
  defaultDesignPack: "mantine",
  fullstack: false,
  servesRealtime: false,
  realtimeCredential: "session-cookie",
  sharedTableInheritance: false,
  ...rest,
});

const REACT_FACTS = frontend("react");

/** Every platform's facts.  The `static` platform is React's UI-only alias and
 *  shares its row. */
export const TARGET_FACTS: Readonly<Record<Platform, TargetFacts>> = {
  node: NO_UI_BACKEND,
  python: NO_UI_BACKEND,
  dotnet: SPA_HOST_BACKEND,
  java: SPA_HOST_BACKEND,
  elixir: {
    // LiveView renders server-side; an embedded SPA picks its own pack.
    defaultUiFramework: "phoenixLiveView",
    rendersUiOnlyWhenBound: false,
    defaultDesignPack: "coreComponents",
    fullstack: true,
    servesRealtime: true,
    sharedTableInheritance: true,
    // The app warms the issuer's JWKS before its Endpoint starts, so boot
    // waits on the IdP's own boot and realm import.
    oidcStartGraceSeconds: 60,
  },
  react: REACT_FACTS,
  static: REACT_FACTS,
  svelte: frontend("svelte"),
  vue: frontend("vue"),
  angular: frontend("angular"),
  // Feliz renders F# procedurally; its `design:` selects a daisyUI theme.
  feliz: frontend("feliz", { selfRenderedUiFormat: "feliz" }),
  // Flutter renders Material widgets procedurally, so it carries no design,
  // and its native build has no HttpOnly cookie jar (D-FLUTTER-BEARER).
  flutter: frontend("flutter", {
    defaultDesignPack: undefined,
    realtimeCredential: "cookie-web-bearer-native",
    selfRenderedUiFormat: "flutter",
  }),
};

/** Every ui framework's facts. */
const FRAMEWORK_FACTS: Readonly<Record<string, FrameworkFacts>> = {
  react: {
    packFormat: "tsx",
    staticBundlePack: "mantine",
    designSlot: "pack",
    axes: requireFrontendAxes("react"),
  },
  svelte: {
    packFormat: "svelte",
    staticBundlePack: "shadcnSvelte",
    designSlot: "pack",
    axes: requireFrontendAxes("svelte"),
  },
  vue: {
    packFormat: "vue",
    staticBundlePack: "vuetify",
    designSlot: "pack",
    axes: requireFrontendAxes("vue"),
  },
  angular: {
    packFormat: "angular",
    staticBundlePack: "angularMaterial",
    designSlot: "pack",
    handBuiltFormSentences: true,
    axes: requireFrontendAxes("angular"),
  },
  phoenixLiveView: {
    packFormat: "heex",
    designSlot: "pack",
    axes: requireFrontendAxes("phoenixLiveView"),
  },
  feliz: {
    designSlot: "daisyui-theme",
    handBuiltFormSentences: true,
    axes: requireFrontendAxes("feliz"),
  },
  flutter: { designSlot: "inert", axes: requireFrontendAxes("flutter") },
};

/** The facts of a ui framework, or `undefined` for an unknown name (including
 *  `static`, which names a platform alias rather than a framework). */
export function frameworkFacts(framework: string | undefined): FrameworkFacts | undefined {
  if (framework === undefined || !Object.hasOwn(FRAMEWORK_FACTS, framework)) return undefined;
  return FRAMEWORK_FACTS[framework];
}

/** The facts of the ui framework whose design packs declare `format`. */
export function frameworkFactsForPackFormat(
  format: string | undefined,
): FrameworkFacts | undefined {
  if (format === undefined) return undefined;
  return Object.values(FRAMEWORK_FACTS).find((f) => f.packFormat === format);
}
