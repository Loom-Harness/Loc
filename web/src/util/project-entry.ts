// The file a multi-file workspace is planned and generated from.
//
// Pure: the root vitest suite imports it.

/** A `system` declaration at the start of a line, outside a `//` comment. */
const SYSTEM_DECL = /^[ \t]*system\s+[A-Za-z_]\w*\s*\{/m;

const MAIN = "/workspace/main.ddd";

function declaresSystem(source: string): boolean {
  return SYSTEM_DECL.test(source.replace(/\/\*[\s\S]*?\*\//g, ""));
}

/** The project's entry: the file that declares the `system`.  The active
 *  file wins when it declares one (a workspace may hold several systems),
 *  then `main.ddd`, then the first other file in path order.  A workspace
 *  with no `system` anywhere keeps the active file, so a lone-file model
 *  still validates and reports its own errors.  `activeText` is the
 *  editor's live text, which may be ahead of `files`. */
export function projectEntryPath(
  files: ReadonlyMap<string, string>,
  activePath: string,
  activeText: string,
): string {
  if (declaresSystem(activeText)) return activePath;
  const candidates = [...files]
    .filter(([path, content]) => path !== activePath && path.endsWith(".ddd") && declaresSystem(content))
    .map(([path]) => path)
    .sort((a, b) => (a === MAIN ? -1 : b === MAIN ? 1 : a.localeCompare(b)));
  return candidates[0] ?? activePath;
}
