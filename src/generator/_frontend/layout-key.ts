/** The key prefix of a named layout's slot text as rendered in `ui`:
 *  `<Ui>.layout.<Layout>`.  The ui name leads, like every authored key, so the
 *  translator tree files the text under that ui's namespace. */
export function layoutKeyPrefix(ui: { name: string }, layout: { name: string }): string {
  return `${ui.name}.layout.${layout.name}`;
}
