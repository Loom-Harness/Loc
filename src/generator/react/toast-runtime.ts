// The React `toast(<msg>)` effect surface — `src/lib/toast.ts` in the
// generated project.
//
// The module SOURCE and the two IR predicates that gate it are
// framework-neutral and now live in `_frontend/toast-effect.ts`, shared with
// the Svelte shells (which need the identical surface for the identical
// reason — F50, the Svelte twin of React's F3).  What stays React's is only
// the emitted PATH.

import { DOM_TOAST_SOURCE } from "../_frontend/toast-effect.js";

export { uiUsesToastEffect, usesToastEffect } from "../_frontend/toast-effect.js";

/** `src/lib/toast.ts` — the generated project's toast effect. */
export const REACT_LIB_TOAST = DOM_TOAST_SOURCE;

/** The emitted module's path inside the generated project. */
export const REACT_LIB_TOAST_PATH = "src/lib/toast.ts";
