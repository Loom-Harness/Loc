// Types for the plain-JS `frontend-fixture.mjs`, which the UI runners and the
// census tests share.

/** `source` with the `__FRONTEND__` / `__FRAMEWORK__` placeholders filled for
 *  `frontend` (see `frontend-fixture.mjs`). */
export function applyFrontend(source: string, frontend: string): string;
