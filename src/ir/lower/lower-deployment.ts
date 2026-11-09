import { AstUtils, UriUtils } from "langium";
import type { Deployable, Ui } from "../../language/generated/ast.js";
import { defaultsFor } from "../../platform/adapter-metadata.js";
import { descriptorFor } from "../../platform/metadata.js";
import { frameworkFacts } from "../../platform/target-facts.js";
import { parseBuiltinDesignRef } from "../../util/builtin-formats.js";
import type { DeployableIR, Platform, UiParamBindingIR } from "../types/loom-ir.js";
import { qualifyDesign, qualifyPlatform } from "./lower-platform.js";
import { originFor } from "./origin.js";

export function lowerDeployable(d: Deployable): DeployableIR {
  const { family: platform, ref: platformRef } = qualifyPlatform(d.platform);
  // `auth: required` opts a backend into token middleware; `auth: ui`
  // mounts the login redirect + guard on a frontend under the system
  // `auth { ... }` block.  Future modes (`optional` / `forbidden`)
  // would extend this branch.
  const auth =
    d.auth === "required"
      ? { required: true, ui: false }
      : d.auth === "ui"
        ? { required: false, ui: true }
        : undefined;
  // `design` defaults only on platforms that actually render UI in this
  // deployable — keeping the IR honest about which deployables mount a
  // frontend.  The platform's `facts` say which ones do (see below).
  // D-PHOENIX-SURFACE: `hosts:` declarations the deployable serves.
  // Resolve the first hosted `Ui` node so `uiName`/`uiFramework` can
  // fall back to it (and read its own declared framework) when the
  // legacy `ui:` binding is absent.
  const hostedUis = (d.hosts ?? []).map((r) => r.ref).filter((u): u is Ui => !!u);
  const hostedUiNames = hostedUis.map((u) => u.name);
  const firstHostedUi = hostedUis[0];
  const uiName =
    d.uiSugar?.ref?.ref?.name ?? d.uiCompose?.ref?.ref?.name ?? firstHostedUi?.name ?? undefined;
  // Page-metamodel UI binding.  The grammar accepts two surface forms —
  // `ui: WebApp` (sugar) and `ui: WebApp { Sales: salesApi }` (compose).
  // Both lower to the same `uiName` + optional `uiFramework` here.
  // `uiName` is computed above so the `design` default can branch on it
  // for a backend that embeds a ui only when bound.  Validator enforces that
  // the referenced ui exists, the platform supports a UI mount, and the
  // framework value is one of the v0-allowed alternatives.
  // Precedence: the framework declared on the bound `ui` itself — whether
  // bound via `ui:` sugar / `compose` or via `hosts:` (D-PHOENIX-SURFACE
  // — the ui owns its framework) — then the platform-derived
  // default.  The bound-ui hop matters: the validator's rules 13b/14 read
  // the ui's declared framework through every binding spelling, so lowering
  // must agree or a validation-clean `ui X { framework: svelte }` + `ui: X`
  // would silently lower as the platform default.  Computed before `design`
  // so the pack default can branch on it (a phoenix host embedding react
  // needs a tsx pack, not coreComponents).
  const boundUi = d.uiSugar?.ref?.ref ?? d.uiCompose?.ref?.ref;
  const facts = descriptorFor(platform).facts;
  const uiFramework =
    boundUi?.framework ??
    firstHostedUi?.framework ??
    (uiName ? facts.defaultUiFramework : undefined);
  // The design pack defaults from what actually RENDERS — the ui's framework,
  // not the host platform: a static-asset host serves any static bundle, so a
  // `platform: react` host of a `framework: svelte` ui defaults to the svelte
  // pack, and a Phoenix host embedding a react ui needs a tsx pack.  A
  // framework with no static-bundle pack of its own takes the platform's
  // fallback.  A platform with no fallback carries no design, and a backend
  // that embeds a ui only when bound carries one only then.
  const design =
    facts.defaultDesignPack === undefined || (facts.rendersUiOnlyWhenBound && !uiName)
      ? undefined
      : qualifyDesign(
          d.design,
          frameworkFacts(uiFramework)?.staticBundlePack ?? facts.defaultDesignPack,
        );
  // Explicit api composition.
  const serves = (d.serves ?? []).map((r) => r.ref?.name ?? "").filter(Boolean);
  const uiBindings = (d.uiCompose?.bindings ?? []).map(
    (b): UiParamBindingIR => ({
      paramName: b.name,
      sourceDeployableName: b.source?.ref?.name ?? "",
    }),
  );
  // D-STORAGE-SPLIT: `contexts:` clause references bounded contexts
  // directly; `dataSources:` clause references the (context, kind)
  // bindings the deployable hosts.
  const contextNames = (d.contextRefs ?? []).map((r) => r.ref?.name ?? "").filter(Boolean);
  const dataSourceNames = (d.dataSourceRefs ?? []).map((r) => r.ref?.name ?? "").filter(Boolean);
  const channelSourceNames = (d.channelRefs ?? []).map((r) => r.ref?.name ?? "").filter(Boolean);
  // D-REALIZATION-AXES: normalize the three realization axes.  Backends fill
  // every axis with a concrete value (an absent knob → the platform default);
  // frontends (`react`/`static`) carry none — `defaultsFor` is undefined for
  // them, the validator rejects any axis written on a frontend.  Each sources
  // its default from the live adapter menu (`adapterDefaults`).
  // `application`↔adapter `style`, `directoryLayout`↔`layout`.
  const adapterDefaults = defaultsFor(platform);
  const axes =
    adapterDefaults !== undefined
      ? {
          persistence: d.persistence ?? adapterDefaults.persistence.state,
          directoryLayout: d.directoryLayout ?? adapterDefaults.layout,
        }
      : {
          persistence: undefined,
          directoryLayout: undefined,
        };
  return {
    name: d.name,
    platform,
    platformRef,
    contextNames,
    dataSourceNames,
    channelSourceNames,
    port: d.port ?? defaultPortFor(platform),
    targetName: d.targets?.ref?.name,
    auth,
    design,
    persistence: axes.persistence,
    directoryLayout: axes.directoryLayout,
    uiName,
    uiFramework,
    hostedUiNames,
    serves,
    uiBindings,
    favicon: d.favicon,
    ...designBaseDirFor(d, design),
    origin: originFor(d),
  };
}

/** The directory a relative custom `design:` path resolves against — the
 *  directory of the `.ddd` file that declares the deployable, NOT the process
 *  working directory (so `ddd generate` finds `design: "./my-pack"` from any
 *  cwd, and a deployable in an imported file resolves against its own file).
 *  Only a `file:` document has one; an in-memory model (the playground, the
 *  `src/api/` toolkit) carries none and the loader falls back to its own
 *  default. */
function designBaseDirFor(d: Deployable, design: string | undefined): { designBaseDir?: string } {
  if (design === undefined || parseBuiltinDesignRef(design) !== null) return {};
  try {
    const uri = AstUtils.getDocument(d).uri;
    if (uri.scheme !== "file") return {};
    return { designBaseDir: UriUtils.dirname(uri).fsPath };
  } catch {
    return {};
  }
}

/** Look up a platform's default deployable port via `PlatformSurface.defaultPort`.
 *  Falls back to 3000 for an unknown / undefined platform (lowering may
 *  still be running before validation surfaces the bad value). */
function defaultPortFor(platform: Platform | undefined): number {
  if (!platform) return 3000;
  try {
    return descriptorFor(platform).defaultPort;
  } catch {
    return 3000;
  }
}
