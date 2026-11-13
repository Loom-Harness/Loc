// ---------------------------------------------------------------------------
// Dynamic-row binding — the rows of an `objectArray` form field
// (`riders: Rider[]`) on the JSX-family frontends.
//
// A row's fields render through the pack's own single-field templates, so an
// enum row field is the pack's enum select, an `X id` its picker, a `bool` its
// checkbox — the same input the field gets at the top level of a form.  Those
// templates bind a STATIC path and test id; a row needs both indexed by the
// row's loop variable (`index`).  So each row field is rendered with sentinel
// paths, and the framework's binder rewrites every sentinel site into an
// index-bound binding:
//
//   ROW_PATH.code        "…" (string)   → `riders.${index}.code`
//                        form.values.…  → form.values.riders[index].code
//   ROW_ID-code          attr="…"       → the framework's bound attribute
//                        `…` (template) → riders-${index}-code
//
// The binding sites a single-field template uses are a closed set per
// framework; a sentinel the binder does not recognise throws, so a pack that
// grows a new binding shape fails generation instead of shipping a row input
// bound to nothing.
// ---------------------------------------------------------------------------

import type { FormFieldVM } from "./view-models.js";

/** The path sentinel a row field renders under. */
const ROW_PATH = "__loomRow__";
/** The test-id sentinel a row field renders under. */
const ROW_ID = "__loomRowId__";

export interface RowBindingField {
  /** The array field's form path (`riders`, `cover.riders`). */
  arrayPath: string;
  /** The array field's test id; a row field's id is `<testId>-<index>-<sub>`. */
  testId: string;
}

/** Rewrites a row's sentinel-bound markup into index-bound markup. */
export type RowBinder = (f: RowBindingField, html: string) => string;

/** One row field re-rooted under the sentinels: its path and every
 *  descendant's under {@link ROW_PATH}, its test ids under the row id, and
 *  its error access through the row element (`errorAccess` builds the
 *  framework's access for a dotted path relative to the row). */
export function rowInputVM(
  vm: FormFieldVM,
  arrayTestId: string,
  errorAccess: (rowRelativePath: string) => string,
): FormFieldVM {
  const rebase = (v: FormFieldVM): FormFieldVM => ({
    ...v,
    path: `${ROW_PATH}.${v.path}`,
    testId: v.testId.startsWith(`${arrayTestId}-`)
      ? `${ROW_ID}-${v.testId.slice(arrayTestId.length + 1)}`
      : v.testId,
    errorExpr: errorAccess(v.path),
    ...(v.children ? { children: v.children.map(rebase) } : {}),
  });
  return rebase(vm);
}

/** `riders.${index}.code` — the row path as the inside of a template literal. */
function indexedPath(arrayPath: string, sub: string): string {
  return `${arrayPath}.\${index}${sub}`;
}

/** `riders[index].code` — the row path as a property access. */
function accessPath(arrayPath: string, sub: string): string {
  return `${arrayPath}[index]${sub}`;
}

const SUB = "((?:\\.[A-Za-z_$][\\w$]*)*)";
const ID_SUB = "((?:-[\\w-]*)?)";

/** The rewrites every framework shares: a quoted path string becomes a
 *  template literal, `form.values.<path>` a property access, and a test id
 *  already inside a template literal splices the index raw. */
function common(f: RowBindingField, html: string, quotedPath: (lit: string) => string): string {
  const rowId = `${f.testId}-\${index}`;
  return html
    .replace(
      new RegExp(`form\\.values\\.${ROW_PATH}${SUB}`, "g"),
      (_m, sub: string) => `form.values.${accessPath(f.arrayPath, sub)}`,
    )
    .replace(new RegExp(`"${ROW_PATH}${SUB}"`, "g"), (_m, sub: string) =>
      quotedPath(`\`${indexedPath(f.arrayPath, sub)}\``),
    )
    .replace(new RegExp(`(\`[^\`]*?)${ROW_ID}`, "g"), (_m, pre: string) => `${pre}${rowId}`);
}

/** Throw when a sentinel survived the rewrite. */
function settled(html: string): string {
  if (html.includes(ROW_PATH) || html.includes(ROW_ID)) {
    const at = html.split("\n").find((l) => l.includes(ROW_PATH) || l.includes(ROW_ID));
    throw new Error(`dynamic-row field: an unrecognised binding site in the row markup: ${at}`);
  }
  return html;
}

/** JSX: a quoted attribute becomes an expression attribute. */
const react: RowBinder = (f, html) => {
  const rowId = `${f.testId}-\${index}`;
  const out = html
    // `name="__loomRow__.code"` → `name={`riders.${index}.code`}`
    .replace(
      new RegExp(`([\\w-]+)="${ROW_PATH}${SUB}"`, "g"),
      (_m, attr: string, sub: string) => `${attr}={\`${indexedPath(f.arrayPath, sub)}\`}`,
    )
    .replace(
      new RegExp(`([\\w-]+)="${ROW_ID}${ID_SUB}"`, "g"),
      (_m, attr: string, sub: string) => `${attr}={\`${rowId}${sub}\`}`,
    );
  return settled(common(f, out, (lit) => lit));
};

/** Vue: a static attribute becomes a `:`-bound one. */
const vue: RowBinder = (f, html) => {
  const rowId = `${f.testId}-\${index}`;
  const out = html.replace(
    new RegExp(`(\\s)([\\w-]+)="${ROW_ID}${ID_SUB}"`, "g"),
    (_m, ws: string, attr: string, sub: string) => `${ws}:${attr}="\`${rowId}${sub}\`"`,
  );
  return settled(common(f, out, (lit) => lit));
};

/** Svelte: a static attribute becomes an expression attribute. */
const svelte: RowBinder = (f, html) => {
  const rowId = `${f.testId}-\${index}`;
  const out = html.replace(
    new RegExp(`([\\w-]+)="${ROW_ID}${ID_SUB}"`, "g"),
    (_m, attr: string, sub: string) => `${attr}={\`${rowId}${sub}\`}`,
  );
  return settled(common(f, out, (lit) => lit));
};

/** The binder per JSX-family framework. */
const ROW_BINDERS: Record<"react" | "vue" | "svelte", RowBinder> = { react, vue, svelte };

export function rowBinderFor(framework: string): RowBinder | undefined {
  return (ROW_BINDERS as Record<string, RowBinder>)[framework];
}
