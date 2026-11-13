// The operations a generated Phoenix project documents, read the way
// `OpenApiSpex.Paths.from_router/1` reads them: every route in the router's
// `scope "/api"` whose controller action declares an `operation` spec.
//
// The spec module carries no paths of its own; each documented operation sits
// on its controller action (`use OpenApiSpex.ControllerSpecs`).  This joins
// the two so a test can ask "what does `post /api/orders/{id}/cancel`
// declare?" without booting the app.

/** `"<method> /api/<path with {params}>"` → the `operation :<action>, …` text. */
export function elixirDocumentedOperations(files: Map<string, string>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [routerPath, router] of files) {
    if (!routerPath.endsWith("_web/router.ex")) continue;
    const root = routerPath.slice(0, routerPath.lastIndexOf("/lib/") + 1);
    const web = router.match(/^defmodule (\w+)\.Router do$/m)?.[1];
    const scope = router.match(/scope "\/api", \w+ do[\s\S]*?\n {2}end/)?.[0] ?? "";
    for (const m of scope.matchAll(
      /^ {4}(get|post|put|patch|delete) "([^"]*)", (\w+), :(\w+)$/gm,
    )) {
      const [, method, path, controller, action] = m;
      const module = [...files].find(
        ([p, c]) => p.startsWith(root) && c.includes(`\ndefmodule ${web}.${controller} do\n`),
      )?.[1];
      const spec = module?.match(
        new RegExp(`^ {2}operation :${action},\\n[\\s\\S]*?(?=\\n\\n)`, "m"),
      )?.[0];
      if (spec) out.set(`${method} /api${path.replace(/:(\w+)/g, "{$1}")}`, spec);
    }
  }
  return out;
}

/** Every operation documented at one path (any method), joined; `path` is
 *  `/api/…` with `{params}`.  Empty when the path documents nothing. */
export function elixirOperationsAt(files: Map<string, string>, path: string): string {
  return [...elixirDocumentedOperations(files)]
    .filter(([k]) => k.slice(k.indexOf(" ") + 1) === path)
    .map(([, spec]) => spec)
    .join("\n\n");
}

/** Every operation's text, joined — for an assertion over the whole document. */
export function elixirOperationsText(files: Map<string, string>): string {
  return [...elixirDocumentedOperations(files).values()].join("\n\n");
}
