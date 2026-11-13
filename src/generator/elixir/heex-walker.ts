// ---------------------------------------------------------------------------
// HEEx walker — the public entry the LiveView emitters import.
//
// A HEEx page or component body renders on the shared walker core through
// `heexTarget` (`heex-target.ts`); `heex-walker-core.ts` holds the walk
// context, the entry (`walkBodyToHeex`) and the HEEx expression renderer.
// ---------------------------------------------------------------------------

export * from "./heex-walker-core.js";
