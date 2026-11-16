// A frontend fixture is one `.ddd` built once per frontend.  Two placeholders
// carry the frontend: `__FRONTEND__` is the ui deployable's `platform:`, and
// `__FRAMEWORK__` sits first in the ui body for its `framework:` clause.  The
// static-bundle frameworks (react, vue, svelte, angular) render on
// `platform: web` with the clause; feliz and flutter are platforms of their
// own and need no clause.

const SELF_HOSTED = new Set(["feliz", "flutter"]);

/** `source` with both placeholders filled for `frontend`. */
export function applyFrontend(source, frontend) {
  const own = SELF_HOSTED.has(frontend);
  return source
    .replaceAll("__FRONTEND__", own ? frontend : "web")
    .replaceAll("__FRAMEWORK__", own ? "" : `framework: ${frontend}`);
}
