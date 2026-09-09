// Macro registry.
//
// Holds the set of registered macros, keyed by name, and exposes
// lookup for the expander and validator.  Loaded from two sources:
//
//   1. The stdlib (`src/macros/stdlib/index.ts`) — bundled with the
//      toolchain, always available.
//   2. Project-local `.loom/macros/*.js` modules — discovered
//      under the workspace root when the CLI/LSP boots.  Authors
//      write `.ts`; tsc emits `.js` next to it; the loader picks
//      up the compiled output.  This avoids any runtime
//      TypeScript dependency in the toolchain itself.
//
// Registration is process-global.  Per-workspace isolation (two
// open projects with different macro libraries) would require a
// per-services-container map.

import type { MacroDefinition } from "./api/define.js";

const registry = new Map<string, MacroDefinition>();

/** Register a macro.  Re-registration with the same name throws —
 * stdlib loads first, so a project-local macro that collides with
 * stdlib triggers an explicit error rather than silent override. */
export function registerMacro(def: MacroDefinition): void {
  if (registry.has(def.name)) {
    const existing = registry.get(def.name)!;
    throw new Error(
      `Macro '${def.name}' is already registered (target=${existing.target}); ` +
        `cannot register a second definition (target=${def.target}).`,
    );
  }
  registry.set(def.name, def);
}

/** Look up a macro by name.  Returns undefined for unknown names —
 * the validator surfaces this as a user-facing diagnostic. */
export function lookupMacro(name: string): MacroDefinition | undefined {
  return registry.get(name);
}

/** All registered macros, in registration order. */
export function allMacros(): readonly MacroDefinition[] {
  return Array.from(registry.values());
}

/** Test/harness hook: wipe the registry.
 *
 * It does NOT restore anything by itself, and the stdlib in particular does
 * not come back: `loadStdlibMacros()` latches on a module-level `_loaded`
 * flag, so calling it after this is a no-op and the process is left with an
 * EMPTY registry for every later caller.  Under `isolate: false` (one module
 * graph per worker) that reaches other test FILES, as an order-dependent
 * failure whose cause looks unrelated to whichever file exposes it.
 *
 * So a caller must restore what it wiped, one of two ways:
 *   - re-register the exact prior contents (`allMacros()` before, replayed
 *     after — this preserves order, which `lookupMacro` collisions depend on), or
 *   - call `_resetStdlibLoadFlag()` from `./stdlib/index.js` and then
 *     `loadStdlibMacros()` to rebuild the stdlib half.
 *
 * The two hooks stay separate rather than being fused here because
 * `stdlib/index.ts` imports `registerMacro` from this module — reaching back
 * the other way would close an import cycle.
 * `test/system/module-global-state-census.test.ts` pins the coupling. */
export function _resetRegistryForTests(): void {
  registry.clear();
}
