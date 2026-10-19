// ---------------------------------------------------------------------------
// Single source of truth for the built-in design packs that ship under
// `<repo>/designs/<family>/<version>/`.  Every built-in pack is
// identified by a `family@version` pair (e.g. "mantine@v9"), with the
// `family` half corresponding to a directory under `designs/` and the
// `version` half corresponding to a subdirectory inside it.
//
// Two consumers read this map:
//   1. The Node + browser pack loaders (`loader-fs.ts`, `loader-vfs.ts`)
//      decide whether a `design:` value resolves under the bundled
//      designs/ directory (built-in) or as a path relative to the .ddd
//      file (custom) via `parseBuiltinDesignRef`.
//   2. The Langium validator (`ddd-validator.ts`) uses the format value
//      to reject a `design:` whose format doesn't match the deployable's
//      framework (e.g. `platform: react, design: coreComponents` would
//      render a HEEx pack through the TSX renderer).
//
// Adding a new built-in pack version: drop the pack directory under
// `designs/<family>/<vNN>/`, add an entry to `BUILTIN_PACK_FORMATS`,
// and optionally bump `BUILTIN_PACK_LATEST[family]` once the new
// version is the recommended default.  Both consumers pick it up
// automatically; no other code edits required.
// ---------------------------------------------------------------------------

/** Output format a design pack produces.  `tsx` packs render React
 *  (JSX) markup, `heex` packs render Phoenix LiveView templates,
 *  `svelte` packs render Svelte 5 component markup, `vue` packs
 *  render Vue 3 SFC template markup, and `angular` packs render
 *  Angular standalone-component templates.  Canonical home of
 *  the union — the pack loader re-exports it so `generator/` consumers
 *  keep their import path. */
export type PackFormat = "tsx" | "heex" | "svelte" | "vue" | "angular";

export const BUILTIN_PACK_FORMATS = {
  "mantine@v9": "tsx",
  "chakra@v3": "tsx",
  "mui@v7": "tsx",
  "shadcn@v4": "tsx",
  "coreComponents@v3": "heex",
  "daisyui@v1": "heex",
  "shadcnSvelte@v1": "svelte",
  "flowbite@v1": "svelte",
  "vuetify@v3": "vue",
  "shadcnVue@v1": "vue",
  "angularMaterial@v1": "angular",
  "primeng@v1": "angular",
  "spartanNg@v1": "angular",
} as const satisfies Record<string, PackFormat>;

/** Built-in pack versions that shipped once and were removed, mapped to
 *  the successor a pin should move to.  These are the React stack-v1
 *  (React 18) packs; their stack-v3 successors are the current majors.
 *  The validator turns an explicit pin of a retired ref into
 *  `loom.design-pack-retired` naming the successor, rather than the
 *  generic "unknown version" error — the pin was valid once, so the
 *  diagnostic says what to move to. */
export const RETIRED_PACKS = {
  "mantine@v7": "mantine@v9",
  "chakra@v2": "chakra@v3",
  "mui@v5": "mui@v7",
  "shadcn@v3": "shadcn@v4",
} as const satisfies Record<string, string>;

/** The successor of a retired built-in pack ref (`"mantine@v7"` →
 *  `"mantine@v9"`), or `undefined` when `qualified` was never retired. */
export function retiredPackSuccessor(qualified: string): string | undefined {
  return (RETIRED_PACKS as Record<string, string>)[qualified];
}

/** What bareword `design: mantine` (no `@version`) resolves to in
 *  this toolchain build.  When we ship a new major version of a pack,
 *  flip the entry here and every bareword consumer rolls forward
 *  automatically — explicit pins (`design: "mantine@v9"`) are the
 *  opt-out for projects that want determinism across toolchain
 *  upgrades. */
export const BUILTIN_PACK_LATEST = {
  // The four React families resolve to their stack-v3 (React 19 +
  // Router 7 + zod 4) majors: Mantine 9, Chakra UI 3, Material UI 7, and
  // shadcn on Tailwind 4 (the playground routes its `@import "tailwindcss"`
  // CSS through `@tailwindcss/browser`).
  mantine: "v9",
  chakra: "v3",
  mui: "v7",
  shadcn: "v4",
  coreComponents: "v3",
  // The genuine-daisyUI HEEx pack ships its first version; bareword
  // `design: daisyui` resolves to daisyui@v1.  coreComponents (plain
  // Tailwind core_components) stays the elixir default; daisyui is the
  // opt-in design-system look.
  daisyui: "v1",
  // Svelte packs ship a single version each so far; barewords resolve
  // straight to v1.
  shadcnSvelte: "v1",
  flowbite: "v1",
  // Vue packs: vuetify tracks Vuetify 3 (hence v3); shadcnVue ships
  // its first pack version.
  vuetify: "v3",
  shadcnVue: "v1",
  // Angular packs ship a single version each so far; barewords resolve
  // straight to v1.  angularMaterial is the default (D-ANGULAR-FRONTEND).
  angularMaterial: "v1",
  primeng: "v1",
  spartanNg: "v1",
} as const satisfies Record<string, string>;

export type BuiltinPackFamily = keyof typeof BUILTIN_PACK_LATEST;
/** Legacy alias kept for callers that don't care about versions —
 *  semantically `BuiltinPackName` always referred to a family. */
export type BuiltinPackName = BuiltinPackFamily;

/** Resolved view of a `design:` slot value when it points at a
 *  built-in pack.  Returned by `parseBuiltinDesignRef`; carries the
 *  family + version + the canonical `family@version` form that the
 *  format map + IR field both store. */
export interface ParsedBuiltinDesignRef {
  family: BuiltinPackFamily;
  version: string;
  /** `${family}@${version}` — the canonical key into
   *  `BUILTIN_PACK_FORMATS` and the value stored in IR after
   *  lowering qualifies the bareword form. */
  qualified: string;
}

/** Parse a `design:` slot value.  Returns `null` for custom paths
 *  (anything starting with `.` or `/`) or for names that aren't a
 *  registered built-in family — both callers (loader + validator)
 *  fall through to their custom-pack / unknown-pack codepaths in
 *  those cases.
 *
 *  Accepted forms:
 *    "mantine"        → { family: "mantine", version: "v9",  qualified: "mantine@v9" }   // bareword, version from BUILTIN_PACK_LATEST
 *    "mantine@v9"     → { family: "mantine", version: "v9",  qualified: "mantine@v9" }   // explicit pin
 *    "mantine@v8"     → { family: "mantine", version: "v8",  qualified: "mantine@v8" }   // explicit pin (may not exist — caller checks via packFormatForBuiltin)
 *    "./design/foo"   → null                                                              // custom pack
 *    "frobnicator"    → null                                                              // unknown family
 */
export function parseBuiltinDesignRef(s: string): ParsedBuiltinDesignRef | null {
  // Custom path — leave to the loader's reference-dir resolution.
  if (s.startsWith(".") || s.startsWith("/")) return null;
  const at = s.indexOf("@");
  const family = (at === -1 ? s : s.slice(0, at)) as BuiltinPackFamily;
  if (!(family in BUILTIN_PACK_LATEST)) return null;
  const version = at === -1 ? BUILTIN_PACK_LATEST[family] : s.slice(at + 1);
  return { family, version, qualified: `${family}@${version}` };
}

/** Format the named built-in pack produces, or `undefined` if `name`
 *  is not a built-in or names a built-in family at an unknown
 *  version.  Used by the validator to cross-check a deployable's
 *  `design:` against its framework's expected pack format, and to
 *  emit "no such version" errors. */
export function packFormatForBuiltin(name: string): PackFormat | undefined {
  const parsed = parseBuiltinDesignRef(name);
  if (!parsed) return undefined;
  return (BUILTIN_PACK_FORMATS as Record<string, PackFormat>)[parsed.qualified];
}

/** Every version registered for a given built-in family.  Used by
 *  the validator's "unknown version" error to list the available
 *  pins for a family the user typo'd a version of. */
export function builtinVersionsForFamily(family: BuiltinPackFamily): string[] {
  const prefix = `${family}@`;
  return Object.keys(BUILTIN_PACK_FORMATS)
    .filter((k) => k.startsWith(prefix))
    .map((k) => k.slice(prefix.length))
    .sort();
}

// ---------------------------------------------------------------------------
// Feliz design themes.  Feliz renders F#, not a component-library pack — its
// design system is daisyUI, so a feliz deployable's `design:` slot selects a
// daisyUI THEME (`data-theme`) rather than a pack family.  This is daisyUI v4's
// built-in theme set.  Two consumers read it:
//   1. The validator (Rule 14, feliz branch) rejects a `design:` that isn't one
//      of these.
//   2. The Feliz generator maps `design:` → the emitted `data-theme` + the
//      compiled-in `tailwind.config.js` theme list.
// The Loom defaults (`corporate` light + `business` dark) are always available.
// ---------------------------------------------------------------------------

export const DAISYUI_THEMES: readonly string[] = [
  "light",
  "dark",
  "cupcake",
  "bumblebee",
  "emerald",
  "corporate",
  "synthwave",
  "retro",
  "cyberpunk",
  "valentine",
  "halloween",
  "garden",
  "forest",
  "aqua",
  "lofi",
  "pastel",
  "fantasy",
  "wireframe",
  "black",
  "luxury",
  "dracula",
  "cmyk",
  "autumn",
  "business",
  "acid",
  "lemonade",
  "night",
  "coffee",
  "winter",
  "dim",
  "nord",
  "sunset",
];
