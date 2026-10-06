// ---------------------------------------------------------------------------
// Design-pack DEFECTS — the single list of "this pack cannot be rendered".
//
// A custom `design: "<path>"` is a user-supplied directory, and it can be
// malformed in many ways: no `pack.json`, no `emits`, a missing `.hbs`, an
// unknown `stack`, a missing required primitive, a bad chrome message, an
// undeclared chrome role, an ICU hole in a HEEx template, a `shellFiles` key
// not in `emits`, a template that does not parse.  Each check is a function
// that RETURNS defects rather than throwing, and two consumers read the list:
//
//   - the loader (`compilePack`, `loader-fs.ts#loadPack`) throws ONE
//     `loom.design-pack-invalid` error naming the defects, so a caller that
//     skipped validation still fails with the coded message; and
//   - phase ⑦ (`src/ir/validate/checks/design-pack-checks.ts`) gets the list
//     from a `DesignPackInspector` and raises the same code as a diagnostic
//     before codegen runs.
//
// Browser-safe: no `node:*` import.  The filesystem half (reading `pack.json`
// and the `.hbs` files) is `loader-fs.ts#inspectPackDir`; what the manifest
// plus the template SOURCES show is decided here, so the playground's VFS
// loader gets the same checks through `compilePack`.  The defect vocabulary
// itself is `src/util/design-pack-defects.ts`, shared with phase ⑦.
// ---------------------------------------------------------------------------

import Handlebars from "handlebars";
import type { PackFormat } from "../../util/builtin-formats.js";
import type { PackDefect } from "../../util/design-pack-defects.js";
import type { PackManifest } from "./loader.js";
import { flattenRequired, REQUIRED_PRIMITIVES } from "./required-primitives.js";

export {
  type DesignPackInspector,
  describePackDefects,
  type PackDefect,
  type PackInspection,
} from "../../util/design-pack-defects.js";

const KNOWN_FORMATS: readonly PackFormat[] = ["tsx", "heex", "svelte", "vue", "angular"];

/** True when a manifest's `format` names a format the toolchain renders. */
export function isKnownPackFormat(format: unknown): format is PackFormat {
  return KNOWN_FORMATS.includes(format as PackFormat);
}

/** Characters a declared chrome message may not contain.
 *
 *  Every one of them is significant to a grammar the message is spliced into
 *  UNQUOTED on the i18n-OFF path: `<`/`>` open a tag (and close an EEx `%>`),
 *  `"` closes the attribute form's delimiter, `\` and a backtick and `${`
 *  reopen a JS string.  Rejected at load time rather than escaped, because the
 *  OFF path's whole guarantee is that the bytes are the ones the pack author
 *  wrote — an escape would silently change them. */
const FORBIDDEN_IN_MESSAGE = /[<>"\\`]|\$\{/;

/** An ICU hole: `{name}`.  Holes are the ONLY braces a message may carry. */
export const CHROME_HOLE = /\{(\w+)\}/g;

/** The chrome helpers whose first (or, for `chromeAttr`, second) positional
 *  argument is a declared role — see `pack-chrome.ts#chromeHelpers`. */
const CHROME_ROLE_ARG: Record<string, number> = { chrome: 0, chromeValue: 0, chromeAttr: 1 };

/** Defects in the manifest's `chrome` declaration. */
export function chromeDeclarationDefects(manifest: {
  name: string;
  chrome?: Record<string, string>;
}): PackDefect[] {
  const out: PackDefect[] = [];
  const chrome = manifest.chrome;
  if (chrome == null) return out;
  for (const [role, message] of Object.entries(chrome)) {
    if (typeof message !== "string" || message === "") {
      out.push({
        kind: "chrome-message-empty",
        message: `chrome role "${role}" has a non-string or empty message`,
      });
      continue;
    }
    if (FORBIDDEN_IN_MESSAGE.test(message)) {
      out.push({
        kind: "chrome-message-forbidden-char",
        message: `chrome role "${role}" contains a character that is significant to the markup it is spliced into (< > " \\ \` \${): ${JSON.stringify(message)}`,
      });
    }
    const bare = message.replace(CHROME_HOLE, "");
    if (bare.includes("{") || bare.includes("}")) {
      out.push({
        kind: "chrome-message-brace",
        message: `chrome role "${role}" has an unbalanced or non-ICU brace: ${JSON.stringify(message)} (braces are only allowed as ICU holes, {name})`,
      });
    }
  }
  return out;
}

interface HbsNode {
  type?: string;
  [k: string]: unknown;
}

/** Every node of a Handlebars AST, depth-first. */
function* walkHbs(node: unknown): Generator<HbsNode> {
  if (Array.isArray(node)) {
    for (const n of node) yield* walkHbs(n);
    return;
  }
  if (node == null || typeof node !== "object") return;
  const n = node as HbsNode;
  if (typeof n.type === "string") yield n;
  for (const [k, v] of Object.entries(n)) {
    if (k === "loc" || k === "strip" || k === "openStrip" || k === "closeStrip") continue;
    if (v != null && typeof v === "object") yield* walkHbs(v);
  }
}

/** Defects a template's SOURCE shows statically: it does not parse, it names
 *  a chrome role the pack never declared, it passes ICU hole values on a HEEx
 *  pack (gettext cannot substitute them — `pack-chrome.ts#bind`), or it
 *  includes a partial no template provides.  Only literal role / partial
 *  names are checked; a computed one is the renderer's to resolve. */
function templateSourceDefects(
  templateName: string,
  source: string,
  manifest: { chrome?: Record<string, string> },
  format: PackFormat,
  partialNames: ReadonlySet<string>,
): PackDefect[] {
  let ast: unknown;
  try {
    ast = Handlebars.parse(source);
  } catch (err) {
    const reason = (err instanceof Error ? err.message : String(err)).split("\n")[0];
    return [
      {
        kind: "template-syntax",
        message: `template "${templateName}" is not valid Handlebars: ${reason}`,
      },
    ];
  }
  const out: PackDefect[] = [];
  const seen = new Set<string>();
  const push = (d: PackDefect) => {
    if (seen.has(d.message)) return;
    seen.add(d.message);
    out.push(d);
  };
  for (const node of walkHbs(ast)) {
    if (node.type === "PartialStatement" || node.type === "PartialBlockStatement") {
      const name = node.name as HbsNode | undefined;
      // `{{> foo}}` parses its name as a PathExpression; `{{> (expr)}}` is a
      // dynamic partial (SubExpression) and `{{> @partial-block}}` is the
      // block's own body — neither is a name to look up.
      if (name?.type === "PathExpression" && typeof name.original === "string") {
        const partial = name.original;
        if (!partial.startsWith("@") && !partialNames.has(partial)) {
          push({
            kind: "partial-unknown",
            message: `template "${templateName}" includes partial "${partial}", which no template in the pack (or its shared layer) provides`,
          });
        }
      }
      continue;
    }
    if (
      node.type !== "MustacheStatement" &&
      node.type !== "SubExpression" &&
      node.type !== "BlockStatement"
    ) {
      continue;
    }
    const path = node.path as HbsNode | undefined;
    const helper = path?.type === "PathExpression" ? (path.original as string) : undefined;
    if (helper === undefined || !(helper in CHROME_ROLE_ARG)) continue;
    const roleArg = (node.params as HbsNode[] | undefined)?.[CHROME_ROLE_ARG[helper]];
    if (roleArg?.type !== "StringLiteral") continue;
    const role = String(roleArg.value);
    if (manifest.chrome?.[role] === undefined) {
      push({
        kind: "chrome-role-undeclared",
        message: `template "${templateName}" uses chrome role "${role}", which pack.json's \`chrome\` map does not declare`,
      });
    }
    const pairs = (node.hash as HbsNode | undefined)?.pairs as unknown[] | undefined;
    if (format === "heex" && pairs !== undefined && pairs.length > 0) {
      push({
        kind: "chrome-hole-heex",
        message: `template "${templateName}" passes ICU hole values to chrome role "${role}", which the heex format does not render (split the sentence or drop the hole)`,
      });
    }
  }
  return out;
}

/** Every defect that the manifest plus the template sources show — what
 *  `compilePack` refuses before compiling.  `sources[logicalName]` is the
 *  pack's own template for each `emits` entry (absent when the file could not
 *  be read); `sharedSources` is the format's shared layer plus any stack
 *  partials. */
export function manifestDefects(
  manifest: PackManifest,
  sources: Record<string, string>,
  sharedSources: Record<string, string>,
  options: { validateRequired?: boolean; scanTemplates?: boolean } = {},
): PackDefect[] {
  const out: PackDefect[] = [];
  const emits = manifest.emits as unknown;
  if (emits == null || typeof emits !== "object" || Array.isArray(emits)) {
    out.push({
      kind: "emits-missing",
      message: `pack.json has no \`emits\` map (add { "emits": { "page-list": "page-list.hbs", ... } })`,
    });
    return out;
  }
  const format = (manifest.format ?? "tsx") as PackFormat;
  if (!isKnownPackFormat(format)) {
    out.push({
      kind: "format-unknown",
      message: `pack.json declares format "${String(manifest.format)}"; the formats are ${KNOWN_FORMATS.join(", ")}`,
    });
    return out;
  }
  for (const [logicalName, fileName] of Object.entries(manifest.emits)) {
    if (sources[logicalName] == null) {
      out.push({
        kind: "template-missing",
        message: `template "${logicalName}" → ${JSON.stringify(fileName)} not found`,
      });
    }
  }
  const available = new Set([...Object.keys(manifest.emits), ...Object.keys(sharedSources)]);
  if (options.validateRequired ?? true) {
    const missing = flattenRequired(REQUIRED_PRIMITIVES[format]).filter((n) => !available.has(n));
    if (missing.length > 0) {
      out.push({
        kind: "required-missing",
        message: `missing required template(s) for format ${format}: ${missing.join(", ")} (declare each in pack.json's \`emits\` map; the per-format set is in src/generator/_packs/required-primitives.ts)`,
      });
    }
  }
  for (const [key, outputPath] of Object.entries(manifest.shellFiles ?? {})) {
    if (!available.has(key)) {
      out.push({
        kind: "shellfile-not-emitted",
        message: `shellFiles entry "${key}" → "${outputPath}" is not present in the emits map`,
      });
    }
  }
  out.push(...chromeDeclarationDefects(manifest));
  // Template scan: the pack's own templates, plus the shared ones it does not
  // override (they render under this pack's chrome map too).  It parses every
  // template, which roughly doubles a load, so `compilePack` leaves it to the
  // inspection phase ⑦ runs (`inspectPackDir`); the renderer's chrome helpers
  // keep a coded backstop for a model that skipped validation.
  if (!(options.scanTemplates ?? true)) return out;
  const templates: Array<[string, string]> = Object.entries(sources);
  for (const [name, source] of Object.entries(sharedSources)) {
    if (sources[name] == null && !(name in manifest.emits)) templates.push([name, source]);
  }
  for (const [name, source] of templates) {
    out.push(...templateSourceDefects(name, source, manifest, format, available));
  }
  return out;
}
