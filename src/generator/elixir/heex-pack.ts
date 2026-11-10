// The procedural HEEx pack the shared walker core renders Phoenix LiveView
// primitives through.
//
// A `LoadedPack` keyed by the shared `primitive-*` template names, rendered by
// TypeScript functions rather than `.hbs` templates (the Feliz pack's shape).
// HEEx has one component convention, so the markup a primitive renders is
// fixed here; the HEEx DESIGN packs (`designs/coreComponents`,
// `designs/daisyui`) own the shell those components come from.
//
// No primitive renders through it yet: every node of a HEEx body goes back to
// the HEEx engine through `heexTarget.renderNodeOverride`.  A name it has no
// renderer for answers with a visible give-up comment, never silent markup.

import type { LoadedPack } from "../_packs/loader.js";
import { giveUpText } from "../_walker/give-up.js";

type Renderer = (ctx: Record<string, unknown>) => string;

/** `primitive-*` template name → its HEEx renderer. */
const RENDERERS: Record<string, Renderer> = {};

export function heexPack(): LoadedPack {
  return {
    manifest: { name: "heexProcedural", version: "v1", format: "tsx", emits: {}, imports: {} },
    rootDir: "<heex-procedural>",
    templates: new Map(),
    // Pack chrome is translated by the HEEx engine itself (`pgettext`), so the
    // shared pack-chrome switch has nothing to bind here.
    setChromeI18n() {},
    render(name: string, context: unknown): string {
      const fn = RENDERERS[name];
      if (!fn) {
        return `<%!-- ${giveUpText("loom.page-primitive-target-gap", `heex pack: no renderer for "${name}"`)} --%>`;
      }
      return fn((context ?? {}) as Record<string, unknown>);
    },
  };
}
