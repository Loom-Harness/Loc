// ---------------------------------------------------------------------------
// Per-SFC component imports for a Vue pack whose library would otherwise be
// registered app-wide (`pack.json` → `componentImports`).
//
// Registering a component library globally (`createVuetify({ components })`
// over `import * as components from "vuetify/components"`) puts EVERY component
// in the entry chunk, whatever the app renders — lazy routes cannot move code
// that the shell registers.  So each emitted `.vue` file instead imports exactly
// the library components its own template renders, and the pack's plugin setup
// registers none.  A page's components then ride that page's lazy chunk; the
// shell's own (app bar, drawer, list) stay in the entry.
//
// The set is DERIVED from the emitted template, not declared: every library
// tag in a `.vue` file's `<template>` (`<v-card-text …>`) is a component the
// file renders, and its PascalCase name (`VCardText`) is the library's export
// name.  Reading the final markup means a template change, a new primitive or a
// pack edit can never leave a rendered component unimported — the derivation
// sees exactly what the browser will see.  No auto-import build plugin is
// involved; the imports are ordinary source in the generated project.
// ---------------------------------------------------------------------------

import { rewrite } from "../../util/emission-sink.js";
import { upperFirst } from "../../util/naming.js";

/** The `componentImports` declaration a pack manifest carries. */
export interface ComponentImportsSpec {
  /** Tag prefix that marks a library component in markup (`"v-"`). */
  tagPrefix: string;
  /** Module every component is imported from (`"vuetify/components"`). */
  from: string;
}

/** The library components a single SFC's `<template>` renders, as sorted
 *  export names.  Comments are skipped so a `<!-- <v-x> -->` note never
 *  imports anything. */
export function templateComponents(sfc: string, spec: ComponentImportsSpec): string[] {
  const start = sfc.indexOf("<template");
  const end = sfc.lastIndexOf("</template>");
  if (start < 0 || end < start) return [];
  const markup = sfc.slice(start, end).replace(/<!--[\s\S]*?-->/g, "");
  const prefix = spec.tagPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const names = new Set<string>();
  for (const m of markup.matchAll(
    new RegExp(`<(${prefix}[a-z0-9]+(?:-[a-z0-9]+)*)(?=[\\s/>])`, "g"),
  )) {
    names.add(m[1]!.split("-").map(upperFirst).join(""));
  }
  return [...names].sort();
}

/** Add `import { … } from "<spec.from>"` to every `.vue` file in `files` that
 *  renders library components — into its `<script setup>` block, or a new one
 *  when the file has none.  Files rendering no library component are left
 *  byte-identical. */
export function addComponentImports(files: Map<string, string>, spec: ComponentImportsSpec): void {
  for (const [path, sfc] of files) {
    if (!path.endsWith(".vue")) continue;
    const names = templateComponents(sfc, spec);
    if (names.length === 0) continue;
    const decl = `import { ${names.join(", ")} } from ${JSON.stringify(spec.from)};`;
    const setupOpen = /<script\b[^>]*\bsetup\b[^>]*>/.exec(sfc);
    const next = setupOpen
      ? `${sfc.slice(0, setupOpen.index + setupOpen[0].length)}\n${decl}${sfc.slice(setupOpen.index + setupOpen[0].length)}`
      : `<script setup lang="ts">\n${decl}\n</script>\n${sfc}`;
    rewrite(files, path, next);
  }
}
