// Types for the plain-JS `codemod-workflow-handle.mjs` (D-HANDLE-REMOVAL).
//
// The script is `.mjs` so it runs as a bare `node scripts/…` with no build
// step; its pure core is driven by `test/system/codemod-workflow-handle.test.ts`,
// and without this file that test would be asserting over `any`.  Mirrors the
// module's real exports.

/** A workflow `handle` the codemod left in place, and why. */
export interface RefusedHandle {
  workflow: string;
  handle: string;
  reason: string;
}

/** Lift every workflow `handle` in `src` into a context-level
 *  `commandHandler` written right after its workflow.  `changed` counts the
 *  lifted handles; `refused` names the ones left in place (marked with a
 *  `// codemod-workflow-handle: not lifted — …` line).  Neither ⇒ `text` is
 *  `src` unchanged. */
export function liftWorkflowHandles(src: string): {
  text: string;
  changed: number;
  refused: RefusedHandle[];
};
