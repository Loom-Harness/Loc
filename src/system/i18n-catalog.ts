import { sourceText } from "../generator/_i18n/source-text.js";
import { collectWireValidationMessages } from "../generator/_i18n/validation-catalog.js";
import { loadPack, resolvePackDir } from "../generator/_packs/loader-fs.js";
import { packChromeCatalog } from "../generator/_packs/pack-chrome.js";
import {
  chromeMergedWhenEnabled,
  HAND_BUILT_FORM_SENTENCES,
} from "../generator/_walker/i18n-chrome.js";
import { collectUiMessages } from "../generator/_walker/i18n-extract.js";
import type { BoundedContextIR, EnrichedSystemIR, UiIR } from "../ir/types/loom-ir.js";
import { isMacroEmitted, type OriginRef, type SourceRef } from "../ir/types/origin.js";
import { packFormatForBuiltin } from "../util/builtin-formats.js";
import { isModelTextKey, SYSTEM_TEXT_NS } from "../util/model-text-key.js";

// ---------------------------------------------------------------------------
// `<system>/.loom/messages.<source>.json` artifact (M-T1.11, i18n.md).
//
// The source-language message catalog: every user-visible string
// extracted from the system's UIs, keyed by its stable content-hash key
// (D-I18N-KEY).  One flat `{ key: message }` object, keys sorted, one per line
// — the translator-friendly shape from i18n.md open-question #3, and the diff
// surface `ddd i18n sync` merges each locale against.
//
// Derived at emit time from the enriched IR (mirrors `wire-spec.ts`); nothing
// is stamped on the model.  Emitted for every system, even an empty one — a
// stable `{}` is a valid, mergeable catalog and keeps the artifact's presence
// unconditional (no "sometimes there, sometimes not" for downstream tooling).
// ---------------------------------------------------------------------------

/** Every DESIGN PACK a UI is rendered through, as declared-chrome catalogs
 *  (`pack.<family>.<role>.<hash>` → English).
 *
 *  A pack bakes user-visible English into its own `.hbs` templates ("Remove",
 *  "This operation has no parameters."), which no IR walk can see — so the
 *  translator-facing catalog has to read it off the pack itself.  Resolved from
 *  the model (`deployable.design`), like every other derivation here: nothing
 *  is stamped, and `ddd i18n extract` reaches the same strings without running
 *  codegen.
 *
 *  Scoped to BUILT-IN packs, decided by pure data (`packFormatForBuiltin`) so
 *  no unresolvable `design:` can throw here.  An out-of-tree custom pack's
 *  chrome still reaches the generated app's own `locales/en.json` (that path
 *  has the loaded pack in hand); it does not reach `.loom/messages.en.json`. */
function packChromeForUi(sys: EnrichedSystemIR, ui: UiIR): Record<string, string> {
  const out: Record<string, string> = {};
  for (const dep of sys.deployables) {
    const design = dep.design;
    if (!design) continue;
    if (dep.uiName !== ui.name && !(dep.hostedUiNames ?? []).includes(ui.name)) continue;
    // Feliz and Flutter render no `.hbs` pack (their widgets are emitted
    // procedurally), so a `design` they carry — Feliz's daisyUI theme, or the
    // frontend default — names chrome no view of theirs can read.
    if (dep.platform === "feliz" || dep.platform === "flutter") continue;
    if (packFormatForBuiltin(design) === undefined) continue;
    Object.assign(
      out,
      packChromeCatalog(loadPack(resolvePackDir(design, dep.designBaseDir)).manifest),
    );
  }
  return out;
}

/** The sentence bases (`PackManifest.sentenceChrome`) the packs rendering a UI
 *  read — the per-operation / per-item-type sentences those packs consume. */
function packSentencesForUi(sys: EnrichedSystemIR, ui: UiIR): string[] {
  const out = new Set<string>();
  for (const dep of sys.deployables) {
    const design = dep.design;
    if (!design) continue;
    if (dep.uiName !== ui.name && !(dep.hostedUiNames ?? []).includes(ui.name)) continue;
    if (dep.platform === "flutter") continue;
    if (dep.platform === "feliz" || packFormatForBuiltin(design) === "angular") {
      for (const base of HAND_BUILT_FORM_SENTENCES) out.add(base);
      continue;
    }
    if (packFormatForBuiltin(design) === undefined) continue;
    const manifest = loadPack(resolvePackDir(design, dep.designBaseDir)).manifest;
    for (const base of manifest.sentenceChrome ?? []) out.add(base);
  }
  return [...out].sort();
}

/** The frontend formats that key their implicit model-text sites (form
 *  labels, enum options, submit buttons) by identity — the formats whose walker
 *  target sets `WalkerTarget.modelTextImplicitSites`, plus the HEEx packs
 *  (`src/generator/elixir/heex-model-text.ts`).  A pack-rendered UI is named by
 *  its design pack's format; the pack-less Feliz and Flutter frontends by their
 *  platform. */
export const IMPLICIT_MODEL_TEXT_FORMATS: ReadonlySet<string> = new Set([
  "tsx",
  "vue",
  "svelte",
  "angular",
  "feliz",
  "flutter",
  "heex",
]);

/** The frontend format a deployable renders its UI in: the platform for the
 *  pack-less Feliz and Flutter frontends, else its design pack's format (a
 *  pack that names none is React), else none. */
function deployableUiFormat(dep: EnrichedSystemIR["deployables"][number]): string | undefined {
  if (dep.platform === "feliz" || dep.platform === "flutter") return dep.platform;
  if (dep.design === undefined) return undefined;
  return packFormatForBuiltin(dep.design) ?? "tsx";
}

/** The formats, among {@link IMPLICIT_MODEL_TEXT_FORMATS}, of the frontends
 *  that render `ui` — empty when none keys its implicit model text. */
function implicitModelTextFormats(sys: EnrichedSystemIR, ui: UiIR): Set<string> {
  const out = new Set<string>();
  for (const dep of sys.deployables) {
    if (dep.uiName !== ui.name && !(dep.hostedUiNames ?? []).includes(ui.name)) continue;
    const format = deployableUiFormat(dep);
    if (format !== undefined && IMPLICIT_MODEL_TEXT_FORMATS.has(format)) out.add(format);
  }
  return out;
}

/** Whether a Feliz or Flutter deployable rendering `ui` draws the generated
 *  session gate: it opts in with `auth: ui`, its target backend enforces auth,
 *  and the system declares a `user { }` claim shape — the conjunction those two
 *  generators call `authUi`. */
function uiDrawsAuthGate(sys: EnrichedSystemIR, ui: UiIR): boolean {
  return sys.deployables.some((dep) => {
    if (dep.platform !== "feliz" && dep.platform !== "flutter") return false;
    if (dep.uiName !== ui.name && !(dep.hostedUiNames ?? []).includes(ui.name)) return false;
    const target = sys.deployables.find((d) => d.name === dep.targetName);
    return !!(dep.auth?.ui && target?.auth?.required && sys.user);
  });
}

/** Build the flat, key-sorted `{ key: message }` catalog for a system. */
export function buildMessageCatalog(sys: EnrichedSystemIR): Record<string, string> {
  const byKey = new Map<string, string>();
  for (const ui of sys.uis) {
    for (const { key, message } of collectUiMessages(ui, sys.layouts)) {
      // Same key ⇒ same content hash ⇒ same message; last-writer-wins is a
      // no-op that also collapses the same string used at many call sites.
      byKey.set(key, message);
    }
  }
  // Always-rendered app-shell chrome (404 text, skip link) plus each UI's
  // design-pack DECLARED chrome — merged only when the system is already
  // i18n-enabled by its authored strings (the shell emitters' gate), so a
  // string-less system stays `{}` and its generated projects stay
  // byte-identical.
  if (byKey.size > 0) {
    for (const [key, message] of Object.entries(chromeMergedWhenEnabled())) byKey.set(key, message);
    // Per-aggregate / per-operation / per-item-type whole sentences.
    const contexts = sys.subdomains.flatMap((sub) => sub.contexts);
    for (const ui of sys.uis) {
      const formats = implicitModelTextFormats(sys, ui);
      const scope = {
        contexts,
        sentences: packSentencesForUi(sys, ui),
        implicitModelText: formats.size > 0,
        // The HEEx create form renders optional inputs too (it has no update
        // flow to defer them to), so their labels are catalogued.
        optionalCreateInputs: formats.has("heex"),
        authGate: uiDrawsAuthGate(sys, ui),
        fallbackLabels: formats.has("heex"),
      };
      for (const [key, message] of Object.entries(chromeMergedWhenEnabled(ui, scope)))
        byKey.set(key, message);
      for (const [key, message] of Object.entries(packChromeForUi(sys, ui)))
        byKey.set(key, message);
    }
  }
  // BACKEND validation messages — a NAMED `invariant` / `check` /
  // `precondition`, keyed by its identity key `<Ctx>.<Owner>.rule.<name>`, the
  // code the wire validators put on `errors[].code` and every backend's own
  // catalog is keyed by.  Merged in AFTER the chrome gate deliberately: these are server-side
  // strings, so a UI-less system with named rules has a real catalog
  // to translate without pulling in app-shell chrome no frontend renders.
  for (const sub of sys.subdomains) {
    for (const { code, text } of collectWireValidationMessages(sub.contexts)) byKey.set(code, text);
  }
  const out: Record<string, string> = {};
  for (const key of [...byKey.keys()].sort()) out[key] = sourceText(key, byKey.get(key)!);
  return out;
}

/** Render the `.loom/messages.en.json` artifact for a system. */
export function renderMessageCatalog(sys: EnrichedSystemIR): string {
  return JSON.stringify(buildMessageCatalog(sys), null, 2) + "\n";
}

/** The `.ddd` span a catalog entry points at: a written span as is, a macro
 *  expansion at its `with <macro>(…)` call. */
function sourceRefOf(origin: OriginRef | undefined): SourceRef | undefined {
  if (origin?.kind === "source") return origin;
  if (origin?.kind === "macro" && isMacroEmitted(origin)) return origin.call;
  return undefined;
}

/** The declaration of the type a model-identity key names, and the member
 *  within it when the facet names one — the most specific origin the IR holds. */
function modelTextDeclaration(
  contexts: readonly BoundedContextIR[],
  key: string,
): OriginRef | undefined {
  const ns = key.split(".")[0]!;
  // A system-level type is folded into every context, so any of them carries it.
  const homes = ns === SYSTEM_TEXT_NS ? contexts : contexts.filter((c) => c.name === ns);
  for (const bc of homes) {
    const origin = declarationIn(bc, key);
    if (origin) return origin;
  }
  return undefined;
}

function declarationIn(bc: BoundedContextIR, key: string): OriginRef | undefined {
  const [, type, facet, member] = key.split(".") as [string, string, string, string | undefined];
  const agg = bc.aggregates.find((a) => a.name === type || a.parts?.some((p) => p.name === type));
  if (agg) {
    if (type === agg.name && member !== undefined) {
      if (facet === "field") return agg.fields.find((f) => f.name === member)?.origin ?? agg.origin;
      if (facet === "op") {
        return [...agg.operations, ...agg.creates].find((o) => o.name === member)?.origin;
      }
    }
    return agg.origin;
  }
  const vo = bc.valueObjects.find((v) => v.name === type);
  if (vo) {
    if (facet === "field" && member !== undefined) {
      return vo.fields.find((f) => f.name === member)?.origin ?? vo.origin;
    }
    return vo.origin;
  }
  const en = bc.enums.find((e) => e.name === type);
  if (en) return en.origin;
  return bc.workflows.find((w) => w.name === type)?.origin;
}

/** Where each catalog key was written in the `.ddd` source: `key → spans`.
 *
 *  A page literal sits where it is written.  A model-identity key
 *  (`<Ctx>.<Type>.field.<f>`) is the fact's declaration when the IR holds one —
 *  the translator reads the model element, not a page that happens to show it —
 *  and otherwise the `label(…)` call that names it.  Text no source wrote
 *  (design-pack chrome, app-shell chrome) has no entry. */
export function buildMessageSites(sys: EnrichedSystemIR): Map<string, SourceRef[]> {
  const contexts = sys.subdomains.flatMap((sub) => sub.contexts);
  const sites = new Map<string, SourceRef[]>();
  const add = (key: string, ref: SourceRef | undefined): void => {
    if (!ref) return;
    const list = sites.get(key) ?? [];
    if (!list.some((r) => r.path === ref.path && r.span.start === ref.span.start)) list.push(ref);
    sites.set(key, list);
  };
  for (const ui of sys.uis) {
    for (const entry of collectUiMessages(ui)) {
      if (isModelTextKey(entry.key)) {
        add(entry.key, sourceRefOf(modelTextDeclaration(contexts, entry.key)));
      }
      add(entry.key, sourceRefOf(entry.origin));
    }
  }
  for (const { code } of sys.subdomains.flatMap((sub) =>
    collectWireValidationMessages(sub.contexts),
  )) {
    add(code, sourceRefOf(modelTextDeclaration(contexts, code)));
  }
  return sites;
}
